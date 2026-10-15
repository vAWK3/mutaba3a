import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../db/database';
import { getRepositories } from '../../db';
import { isFuturePaymentDate } from '../../lib/dates';
import { DEMO_PREFIXES } from '../constants';

/**
 * MUT-95 (TD-063): payment records own payment state (ADR-039). The sample used to seed part-paid entries with a
 * received amount and no records, so the first real payment recalculated from records alone and Owed now went UP.
 */

vi.setConfig({ testTimeout: 15_000 });
const { seedDemoData, removeDemoData } = await import('../seedData');

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedDemoData({ announceFeatures: false });
});

async function sampleIncome() {
  return db.transactions.where('id').startsWith(DEMO_PREFIXES.transaction).filter((t) => t.kind === 'income').toArray();
}

async function recordedFor(transactionId: string): Promise<number> {
  const records = await db.paymentRecords.where('transactionId').equals(transactionId).filter((r) => !r.deletedAt).toArray();
  return records.reduce((sum, r) => sum + r.amountMinor, 0);
}

describe('the sample seeds payment records (MUT-95)', () => {
  it('gives every sample income entry records that add up to what it has received, none in the future', async () => {
    const income = await sampleIncome();
    expect(income.some((t) => t.status === 'unpaid' && (t.receivedAmountMinor ?? 0) > 0)).toBe(true);

    for (const t of income) {
      const received = t.status === 'paid' ? t.amountMinor : (t.receivedAmountMinor ?? 0);
      expect(await recordedFor(t.id), t.id).toBe(received);
    }
    const records = await db.paymentRecords.toArray();
    expect(records.length).toBeGreaterThan(0);
    expect(records.filter((r) => isFuturePaymentDate(r.paidAt))).toEqual([]);
    expect(records.every((r) => r.id.startsWith('demo_'))).toBe(true);
  });

  it('a payment on a part-paid entry lowers what is owed by exactly that amount, and the guard uses the true remainder', async () => {
    const partPaid = (await sampleIncome()).find((t) => t.status === 'unpaid' && (t.receivedAmountMinor ?? 0) > 0)!;
    const before = partPaid.receivedAmountMinor!;
    const transactions = getRepositories().base.transactions;

    await transactions.recordPartialPayment(partPaid.id, 1000);

    expect((await db.transactions.get(partPaid.id))!.receivedAmountMinor).toBe(before + 1000);
    const remaining = partPaid.amountMinor - before - 1000;
    await expect(transactions.recordPartialPayment(partPaid.id, remaining + 1)).rejects.toThrow();
  });

  it('removing the sample removes its payment records too', async () => {
    await removeDemoData();
    const left = await db.paymentRecords.filter((r) => r.transactionId.startsWith(DEMO_PREFIXES.transaction)).count();
    expect(left).toBe(0);
  });
});
