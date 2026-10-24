import { parseAmountToMinor } from '../../lib/utils';
import type { Language } from '../../lib/i18n/types';
import type { ActivitySummary, Currency, FxRatesResponse, HostedProfile } from '../api/client';
import { minorToDecimal } from '../format/currencies';
import { addDays, convertTotal, UNCATEGORIZED, weekStart, type Bar, type CategoryRow } from './expenseGroups';
import type { MonthPoint } from './reportInsights';

/**
 * Reports (MUT-175): the pure part. Periods and stepping, the data stage
 * (B3, DR14), and the All-profiles combine (DS1, DR30): the server answers per
 * profile and per currency (ADR-004); combining and converting happen here.
 */

export const PERIODS = ['week', 'month', 'year'] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 'month';
export const REPORT_SCOPES = ['profile', 'all'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];
export type Stage = 1 | 2 | 3;

type Day = string;
type Month = string;
export interface Range {
  from: Day;
  to: Day;
}

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
/** A month counts as complete only if records started by this day of it (DR14). */
export const COMPLETE_MONTH_CUTOFF_DAY = 7;
/** Months before the current one the history covers (the server reads 12 including the current). */
const HISTORY_COMPLETE_MONTHS = 11;

const monthOf = (day: Day): Month => day.slice(0, 7);

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number);
  const total = y! * MONTHS_PER_YEAR + (m! - 1) + n;
  return `${String(Math.floor(total / MONTHS_PER_YEAR)).padStart(4, '0')}-${String((total % MONTHS_PER_YEAR) + 1).padStart(2, '0')}`;
}

function endOfMonth(month: Month): Day {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

export function periodRange(period: Period, at: Day, language: Language): Range {
  if (period === 'week') {
    const from = weekStart(at, language);
    return { from, to: addDays(from, DAYS_PER_WEEK - 1) };
  }
  if (period === 'month') return { from: `${monthOf(at)}-01`, to: endOfMonth(monthOf(at)) };
  return { from: `${at.slice(0, 4)}-01-01`, to: `${at.slice(0, 4)}-12-31` };
}

export function bucketFor(period: Period): 'day' | 'month' {
  return period === 'year' ? 'month' : 'day';
}

/** The first day of the period before (−1) or after (+1) the one holding `at`. */
export function stepPeriod(period: Period, at: Day, direction: -1 | 1, language: Language): Day {
  const { from } = periodRange(period, at, language);
  if (period === 'week') return addDays(from, direction * DAYS_PER_WEEK);
  return `${addMonths(monthOf(from), direction * (period === 'month' ? 1 : MONTHS_PER_YEAR))}-01`;
}

/** Next is offered up to the period holding today. */
export function hasNext(period: Period, at: Day, today: Day, language: Language): boolean {
  return stepPeriod(period, at, 1, language) <= today;
}

/** Previous is offered back to the period holding the first record (always, when older records exist). */
export function hasPrevious(period: Period, at: Day, since: Day | null, earlier: boolean, language: Language): boolean {
  if (earlier) return true;
  if (!since) return false;
  return periodRange(period, stepPeriod(period, at, -1, language), language).to >= since;
}

/** The first month that counts as complete-able: since's own month if records began by its 7th day, else the next. */
function firstCountedMonth(since: Day): Month {
  return since.slice(8, 10) <= String(COMPLETE_MONTH_CUTOFF_DAY).padStart(2, '0') ? monthOf(since) : addMonths(monthOf(since), 1);
}

/** The complete months before today's, oldest first, within the history the server reads. */
export function completeMonths(since: Day | null, earlier: boolean, today: Day): Month[] {
  const current = monthOf(today);
  const window = Array.from({ length: HISTORY_COMPLETE_MONTHS }, (_, i) => addMonths(current, i - HISTORY_COMPLETE_MONTHS));
  if (earlier) return window;
  if (!since) return [];
  const first = firstCountedMonth(since);
  return window.filter((month) => month >= first);
}

export function stageOf(completeCount: number): Stage {
  return completeCount >= 2 ? 3 : completeCount === 1 ? 2 : 1;
}

/** The month the stage after `stage` begins (B8's teaser), or null at stage 3 or with no records. */
export function unlockMonth(since: Day | null, stage: Stage): Month | null {
  if (!since || stage === 3) return null;
  return addMonths(firstCountedMonth(since), stage);
}

/** Reports reads payments and expenses; a profile that can see neither is never in the switch (DR12). */
export function canReadReports(profile: Pick<HostedProfile, 'access'>): boolean {
  return profile.access.payments !== 'none' && profile.access.expenses !== 'none';
}

// ---- Money per currency, in minor units --------------------------------------

export type Money = ReadonlyMap<Currency, number>;

function addTo(into: Map<Currency, number>, currency: Currency, amount: string) {
  into.set(currency, (into.get(currency) ?? 0) + parseAmountToMinor(amount, currency));
}

function addMoney(into: Map<Currency, number>, money: Money) {
  for (const [currency, minor] of money) into.set(currency, (into.get(currency) ?? 0) + minor);
}

export function isZeroMoney(money: Money): boolean {
  return [...money.values()].every((minor) => minor === 0);
}

// ---- Combining profiles (DS1) --------------------------------------------------

export interface ProfileBlock {
  profileId: string;
  profileName: string;
  activity: ActivitySummary;
  categoryName: (categoryId: string | null) => string;
  clientName: (customerId: string | null) => string;
}

export interface CategoryRowData {
  key: string;
  name: string;
  uncategorized: boolean;
  amounts: Money;
}

export interface ClientRowData {
  key: string;
  name: string;
  /** Set only when more than one profile is in view (DR30). */
  profileName: string | null;
  amounts: Money;
  daysToPaid: number | null;
}

export interface MonthTotals {
  month: Month;
  received: Money;
  spent: Money;
  categories: CategoryRowData[];
  clients: ClientRowData[];
}

export interface Combined {
  since: Day | null;
  earlier: boolean;
  received: Money;
  spent: Money;
  buckets: Array<{ start: Day; received: Money; spent: Money }>;
  categories: CategoryRowData[];
  clients: ClientRowData[];
  history: MonthTotals[];
  daysToPaid: number | null;
}

type CurrencyActivity = ActivitySummary['currencies'][number];

/** Categories merge by name across profiles ("Food" is Food everywhere); clients never merge (DR30). */
const categoryKey = (name: string) => name.trim().toLocaleLowerCase();

function categoriesOf(blocks: ReadonlyArray<{ block: ProfileBlock; currencies: CurrencyActivity[] }>): CategoryRowData[] {
  const rows = new Map<string, { name: string; uncategorized: boolean; amounts: Map<Currency, number> }>();
  for (const { block, currencies } of blocks) {
    for (const c of currencies) {
      for (const cat of c.byCategory) {
        const name = block.categoryName(cat.categoryId);
        const key = cat.categoryId === null ? '\u0000none' : categoryKey(name);
        const row = rows.get(key) ?? { name, uncategorized: cat.categoryId === null, amounts: new Map() };
        addTo(row.amounts, c.currency, cat.total);
        rows.set(key, row);
      }
    }
  }
  return [...rows.entries()].map(([key, row]) => ({ key, ...row }));
}

function clientsOf(blocks: ReadonlyArray<{ block: ProfileBlock; currencies: CurrencyActivity[] }>, multi: boolean): ClientRowData[] {
  const rows = new Map<string, ClientRowData & { amounts: Map<Currency, number> }>();
  for (const { block, currencies } of blocks) {
    const days = new Map(block.activity.daysToPaid.byCustomer.map((d) => [d.customerId, d.median]));
    for (const c of currencies) {
      for (const client of c.byCustomer) {
        const key = `${block.profileId}:${client.customerId ?? 'none'}`;
        const row = rows.get(key) ?? { key, name: block.clientName(client.customerId), profileName: multi ? block.profileName : null, amounts: new Map(), daysToPaid: client.customerId ? (days.get(client.customerId) ?? null) : null };
        addTo(row.amounts, c.currency, client.total);
        rows.set(key, row);
      }
    }
  }
  return [...rows.values()];
}

/** The median of each profile's median, weighted by its entries: the closest honest figure without every sample. */
function weightedMedian(parts: ReadonlyArray<{ median: number; n: number }>): number | null {
  const total = parts.reduce((sum, p) => sum + p.n, 0);
  if (total === 0) return null;
  const sorted = [...parts].sort((a, b) => a.median - b.median);
  const at = (index: number) => {
    let seen = 0;
    for (const p of sorted) {
      seen += p.n;
      if (index < seen) return p.median;
    }
    return sorted.at(-1)!.median;
  };
  const mid = Math.floor(total / 2);
  return total % 2 === 1 ? at(mid) : Math.round((at(mid - 1) + at(mid)) / 2);
}

export function combine(blocks: readonly ProfileBlock[]): Combined {
  const multi = blocks.length > 1;
  const received = new Map<Currency, number>();
  const spent = new Map<Currency, number>();
  const buckets = new Map<Day, { received: Map<Currency, number>; spent: Map<Currency, number> }>();
  const months = new Map<Month, Array<{ block: ProfileBlock; currencies: CurrencyActivity[] }>>();
  for (const block of blocks) {
    for (const c of block.activity.currencies) {
      addTo(received, c.currency, c.received);
      addTo(spent, c.currency, c.spent);
    }
    for (const b of block.activity.buckets) {
      const into = buckets.get(b.start) ?? { received: new Map(), spent: new Map() };
      for (const c of b.currencies) {
        addTo(into.received, c.currency, c.received);
        addTo(into.spent, c.currency, c.spent);
      }
      buckets.set(b.start, into);
    }
    for (const h of block.activity.history) months.set(h.month, [...(months.get(h.month) ?? []), { block, currencies: h.currencies }]);
  }
  const period = blocks.map((block) => ({ block, currencies: block.activity.currencies }));
  const since = blocks.map((b) => b.activity.dataSince).filter((d): d is Day => d !== null).sort()[0] ?? null;
  return {
    since,
    earlier: blocks.some((b) => b.activity.earlierData),
    received,
    spent,
    buckets: [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([start, money]) => ({ start, ...money })),
    categories: categoriesOf(period),
    clients: clientsOf(period, multi),
    history: [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, parts]) => {
      const r = new Map<Currency, number>();
      const s = new Map<Currency, number>();
      for (const { currencies } of parts) for (const c of currencies) {
        addTo(r, c.currency, c.received);
        addTo(s, c.currency, c.spent);
      }
      return { month, received: r, spent: s, categories: categoriesOf(parts), clients: clientsOf(parts, multi) };
    }),
    daysToPaid: weightedMedian(blocks.map((b) => b.activity.daysToPaid.overall).filter((d): d is { median: number; n: number } => d !== null)),
  };
}

/** Adds the hero's money of several profiles (the Owed line in All profiles). */
export function sumMoney(parts: readonly Money[]): Money {
  const into = new Map<Currency, number>();
  for (const part of parts) addMoney(into, part);
  return into;
}

// ---- One unit for comparisons (B5, D3) -----------------------------------------

export interface Unit {
  currency: Currency;
  /** Rates to convert into `currency`; null = only `currency` counts. */
  rates: FxRatesResponse | null;
  /** True when other currencies were left out because a rate is missing (D3's label). */
  singleCurrency: boolean;
}

/**
 * The unit insights compare in (D3): one currency in view needs no rates; with
 * every rate present it is the base; otherwise the largest currency in view
 * (by `weight`, e.g. its number of records), labelled.
 */
export function chooseUnit(currencies: readonly Currency[], base: Currency, rates: FxRatesResponse | undefined, weight: (currency: Currency) => number): Unit {
  if (currencies.length <= 1) return { currency: currencies[0] ?? base, rates: null, singleCurrency: false };
  const allRated = rates && currencies.every((c) => rates.rates.some((r) => r.currency === c && r.rate > 0));
  if (allRated) return { currency: rates.base, rates, singleCurrency: false };
  const largest = [...currencies].sort((a, b) => weight(b) - weight(a) || (a === base ? -1 : b === base ? 1 : 0))[0]!;
  return { currency: largest, rates: null, singleCurrency: true };
}

/** Money in the unit's minor units. */
export function inUnit(money: Money, unit: Unit): number {
  if (!unit.rates) return money.get(unit.currency) ?? 0;
  const converted = convertMoney(money, unit.rates);
  return converted ? parseAmountToMinor(converted.total, unit.currency) : 0;
}

/** The ≈ figure (B5): every currency in the base at today's rate, or null when a rate is missing. */
export function convertMoney(money: Money, rates: FxRatesResponse) {
  const currencies = [...money.entries()].map(([currency, minor]) => ({ currency, total: minorToDecimal(minor, currency) }));
  return convertTotal({ currencies }, rates);
}

// ---- Shaping for the page (CLAUDE.md: tables and charts get shaped rows) -----

const PERCENT = 100;
const NO_CATEGORY_KEY = '\u0000none';
const isNoClient = (key: string) => key.endsWith(':none');

/** A bucket's last day: the day itself, or its month's last day. */
function bucketEnd(start: Day, bucket: 'day' | 'month'): Day {
  return bucket === 'day' ? start : endOfMonth(monthOf(start));
}

/**
 * The chart's bars in the unit's minor units (received as the first series,
 * spent beside it), the days before the first record marked "before" (DR13),
 * and the buckets whose money sits only in a currency the unit left out (D3's dot).
 */
export function chartBars(c: Combined, unit: Unit, bucket: 'day' | 'month' = 'day'): { bars: Bar[]; spent: ReadonlyMap<string, number>; other: ReadonlySet<string> } {
  const shaped = c.buckets.map((b) => ({ start: b.start, received: inUnit(b.received, unit), spent: inUnit(b.spent, unit), raw: [...b.received, ...b.spent] }));
  const max = Math.max(0, ...shaped.flatMap((b) => [b.received, b.spent]));
  const before = (start: Day) => !c.earlier && c.since !== null && bucketEnd(start, bucket) < c.since;
  return {
    bars: shaped.map((b) => ({ key: b.start, from: b.start, to: bucketEnd(b.start, bucket), position: before(b.start) ? 'before' : 'in', minor: b.received, total: minorToDecimal(b.received, unit.currency), count: 0, max })),
    spent: new Map(shaped.map((b) => [b.start, b.spent])),
    other: new Set(shaped.filter((b) => !unit.rates && b.raw.some(([currency, minor]) => currency !== unit.currency && minor !== 0)).map((b) => b.start)),
  };
}

/** List rows as shares of their total in the unit: largest first, Uncategorized and "no client" last. */
export function shareRows(rows: ReadonlyArray<{ key: string; name: string; amounts: Money }>, unit: Unit): CategoryRow[] {
  const shaped = rows.map((row) => ({ row, minor: inUnit(row.amounts, unit), last: row.key === NO_CATEGORY_KEY || isNoClient(row.key) })).filter((r) => r.minor > 0);
  const total = shaped.reduce((sum, r) => sum + r.minor, 0);
  return shaped
    .sort((a, b) => (a.last ? 1 : 0) - (b.last ? 1 : 0) || b.minor - a.minor)
    .map(({ row, minor }) => ({ key: row.key === NO_CATEGORY_KEY ? UNCATEGORIZED : row.key, name: row.name, total: minorToDecimal(minor, unit.currency), count: 0, share: total === 0 ? 0 : Math.round((minor / total) * PERCENT) }));
}

/** Insight input: each month's totals and rows in the unit (months absent from the history are empty). */
export function monthPoints(c: Combined, months: readonly Month[], unit: Unit): MonthPoint[] {
  return months.map((month) => {
    const h = c.history.find((m) => m.month === month);
    if (!h) return { month, received: 0, spent: 0, categories: [], clients: [] };
    return {
      month,
      received: inUnit(h.received, unit),
      spent: inUnit(h.spent, unit),
      categories: h.categories.map((row) => ({ key: row.key, name: row.name, amount: inUnit(row.amounts, unit) })),
      clients: h.clients.map((row) => ({ key: row.key, name: row.name, amount: inUnit(row.amounts, unit), ...(isNoClient(row.key) ? { none: true } : {}) })),
    };
  });
}

/** How many months each currency has money in across the history: D3's "largest currency in view". */
export function recordWeight(c: Combined): (currency: Currency) => number {
  return (currency) => c.history.reduce((sum, h) => sum + (h.received.get(currency) ? 1 : 0) + (h.spent.get(currency) ? 1 : 0), 0);
}

/** Every currency with money in the period or the history, sorted. */
export function currenciesIn(c: Combined): Currency[] {
  const all = new Set<Currency>();
  for (const money of [c.received, c.spent, ...c.history.flatMap((h) => [h.received, h.spent])]) for (const [currency, minor] of money) if (minor !== 0) all.add(currency);
  return [...all].sort();
}
