import { describe, expect, it } from 'vitest';
import { summarizeExpenses } from '../summary.js';

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
