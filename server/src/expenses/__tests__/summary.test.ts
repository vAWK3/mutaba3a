import { describe, expect, it } from 'vitest';
import { summarizeExpenses, summarizeGroup } from '../summary.js';

const row = (currency: string, amountMinor: bigint, categoryId: string | null = null, customerId: string | null = null) => ({ currency, amountMinor, categoryId, customerId });

describe('summarizeExpenses (MUT-42 AC: per currency, never summed across currencies)', () => {
  it('gives no blocks for no expenses', () => {
    expect(summarizeExpenses([])).toEqual([]);
  });

  it('keeps one block per currency, sorted by code, with totals formatted in that currency', () => {
    const blocks = summarizeExpenses([row('USD', 1_000n), row('ILS', 250n), row('ILS', 50n), row('EUR', 1n)]);
    expect(blocks.map((b) => [b.currency, b.total, b.count])).toEqual([
      ['EUR', '0.01', 1],
      ['ILS', '3.00', 2],
      ['USD', '10.00', 1],
    ]);
  });

  it('breaks each currency down by category and by customer, largest first, null (unlinked) last', () => {
    const [ils] = summarizeExpenses([
      row('ILS', 100n, 'cat-a', 'cust-1'),
      row('ILS', 900n, 'cat-b', null),
      row('ILS', 300n, null, 'cust-2'),
      row('ILS', 300n, 'cat-a', 'cust-1'),
      row('ILS', 5_000n, null, null),
    ]);
    expect(ils!.byCategory).toEqual([
      { categoryId: 'cat-b', total: '9.00', count: 1 },
      { categoryId: 'cat-a', total: '4.00', count: 2 },
      { categoryId: null, total: '53.00', count: 2 },
    ]);
    expect(ils!.byCustomer).toEqual([
      { customerId: 'cust-1', total: '4.00', count: 2 },
      { customerId: 'cust-2', total: '3.00', count: 1 },
      { customerId: null, total: '59.00', count: 2 },
    ]);
  });

  it('breaks ties by id so the order is stable', () => {
    const [ils] = summarizeExpenses([row('ILS', 100n, 'b'), row('ILS', 100n, 'a')]);
    expect(ils!.byCategory.map((c) => c.categoryId)).toEqual(['a', 'b']);
  });
});

describe('summarizeGroup (MUT-267 6A: every member has a day bucket, so buckets sum to the total)', () => {
  const m = (currency: string, amountMinor: bigint, occurredOn: string, categoryId: string | null = null) => ({ currency, amountMinor, occurredOn, categoryId, customerId: null });
  const series = { from: '2026-10-03', to: '2026-10-05' };

  it('gives no blocks for no members', () => {
    expect(summarizeGroup([], series)).toEqual([]);
  });

  it('zero-fills every series day per currency and marks it in', () => {
    const [jod] = summarizeGroup([m('JOD', 5_000n, '2026-10-04')], series);
    expect(jod!.byDay).toEqual([
      { date: '2026-10-03', total: '0.000', count: 0, position: 'in' },
      { date: '2026-10-04', total: '5.000', count: 1, position: 'in' },
      { date: '2026-10-05', total: '0.000', count: 0, position: 'in' },
    ]);
  });

  it('adds sparse before/after buckets for members outside the series, in date order', () => {
    const [jod] = summarizeGroup([m('JOD', 120_000n, '2026-09-12'), m('JOD', 80_000n, '2026-10-23'), m('JOD', 1_000n, '2026-10-03'), m('JOD', 2_000n, '2026-09-12')], series);
    expect(jod!.byDay.map((b) => [b.date, b.position, b.count])).toEqual([
      ['2026-09-12', 'before', 2],
      ['2026-10-03', 'in', 1],
      ['2026-10-04', 'in', 0],
      ['2026-10-05', 'in', 0],
      ['2026-10-23', 'after', 1],
    ]);
  });

  it('keeps currencies apart and every block sums to its own total', () => {
    const blocks = summarizeGroup([m('JOD', 1_500n, '2026-10-03'), m('USD', 4_000n, '2026-10-05'), m('USD', 1_000n, '2026-11-01')], series);
    expect(blocks.map((b) => b.currency)).toEqual(['JOD', 'USD']);
    for (const block of blocks) {
      const minor = block.byDay.reduce((acc, b) => acc + Number(b.total.replace('.', '')), 0);
      expect(minor).toBe(Number(block.total.replace('.', '')));
      expect(block.byDay.reduce((acc, b) => acc + b.count, 0)).toBe(block.count);
    }
  });

  it('walks a full 366-day series exactly, the last day included (counted loop)', () => {
    const [jod] = summarizeGroup([m('JOD', 1_000n, '2027-01-01')], { from: '2026-01-01', to: '2027-01-01' });
    expect(jod!.byDay).toHaveLength(366);
    expect(jod!.byDay.at(-1)).toEqual({ date: '2027-01-01', total: '1.000', count: 1, position: 'in' });
  });

  it('keeps the category breakdown of summarizeExpenses', () => {
    const [jod] = summarizeGroup([m('JOD', 1_000n, '2026-10-03', 'cat-a'), m('JOD', 3_000n, '2026-10-04', null)], series);
    expect(jod!.byCategory).toEqual([
      { categoryId: 'cat-a', total: '1.000', count: 1 },
      { categoryId: null, total: '3.000', count: 1 },
    ]);
  });
});
