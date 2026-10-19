export const BLOBS_DB_NAME = 'mut-local-blobs';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

/**
 * Receipt files on this device (MUT-287, eng review R1). A database of its
 * own, not a store inside `mut-local`: that database already holds MUT-286
 * data on devices (tag api-v0.3.14), and upgrading it would need every open
 * tab to let go first; an old tab left open would hang a new one. Each file
 * is stored as `{ type, bytes }` with the bytes as an `ArrayBuffer`, never
 * base64 and never in the snapshot: an `ArrayBuffer` clones the same in every
 * engine, where a stored `Blob` has had engine bugs (older Safari) and doesn't
 * survive the test environment's clone.
 */
export interface StoredFile {
  type: string;
  bytes: ArrayBuffer;
}

export class IndexedDbBlobStore {
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string = BLOBS_DB_NAME) {
    this.dbName = dbName;
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error(`Failed to open the ${this.dbName} database`));
      });
      // A failed open is forgotten, so the next call tries again instead of replaying the same rejection.
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  /** Resolves on the transaction's `oncomplete`: the bytes are on disk, not just queued. Rejects with the browser's error (e.g. `QuotaExceededError`). */
  async put(key: string, blob: Blob): Promise<void> {
    const file: StoredFile = { type: blob.type, bytes: await readBytes(blob) };
    await this.write((store) => store.put(file, key));
  }

  async get(key: string): Promise<Blob | null> {
    const file = await this.getFile(key);
    return file ? new Blob([file.bytes], { type: file.type }) : null;
  }

  /** The stored bytes as they are, for the records archive (no Blob round-trip). */
  async getFile(key: string): Promise<StoredFile | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as StoredFile | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read a stored file'));
    });
  }

  /** Several files in one transaction (Restore). */
  async putFiles(files: ReadonlyArray<{ key: string } & StoredFile>): Promise<void> {
    if (files.length === 0) return;
    await this.write((store) => {
      for (const { key, type, bytes } of files) store.put({ type, bytes } satisfies StoredFile, key);
    });
  }

  /** Deleting a key that isn't there is not an error. */
  async delete(keys: Iterable<string>): Promise<void> {
    const list = [...keys];
    if (list.length === 0) return;
    await this.write((store) => {
      for (const key of list) store.delete(key);
    });
  }

  async keys(): Promise<string[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => reject(request.error ?? new Error('Failed to list stored files'));
    });
  }

  private async write(apply: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      apply(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to write a stored file'));
      tx.onabort = () => reject(tx.error ?? new Error('Writing a stored file was aborted'));
    });
  }
}

/** `Blob.arrayBuffer` where the engine has it; `FileReader` otherwise (older engines, and the jsdom test environment). */
export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the file'));
    reader.readAsArrayBuffer(blob);
  });
}
