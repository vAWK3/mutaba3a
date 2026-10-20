import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDatabase } from '../idb.js';

/** MUT-287 review D12: tabs running this build never block a later upgrade, and an upgrade they can't make never hangs. */
describe('LocalDatabase', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('creates its stores on first open and reuses the connection', async () => {
    const db = new LocalDatabase('test-db', 1, ['a', 'b']);
    const first = await db.open();

    expect([...first.objectStoreNames].sort()).toEqual(['a', 'b']);
    expect(await db.open()).toBe(first);
  });

  it('lets a newer build upgrade it, then refuses further use with a reload-to-continue error', async () => {
    const thisTab = new LocalDatabase('test-db', 1, ['a']);
    await thisTab.open();

    const newerTab = new LocalDatabase('test-db', 2, ['a', 'b']);
    const upgraded = await newerTab.open();

    expect([...upgraded.objectStoreNames].sort()).toEqual(['a', 'b']);
    await expect(thisTab.open()).rejects.toMatchObject({ name: 'LocalDatabaseSupersededError' });
  });

  it('rejects instead of hanging when an older tab keeps the database open through an upgrade', async () => {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('test-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('a');
      request.onsuccess = () => resolve(request.result); // no onversionchange: a build from before this rule
      request.onerror = () => reject(request.error);
    });

    await expect(new LocalDatabase('test-db', 2, ['a', 'b']).open()).rejects.toMatchObject({ name: 'LocalDatabaseBlockedError' });
    legacy.close();
  });
});
