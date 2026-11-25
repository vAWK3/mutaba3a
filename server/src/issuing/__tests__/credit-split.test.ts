import { describe, expect, it } from 'vitest';
import { creditCap, planRelease, splitCredit, type LiveAllocation } from '../credit-split.js';

/** MUT-643 (D1–D3): how far a credit note may go, what part of it is paid money, and which allocations give it back. */

const alloc = (id: string, paymentId: string, amountMinor: bigint, at: string): LiveAllocation => ({ id, paymentId, amountMinor, createdAt: new Date(at) });

describe('creditCap', () => {
  it('is the original gross less the credit notes already on it', () => {
    expect(creditCap(100_000n, 70_000n)).toBe(30_000n);
  });

  it('is never below zero', () => {
    expect(creditCap(100_000n, 100_000n)).toBe(0n);
  });
});

describe('splitCredit', () => {
  const owed = { grossMinor: 100_000n, paidMinor: 40_000n, creditedMinor: 0n };

  it('a credit within what is still owed has no paid part', () => {
    expect(splitCredit(owed, 60_000n)).toEqual({ owedPartMinor: 60_000n, paidPartMinor: 0n });
  });

  it('a credit beyond what is still owed takes the rest from what was paid', () => {
    expect(splitCredit(owed, 80_000n)).toEqual({ owedPartMinor: 60_000n, paidPartMinor: 20_000n });
  });

  it('a fully paid invoice-receipt credited in full is all paid part', () => {
    expect(splitCredit({ grossMinor: 100_000n, paidMinor: 100_000n, creditedMinor: 0n }, 100_000n)).toEqual({ owedPartMinor: 0n, paidPartMinor: 100_000n });
  });

  it('counts earlier credits as no longer owed', () => {
    expect(splitCredit({ grossMinor: 100_000n, paidMinor: 50_000n, creditedMinor: 30_000n }, 40_000n)).toEqual({ owedPartMinor: 20_000n, paidPartMinor: 20_000n });
  });

  it('refuses a paid part larger than what was paid (the cap is checked first)', () => {
    expect(() => splitCredit(owed, 120_000n)).toThrow();
  });
});

describe('planRelease', () => {
  it('takes the paid part from the newest allocation first', () => {
    const rows = [alloc('a1', 'p1', 30_000n, '2026-11-01T10:00:00Z'), alloc('a2', 'p2', 50_000n, '2026-11-05T10:00:00Z')];
    expect(planRelease(rows, 20_000n)).toEqual([{ allocation: rows[1], releaseMinor: 20_000n }]);
  });

  it('crosses into older allocations when the newest is not enough', () => {
    const rows = [alloc('a1', 'p1', 30_000n, '2026-11-01T10:00:00Z'), alloc('a2', 'p2', 50_000n, '2026-11-05T10:00:00Z')];
    expect(planRelease(rows, 60_000n)).toEqual([
      { allocation: rows[1], releaseMinor: 50_000n },
      { allocation: rows[0], releaseMinor: 10_000n },
    ]);
  });

  it('orders rows made at the same instant by id, newest-first meaning the larger id first', () => {
    const rows = [alloc('a1', 'p1', 10_000n, '2026-11-01T10:00:00Z'), alloc('a2', 'p2', 10_000n, '2026-11-01T10:00:00Z')];
    expect(planRelease(rows, 5_000n).map((r) => r.allocation.id)).toEqual(['a2']);
  });

  it('releases nothing for a zero paid part', () => {
    expect(planRelease([alloc('a1', 'p1', 10_000n, '2026-11-01T10:00:00Z')], 0n)).toEqual([]);
  });

  it('refuses when the live allocations hold less than the paid part', () => {
    expect(() => planRelease([alloc('a1', 'p1', 10_000n, '2026-11-01T10:00:00Z')], 20_000n)).toThrow();
  });
});
