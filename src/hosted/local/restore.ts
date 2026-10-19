import type { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { liveReceiptKeys, sweepBlobs } from './attachments.js';
import type { IndexedDbBlobStore } from './blobStore.js';
import type { LocalLock } from './locks.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import type { IndexedDbPersistence } from './persistence.js';
import type { DecodedRecordsArchive } from './recordsArchive.js';

export interface RestoreDependencies {
  lock: LocalLock;
  persistence: IndexedDbPersistence;
  store: MemoryLedgerStore;
  blobs: IndexedDbBlobStore;
  now: () => Date;
}

/**
 * Replaces every local record and receipt file with a backup's (Your data ›
 * Restore). Records and files live in two databases (eng review R1), so this
 * is crash-safe by order rather than one transaction, all under the lock:
 *
 *  1. add the backup's receipt files (nothing deleted yet);
 *  2. save the backup's records: disk first, so a refused save leaves memory
 *     and disk on this device's own records, whose files are all still there;
 *  3. only then delete the files the new records no longer name.
 *
 * A crash after 1 leaves extra files, which the next boot sweeps.
 */
export async function applyRestore(deps: RestoreDependencies, decoded: DecodedRecordsArchive): Promise<void> {
  const { lock, persistence, store, blobs, now } = deps;
  await lock.withLock(async ({ onDiskVersion }) => {
    await blobs.putFiles(decoded.files);
    await persistence.save({ ...decoded.snapshot, formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now() });
    store.restore(decoded.snapshot);
    await sweepBlobs(blobs, liveReceiptKeys(store.snapshot().maps)).catch(() => undefined);
    return { result: undefined, wrote: true };
  });
}
