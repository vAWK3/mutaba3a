import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalBackend } from '../../session/localBackendContract.js';
import { IndexedDbBlobStore } from '../blobStore.js';

/**
 * MUT-287 AC2 + AC3: signed out, the server's own receipt and attachment
 * routes run in the page over `LocalAttachmentStorage`. A "page load" is a
 * fresh module instance over the same fake IndexedDB (see boot.test.ts), so a
 * reload is real: its own memory, the same databases on disk.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

async function openPage(): Promise<LocalBackend> {
  vi.resetModules();
  const module = await import('../index.js');
  return module.bootLocalBackend();
}

let idem = 0;
function call(page: LocalBackend, profileId: string, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Mutaba3a-Profile': profileId };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method === 'POST') headers['Idempotency-Key'] = `receipts-test-${++idem}`;
  return page.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

async function profileOf(page: LocalBackend): Promise<string> {
  const me = (await (await page.fetch(new Request('http://localhost/v1/me'))).json()) as { profiles: Array<{ id: string }> };
  return me.profiles[0]!.id;
}

async function anExpense(page: LocalBackend, profileId: string): Promise<string> {
  const response = await call(page, profileId, 'POST', '/v1/expenses', { occurredOn: '2026-10-01', amount: '120.00', currency: 'ILS', title: 'Printer ink' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

interface Started {
  receipt: { id: string };
  upload: { url: string; headers: Record<string, string> };
}

const PDF = '%PDF-1.7 receipt';

async function startReceipt(page: LocalBackend, profileId: string, expenseId: string, sizeBytes = PDF.length): Promise<Started> {
  const response = await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts`, { filename: 'Ink receipt.pdf', mimeType: 'application/pdf', sizeBytes });
  expect(response.status).toBe(201);
  return (await response.json()) as Started;
}

const PAGE_LOAD_TIMEOUT_MS = 30_000;

describe('receipts signed out (AC2)', { timeout: PAGE_LOAD_TIMEOUT_MS }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('uploads to this device, completes READY, and downloads the same file after a reload', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);

    const { receipt, upload } = await startReceipt(page, profileId, expenseId);
    expect(upload.url.startsWith('local-blob:')).toBe(true);
    await page.putBlob(upload.url, new Blob([PDF], { type: 'application/pdf' }));
    const completed = await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts/${receipt.id}/complete`);
    expect(completed.status).toBe(200);
    expect(((await completed.json()) as { status: string }).status).toBe('READY');

    const reloaded = await openPage();
    const download = await call(reloaded, profileId, 'GET', `/v1/expenses/${expenseId}/receipts/${receipt.id}/download`);
    expect(download.status).toBe(200);
    const { url, filename } = (await download.json()) as { url: string; filename: string };
    expect(filename).toBe('Ink receipt.pdf');
    expect(await (await reloaded.readBlob(url))?.text()).toBe(PDF);
  });

  it('refuses to complete before the file is on this device (422 UPLOAD_INCOMPLETE)', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);
    const { receipt } = await startReceipt(page, profileId, expenseId);

    const response = await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts/${receipt.id}/complete`);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string; details?: { reason?: string } } }).error.details?.reason).toBe('UPLOAD_INCOMPLETE');
  });

  it('refuses a file whose size differs from the declared one (422 UPLOAD_MISMATCH)', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);
    const { receipt, upload } = await startReceipt(page, profileId, expenseId, 999);
    await page.putBlob(upload.url, new Blob([PDF], { type: 'application/pdf' }));

    const response = await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts/${receipt.id}/complete`);

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('UPLOAD_MISMATCH');
  });

  it('removes the file once deleting its expense has saved', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);
    const { receipt, upload } = await startReceipt(page, profileId, expenseId);
    await page.putBlob(upload.url, new Blob([PDF], { type: 'application/pdf' }));
    await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts/${receipt.id}/complete`);

    expect((await call(page, profileId, 'DELETE', `/v1/expenses/${expenseId}`)).status).toBe(204);

    expect(await page.readBlob(upload.url)).toBeNull();
  });

  it('refuses a putBlob or readBlob for anything but a local-blob URL', async () => {
    const page = await openPage();

    await expect(page.putBlob('https://storage.googleapis.com/bucket/k', new Blob(['x']))).rejects.toThrow();
    await expect(page.readBlob('https://storage.googleapis.com/bucket/k')).rejects.toThrow();
  });

  it('sweeps, on boot, files no receipt names, and keeps a pending upload', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);
    const { upload } = await startReceipt(page, profileId, expenseId);
    await page.putBlob(upload.url, new Blob([PDF], { type: 'application/pdf' }));
    await new IndexedDbBlobStore().put('org/x/expense-receipts/left-behind', new Blob(['orphan']));

    await openPage();

    expect(await new IndexedDbBlobStore().keys()).toEqual([upload.url.slice('local-blob:'.length)]);
  });
});

describe('Your data with receipts (eng review R2)', { timeout: PAGE_LOAD_TIMEOUT_MS }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('downloads the records with the receipt file, and a cleared device gets both back from it', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);
    const expenseId = await anExpense(page, profileId);
    const { receipt, upload } = await startReceipt(page, profileId, expenseId);
    await page.putBlob(upload.url, new Blob([PDF], { type: 'application/pdf' }));
    await call(page, profileId, 'POST', `/v1/expenses/${expenseId}/receipts/${receipt.id}/complete`);
    const archive = await page.exportRecords();

    globalThis.indexedDB = new IDBFactory();
    const cleared = await openPage();
    const pending = await cleared.readRecordsFile(archive);
    await pending.apply();

    expect(pending.recordCount).toBe(1);
    const download = await call(cleared, profileId, 'GET', `/v1/expenses/${expenseId}/receipts/${receipt.id}/download`);
    expect(download.status).toBe(200);
    expect(await (await cleared.readBlob(((await download.json()) as { url: string }).url))?.text()).toBe(PDF);
  });
});

describe('documents signed out (AC3)', { timeout: PAGE_LOAD_TIMEOUT_MS }, () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
  });

  it('lists an empty page of documents instead of 503 ATTACHMENTS_NOT_CONFIGURED', async () => {
    const page = await openPage();
    const profileId = await profileOf(page);

    const response = await call(page, profileId, 'GET', '/v1/attachments');

    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: unknown[] }).items).toEqual([]);
  });
});
