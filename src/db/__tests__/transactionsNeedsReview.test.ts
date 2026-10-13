import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { getRepositories } from '../provider';

// MUT-47 (T6): the migration wizard's reads and writes, moved from the
// component into the transactions repository. The write is pinned exactly as
// it was: profileId set, needsReview cleared, nothing else (no updatedAt —
// TODOS #9).

const stamp = '2024-01-01T00:00:00.000Z';
const base = { kind: 'income' as const, status: 'unpaid' as const, amountMinor: 1, currency: 'USD' as const, occurredAt: '2024-01-01', createdAt: stamp, updatedAt: stamp };

beforeEach(async () => {
  await db.transactions.clear();
  await db.transactions.bulkAdd([
    { ...base, id: 't-review', needsReview: true },
    { ...base, id: 't-review-2', needsReview: true },
    { ...base, id: 't-done' },
  ]);
});
afterEach(() => db.transactions.clear());

describe('transactions.listNeedsReview', () => {
  it('returns only rows flagged needsReview', async () => {
    const rows = await getRepositories().base.transactions.listNeedsReview();
    expect(rows.map((r) => r.id).sort()).toEqual(['t-review', 't-review-2']);
  });
});

describe('transactions.resolveNeedsReview', () => {
  it('files each reviewed row under its chosen business and clears only those flags', async () => {
    await getRepositories().base.transactions.resolveNeedsReview({ 't-review': 'bp-1' });

    const reviewed = await db.transactions.get('t-review');
    expect(reviewed?.profileId).toBe('bp-1');
    expect(reviewed?.needsReview).toBeUndefined();
    expect(reviewed?.updatedAt).toBe(stamp);
    expect((await db.transactions.get('t-review-2'))?.needsReview).toBe(true);
  });
});
