import { LocalRecordsFileRefused } from '../session/localBackendContract.js';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES } from '../../../server/src/attachments/rules.js';
import { backedUpKeys } from './attachments.js';
import { readBytes, type IndexedDbBlobStore, type StoredFile } from './blobStore.js';
import type { StoredSnapshot } from './migrations/index.js';
import { decodeRecordsFile, encodeRecordsFile } from './recordsFile.js';

/**
 * "Download my records" with receipts (MUT-287, eng review R2 / D3): a zip of
 * `records.json` (the MUT-286 records file, unchanged) and one binary entry
 * per receipt file under `receipts/<storage key>`. Binary entries keep the
 * file free of base64 and of any text-size ceiling. jszip loads only here,
 * on Download or Restore, never with the app.
 */

const RECORDS_ENTRY = 'records.json';
const RECEIPTS_DIR = 'receipts/';
const ZIP_MIME = 'application/zip';
/** Every zip starts with the local-file-header signature "PK". */
const ZIP_MAGIC = [0x50, 0x4b];

export interface DecodedRecordsArchive {
  snapshot: Omit<StoredSnapshot, 'stateVersion'>;
  /**
   * Visible receipts (READY) whose file this records file can't supply: absent
   * (a MUT-286 `.json`, a damaged or trimmed zip) or refused by the upload
   * rules. Known before the confirm, so the person is told (review D4).
   */
  missing: string[];
  /**
   * Unpacks the receipt files, only when the person replaces (review D5):
   * cancelling never decompresses them. A file whose real size differs from
   * its receipt joins `missing` here.
   */
  readFiles(): Promise<{ files: Array<{ key: string } & StoredFile>; missing: string[] }>;
}

async function loadJsZip() {
  return (await import('jszip')).default;
}

/** What goes in a records file: the records as text and each live file's bytes, read under the lock. */
export interface RecordsArchiveContents {
  recordsJson: string;
  files: Array<{ key: string; bytes: ArrayBuffer }>;
}

/** Under the lock, over an up-to-date snapshot: copies the records and every live stored file (review D3: the zipping runs after, outside it). */
export async function collectRecordsArchive(snapshot: StoredSnapshot, blobs: IndexedDbBlobStore): Promise<RecordsArchiveContents> {
  const files: RecordsArchiveContents['files'] = [];
  for (const key of backedUpKeys(snapshot.maps)) {
    const file = await blobs.getFile(key);
    if (file) files.push({ key, bytes: file.bytes });
  }
  return { recordsJson: encodeRecordsFile(snapshot), files };
}

/** No lock needed: the bytes were already copied. */
export async function zipRecordsArchive(contents: RecordsArchiveContents): Promise<Blob> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  zip.file(RECORDS_ENTRY, contents.recordsJson);
  // A view made here: jszip type-checks with instanceof, and a buffer IndexedDB cloned can belong to another realm.
  // STORE: receipts are PDF/JPEG/PNG, already compressed, so DEFLATE would only cost time.
  for (const { key, bytes } of contents.files) zip.file(`${RECEIPTS_DIR}${key}`, new Uint8Array(bytes), { binary: true, compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: ZIP_MIME, compression: 'DEFLATE' });
}

/** Both steps at once (tests, and callers that hold no lock). */
export async function encodeRecordsArchive(snapshot: StoredSnapshot, blobs: IndexedDbBlobStore): Promise<Blob> {
  return zipRecordsArchive(await collectRecordsArchive(snapshot, blobs));
}

/** A zip from this build (or re-made from the folder it was extracted into), or a MUT-286 `.json`. Refuses anything else with `LocalRecordsFileRefused`. */
export async function decodeRecordsArchive(file: Blob): Promise<DecodedRecordsArchive> {
  const bytes = await readBytes(file);
  if (!isZip(bytes)) {
    const snapshot = decodeRecordsFile(new TextDecoder().decode(bytes));
    const missing = visibleReceipts(snapshot).map((r) => r.storageKey);
    return { snapshot, missing, readFiles: async () => ({ files: [], missing }) };
  }

  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new LocalRecordsFileRefused('not-a-records-file');
  });
  const root = recordsRoot(Object.keys(zip.files));
  const records = zip.file(`${root}${RECORDS_ENTRY}`);
  if (!records) throw new LocalRecordsFileRefused('not-a-records-file');
  const snapshot = decodeRecordsFile(await records.async('string'));

  const candidates: Array<{ receipt: VisibleReceipt; entry: ZipEntry }> = [];
  const missing: string[] = [];
  for (const receipt of visibleReceipts(snapshot)) {
    const entry = zip.file(`${root}${RECEIPTS_DIR}${receipt.storageKey}`);
    if (entry && passesUploadRules(receipt, declaredSize(entry))) candidates.push({ receipt, entry });
    else missing.push(receipt.storageKey);
  }

  return {
    snapshot,
    missing,
    readFiles: async () => {
      const files: Array<{ key: string } & StoredFile> = [];
      const alsoMissing = [...missing];
      for (const { receipt, entry } of candidates) {
        const content = await entry.async('arraybuffer');
        if (passesUploadRules(receipt, content.byteLength)) files.push({ key: receipt.storageKey, type: receipt.mimeType, bytes: content });
        else alsoMissing.push(receipt.storageKey);
      }
      return { files, missing: alsoMissing };
    },
  };
}

type ZipEntry = { async(type: 'arraybuffer'): Promise<ArrayBuffer>; _data?: { uncompressedSize?: unknown } };

interface VisibleReceipt {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

/** READY, not deleted, with a usable key: the receipts a person sees and can download. */
function visibleReceipts(snapshot: Omit<StoredSnapshot, 'stateVersion'>): VisibleReceipt[] {
  return [...snapshot.maps.expReceipts.values()]
    .filter((r) => r.status === 'READY' && !r.deletedAt && typeof r.storageKey === 'string' && r.storageKey !== '')
    .map((r) => ({ storageKey: r.storageKey, mimeType: r.mimeType, sizeBytes: r.sizeBytes }));
}

/** Where records.json sits: the zip's root, or the one folder Safari's "open safe files" unzipped it into and the person zipped again. */
function recordsRoot(names: string[]): string {
  if (names.includes(RECORDS_ENTRY)) return '';
  const folders = names.filter((name) => /^[^/]+\/records\.json$/.test(name)).map((name) => name.slice(0, -RECORDS_ENTRY.length));
  if (folders.length !== 1) throw new LocalRecordsFileRefused('not-a-records-file');
  return folders[0]!;
}

/** The entry's uncompressed size from the zip's own directory, read without unpacking it; unknown when jszip doesn't say. */
function declaredSize(entry: ZipEntry): number | null {
  const size = entry._data?.uncompressedSize;
  return typeof size === 'number' ? size : null;
}

/** The upload rules, held to restored files too (review D5): a receipt type, at most 10 MB, and exactly the size its receipt declares. */
function passesUploadRules(receipt: VisibleReceipt, size: number | null): boolean {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(receipt.mimeType)) return false;
  if (receipt.sizeBytes > MAX_ATTACHMENT_BYTES) return false;
  return size === null || size === receipt.sizeBytes;
}

function isZip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(ZIP_MAGIC.length, bytes.byteLength));
  return ZIP_MAGIC.every((byte, i) => head[i] === byte);
}
