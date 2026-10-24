import { addDays, addMonths, compareIsoDates, daysBetween, monthOf, type IsoDate, type IsoMonth } from '../dates.js';
import { summarizeExpenses, type ExpenseBucket } from '../expenses/summary.js';
import { formatMoney, type Currency } from '../money.js';
import type { AllocationRecord, ExpenseRecord, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';

/**
 * The activity summary behind portal Reports (MUT-175, plan §4.2 and D1): what
 * came in and went out over a period, per currency (never summed across
 * currencies, ADR-004), plus a 12-month monthly history the portal derives its
 * stage and insights from, and how long clients take to pay (D2). Pure: the
 * route reads the rows, this shapes them.
 */

export type ActivityBucket = 'day' | 'month';

/** Months of history, ending with the period's last month (D1). */
export const HISTORY_MONTHS = 12;
/** Below this many settled entries, days to get paid is not claimed (D2). */
export const MIN_DAYS_TO_PAID_SAMPLES = 3;

export interface ActivityInput {
  payments: ReadonlyArray<Pick<PaymentRecord, 'id' | 'currency' | 'amountMinor' | 'receivedOn' | 'customerId' | 'status'>>;
  expenses: ReadonlyArray<Pick<ExpenseRecord, 'currency' | 'amountMinor' | 'occurredOn' | 'categoryId' | 'customerId'>>;
  allocations: ReadonlyArray<Pick<AllocationRecord, 'paymentId' | 'receivableId'>>;
  receivables: ReadonlyArray<Pick<ReceivableRecord, 'id' | 'customerId' | 'postingDate' | 'status'>>;
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
  daysToPaid: { overall: DaysToPaid | null; byCustomer: Array<{ customerId: string } & DaysToPaid> };
}

type Pay = ActivityInput['payments'][number];
type Exp = ActivityInput['expenses'][number];

/** The first day the summary reads: the 1st of the month 11 months before `to`'s. */
export function historyStart(to: IsoDate): IsoDate {
  return `${addMonths(monthOf(to), 1 - HISTORY_MONTHS)}-01`;
}

export function summarizeActivity(input: ActivityInput): ActivitySummary {
  const payments = input.payments.filter((p) => p.status === 'POSTED');
  const inPeriod = <T>(rows: readonly T[], date: (row: T) => IsoDate) => rows.filter((r) => compareIsoDates(date(r), input.from) >= 0 && compareIsoDates(date(r), input.to) <= 0);
  const periodPayments = inPeriod(payments, (p) => p.receivedOn);
  const periodExpenses = inPeriod(input.expenses, (e) => e.occurredOn);
  const currencies = currenciesOf(periodPayments, periodExpenses);
  const keyOf = input.bucket === 'day' ? (date: IsoDate) => date : (date: IsoDate) => `${monthOf(date)}-01`;
  return {
    dataSince: earliest([...payments.map((p) => p.receivedOn), ...input.expenses.map((e) => e.occurredOn)]),
    buckets: bucketStarts(input.from, input.to, input.bucket).map((start) => ({
      start,
      currencies: currencies.map((currency) =>
        flow(
          currency,
          periodPayments.filter((p) => p.currency === currency && keyOf(p.receivedOn) === start),
          periodExpenses.filter((e) => e.currency === currency && keyOf(e.occurredOn) === start),
        ),
      ),
    })),
    currencies: activity(periodPayments, periodExpenses),
    history: historyMonths(input.to).map((month) =>
      ({ month, currencies: activity(payments.filter((p) => monthOf(p.receivedOn) === month), input.expenses.filter((e) => monthOf(e.occurredOn) === month)) }),
    ),
    daysToPaid: daysToPaid(input, payments),
  };
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
      byCustomer: byCustomer(own).map(([customerId, group]) => ({ customerId, total: fmt(sum(group)), count: group.length })),
    };
  });
}

function sum(rows: ReadonlyArray<{ amountMinor: bigint }>): bigint {
  return rows.reduce((acc, r) => acc + r.amountMinor, 0n);
}

/** Received per client: largest first, ties by id, no client last (the expense summary's order). */
function byCustomer(payments: readonly Pay[]): Array<[string | null, Pay[]]> {
  const groups = new Map<string | null, Pay[]>();
  for (const p of payments) groups.set(p.customerId, [...(groups.get(p.customerId) ?? []), p]);
  return [...groups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === null || kb === null) return ka === null ? 1 : -1;
    const diff = sum(b) - sum(a);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
    return ka < kb ? -1 : 1;
  });
}

function earliest(dates: readonly IsoDate[]): IsoDate | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (compareIsoDates(a, b) <= 0 ? a : b));
}

/** A counted walk (never an open-ended comparison): the route caps the range at 13 months. */
const MAX_BUCKETS = 400;

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
 * D2: each SETTLED Owed entry whose allocating POSTED payments were read counts
 * once — days from its date to its last such payment, never below 0. The
 * median, with n; null below MIN_DAYS_TO_PAID_SAMPLES, overall and per client.
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
    return r.status === 'SETTLED' && paidOn ? [{ customerId: r.customerId, days: Math.max(0, daysBetween(r.postingDate, paidOn)) }] : [];
  });
  const clients = [...new Set(samples.map((s) => s.customerId))].sort();
  return {
    overall: medianOf(samples.map((s) => s.days)),
    byCustomer: clients.flatMap((customerId) => {
      const m = medianOf(samples.filter((s) => s.customerId === customerId).map((s) => s.days));
      return m ? [{ customerId, ...m }] : [];
    }),
  };
}

function medianOf(values: readonly number[]): DaysToPaid | null {
  if (values.length < MIN_DAYS_TO_PAID_SAMPLES) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { median, n: sorted.length };
}
