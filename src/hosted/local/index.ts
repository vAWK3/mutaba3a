import { CachedFxRates } from '../../../server/src/fx-rates.js';
import { MemoryLedgerStore } from '../../../server/src/repositories/memory.js';
import { LocalRecordsFileRefused, localBlobKey, type BootLocalBackend, type CarryOverPayloadKind, type CarryOverPrepareOptions, type LocalBackend, type PendingRestore } from '../session/localBackendContract.js';
import { LocalAttachmentStorage, liveStoredKeys, sweepBlobs } from './attachments.js';
import { IndexedDbBlobStore, readBytes } from './blobStore.js';
import { CarryOverCheckFailed, countsOf, prepareFromBackup, type PreparedCarryOver } from './carryOver/index.js';
import { FreeAppBackupRefused, looksLikeFreeAppBackup, parseFreeAppBackupValue } from './carryOver/freeAppBackup.js';
import { CarryOverAborted } from './carryOver/replay.js';
import { snapshotTotals, totalsByCurrency } from './carryOver/totals.js';
import { createLocalApp } from './createLocalApp.js';
import { PublicFxRateSource } from './fxSource.js';
import { LocalLock } from './locks.js';
import { mintLocalSession, type LocalSession } from './mintLocalSession.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import { IndexedDbPersistence } from './persistence.js';
import { collectRecordsArchive, decodeRecordsArchive, zipRecordsArchive } from './recordsArchive.js';
import { countRecords } from './recordsFile.js';
import { applyRestore } from './restore.js';
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
 *     entered yet;
 *  4. delete stored files no live record names (best effort, under the lock;
 *     MUT-287), then wire receipt files (`mut-local-blobs`) and reference rates
 *     (`GET /v1/public/fx-rates`, cached in the page) into the local app.
 *
 * Every request then goes through `transport.ts` with the session's bearer
 * token attached. A 401 means another tab replaced the records (Restore) and
 * this page's session belonged to the person who was there before: it mints
 * a fresh one and retries once, which is what a local person should see.
 */

const now = () => new Date();

/** How long this page reuses the public snapshot before asking again. The ECB publishes once a business day; the server caches longer still. */
const LOCAL_FX_TTL_MS = 60 * 60 * 1000;

async function boot(): Promise<LocalBackend> {
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

  const fxRates = new CachedFxRates({ source: new PublicFxRateSource(), ttlMs: LOCAL_FX_TTL_MS, now });
  const app = createLocalApp({ store, now, attachments, fxRates });
  const transport = createLocalTransport({ app, store, persistence, lock, now, removals: attachments });
  let persistRequested = false;

  async function send(request: Request): Promise<Response> {
    // Review D2: a reference-rates fetch reads no records, so it runs here, before the cross-tab lock. Inside it the
    // route then reads the warm cache (or the failure backoff) and never waits on the network. MUT-447: the Reports
    // verdict converts with the same rates, so it is warmed the same way.
    if (readsFxRates(request)) await fxRates.get().catch(() => undefined);
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

  async function readRecordsFile(file: Blob, carryOver?: CarryOverPrepareOptions): Promise<PendingRestore> {
    const freeAppBackup = await freeAppBackupIn(file);
    if (freeAppBackup !== null) {
      if (!carryOver) throw new LocalRecordsFileRefused('not-a-records-file');
      return pendingCarryOver(await prepareCarriedBackup(freeAppBackup, carryOver));
    }
    const decoded = await decodeRecordsArchive(file);
    return {
      recordCount: countRecords(decoded.snapshot.maps),
      missingReceiptFiles: decoded.missing.length,
      exportedFromAccountAt: decoded.fromAccount ? decoded.snapshot.savedAt : null,
      deviceRecordCount: countRecords(store.snapshot().maps),
      // MUT-291: the old address's records arrive as its own records file; the summary names what it holds.
      ...(carryOver ? { carryOver: { counts: { ...countsOf(decoded.snapshot.maps) }, totals: totalsByCurrency(snapshotTotals(decoded.snapshot.maps)), changed: [], notCarried: decoded.missing.length > 0 ? [{ code: 'receipt-file-unreadable', count: decoded.missing.length }] : [], jodEntries: 0 } } : {}),
      apply: async () => {
        // Unpacked only now, outside the lock; the lock covers just the add, save and sweep (restore.ts).
        const { files, missing } = await decoded.readFiles();
        if (missing.length > decoded.missing.length) console.warn('[mutaba3a local]', missing.length - decoded.missing.length, 'receipt file(s) in the records file did not match their receipt and were left out');
        await applyRestore({ lock, persistence, store, blobs, now }, decoded.snapshot, files);
        session = await mintLocalSession(store, now, 'ar');
      },
    };
  }

  /** MUT-291: the old web app's backup, mapped and replayed through a throwaway local app, then checked (E4); nothing written yet. */
  async function prepareCarriedBackup(raw: unknown, options: CarryOverPrepareOptions): Promise<PreparedCarryOver> {
    try {
      const backup = parseFreeAppBackupValue(raw);
      return await prepareFromBackup(backup, { now, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: options.locale, labels: options.labels, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    } catch (error) {
      if (error instanceof FreeAppBackupRefused) throw new LocalRecordsFileRefused(error.reason === 'too-new' ? 'too-new' : 'not-a-records-file');
      if (error instanceof CarryOverCheckFailed || error instanceof CarryOverAborted) {
        console.warn('[mutaba3a local] carry-over check failed', error);
        throw new LocalRecordsFileRefused('carry-over-failed');
      }
      throw error;
    }
  }

  function pendingCarryOver(prepared: PreparedCarryOver): PendingRestore {
    const { counts } = prepared;
    return {
      recordCount: counts.clients + counts.projects + counts.income + counts.payments + counts.expenses + counts.conversions,
      missingReceiptFiles: 0,
      exportedFromAccountAt: null,
      deviceRecordCount: countRecords(store.snapshot().maps),
      carryOver: { counts: { ...counts }, totals: prepared.totals, changed: prepared.report.changed, notCarried: prepared.report.notCarried, jodEntries: prepared.report.jodEntries },
      apply: async () => {
        await applyRestore({ lock, persistence, store, blobs, now }, prepared.snapshot, prepared.files);
        session = await mintLocalSession(store, now, 'ar');
      },
    };
  }

  async function prepareCarryOver(kind: CarryOverPayloadKind, payload: Blob, options: CarryOverPrepareOptions): Promise<PendingRestore> {
    if (kind === 'records-file') return readRecordsFile(payload, options);
    const raw = await freeAppBackupIn(payload);
    if (raw === null) throw new LocalRecordsFileRefused('not-a-records-file');
    return pendingCarryOver(await prepareCarriedBackup(raw, options));
  }

  return {
    fetch: fetchLocal,
    onRemoteWrite: (handler) => lock.onRemoteWrite(() => handler()),
    // Under the lock, from disk if another tab wrote since: a download must hold every save this device has made.
    exportRecords: async () => {
      const contents = await lock.withLock(async ({ stale }) => {
        if (stale) await reloadFromDisk(store, persistence);
        const { maps } = store.snapshot();
        return { result: await collectRecordsArchive({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: 0, savedAt: now(), maps }, blobs), wrote: false };
      });
      // Review D3: the copy is exact as of the lock; compressing it holds no tab up.
      return zipRecordsArchive(contents);
    },
    readRecordsFile,
    prepareCarryOver,
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
      await sweepBlobs(blobs, liveStoredKeys(store.snapshot().maps, now()));
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

function readsFxRates(request: Request): boolean {
  return request.method === 'GET' && FX_RATE_READERS.has(new URL(request.url).pathname);
}

/** The local routes that read reference rates, the ones `send` warms outside the lock. */
const FX_RATE_READERS: ReadonlySet<string> = new Set(['/v1/fx-rates', '/v1/summaries/verdict']);

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

/** The parsed JSON when `file` is the old web app's backup (MUT-291), else null: a records zip or file goes the usual way. */
async function freeAppBackupIn(file: Blob): Promise<unknown> {
  // Two bytes say whether it's a zip, without reading a large records file twice.
  const magic = new Uint8Array(await readBytes(file.slice(0, 2)));
  if (magic[0] === 0x50 && magic[1] === 0x4b) return null; // a zip
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await readBytes(file)));
    return looksLikeFreeAppBackup(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** MUT-291: this origin's signed-out records, counted from disk without booting a session or writing anything. */
export async function countRecordsOnThisDevice(): Promise<number> {
  const loaded = await new IndexedDbPersistence().load();
  // Records this build can't read are still records: the caller offers the move rather than leaving them.
  if (loaded.kind === 'too-new') throw new LocalRecordsFileRefused('too-new');
  return loaded.kind === 'ok' ? countRecords(loaded.snapshot.maps) : 0;
}
