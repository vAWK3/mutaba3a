import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { BLOBS_DB_NAME, IndexedDbBlobStore } from '../blobStore.js';

/**
 * MUT-287 (eng review R1): receipt files live in their own database,
 * `mut-local-blobs`, so the `mut-local` database already on devices (MUT-286,
 * tag api-v0.3.14) is never upgraded and no old tab can block a new one.
 */
describe('IndexedDbBlobStore', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('keeps a file with its type and size under its key, and answers null for a key it never had', async () => {
    const blobs = new IndexedDbBlobStore();

    await blobs.put('org/a/expense-receipts/r1', new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    const stored = await blobs.get('org/a/expense-receipts/r1');

    expect(stored?.size).toBe(8);
    expect(stored?.type).toBe('application/pdf');
    expect(await stored?.text()).toBe('%PDF-1.7');
    expect(await blobs.get('org/a/expense-receipts/never')).toBeNull();
  });

  it('lists its keys and deletes the ones it is given, ignoring keys it never had', async () => {
    const blobs = new IndexedDbBlobStore();
    await blobs.put('k1', new Blob(['1']));
    await blobs.put('k2', new Blob(['2']));

    await blobs.delete(['k1', 'missing']);

    expect(await blobs.keys()).toEqual(['k2']);
  });

  it('answers a file\'s type and size from its own small record, and forgets it with the file (review D11)', async () => {
    const blobs = new IndexedDbBlobStore();
    await blobs.putFiles([{ key: 'k', type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer }]);

    expect(await blobs.stat('k')).toEqual({ type: 'image/png', size: 3 });
    await blobs.delete(['k']);
    expect(await blobs.stat('k')).toBeNull();
    expect(await blobs.stat('never')).toBeNull();
  });

  it('survives a new connection, as a reload opens one', async () => {
    await new IndexedDbBlobStore().put('k', new Blob(['kept'], { type: 'image/png' }));

    const again = await new IndexedDbBlobStore().get('k');

    expect(await again?.text()).toBe('kept');
  });

  it('uses its own database and never opens mut-local', async () => {
    await new IndexedDbBlobStore().put('k', new Blob(['x']));

    const names = (await indexedDB.databases()).map((db) => db.name);

    expect(names).toEqual([BLOBS_DB_NAME]);
    expect(BLOBS_DB_NAME).toBe('mut-local-blobs');
  });
});
