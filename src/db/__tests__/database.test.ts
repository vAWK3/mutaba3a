import { describe, it, expect } from 'vitest';
import { uncoveredPaymentAmount } from '../database';
import type { Transaction } from '../../types';

/**
 * MUT-60: the v23 backfill's per-transaction rule, tested as a pure function
 * so every branch is covered without spinning up Dexie. The Dexie-level
 * migration test (migration-v23.test.ts) covers the wiring on top of this.
 */

function tx(overrides: Partial<Transaction> = {}): Parameters<typeof uncoveredPaymentAmount>[0] {
  return {
    kind: 'income',
    status: 'paid',
    amountMinor: 10000,
    ...overrides,
  };
}

describe('uncoveredPaymentAmount', () => {
  it('a fully-paid income transaction with no records needs the full amount covered', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'paid', amountMinor: 10000 }), 0)).toBe(10000);
  });

  it('a part-paid (unpaid) transaction needs its receivedAmountMinor covered, not the full amount', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'unpaid', amountMinor: 10000, receivedAmountMinor: 4000 }), 0)).toBe(4000);
  });

  it('an unpaid transaction with no receivedAmountMinor needs nothing covered', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'unpaid', amountMinor: 10000 }), 0)).toBe(0);
  });

  it('subtracts whatever records already exist', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'paid', amountMinor: 10000 }), 6000)).toBe(4000);
  });

  it('is already fully covered -- needs nothing more', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'paid', amountMinor: 10000 }), 10000)).toBe(0);
  });

  it('never goes negative when records exceed the total (legacy over-recorded data)', () => {
    expect(uncoveredPaymentAmount(tx({ status: 'paid', amountMinor: 10000 }), 15000)).toBe(0);
  });

  it('is 0 for an expense -- payment records only apply to income', () => {
    expect(uncoveredPaymentAmount(tx({ kind: 'expense', status: 'paid', amountMinor: 10000 }), 0)).toBe(0);
  });

  it('is 0 for a soft-deleted transaction', () => {
    expect(uncoveredPaymentAmount(tx({ deletedAt: '2026-10-01T00:00:00.000Z' }), 0)).toBe(0);
  });

  it('is 0 for an archived transaction', () => {
    expect(uncoveredPaymentAmount(tx({ archivedAt: '2026-10-01T00:00:00.000Z' }), 0)).toBe(0);
  });

  it('this is idempotent by construction: calling it again on the now-covered amount yields 0', () => {
    const t = tx({ status: 'paid', amountMinor: 10000 });
    const first = uncoveredPaymentAmount(t, 0);
    expect(uncoveredPaymentAmount(t, first)).toBe(0);
  });
});
