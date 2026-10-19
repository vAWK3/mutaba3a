import { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { localBlobKey, type BootLocalBackend, type LocalBackend, type PendingRestore } from '../session/localBackendContract.js';
import { LocalAttachmentStorage, liveReceiptKeys, sweepBlobs } from './attachments.js';
import { IndexedDbBlobStore } from './blobStore.js';
import { createLocalApp } from './createLocalApp.js';
import { LocalLock } from './locks.js';
import { mintLocalSession, type LocalSession } from './mintLocalSession.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import { IndexedDbPersistence } from './persistence.js';
import { installBufferShim } from './platform/buffer-shim.js';
import { countRecords, decodeRecordsFile, encodeRecordsFile } from './recordsFile.js';
import { createLocalTransport, LocalFormatTooNewError, reloadFromDisk } from './transport.js';

/**
 * The lazy local-mode chunk's one entry (MUT-286 Phase C; brief §2.1, §2.7),
 * reached only through the `@mut/local-backend` alias (see
 * `session/localBackendContract.ts`). Booted once per page:
 *
 *  1. load the snapshot (refusing a newer format, migrating an older one);
 *  2. find or create the local person and mint this page's device session;
 *  3. on a first-ever boot, save at once (under the lock), so the personal
 *     profile's id, and every `/p/<id>` URL, survives a reload with nothing
 *     entered yet.
 *
 * Every request then goes through `transport.ts` with the session's bearer
 * token attached. A 401 means another tab replaced the records (Restore) and
 * this page's session belonged to the person who was there before: it mints
 * a fresh one and retries once, which is what a local person should see.
 */

const now = () => new Date();

async function boot(): Promise<LocalBackend> {
  installBufferShim();
  const store = new MemoryLedgerStore();
  const persistence = new IndexedDbPersistence();
  const lock = new LocalLock(persistence);

  const loaded = await persistence.load();
  if (loaded.kind === 'too-new') throw new LocalFormatTooNewError(loaded.storedFormatVersion);
  if (loaded.kind === 'ok') {
    store.restore(loaded.snapshot);
    lock.noteLoadedVersion(loaded.snapshot.stateVersion);
  }

  let session = loaded.kind === 'empty' ? await createOnFirstBoot(lock, persistence, store) : await mintLocalSession(store, now, 'ar');

  const blobs = new IndexedDbBlobStore();
  const attachments = new LocalAttachmentStorage(blobs);
  await sweepUnusedBlobs(lock, persistence, store, blobs);

  const app = createLocalApp({ store, now, attachments });
  const transport = createLocalTransport({ app, store, persistence, lock, now, removals: attachments });
  let persistRequested = false;

  async function send(request: Request): Promise<Response> {
    const authorised = new Request(request, { headers: withBearer(request.headers, session.token) });
    const response = await transport(authorised);
    if (!persistRequested && isWrite(request.method) && response.ok) {
      persistRequested = true;
      // D2: asked once, after the first saved record; browsers decide silently, so the answer is ignored.
      void navigator.storage?.persist?.().catch(() => undefined);
    }
    return response;
  }

  async function fetchLocal(request: Request): Promise<Response> {
    // Cloned before the first try: a body can only be read once, and the retry needs it again.
    const retry = request.clone();
    const response = await send(request);
    if (response.status !== 401) return response;
    session = await mintLocalSession(store, now, 'ar');
    return send(retry);
  }

  async function readRecordsFile(file: Blob): Promise<PendingRestore> {
    const decoded = decodeRecordsFile(await file.text());
    return {
      recordCount: countRecords(decoded.maps),
      apply: async () => {
        await lock.withLock(async ({ onDiskVersion }) => {
          // Disk first: if the browser refuses the save, memory still holds this device's records, not the file's.
          await persistence.save({ ...decoded, formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now() });
          store.restore(decoded);
          // After the save (eng review R1): until then, the records being replaced still had their files.
          await sweepBlobs(blobs, liveReceiptKeys(store.snapshot().maps)).catch(() => undefined);
          return { result: undefined, wrote: true };
        });
        session = await mintLocalSession(store, now, 'ar');
      },
    };
  }

  return {
    fetch: fetchLocal,
    onRemoteWrite: (handler) => lock.onRemoteWrite(() => handler()),
    // Under the lock, from disk if another tab wrote since: a download must hold every save this device has made.
    exportRecords: () =>
      lock.withLock(async ({ stale }) => {
        if (stale) await reloadFromDisk(store, persistence);
        const { maps } = store.snapshot();
        const text = encodeRecordsFile({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: 0, savedAt: now(), maps });
        return { result: new Blob([text], { type: 'application/json' }), wrote: false };
      }),
    readRecordsFile,
    putBlob: async (url, file) => blobs.put(localBlobKey(url), file),
    readBlob: async (url) => blobs.get(localBlobKey(url)),
  };
}

/**
 * On boot, under the lock and over the latest snapshot: deletes stored files
 * no live receipt names. They're left by a crash between a save and its
 * deletes, or by an upload whose receipt never saved. A pending upload's file
 * is kept, even another tab's. Best effort: a failure here never stops boot.
 */
async function sweepUnusedBlobs(lock: LocalLock, persistence: IndexedDbPersistence, store: MemoryLedgerStore, blobs: IndexedDbBlobStore): Promise<void> {
  await lock
    .withLock(async ({ stale }) => {
      if (stale) await reloadFromDisk(store, persistence);
      await sweepBlobs(blobs, liveReceiptKeys(store.snapshot().maps));
      return { result: undefined, wrote: false };
    })
    .catch(() => undefined);
}

/**
 * The first boot on this device, under the lock: two tabs opened together on
 * an empty database must not each create a person and overwrite the other's.
 * The second one finds the first's snapshot (stale), adopts it, and saves
 * nothing.
 */
async function createOnFirstBoot(lock: LocalLock, persistence: IndexedDbPersistence, store: MemoryLedgerStore): Promise<LocalSession> {
  return lock.withLock(async ({ stale, onDiskVersion }) => {
    if (stale) {
      const again = await persistence.load();
      if (again.kind === 'too-new') throw new LocalFormatTooNewError(again.storedFormatVersion);
      if (again.kind === 'ok') store.restore(again.snapshot);
    }
    const session = await mintLocalSession(store, now, 'ar');
    if (stale) return { result: session, wrote: false };
    const { maps } = store.snapshot();
    await persistence.save({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: onDiskVersion + 1, savedAt: now(), maps });
    return { result: session, wrote: true };
  });
}

function withBearer(headers: Headers, token: string): Headers {
  const next = new Headers(headers);
  next.set('Authorization', `Bearer ${token}`);
  return next;
}

function isWrite(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

let booted: Promise<LocalBackend> | null = null;

/** Memoized: every caller in this page shares one backend. A failed boot is forgotten so the next request tries again. */
export const bootLocalBackend: BootLocalBackend = () => {
  booted ??= boot().catch((error: unknown) => {
    booted = null;
    throw error;
  });
  return booted;
};
