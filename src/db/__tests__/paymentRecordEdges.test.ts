import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, paymentRecordRepo, recalculateReceivedAmount, PaymentRecordError } from '../repository';
import type { Transaction } from '../../types';

/**
 * MUT-24 §C: the payment-record paths (MUT-18/60) paymentRecords.test.ts does
 * not reach — a missing parent entry, an entry already covered by its records,
 * a deleted record, legacy data with no record to date the payment, and the
 * tie and date-bound rules of the payment lists.
 */

const now = '2026-10-01T09:00:00.000Z';

function income(id: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id, kind: 'income', status: 'unpaid', amountMinor: 10000, currency: 'USD',
    occurredAt: '2026-09-01', clientId: 'c1', createdAt: now, updatedAt: now, ...extra,
  } as Transaction;
}

const record = (id: string, transactionId: string, amountMinor: number, paidAt: string, extra: object = {}) => ({
  id, transactionId, amountMinor, paidAt, createdAt: now, updatedAt: now, ...extra,
});

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.paymentRecords.clear(), db.clients.clear()]);
});

describe('recalculateReceivedAmount', () => {
  it('does nothing for an entry that no longer exists', async () => {
    await expect(recalculateReceivedAmount('missing')).resolves.toBeUndefined();
    expect(await db.transactions.count()).toBe(0);
  });

  it('dates a fully covered entry by its latest record, whatever order the records are in', async () => {
    await db.transactions.add(income('t1'));
    await db.paymentRecords.bulkAdd([
      record('r2', 't1', 6000, '2026-09-20'),
      record('r1', 't1', 4000, '2026-09-10'),
    ]);

    await recalculateReceivedAmount('t1');

    expect(await db.transactions.get('t1')).toMatchObject({ status: 'paid', paidAt: '2026-09-20', receivedAmountMinor: 10000 });
  });

  it('falls back to now when a covered entry has no record to date it (legacy zero-amount data)', async () => {
    await db.transactions.add(income('free', { amountMinor: 0 }));

    await recalculateReceivedAmount('free');

    const tx = await db.transactions.get('free');
    expect(tx).toMatchObject({ status: 'paid', receivedAmountMinor: 0 });
    expect(Date.parse(tx!.paidAt!)).toBeGreaterThan(Date.parse(now));
  });
});

describe('transactionRepo.markPaid', () => {
  it('is a no-op for a missing entry', async () => {
    await expect(transactionRepo.markPaid('missing')).resolves.toBeUndefined();
    expect(await db.paymentRecords.count()).toBe(0);
  });

  it('finalizes an entry its records already cover, adding no record', async () => {
    await db.transactions.add(income('t1', { receivedAmountMinor: 10000 }));
    await db.paymentRecords.add(record('r1', 't1', 10000, '2026-09-15'));

    await transactionRepo.markPaid('t1', { paidAt: '2026-10-01' });

    expect(await db.paymentRecords.count()).toBe(1);
    expect(await db.transactions.get('t1')).toMatchObject({ status: 'paid', paidAt: '2026-09-15' });
  });
});

describe('transactionRepo.update to Received with no records', () => {
  it('leaves an expense marked paid as written: only income is record-backed', async () => {
    await db.transactions.add({ ...income('e1'), kind: 'expense' } as Transaction);

    await transactionRepo.update('e1', { status: 'paid', paidAt: '2026-09-30' });

    expect(await db.transactions.get('e1')).toMatchObject({ status: 'paid', paidAt: '2026-09-30' });
    expect(await db.paymentRecords.count()).toBe(0);
  });

  it('is a no-op for a missing entry', async () => {
    await expect(transactionRepo.update('missing', { title: 'x' })).resolves.toBeUndefined();
  });
});

describe('paymentRecordRepo.update', () => {
  it('refuses to edit a deleted record', async () => {
    await db.transactions.add(income('t1'));
    await db.paymentRecords.add(record('r1', 't1', 1000, '2026-09-15', { deletedAt: now }));

    await expect(paymentRecordRepo.update('r1', { notes: 'late' })).rejects.toThrow(
      new PaymentRecordError('Payment record has been deleted', { paymentRecordId: 'r1' })
    );
  });

  it('still saves an orphaned record whose entry was removed', async () => {
    await db.paymentRecords.add(record('r1', 'gone', 1000, '2026-09-15'));

    await paymentRecordRepo.update('r1', { amountMinor: 1500 });

    expect((await db.paymentRecords.get('r1'))?.amountMinor).toBe(1500);
  });
});

describe('paymentRecordRepo.listRecent', () => {
  it('returns nothing when there is no live income at all', async () => {
    await db.transactions.add(income('t1', { deletedAt: now }));
    expect(await paymentRecordRepo.listRecent()).toEqual([]);
  });

  it('orders payments made on the same day by id, so the list never jumps', async () => {
    await db.transactions.add(income('t1', { amountMinor: 3000 }));
    await db.paymentRecords.bulkAdd([
      record('rb', 't1', 1000, '2026-09-15'),
      record('ra', 't1', 1000, '2026-09-15'),
      record('rc', 't1', 1000, '2026-09-16'),
    ]);

    expect((await paymentRecordRepo.listRecent()).map((r) => r.id)).toEqual(['rc', 'ra', 'rb']);
  });
});

describe('paymentRecordRepo.listByClient filters', () => {
  beforeEach(async () => {
    await db.transactions.bulkAdd([income('usd', { amountMinor: 5000 }), income('ils', { currency: 'ILS', amountMinor: 5000 })]);
    await db.paymentRecords.bulkAdd([
      record('aug', 'usd', 1000, '2026-08-31T23:00:00.000Z'),
      record('sep', 'usd', 1000, '2026-09-15'),
      record('oct', 'usd', 1000, '2026-10-01'),
      record('shekel', 'ils', 1000, '2026-09-20'),
    ]);
  });

  it('keeps payments up to and including the end date, comparing calendar dates', async () => {
    const rows = await paymentRecordRepo.listByClient('c1', { dateFrom: '2026-08-31', dateTo: '2026-09-30' });
    expect(rows.map((r) => r.id)).toEqual(['shekel', 'sep', 'aug']);
  });

  it('keeps only the chosen currency', async () => {
    const rows = await paymentRecordRepo.listByClient('c1', { currency: 'ILS' });
    expect(rows.map((r) => r.id)).toEqual(['shekel']);
  });
});
