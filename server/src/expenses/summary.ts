import { addDays, compareIsoDates, type IsoDate } from '../dates.js';
import { formatMoney, type Currency } from '../money.js';
import { MAX_GROUP_SPAN_DAYS } from './groups.js';
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

export function sum(rows: ReadonlyArray<{ amountMinor: bigint }>): bigint {
  return rows.reduce((acc, e) => acc + e.amountMinor, 0n);
}

/** Groups by key: largest total first, ties by id, the null group last. MUT-175 reuses it for received by client. */
export function breakdown<T extends { amountMinor: bigint }>(rows: readonly T[], key: (row: T) => string | null): Array<[string | null, T[]]> {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  const totals = new Map([...groups].map(([k, group]) => [k, sum(group)]));
  return [...groups.entries()].sort(([ka], [kb]) => {
    if (ka === null || kb === null) return ka === null ? 1 : -1;
    const diff = totals.get(kb)! - totals.get(ka)!;
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return ka < kb ? -1 : 1;
  });
}

export type DayPosition = 'before' | 'in' | 'after';

export interface DayBucket extends ExpenseBucket {
  date: IsoDate;
  position: DayPosition;
}

export interface GroupSummaryBlock extends ExpenseSummaryBlock {
  byDay: DayBucket[];
}

type GroupSummarized = Summarized & Pick<ExpenseRecord, 'occurredOn'>;

/**
 * A group's summary (MUT-267): the expense summary per currency plus one
 * bucket per day. Every series day is zero-filled; every member dated outside
 * the series gets a sparse bucket marked before or after it (design review 6A),
 * so a currency's buckets always sum to its total.
 */
export function summarizeGroup(members: readonly GroupSummarized[], series: { from: IsoDate; to: IsoDate }): GroupSummaryBlock[] {
  return summarizeExpenses(members).map((block) => ({
    ...block,
    byDay: dayBuckets(
      members.filter((e) => e.currency === block.currency),
      series,
      block.currency,
    ),
  }));
}

function dayBuckets(rows: readonly GroupSummarized[], series: { from: IsoDate; to: IsoDate }, currency: Currency): DayBucket[] {
  const byDate = new Map<IsoDate, GroupSummarized[]>();
  for (const e of rows) {
    const day = byDate.get(e.occurredOn);
    if (day) day.push(e);
    else byDate.set(e.occurredOn, [e]);
  }
  const dates = new Set(byDate.keys());
  // A counted walk, never an open-ended string comparison (pre-landing review): at most one group span of days.
  for (let d = series.from, i = 0; i < MAX_GROUP_SPAN_DAYS && compareIsoDates(d, series.to) <= 0; d = addDays(d, 1), i++) dates.add(d);
  return [...dates].sort().map((date) => {
    const group = byDate.get(date) ?? [];
    const position: DayPosition = compareIsoDates(date, series.from) < 0 ? 'before' : compareIsoDates(date, series.to) > 0 ? 'after' : 'in';
    return { date, total: formatMoney({ minor: sum(group), currency }), count: group.length, position };
  });
}
