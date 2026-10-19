import { LocalRecordsFileRefused } from '../session/localBackendContract.js';
import { liveReceiptKeys } from './attachments.js';
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
  /** Receipt files for receipts the records name; entries nobody names are ignored. */
  files: Array<{ key: string } & StoredFile>;
  /** Receipts the records name whose file the archive doesn't hold: restored without it (its download then fails with the usual toast). */
  missing: string[];
}

async function loadJsZip() {
  return (await import('jszip')).default;
}

/** Records plus every live receipt's stored file. Call under the lock, over an up-to-date snapshot. */
export async function encodeRecordsArchive(snapshot: StoredSnapshot, blobs: IndexedDbBlobStore): Promise<Blob> {
  const JSZip = await loadJsZip();
  const zip = new JSZip();
  zip.file(RECORDS_ENTRY, encodeRecordsFile(snapshot));
  for (const key of liveReceiptKeys(snapshot.maps)) {
    const file = await blobs.getFile(key);
    // A view made here: jszip type-checks with instanceof, and a buffer IndexedDB cloned can belong to another realm.
    if (file) zip.file(`${RECEIPTS_DIR}${key}`, new Uint8Array(file.bytes), { binary: true });
  }
  return zip.generateAsync({ type: 'blob', mimeType: ZIP_MIME, compression: 'DEFLATE' });
}

/** A zip from this build, or a MUT-286 `.json` records file. Refuses anything else with `LocalRecordsFileRefused`. */
export async function decodeRecordsArchive(file: Blob): Promise<DecodedRecordsArchive> {
  const bytes = await readBytes(file);
  if (!isZip(bytes)) return { snapshot: decodeRecordsFile(new TextDecoder().decode(bytes)), files: [], missing: [] };

  const JSZip = await loadJsZip();
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new LocalRecordsFileRefused('not-a-records-file');
  });
  const records = zip.file(RECORDS_ENTRY);
  if (!records) throw new LocalRecordsFileRefused('not-a-records-file');
  const snapshot = decodeRecordsFile(await records.async('string'));

  const files: DecodedRecordsArchive['files'] = [];
  const missing: string[] = [];
  for (const receipt of snapshot.maps.expReceipts.values()) {
    if (receipt.deletedAt || !receipt.storageKey) continue;
    const entry = zip.file(`${RECEIPTS_DIR}${receipt.storageKey}`);
    if (entry) files.push({ key: receipt.storageKey, type: receipt.mimeType, bytes: await entry.async('arraybuffer') });
    else missing.push(receipt.storageKey);
  }
  return { snapshot, files, missing };
}

function isZip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(ZIP_MAGIC.length, bytes.byteLength));
  return ZIP_MAGIC.every((byte, i) => head[i] === byte);
}
