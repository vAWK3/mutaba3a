import { LocalDatabase } from './idb.js';
import { LOCAL_FORMAT_VERSION, migrate, type StoredSnapshot } from './migrations/index.js';

const DB_NAME = 'mut-local';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const SNAPSHOT_KEY = 'snapshot';
/**
 * A second, small record beside the full snapshot (same object store, same
 * write transaction — see `save()`), so a version check (`locks.ts`, before
 * every request) never has to deserialize the whole snapshot just to read two
 * numbers (brief §2.5: "a tab reads `stateVersion`, one small read").
 */
const VERSION_KEY = 'version';

interface VersionRecord {
  formatVersion: number;
  stateVersion: number;
}

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'ok'; snapshot: StoredSnapshot }
  /** The stored data was written by a newer build than this one. Never migrated, never written over — the caller shows a "reload to continue" screen (D1). */
  | { kind: 'too-new'; storedFormatVersion: number };

/**
 * `mut-local`'s one object store `state`, key `'snapshot'` (plan §2.5).
 * IndexedDB's structured clone keeps `Map` and `Date` as themselves, so there
 * is no custom serializer: whatever `MemoryLedgerStore.snapshot()` returns is
 * exactly what comes back out of `load()` (after migration, if older).
 */
export class IndexedDbPersistence {
  private readonly db: LocalDatabase;

  /** `dbName` defaults to the one real database (`mut-local`); a test passes a fresh name per case instead of deleting and recreating the shared one between tests (IndexedDB's `deleteDatabase` blocks on any connection this class never explicitly closes, which is otherwise harmless in a real tab that lives for the page's lifetime). */
  constructor(dbName: string = DB_NAME) {
    this.db = new LocalDatabase(dbName, DB_VERSION, [STORE_NAME]);
  }

  private openDb(): Promise<IDBDatabase> {
    return this.db.open();
  }

  /** The two small numbers `locks.ts` checks before every request, without touching the full snapshot. `null` when nothing has ever been saved. */
  async peekVersion(): Promise<VersionRecord | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(VERSION_KEY);
      request.onsuccess = () => resolve((request.result as VersionRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read the mut-local version record'));
    });
  }

  /**
   * Refuses and signals "reload to continue" on a newer-than-known
   * `formatVersion` without writing anything (D1); runs this build's
   * migrations when the stored shape is older.
   */
  async load(): Promise<LoadResult> {
    const db = await this.openDb();
    const stored = await new Promise<StoredSnapshot | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result as StoredSnapshot | undefined);
      request.onerror = () => reject(request.error ?? new Error('Failed to read the mut-local snapshot'));
    });
    if (!stored) return { kind: 'empty' };
    if (stored.formatVersion > LOCAL_FORMAT_VERSION) return { kind: 'too-new', storedFormatVersion: stored.formatVersion };
    return { kind: 'ok', snapshot: migrate(stored) };
  }

  /**
   * One transaction, awaiting `oncomplete` rather than the `put()` request's
   * own `onsuccess` — a request firing `onsuccess` only means the browser
   * queued it; `oncomplete` means the transaction committed. This is what
   * makes "durable before the caller's response resolves" true (plan §2.5):
   * a tab closed mid-write aborts the transaction, and nothing the person saw
   * as "saved" is lost, because nothing told them it was yet.
   */
  async save(snapshot: StoredSnapshot): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot, SNAPSHOT_KEY);
      store.put({ formatVersion: snapshot.formatVersion, stateVersion: snapshot.stateVersion } satisfies VersionRecord, VERSION_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save the mut-local snapshot'));
      tx.onabort = () => reject(tx.error ?? new Error('mut-local save aborted'));
    });
  }

  /** Releases the connection, if one was opened. A real tab never needs this (the connection lives as long as the page); a test tears down between cases with it instead of `indexedDB.deleteDatabase`, which blocks on any open connection. */
  async close(): Promise<void> {
    await this.db.close();
  }
}
