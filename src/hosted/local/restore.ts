import type { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { liveStoredKeys, sweepBlobs } from './attachments.js';
import type { IndexedDbBlobStore, StoredFile } from './blobStore.js';
import type { LocalLock } from './locks.js';
import { LOCAL_FORMAT_VERSION, type StoredSnapshot } from './migrations/index.js';
import type { IndexedDbPersistence } from './persistence.js';
import { reloadFromDisk } from './transport.js';

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
export async function applyRestore(deps: RestoreDependencies, snapshot: Omit<StoredSnapshot, 'stateVersion'>, files: ReadonlyArray<{ key: string } & StoredFile>): Promise<void> {
  const { lock, persistence, store, blobs, now } = deps;
  await lock.withLock(async ({ stale, onDiskVersion }) => {
    // Another tab may have saved since this one loaded: its records name files this tab's memory doesn't.
    if (stale) await reloadFromDisk(store, persistence);
    await blobs.putFiles(files);
    try {
      await persistence.save({ ...snapshot, formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now() });
    } catch (error) {
      // The save was refused (often storage full, which the files just added make likelier). Delete only what
      // step 1 added that this device's own records don't name; nothing else is this call's to delete.
      const live = liveStoredKeys(store.snapshot().maps, now());
      await blobs.delete(files.map((f) => f.key).filter((key) => !live.has(key))).catch(() => undefined);
      throw error;
    }
    store.restore(snapshot);
    await sweepBlobs(blobs, liveStoredKeys(store.snapshot().maps, now())).catch(() => undefined);
    return { result: undefined, wrote: true };
  });
}
