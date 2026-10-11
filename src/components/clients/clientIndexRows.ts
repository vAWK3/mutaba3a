/**
 * Row shaping and ordering for the clients index (MUT-7).
 *
 * Rows carry everything a cell shows, so cells only format. Ordering never
 * adds amounts of different currencies: owed now ranks by today's exchange
 * rate (ADR-034) -- a ranking only, nothing converted is ever displayed --
 * and every other column compares something currency-free (days, dates,
 * names). Ties always fall back to name A–Z, then id, so the order is stable.
 */

import { convertAmount } from '../../lib/fx';
import type { ClientSummary, Currency, LastPayment, OwedByCurrency } from '../../types';
import type { SortDir } from '../../hooks/useSortState';

export type ClientSortField = 'name' | 'owed' | 'overdue' | 'lastPayment' | 'activity';

export const CLIENT_SORT_FIELDS: ClientSortField[] = ['name', 'owed', 'overdue', 'lastPayment', 'activity'];

/** Rates to ILS per currency. ILS is always 1; a missing currency has no rate. */
export type RatesToIls = Partial<Record<Exclude<Currency, 'ILS'>, number>>;

const RANK_CURRENCIES: readonly Currency[] = ['USD', 'ILS', 'EUR'];

export interface ClientIndexRow {
  id: string;
  name: string;
  owed: OwedByCurrency[];
  isSettled: boolean;
  /** Currencies with an overdue amount, in owed order */
  overdue: { currency: Currency; amountMinor: number }[];
  oldestOverdueDays?: number;
  lastPayment?: LastPayment;
  lastActivityAt?: string;
  /** Owed-now ordering key; see owedRank */
  owedRank: number[];
}

/**
 * Owed-now ordering key: [ILS-converted total over the currencies that have
 * a rate, then the amount of each currency that has none, in USD, ILS, EUR
 * order]. Compared element by element, so an amount without a rate ranks
 * after every amount with one rather than being guessed at.
 */
export function owedRank(owed: OwedByCurrency[], rates: RatesToIls): number[] {
  const rateOf = (currency: Currency) => (currency === 'ILS' ? 1 : rates[currency]);
  let ratedTotal = 0;
  const unrated = RANK_CURRENCIES.map(() => 0);

  for (const { currency, owedMinor } of owed) {
    const rate = rateOf(currency);
    if (rate) ratedTotal += convertAmount(owedMinor, currency, 'ILS', rate);
    else unrated[RANK_CURRENCIES.indexOf(currency)] += owedMinor;
  }
  return [ratedTotal, ...unrated];
}

export function toClientIndexRow(summary: ClientSummary, rates: RatesToIls): ClientIndexRow {
  return {
    id: summary.id,
    name: summary.name,
    owed: summary.owed,
    isSettled: summary.owed.length === 0,
    overdue: summary.owed
      .filter((o) => o.overdueMinor > 0)
      .map((o) => ({ currency: o.currency, amountMinor: o.overdueMinor })),
    oldestOverdueDays: summary.oldestOverdueDays,
    lastPayment: summary.lastPayment,
    lastActivityAt: summary.lastActivityAt,
    owedRank: owedRank(summary.owed, rates),
  };
}

const compareTuples = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const byField: Record<ClientSortField, (a: ClientIndexRow, b: ClientIndexRow) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  owed: (a, b) => compareTuples(a.owedRank, b.owedRank),
  overdue: (a, b) => (a.oldestOverdueDays ?? -1) - (b.oldestOverdueDays ?? -1),
  lastPayment: (a, b) => (a.lastPayment?.paidAt.slice(0, 10) ?? '').localeCompare(b.lastPayment?.paidAt.slice(0, 10) ?? ''),
  activity: (a, b) => (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? ''),
};

const tieBreak = (a: ClientIndexRow, b: ClientIndexRow) =>
  a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Comparator for one column and direction; ties are always name A–Z, then id. */
export function compareClientRows(field: ClientSortField, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1;
  return (a: ClientIndexRow, b: ClientIndexRow) => sign * byField[field](a, b) || tieBreak(a, b);
}
