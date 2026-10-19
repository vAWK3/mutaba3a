import { LocalDatabase } from './idb.js';

export const BLOBS_DB_NAME = 'mut-local-blobs';
/** 2: the `meta` store (review D11). Version 1 only ever existed in builds of this branch before it, never in a release. */
const DB_VERSION = 2;
const STORE_NAME = 'blobs';
/** `{ type, size }` per key, so a size/type check never loads a file's bytes (review D11). Written with the file in one transaction. */
const META_STORE = 'meta';

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

export interface StoredFileStat {
  type: string;
  size: number;
}

export class IndexedDbBlobStore {
  private readonly db: LocalDatabase;

  constructor(dbName: string = BLOBS_DB_NAME) {
    this.db = new LocalDatabase(dbName, DB_VERSION, [STORE_NAME, META_STORE]);
  }

  private openDb(): Promise<IDBDatabase> {
    return this.db.open();
  }

  /** Resolves on the transaction's `oncomplete`: the bytes are on disk, not just queued. Rejects with the browser's error (e.g. `QuotaExceededError`). */
  async put(key: string, blob: Blob): Promise<void> {
    await this.putFiles([{ key, type: blob.type, bytes: await readBytes(blob) }]);
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

  /** Several files in one transaction (Restore), each with its `{ type, size }`. */
  async putFiles(files: ReadonlyArray<{ key: string } & StoredFile>): Promise<void> {
    if (files.length === 0) return;
    await this.write((blobs, meta) => {
      for (const { key, type, bytes } of files) {
        blobs.put({ type, bytes } satisfies StoredFile, key);
        meta.put({ type, size: bytes.byteLength } satisfies StoredFileStat, key);
      }
    });
  }

  /** A file's type and size, without reading its bytes; `null` when there is none. */
  async stat(key: string): Promise<StoredFileStat | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(key);
      request.onsuccess = () => resolve((request.result as StoredFileStat | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Failed to read a stored file\'s size'));
    });
  }

  /** Deleting a key that isn't there is not an error. */
  async delete(keys: Iterable<string>): Promise<void> {
    const list = [...keys];
    if (list.length === 0) return;
    await this.write((blobs, meta) => {
      for (const key of list) {
        blobs.delete(key);
        meta.delete(key);
      }
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

  /** Releases the connection (tests). */
  async close(): Promise<void> {
    await this.db.close();
  }

  private async write(apply: (blobs: IDBObjectStore, meta: IDBObjectStore) => void): Promise<void> {
    const db = await this.openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite');
      apply(tx.objectStore(STORE_NAME), tx.objectStore(META_STORE));
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
