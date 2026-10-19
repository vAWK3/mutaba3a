import type { AttachmentStorage, SignedUrl, StoredObject } from '../../../server/src/attachments/storage.js';
import type { LocalSnapshotMaps } from '../../../server/src/repositories/memory.js';
import { localBlobUrl } from '../session/localBackendContract.js';
import type { IndexedDbBlobStore } from './blobStore.js';

/**
 * The server's `AttachmentStorage`, on this device (MUT-287, brief §6). The
 * receipt routes run unchanged: they sign `local-blob:<key>` URLs (the
 * portal's local branches put and read the bytes), `head` the stored Blob for
 * the size/type check on complete, and `remove` on delete.
 *
 * `remove` only stages the key. The transport deletes staged files after the
 * request's snapshot has saved (`flushRemovals`) and forgets them otherwise
 * (`discardRemovals`), so a save that fails never leaves a receipt whose file
 * is already gone. Requests run one at a time under the lock, so one staging
 * set is enough.
 */
export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly staged = new Set<string>();

  constructor(private readonly blobs: IndexedDbBlobStore) {}

  async signUpload(key: string, input: { mimeType: string; sizeBytes: number; ttlSeconds: number; now: Date }): Promise<SignedUrl & { headers: Record<string, string> }> {
    return { url: localBlobUrl(key), expiresAt: expiry(input), headers: { 'Content-Type': input.mimeType } };
  }

  async signDownload(key: string, input: { filename: string; mimeType: string; ttlSeconds: number; now: Date }): Promise<SignedUrl> {
    return { url: localBlobUrl(key), expiresAt: expiry(input) };
  }

  /** From the stored `{ type, size }` alone: the bytes are never loaded to answer it (review D11). */
  async head(key: string): Promise<StoredObject | null> {
    const stat = await this.blobs.stat(key);
    return stat ? { sizeBytes: stat.size, contentType: stat.type || null } : null;
  }

  async remove(key: string): Promise<void> {
    this.staged.add(key);
  }

  /** After the snapshot saved. A failed delete only leaves an orphan, which the next boot sweeps. */
  async flushRemovals(): Promise<void> {
    const keys = [...this.staged];
    this.staged.clear();
    await this.blobs.delete(keys).catch(() => undefined);
  }

  discardRemovals(): void {
    this.staged.clear();
  }
}

function expiry(input: { ttlSeconds: number; now: Date }): Date {
  return new Date(input.now.getTime() + input.ttlSeconds * 1000);
}

/** A `local-blob:` URL's lifetime, and how long a pending upload's file is kept for it (review D6). Same as the server's default. */
export const LOCAL_URL_TTL_SECONDS = 900;

interface StoredRecord {
  storageKey: unknown;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
}

function storedRecords(maps: LocalSnapshotMaps): StoredRecord[] {
  return [...maps.expReceipts.values(), ...maps.files.values()].filter((r) => !r.deletedAt && typeof r.storageKey === 'string' && r.storageKey !== '');
}

/**
 * Every file a live record still needs, for the sweeps: READY receipts and
 * documents (which share this storage through `attachmentRoutes`, though none
 * can be uploaded signed out today), and a pending upload's file while its
 * upload link is still valid, so another tab's upload in flight is never
 * swept, and an abandoned one is (review D6).
 */
export function liveStoredKeys(maps: LocalSnapshotMaps, now: Date): Set<string> {
  const pendingSince = now.getTime() - LOCAL_URL_TTL_SECONDS * 1000;
  const keys = new Set<string>();
  for (const record of storedRecords(maps)) {
    if (record.status !== 'READY' && record.createdAt.getTime() < pendingSince) continue;
    keys.add(record.storageKey as string);
  }
  return keys;
}

/**
 * The files a records file carries: READY receipts, the ones a person can
 * see, never a half-finished upload. Receipts only, because Restore reads
 * back receipts only; documents can't be uploaded signed out.
 */
export function backedUpKeys(maps: LocalSnapshotMaps): Set<string> {
  const keys = new Set<string>();
  for (const r of maps.expReceipts.values()) if (!r.deletedAt && r.status === 'READY' && typeof r.storageKey === 'string' && r.storageKey) keys.add(r.storageKey);
  return keys;
}

/** Deletes every stored file `live` doesn't name; returns how many. Run under the lock, over an up-to-date store. */
export async function sweepBlobs(blobs: IndexedDbBlobStore, live: ReadonlySet<string>): Promise<number> {
  const orphans = (await blobs.keys()).filter((key) => !live.has(key));
  await blobs.delete(orphans);
  return orphans.length;
}
