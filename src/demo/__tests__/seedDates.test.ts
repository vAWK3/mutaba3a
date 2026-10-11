import { describe, it, expect } from 'vitest';
import { notAfter } from '../seedData/dates';
import { createDemoTransactions } from '../seedData/transactions';
import { createDemoExpenses } from '../seedData/expenses';
import { createDemoProfiles } from '../seedData/profile';

describe('notAfter', () => {
  it('keeps a date that is not later than the limit', () => {
    const limit = new Date('2026-10-11T12:00:00Z');
    const earlier = new Date('2026-10-01T00:00:00Z');
    expect(notAfter(earlier, limit).toISOString()).toBe(earlier.toISOString());
  });

  it('caps a later date at the limit', () => {
    const limit = new Date('2026-10-11T12:00:00Z');
    expect(notAfter(new Date('2026-10-19T00:00:00Z'), limit).toISOString()).toBe(limit.toISOString());
  });
});

describe('demo seed dates (ADR-038: no future payments)', () => {
  it('never dates a payment after now', () => {
    const transactions = createDemoTransactions();
    const now = Date.now(); // after generating: the seed's own "now" is the cap
    for (const tx of transactions) {
      if (tx.paidAt) expect(new Date(tx.paidAt).getTime()).toBeLessThanOrEqual(now);
    }
  });

  it('never dates an expense after today', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const expense of createDemoExpenses()) {
      expect(expense.occurredAt <= today).toBe(true);
    }
  });
});

describe('demo profiles and the default', () => {
  it('makes the first sample business the default when nothing else is', () => {
    const profiles = createDemoProfiles({ existingDefault: false });
    expect(profiles.filter((p) => p.isDefault)).toHaveLength(1);
    expect(profiles[0].isDefault).toBe(true);
  });

  it('never adds a second default next to an existing one', () => {
    const profiles = createDemoProfiles({ existingDefault: true });
    expect(profiles.some((p) => p.isDefault)).toBe(false);
  });
});
