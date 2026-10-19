import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbBlobStore } from '../blobStore.js';
import { LocalLock } from '../locks.js';
import { IndexedDbPersistence } from '../persistence.js';
import { decodeRecordsArchive, encodeRecordsArchive } from '../recordsArchive.js';
import { applyRestore } from '../restore.js';
import { deviceWithReceipt, PDF } from './helpers/device.js';

/**
 * MUT-287 eng review R1: receipt files and records live in two databases, so
 * Restore can't be one transaction. It is crash-safe by order instead: add the
 * file's receipt files, save the records, then delete files no live receipt
 * names. Until the save lands, the old records and their files are intact.
 */
class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const NOW = () => new Date('2026-10-19T12:00:00Z');

/** Another device's backup, then a fresh "this device" with its own saved records and receipt file. */
async function backupThenThisDevice() {
  globalThis.indexedDB = new IDBFactory();
  const other = await deviceWithReceipt();
  const archive = await encodeRecordsArchive(other.snapshot, other.blobs);

  globalThis.indexedDB = new IDBFactory();
  const mine = await deviceWithReceipt();
  const persistence = new IndexedDbPersistence();
  await persistence.save(mine.snapshot);
  const lock = new LocalLock(persistence);
  return { archive, other, mine, persistence, lock };
}

describe('applyRestore', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('replaces the records and their files with the backup, and drops files the new records never name', async () => {
    const { archive, other, mine, persistence, lock } = await backupThenThisDevice();

    await applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, await decodeRecordsArchive(archive));

    const loaded = await persistence.load();
    expect(loaded.kind).toBe('ok');
    const receipts = loaded.kind === 'ok' ? [...loaded.snapshot.maps.expReceipts.values()].map((r) => r.storageKey) : [];
    expect(receipts).toEqual([other.key]);
    expect([...mine.store.snapshot().maps.expReceipts.values()].map((r) => r.storageKey)).toEqual([other.key]);
    expect(await new IndexedDbBlobStore().keys()).toEqual([other.key]);
    expect(await (await new IndexedDbBlobStore().get(other.key))?.text()).toBe(PDF);
  });

  it('keeps this device whole when the save fails: old records, their receipt files, and none of the backup\'s files left behind', async () => {
    const { archive, other, mine, persistence, lock } = await backupThenThisDevice();
    persistence.save = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };

    await expect(applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, await decodeRecordsArchive(archive))).rejects.toThrow();

    const loaded = await new IndexedDbPersistence().load();
    const receipts = loaded.kind === 'ok' ? [...loaded.snapshot.maps.expReceipts.values()].map((r) => r.storageKey) : [];
    expect(receipts).toEqual([mine.key]);
    expect([...mine.store.snapshot().maps.expReceipts.values()].map((r) => r.storageKey)).toEqual([mine.key]);
    expect(await (await new IndexedDbBlobStore().get(mine.key))?.text()).toBe(PDF);
    expect(await new IndexedDbBlobStore().get(other.key)).toBeNull();
  });
});
