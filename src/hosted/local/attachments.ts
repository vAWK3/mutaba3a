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

  async head(key: string): Promise<StoredObject | null> {
    const blob = await this.blobs.get(key);
    return blob ? { sizeBytes: blob.size, contentType: blob.type || null } : null;
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

/**
 * Every file a live record still needs: receipts (READY and PENDING_UPLOAD
 * alike, so an upload in flight in another tab is never swept) and documents,
 * which share this storage (`attachmentRoutes`) even though none can be
 * uploaded signed out today.
 */
export function liveStoredKeys(maps: LocalSnapshotMaps): Set<string> {
  const keys = new Set<string>();
  for (const receipt of maps.expReceipts.values()) if (!receipt.deletedAt && typeof receipt.storageKey === 'string' && receipt.storageKey) keys.add(receipt.storageKey);
  for (const file of maps.files.values()) if (!file.deletedAt && typeof file.storageKey === 'string' && file.storageKey) keys.add(file.storageKey);
  return keys;
}

/** Deletes every stored file `live` doesn't name; returns how many. Run under the lock, over an up-to-date store. */
export async function sweepBlobs(blobs: IndexedDbBlobStore, live: ReadonlySet<string>): Promise<number> {
  const orphans = (await blobs.keys()).filter((key) => !live.has(key));
  await blobs.delete(orphans);
  return orphans.length;
}
