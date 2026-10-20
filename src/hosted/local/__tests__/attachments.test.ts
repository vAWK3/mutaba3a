import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import { backedUpKeys, LocalAttachmentStorage, liveStoredKeys, sweepBlobs } from '../attachments.js';
import { IndexedDbBlobStore } from '../blobStore.js';

/**
 * MUT-287 (brief §6): the server's own receipt routes run in the page over
 * this `AttachmentStorage`. URLs are `local-blob:<key>`, handled by the
 * portal's local branches, never fetched; removal waits for the save.
 */
const NOW = new Date('2026-10-19T10:00:00Z');

describe('LocalAttachmentStorage', () => {
  let blobs: IndexedDbBlobStore;
  let storage: LocalAttachmentStorage;

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    blobs = new IndexedDbBlobStore();
    storage = new LocalAttachmentStorage(blobs);
  });

  it('signs an upload as a local-blob URL with the declared content type', async () => {
    const upload = await storage.signUpload('org/a/expense-receipts/r1', { mimeType: 'application/pdf', sizeBytes: 8, ttlSeconds: 900, now: NOW });

    expect(upload.url).toBe('local-blob:org/a/expense-receipts/r1');
    expect(upload.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(upload.expiresAt.toISOString()).toBe('2026-10-19T10:15:00.000Z');
  });

  it('signs a download as the same local-blob URL', async () => {
    const download = await storage.signDownload('org/a/expense-receipts/r1', { filename: 'Receipt.pdf', mimeType: 'application/pdf', ttlSeconds: 900, now: NOW });

    expect(download.url).toBe('local-blob:org/a/expense-receipts/r1');
  });

  it('heads a stored file by its size and type, and answers null before the upload', async () => {
    expect(await storage.head('k')).toBeNull();

    await blobs.put('k', new Blob(['%PDF-1.7'], { type: 'application/pdf' }));

    expect(await storage.head('k')).toEqual({ sizeBytes: 8, contentType: 'application/pdf' });
  });

  it('reports an untyped file as contentType null, as the bucket would', async () => {
    await blobs.put('k', new Blob(['abc']));

    expect(await storage.head('k')).toEqual({ sizeBytes: 3, contentType: null });
  });

  it('only stages a removal: the file stays until flushRemovals, after the save', async () => {
    await blobs.put('k', new Blob(['x']));

    await storage.remove('k');
    expect(await blobs.get('k')).not.toBeNull();

    await storage.flushRemovals();
    expect(await blobs.get('k')).toBeNull();
  });

  it('forgets staged removals when the request did not save, so the file stays', async () => {
    await blobs.put('k', new Blob(['x']));

    await storage.remove('k');
    storage.discardRemovals();
    await storage.flushRemovals();

    expect(await blobs.get('k')).not.toBeNull();
  });
});

describe('sweepBlobs', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('deletes every file no live receipt names, and keeps the rest', async () => {
    const blobs = new IndexedDbBlobStore();
    await blobs.put('live', new Blob(['1']));
    await blobs.put('orphan', new Blob(['2']));

    const removed = await sweepBlobs(blobs, new Set(['live']));

    expect(removed).toBe(1);
    expect(await blobs.keys()).toEqual(['live']);
  });
});

describe('which stored files are live (review D6)', () => {
  const NOW_MS = Date.parse('2026-10-19T10:00:00Z');
  const receipt = (key: string, status: string, minutesAgo: number, deletedAt: Date | null = null) => [key, { storageKey: key, status, deletedAt, createdAt: new Date(NOW_MS - minutesAgo * 60_000) }] as const;
  const maps = {
    expReceipts: new Map([receipt('ready', 'READY', 600), receipt('uploading', 'PENDING_UPLOAD', 14), receipt('abandoned', 'PENDING_UPLOAD', 16), receipt('deleted', 'READY', 600, new Date(NOW_MS))]),
    files: new Map([['doc', { storageKey: 'doc', status: 'READY', deletedAt: null, createdAt: new Date(NOW_MS) }]]),
  } as unknown as LocalSnapshotMaps;

  it('keeps an upload in flight only while its 15-minute upload link is valid, and every document', () => {
    expect([...liveStoredKeys(maps, new Date(NOW_MS))].sort()).toEqual(['doc', 'ready', 'uploading']);
  });

  it('backs up only receipts a person can see (READY): what Restore reads back', () => {
    expect([...backedUpKeys(maps)].sort()).toEqual(['ready']);
  });
});

