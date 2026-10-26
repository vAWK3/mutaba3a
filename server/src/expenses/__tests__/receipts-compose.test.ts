import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { Organization } from '../../repositories/ports.js';
import { completeExpenseReceipt, completeLibraryReceipt, startExpenseReceipt, startLibraryReceipt, type ReceiptActor, type ReceiptDeps } from '../receipts-compose.js';
import { MAX_RECEIPTS_PER_EXPENSE } from '../compose.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';

/**
 * MUT-436 (review R4): receipt upload start/complete, shared by the session routes and the MCP receipt tools. The
 * routes' suites still prove the HTTP answers; this pins the shared rules at their own boundary.
 */
const NOW = new Date('2026-10-26T09:00:00Z');
const USER = '0f5c2a1e-7b3d-4c9a-9e1f-2a3b4c5d6e7f';
const PDF = { filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };

async function setup(withStorage = true) {
  const store = new MemoryLedgerStore();
  const storage = new MemoryAttachmentStorage();
  const organization: Organization = await store.organizations.create({ name: 'Studio', slug: `studio-${Math.random().toString(36).slice(2, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const expense = await store.expenses.create({ organizationId: organization.id, occurredOn: '2026-10-20', amountMinor: 4590n, currency: 'ILS', title: null, vendor: null, vendorId: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: USER } as Parameters<MemoryLedgerStore['expenses']['create']>[0], NOW);
  const audits: Array<{ action: string; metadata: unknown }> = [];
  const deps: ReceiptDeps = { store, storage: withStorage ? storage : null, urlTtlSeconds: 600 };
  const actor: ReceiptActor = { organization, userId: USER, requestId: 'req-1', now: NOW, audit: async (action, _type, _id, metadata) => void audits.push({ action, metadata }) };
  return { store, storage, organization, expense, deps, actor, audits };
}

describe('startExpenseReceipt / completeExpenseReceipt', () => {
  it('starts a pending receipt with a signed PUT, and completes it once the object is there, audited with extra metadata', async () => {
    const { storage, expense, deps, actor, audits } = await setup();
    const { receipt, upload } = await startExpenseReceipt(deps, actor, expense.id, PDF);
    expect(receipt).toMatchObject({ expenseId: expense.id, status: 'PENDING_UPLOAD' });
    expect(upload).toMatchObject({ method: 'PUT', url: expect.stringContaining(receipt.storageKey) });

    await expect(completeExpenseReceipt(deps, actor, expense.id, receipt.id)).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'UPLOAD_INCOMPLETE' }) });
    storage.put(receipt.storageKey, { sizeBytes: 1000, contentType: 'application/pdf' });
    const ready = await completeExpenseReceipt(deps, actor, expense.id, receipt.id, { captureSource: 'mcp' });
    expect(ready.status).toBe('READY');
    expect(audits).toEqual([{ action: 'expense_receipt.added', metadata: expect.objectContaining({ expenseId: expense.id, captureSource: 'mcp' }) }]);
    // Idempotent once READY: no second audit.
    await completeExpenseReceipt(deps, actor, expense.id, receipt.id);
    expect(audits).toHaveLength(1);
  });

  it('refuses without storage, a file type outside PDF/JPEG/PNG, an unknown expense, and a full expense', async () => {
    const off = await setup(false);
    await expect(startExpenseReceipt(off.deps, off.actor, off.expense.id, PDF)).rejects.toMatchObject({ code: 'ATTACHMENTS_NOT_CONFIGURED' });
    const { storage, expense, deps, actor } = await setup();
    await expect(startExpenseReceipt(deps, actor, expense.id, { ...PDF, mimeType: 'text/html' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(startExpenseReceipt(deps, actor, '00000000-0000-4000-8000-000000000000', PDF)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Only READY receipts count toward the cap (listByExpense), so each one is finished.
    for (let i = 0; i < MAX_RECEIPTS_PER_EXPENSE; i++) {
      const { receipt } = await startExpenseReceipt(deps, actor, expense.id, PDF);
      storage.put(receipt.storageKey, { sizeBytes: 1000, contentType: 'application/pdf' });
      await completeExpenseReceipt(deps, actor, expense.id, receipt.id);
    }
    await expect(startExpenseReceipt(deps, actor, expense.id, PDF)).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'TOO_MANY_RECEIPTS' }) });
  });
});

describe('startLibraryReceipt / completeLibraryReceipt', () => {
  it('starts a To-review receipt with no expense and completes it; refuses to finish a receipt that belongs to an expense', async () => {
    const { storage, expense, deps, actor } = await setup();
    const limiter = new SlidingWindowRateLimiter(30);
    const { receipt } = await startLibraryReceipt({ ...deps, uploadLimiter: limiter }, actor, PDF);
    expect(receipt).toMatchObject({ expenseId: null, filingStatus: 'TO_REVIEW' });
    storage.put(receipt.storageKey, { sizeBytes: 1000, contentType: 'application/pdf' });
    expect((await completeLibraryReceipt(deps, actor, receipt.id)).status).toBe('READY');

    const onExpense = await startExpenseReceipt(deps, actor, expense.id, PDF);
    await expect(completeLibraryReceipt(deps, actor, onExpense.receipt.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('answers 429 RATE_LIMITED past the per-person budget, with retryAfterSeconds', async () => {
    const { deps, actor } = await setup();
    const limiter = new SlidingWindowRateLimiter(1);
    await startLibraryReceipt({ ...deps, uploadLimiter: limiter }, actor, PDF);
    await expect(startLibraryReceipt({ ...deps, uploadLimiter: limiter }, actor, PDF)).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
  });
});
