import type { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import type { LocalLock } from './locks.js';
import type { IndexedDbPersistence } from './persistence.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export type LocalTransport = (request: Request) => Promise<Response>;

export interface LocalTransportOptions {
  /** `createLocalApp`'s return value; typed structurally so this file doesn't need `@hono/zod-openapi`'s own type (see `createLocalApp.ts`'s docblock on why that import doesn't resolve from here). */
  app: { fetch(request: Request): Promise<Response> };
  store: MemoryLedgerStore;
  persistence: IndexedDbPersistence;
  lock: LocalLock;
  now: () => Date;
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
  const { app, store, persistence, lock, now } = options;

  return (request: Request): Promise<Response> =>
    lock.withLock(async ({ stale, onDiskVersion }) => {
      if (stale) {
        const loaded = await persistence.load();
        if (loaded.kind === 'too-new') throw new LocalFormatTooNewError(loaded.storedFormatVersion);
        if (loaded.kind === 'ok') store.restore(loaded.snapshot);
        // 'empty' here would mean another tab's write somehow vanished between the version bump and this read —
        // not a reachable state in practice (the two happen in the same IndexedDB transaction) — so there is
        // nothing to restore and this tab's current in-memory data is simply what there is.
      }

      const response = await app.fetch(request);

      const wrote = MUTATING_METHODS.has(request.method) && response.status >= 200 && response.status < 300;
      if (wrote) {
        const { maps } = store.snapshot();
        await persistence.save({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now(), maps });
      }

      return { result: response, wrote };
    });
}
