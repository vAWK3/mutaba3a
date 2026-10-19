/**
 * The local backend's IndexedDB databases (`mut-local`, `mut-local-blobs`)
 * open through this one place, so they follow the same upgrade rules (MUT-287
 * review D12):
 *
 *  - when a newer build opens the database at a higher version, this tab
 *    closes its connection at once (`onversionchange`), so it never blocks
 *    that upgrade, and refuses every later use with
 *    `LocalDatabaseSupersededError` (the portal's "reload to continue");
 *  - when this tab's own upgrade is blocked by a tab that doesn't let go (a
 *    build from before this rule), the open rejects with
 *    `LocalDatabaseBlockedError` instead of hanging, possibly under the
 *    cross-tab lock.
 *
 * A failed open is forgotten, so the next call tries again.
 */
export class LocalDatabaseSupersededError extends Error {
  constructor(name: string) {
    super(`A newer version of this app upgraded the ${name} database. Reload to continue.`);
    this.name = 'LocalDatabaseSupersededError';
  }
}

export class LocalDatabaseBlockedError extends Error {
  constructor(name: string) {
    super(`Another tab of this app is holding the ${name} database open. Close it, then reload.`);
    this.name = 'LocalDatabaseBlockedError';
  }
}

export class LocalDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private superseded = false;

  constructor(
    readonly name: string,
    private readonly version: number,
    private readonly stores: readonly string[],
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.superseded) return Promise.reject(new LocalDatabaseSupersededError(this.name));
    if (!this.dbPromise) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        let gaveUp = false;
        const request = indexedDB.open(this.name, this.version);
        request.onupgradeneeded = () => {
          for (const store of this.stores) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        };
        request.onsuccess = () => {
          const db = request.result;
          // A blocked open that was already refused can still succeed once the other tab lets go: nobody holds it, so release it.
          if (gaveUp) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.superseded = true;
            this.dbPromise = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error(`Failed to open the ${this.name} database`));
        request.onblocked = () => {
          gaveUp = true;
          reject(new LocalDatabaseBlockedError(this.name));
        };
      });
      this.dbPromise = opening;
      opening.catch(() => {
        if (this.dbPromise === opening) this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  /** Releases the connection, if one was opened (tests tear down with it). */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}
