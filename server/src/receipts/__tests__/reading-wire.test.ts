import { describe, expect, it } from 'vitest';
import type { ExpenseReceiptRecord, ReceiptReadStatus } from '../../repositories/ports.js';
import { ExpenseReceiptSchema } from '../../schemas.js';
import { serializeExpenseReceipt } from '../../serializers.js';

/** MUT-441: `reading` on the wire is the read state a client acts on: pending (poll), done, failed; null otherwise. */
const receipt: ExpenseReceiptRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  expenseId: null,
  filename: 'cafe.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  status: 'READY',
  filingStatus: 'TO_REVIEW',
  receivedOn: '2026-10-28',
  storageKey: 'k',
  uploadedByUserId: null,
  suggested: null,
  approved: null,
  approvedAt: null,
  approvedByUserId: null,
  version: 1,
  requestId: null,
  createdAt: new Date('2026-10-28T10:00:00Z'),
  completedAt: new Date('2026-10-28T10:00:01Z'),
  deletedAt: null,
};

describe('serializeExpenseReceipt reading (MUT-441)', () => {
  it.each<[ReceiptReadStatus | undefined, string | null]>([
    ['PENDING', 'pending'],
    ['DONE', 'done'],
    ['FAILED', 'failed'],
    ['NONE', null],
    ['SKIPPED', null],
    [undefined, null],
  ])('%s reads as %s, and the response schema accepts it', (readStatus, reading) => {
    const wire = serializeExpenseReceipt(readStatus === undefined ? receipt : { ...receipt, readStatus });
    expect(wire.reading).toBe(reading);
    expect(ExpenseReceiptSchema.parse(wire).reading).toBe(reading);
  });

  it('never puts the capture hint, attempts, lease or failure reason on the wire', () => {
    const wire = serializeExpenseReceipt({ ...receipt, readStatus: 'FAILED', readAttempts: 3, readLeaseUntil: new Date(), readRequestedAt: new Date(), readFailReason: 'exhausted', captureHint: 'SCANNED' });
    for (const key of ['captureHint', 'readStatus', 'readAttempts', 'readLeaseUntil', 'readRequestedAt', 'readFailReason']) expect(wire).not.toHaveProperty(key);
  });
});
