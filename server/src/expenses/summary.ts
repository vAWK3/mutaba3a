import { formatMoney, type Currency } from '../money.js';
import type { ExpenseRecord } from '../repositories/ports.js';

/**
 * The expense summary (MUT-42 D3): one block per currency, never summed
 * across currencies (ADR-004, AC 1). `customerId: null` is spending linked to
 * no client — the firm's own, or personal on a personal profile.
 */
export interface ExpenseBucket {
  total: string;
  count: number;
}

export interface ExpenseSummaryBlock extends ExpenseBucket {
  currency: Currency;
  byCategory: Array<{ categoryId: string | null } & ExpenseBucket>;
  byCustomer: Array<{ customerId: string | null } & ExpenseBucket>;
}

type Summarized = Pick<ExpenseRecord, 'currency' | 'amountMinor' | 'categoryId' | 'customerId'>;

export function summarizeExpenses(expenses: readonly Summarized[]): ExpenseSummaryBlock[] {
  const currencies = [...new Set(expenses.map((e) => e.currency))].sort() as Currency[];
  return currencies.map((currency) => {
    const rows = expenses.filter((e) => e.currency === currency);
    const fmt = (minor: bigint) => formatMoney({ minor, currency });
    return {
      currency,
      total: fmt(sum(rows)),
      count: rows.length,
      byCategory: breakdown(rows, (e) => e.categoryId).map(([categoryId, group]) => ({ categoryId, total: fmt(sum(group)), count: group.length })),
      byCustomer: breakdown(rows, (e) => e.customerId).map(([customerId, group]) => ({ customerId, total: fmt(sum(group)), count: group.length })),
    };
  });
}

function sum(rows: readonly Summarized[]): bigint {
  return rows.reduce((acc, e) => acc + e.amountMinor, 0n);
}

/** Groups by key: largest total first, ties by id, the null group last. */
function breakdown(rows: readonly Summarized[], key: (e: Summarized) => string | null): Array<[string | null, Summarized[]]> {
  const groups = new Map<string | null, Summarized[]>();
  for (const e of rows) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  return [...groups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === null || kb === null) return ka === null ? 1 : -1;
    const diff = sum(b) - sum(a);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return ka < kb ? -1 : 1;
  });
}
