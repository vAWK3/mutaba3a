import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../../db/database';
import { transactionRepo, paymentRecordRepo } from '../../../db/repository';

vi.mock('../ops-engine', () => ({ captureOp: vi.fn(async () => null) }));

import { captureOp } from '../ops-engine';
import { syncedTransactionRepo } from '../synced-repository';

function loggedUpdates() {
  return vi
    .mocked(captureOp)
    .mock.calls.map(([op]) => op)
    .filter((op) => op.opType === 'update');
}

// ADR-039: the repository refuses payment fields on an entry with payment
// records and derives them instead; the op log has to carry what was written.
describe('syncedTransactionRepo.update', () => {
  let txId: string;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000,
      currency: 'USD',
      occurredAt: '2024-03-15',
      title: 'Logo',
    });
    txId = tx.id;
    vi.mocked(captureOp).mockClear();
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  it('logs every field it was asked to write on an entry without records', async () => {
    await syncedTransactionRepo.update(txId, { title: 'Logo v2', status: 'paid', paidAt: '2024-03-20' });

    expect(loggedUpdates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'title', value: 'Logo v2', previousValue: 'Logo' }),
        expect.objectContaining({ field: 'status', value: 'paid', previousValue: 'unpaid' }),
        expect.objectContaining({ field: 'paidAt', value: '2024-03-20' }),
      ])
    );
  });

  it('does not log payment fields the repository refused', async () => {
    await paymentRecordRepo.create({ transactionId: txId, amountMinor: 4000, paidAt: '2024-03-18' });
    vi.mocked(captureOp).mockClear();

    await syncedTransactionRepo.update(txId, { title: 'Logo v2', status: 'paid', paidAt: '2024-03-20' });

    const updates = loggedUpdates();
    expect(updates).toContainEqual(expect.objectContaining({ field: 'title', value: 'Logo v2' }));
    expect(updates.filter((op) => op.field === 'status' || op.field === 'paidAt')).toEqual([]);
    expect((await transactionRepo.get(txId))?.status).toBe('unpaid');
  });

  it('logs the payment state the records derive after an amount change', async () => {
    await paymentRecordRepo.create({ transactionId: txId, amountMinor: 10000, paidAt: '2024-03-18' });
    vi.mocked(captureOp).mockClear();

    await syncedTransactionRepo.update(txId, { amountMinor: 15000 });

    expect(loggedUpdates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'amountMinor', value: 15000 }),
        expect.objectContaining({ field: 'status', value: 'unpaid', previousValue: 'paid' }),
      ])
    );
  });
});
