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

    const decoded = await decodeRecordsArchive(archive);
    await applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, decoded.snapshot, (await decoded.readFiles()).files);

    const loaded = await persistence.load();
    expect(loaded.kind).toBe('ok');
    const receipts = loaded.kind === 'ok' ? [...loaded.snapshot.maps.expReceipts.values()].map((r) => r.storageKey) : [];
    expect(receipts).toEqual([other.key]);
    expect([...mine.store.snapshot().maps.expReceipts.values()].map((r) => r.storageKey)).toEqual([other.key]);
    expect(await new IndexedDbBlobStore().keys()).toEqual([other.key]);
    expect(await (await new IndexedDbBlobStore().get(other.key))?.text()).toBe(PDF);
  });

  it('keeps a To-review receipt with no expense, and its file, from a hosted backup (MUT-255 decision P1)', async () => {
    const { other, mine, persistence, lock } = await backupThenThisDevice();
    // A hosted "Download my records" carries library receipts that wait To review, with no expense yet.
    const [receipt] = [...other.snapshot.maps.expReceipts.values()];
    const library = { ...other.snapshot, maps: { ...other.snapshot.maps, expReceipts: new Map([[receipt!.id, { ...receipt!, expenseId: null, filingStatus: 'TO_REVIEW' as const }]]) } };
    const decoded = await decodeRecordsArchive(await encodeRecordsArchive(library, other.blobs));

    await applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, decoded.snapshot, (await decoded.readFiles()).files);

    expect([...mine.store.snapshot().maps.expReceipts.values()]).toEqual([expect.objectContaining({ id: receipt!.id, expenseId: null, filingStatus: 'TO_REVIEW', storageKey: other.key })]);
    expect(await (await new IndexedDbBlobStore().get(other.key))?.text()).toBe(PDF);
  });

  it('keeps this device whole when the save fails: old records, their receipt files, and none of the backup\'s files left behind', async () => {
    const { archive, other, mine, persistence, lock } = await backupThenThisDevice();
    persistence.save = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };

    const decoded = await decodeRecordsArchive(archive);
    await expect(applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, decoded.snapshot, (await decoded.readFiles()).files)).rejects.toThrow();

    const loaded = await new IndexedDbPersistence().load();
    const receipts = loaded.kind === 'ok' ? [...loaded.snapshot.maps.expReceipts.values()].map((r) => r.storageKey) : [];
    expect(receipts).toEqual([mine.key]);
    expect([...mine.store.snapshot().maps.expReceipts.values()].map((r) => r.storageKey)).toEqual([mine.key]);
    expect(await (await new IndexedDbBlobStore().get(mine.key))?.text()).toBe(PDF);
    expect(await new IndexedDbBlobStore().get(other.key)).toBeNull();
  });

  it('on a refused save, deletes only the files it added, never one another tab saved meanwhile (re-review)', async () => {
    const { archive, mine, persistence, lock } = await backupThenThisDevice();
    // Another tab's receipt: saved to disk and to the blob store after this tab last loaded, so this tab's memory doesn't name it.
    await new IndexedDbBlobStore().put('org/x/expense-receipts/other-tab', new Blob(['%PDF other tab'], { type: 'application/pdf' }));
    persistence.save = async () => {
      throw new DOMException('full', 'QuotaExceededError');
    };

    const decoded = await decodeRecordsArchive(archive);
    await expect(applyRestore({ lock, persistence, store: mine.store, blobs: mine.blobs, now: NOW }, decoded.snapshot, (await decoded.readFiles()).files)).rejects.toThrow();

    expect(await (await new IndexedDbBlobStore().get('org/x/expense-receipts/other-tab'))?.text()).toBe('%PDF other tab');
  });
});
