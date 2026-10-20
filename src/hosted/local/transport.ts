import type { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import type { LocalLock } from './locks.js';
import type { IndexedDbPersistence } from './persistence.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export type LocalTransport = (request: Request) => Promise<Response>;

export interface LocalTransportOptions {
  /** `createLocalApp`'s return value; typed structurally so this file doesn't need `@hono/zod-openapi`'s own type (see `createLocalApp.ts`'s docblock on why that import doesn't resolve from here). */
  app: { fetch(request: Request): Response | Promise<Response> };
  store: MemoryLedgerStore;
  persistence: IndexedDbPersistence;
  lock: LocalLock;
  now: () => Date;
  /** Receipt files a request staged for deletion (`LocalAttachmentStorage`, MUT-287): deleted only once that request's snapshot saved. */
  removals?: StagedRemovals;
}

export interface StagedRemovals {
  flushRemovals(): Promise<void>;
  discardRemovals(): void;
}

/**
 * Thrown instead of running a request when another tab has already written a
 * snapshot in a newer format than this page's code knows (D1): refusing the
 * whole request, not only the write half, is the safe default when this
 * tab's in-memory shape of the data can no longer be trusted. Phase C catches
 * this and shows the "reload to continue" screen the brief specifies.
 */
export class LocalFormatTooNewError extends Error {
  readonly storedFormatVersion: number;

  constructor(storedFormatVersion: number) {
    super(`Another tab saved local data in a newer format (${storedFormatVersion} > ${LOCAL_FORMAT_VERSION}). Reload to continue.`);
    this.name = 'LocalFormatTooNewError';
    this.storedFormatVersion = storedFormatVersion;
  }
}

/**
 * The browser refused to save (storage full, or storage taken away): this
 * page's memory may now hold a write the disk doesn't, and its idempotency
 * records would replay it as saved. So the page stops: every request after it
 * rejects with this, and Phase C shows "reload to continue". A reload rebuilds
 * memory from disk, where nothing unsaved was ever recorded.
 */
export class LocalSaveFailedError extends Error {
  constructor(cause: unknown) {
    super('This browser refused to save the records on this device. Reload to continue.', { cause });
    this.name = 'LocalSaveFailedError';
  }
}

/**
 * Another tab wrote since this one last knew: make this tab's in-memory store
 * the on-disk snapshot before reading or writing anything (call under the
 * lock). Refuses a newer format (D1). An 'empty' result would mean another
 * tab's write vanished between its version bump and this read, which can't
 * happen (both land in one IndexedDB transaction), so memory stays as it is.
 */
export async function reloadFromDisk(store: MemoryLedgerStore, persistence: IndexedDbPersistence): Promise<void> {
  const loaded = await persistence.load();
  if (loaded.kind === 'too-new') throw new LocalFormatTooNewError(loaded.storedFormatVersion);
  if (loaded.kind === 'ok') store.restore(loaded.snapshot);
}

/**
 * `(req: Request) => Promise<Response>`, matching `fetch`'s own shape so it
 * drops into `client.ts`'s transport seam (Phase C) in place of same-origin
 * `fetch`. Implements the durability sequence from the plan (§2.5, §13.4):
 *
 *  1. take the lock (`LocalLock.withLock`, exclusive across tabs);
 *  2. if another tab wrote since this tab last knew, reload this tab's
 *     in-memory store from the on-disk snapshot *before* running the request
 *     — otherwise this request's own change would be based on stale data and
 *     could silently undo the other tab's write (the race `locks.test.ts`
 *     exercises directly);
 *  3. run the request against the (now up to date) local app;
 *  4. on a mutating method (`POST`/`PATCH`/`PUT`/`DELETE`) with a 2xx/204
 *     response, persist the store's new snapshot in one transaction and bump
 *     `stateVersion` — a non-mutating request, or one that failed, writes
 *     nothing and leaves the version where it was;
 *  5. release the lock and resolve with the response.
 *
 * A tab closed mid-write aborts the IndexedDB transaction (`persistence.ts`);
 * nothing the person saw as "saved" is lost, because step 4 hadn't resolved
 * yet to tell them so.
 */
export function createLocalTransport(options: LocalTransportOptions): LocalTransport {
  const { app, store, persistence, lock, now, removals } = options;

  let stopped: LocalSaveFailedError | null = null;

  return (request: Request): Promise<Response> => {
    if (stopped) return Promise.reject(stopped);
    return lock.withLock(async ({ stale, onDiskVersion }) => {
      try {
        if (stale) await reloadFromDisk(store, persistence);

        const response = await app.fetch(request);

        const wrote = MUTATING_METHODS.has(request.method) && response.status >= 200 && response.status < 300;
        if (wrote) {
          const { maps } = store.snapshot();
          try {
            await persistence.save({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now(), maps });
          } catch (cause) {
            stopped = new LocalSaveFailedError(cause);
            throw stopped;
          }
          // Still under the lock: no other tab's Restore or sweep can run between this save and the deletes it allows.
          await removals?.flushRemovals();
        }

        return { result: response, wrote };
      } finally {
        // Whatever this request staged and did not get to delete (refused, failed, or not saved) is forgotten; after a flush this is a no-op.
        removals?.discardRemovals();
      }
    });
  };
}
