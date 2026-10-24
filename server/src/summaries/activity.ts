import { addDays, addMonths, compareIsoDates, daysBetween, endOfMonth, monthOf, type IsoDate, type IsoMonth } from '../dates.js';
import { breakdown, sum, summarizeExpenses, type ExpenseBucket } from '../expenses/summary.js';
import { formatMoney, type Currency } from '../money.js';
import type { AllocationRecord, ExpenseRecord, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';

/**
 * The activity summary behind portal Reports (MUT-175, plan §4.2 and D1): what
 * came in and went out over a period, per currency (never summed across
 * currencies, ADR-004), plus a 12-month monthly history the portal derives its
 * stage and insights from, and how long clients take to pay (D2). Pure: the
 * route reads the rows, this shapes them. Rows are grouped once by bucket and
 * by month, then read from the groups (review: no per-bucket rescans).
 */

export type ActivityBucket = 'day' | 'month';

/** Months of history, ending with the period's last month (D1). */
export const HISTORY_MONTHS = 12;
/** Below this many settled entries, days to get paid is not claimed (D2). */
export const MIN_DAYS_TO_PAID_SAMPLES = 3;
/** One bucket per day of the longest range the route accepts (13 months), with room to spare. */
export const MAX_BUCKETS = 13 * 31;

export interface ActivityInput {
  payments: ReadonlyArray<Pick<PaymentRecord, 'id' | 'currency' | 'amountMinor' | 'receivedOn' | 'customerId' | 'status'>>;
  expenses: ReadonlyArray<Pick<ExpenseRecord, 'currency' | 'amountMinor' | 'occurredOn' | 'categoryId' | 'customerId'>>;
  allocations: ReadonlyArray<Pick<AllocationRecord, 'paymentId' | 'receivableId'>>;
  receivables: ReadonlyArray<Pick<ReceivableRecord, 'id' | 'customerId' | 'postingDate' | 'status' | 'grossMinor' | 'paidMinor'>>;
  from: IsoDate;
  to: IsoDate;
  bucket: ActivityBucket;
}

export interface CurrencyFlow {
  currency: Currency;
  received: string;
  spent: string;
}

export interface CurrencyActivity extends CurrencyFlow {
  byCategory: Array<{ categoryId: string | null } & ExpenseBucket>;
  /** Received per client, largest first; null (no client) last. */
  byCustomer: Array<{ customerId: string | null } & ExpenseBucket>;
}

export interface DaysToPaid {
  median: number;
  n: number;
}

export interface ActivitySummary {
  dataSince: IsoDate | null;
  buckets: Array<{ start: IsoDate; currencies: CurrencyFlow[] }>;
  currencies: CurrencyActivity[];
  history: Array<{ month: IsoMonth; currencies: CurrencyActivity[] }>;
  daysToPaid: {
    overall: DaysToPaid | null;
    byCustomer: Array<{ customerId: string } & DaysToPaid>;
    /** D2 (review): each counted entry's days, so All profiles can take the median over every sample. No ids or amounts. */
    samples: number[];
  };
}

type Pay = ActivityInput['payments'][number];
type Exp = ActivityInput['expenses'][number];

/** The first day the summary reads: the 1st of the month 11 months before `to`'s. */
export function historyStart(to: IsoDate): IsoDate {
  return `${addMonths(monthOf(to), 1 - HISTORY_MONTHS)}-01`;
}

export function summarizeActivity(input: ActivityInput): ActivitySummary {
  const payments = input.payments.filter((p) => p.status === 'POSTED');
  const within = (date: IsoDate) => compareIsoDates(date, input.from) >= 0 && compareIsoDates(date, input.to) <= 0;
  const periodPayments = payments.filter((p) => within(p.receivedOn));
  const periodExpenses = input.expenses.filter((e) => within(e.occurredOn));
  const currencies = currenciesOf(periodPayments, periodExpenses);
  const keyOf = input.bucket === 'day' ? (date: IsoDate) => date : (date: IsoDate) => `${monthOf(date)}-01`;
  const byBucket = groupBy(periodPayments, periodExpenses, (p) => keyOf(p.receivedOn), (e) => keyOf(e.occurredOn));
  const byMonth = groupBy(payments, input.expenses, (p) => monthOf(p.receivedOn), (e) => monthOf(e.occurredOn));
  return {
    dataSince: earliest([...payments.map((p) => p.receivedOn), ...input.expenses.map((e) => e.occurredOn)]),
    buckets: bucketStarts(input.from, input.to, input.bucket).map((start) => {
      const rows = byBucket.get(start) ?? EMPTY;
      return { start, currencies: currencies.map((currency) => flow(currency, rows.payments.filter((p) => p.currency === currency), rows.expenses.filter((e) => e.currency === currency))) };
    }),
    currencies: activity(periodPayments, periodExpenses),
    history: historyMonths(input.to).map((month) => {
      const rows = byMonth.get(month) ?? EMPTY;
      return { month, currencies: activity(rows.payments, rows.expenses) };
    }),
    daysToPaid: daysToPaid(input, payments),
  };
}

const EMPTY = { payments: [] as Pay[], expenses: [] as Exp[] };

function groupBy(payments: readonly Pay[], expenses: readonly Exp[], payKey: (p: Pay) => string, expKey: (e: Exp) => string): Map<string, { payments: Pay[]; expenses: Exp[] }> {
  const groups = new Map<string, { payments: Pay[]; expenses: Exp[] }>();
  const at = (key: string) => {
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { payments: [], expenses: [] }));
    return group;
  };
  for (const p of payments) at(payKey(p)).payments.push(p);
  for (const e of expenses) at(expKey(e)).expenses.push(e);
  return groups;
}

function currenciesOf(payments: readonly Pay[], expenses: readonly Exp[]): Currency[] {
  return [...new Set([...payments.map((p) => p.currency), ...expenses.map((e) => e.currency)])].sort() as Currency[];
}

function flow(currency: Currency, payments: readonly Pay[], expenses: readonly Exp[]): CurrencyFlow {
  const fmt = (minor: bigint) => formatMoney({ minor, currency });
  return { currency, received: fmt(sum(payments)), spent: fmt(sum(expenses)) };
}

function activity(payments: readonly Pay[], expenses: readonly Exp[]): CurrencyActivity[] {
  const spending = summarizeExpenses(expenses);
  return currenciesOf(payments, expenses).map((currency) => {
    const own = payments.filter((p) => p.currency === currency);
    const fmt = (minor: bigint) => formatMoney({ minor, currency });
    return {
      ...flow(currency, own, expenses.filter((e) => e.currency === currency)),
      byCategory: spending.find((b) => b.currency === currency)?.byCategory ?? [],
      byCustomer: breakdown(own, (p) => p.customerId).map(([customerId, group]) => ({ customerId, total: fmt(sum(group)), count: group.length })),
    };
  });
}

function earliest(dates: readonly IsoDate[]): IsoDate | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (compareIsoDates(a, b) <= 0 ? a : b));
}

/** A counted walk (never an open-ended comparison), capped at MAX_BUCKETS. */
function bucketStarts(from: IsoDate, to: IsoDate, bucket: ActivityBucket): IsoDate[] {
  const starts: IsoDate[] = [];
  if (bucket === 'day') {
    for (let d = from, i = 0; i < MAX_BUCKETS && compareIsoDates(d, to) <= 0; d = addDays(d, 1), i++) starts.push(d);
    return starts;
  }
  for (let m = monthOf(from), i = 0; i < MAX_BUCKETS && m <= monthOf(to); m = addMonths(m, 1), i++) starts.push(`${m}-01`);
  return starts;
}

function historyMonths(to: IsoDate): IsoMonth[] {
  const last = monthOf(to);
  return Array.from({ length: HISTORY_MONTHS }, (_, i) => addMonths(last, i + 1 - HISTORY_MONTHS));
}

/**
 * D2: each Owed entry that is SETTLED and fully paid (not closed by a credit)
 * counts once: days from its date to its last allocating POSTED payment that
 * was read, never below 0. The median, with n; null below
 * MIN_DAYS_TO_PAID_SAMPLES, overall and per client. The route reads payments
 * through `to`, so on a past period an entry finished after `to` is measured
 * from its last payment by `to` (the portal shows per-client days from the
 * current months, never a past period's).
 */
function daysToPaid(input: ActivityInput, posted: readonly Pay[]): ActivitySummary['daysToPaid'] {
  const receivedOn = new Map(posted.map((p) => [p.id, p.receivedOn]));
  const lastPaid = new Map<string, IsoDate>();
  for (const a of input.allocations) {
    const on = receivedOn.get(a.paymentId);
    if (!on) continue;
    const seen = lastPaid.get(a.receivableId);
    if (!seen || compareIsoDates(on, seen) > 0) lastPaid.set(a.receivableId, on);
  }
  const samples = input.receivables.flatMap((r) => {
    const paidOn = lastPaid.get(r.id);
    const paidInFull = r.status === 'SETTLED' && r.paidMinor >= r.grossMinor;
    return paidInFull && paidOn ? [{ customerId: r.customerId, days: Math.max(0, daysBetween(r.postingDate, paidOn)) }] : [];
  });
  const clients = [...new Set(samples.map((s) => s.customerId))].sort();
  return {
    overall: medianOf(samples.map((s) => s.days)),
    byCustomer: clients.flatMap((customerId) => {
      const m = medianOf(samples.filter((s) => s.customerId === customerId).map((s) => s.days));
      return m ? [{ customerId, ...m }] : [];
    }),
    samples: samples.map((s) => s.days).sort((a, b) => a - b),
  };
}

export function medianOf(values: readonly number[]): DaysToPaid | null {
  if (values.length < MIN_DAYS_TO_PAID_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { median, n: sorted.length };
}

/** The last day of `to`'s month: history months are whole when the route reads this far (review: history doc). */
export function historyEnd(to: IsoDate): IsoDate {
  return endOfMonth(to);
}
