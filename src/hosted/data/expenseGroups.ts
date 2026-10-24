import { currencyExponent, parseAmountToMinor } from '../../lib/utils';
import type { Language } from '../../lib/i18n/types';
import type { Currency, Expense, ExpenseGroup, ExpenseGroupMark, ExpenseGroupSummary, FxRatesResponse } from '../api/client';
import { minorToDecimal } from '../format/currencies';

/**
 * The expense-group rules the portal derives itself (MUT-268, eng plan E3–E8):
 * status, windows, per-day, bars, categories, the converted line, and the
 * optimistic leave-out overlay. Pure: no React, no network. Calendar dates are
 * `YYYY-MM-DD` and handled as UTC days, so no zone moves them. Money is integer
 * minor units in and canonical decimal strings out, never floats in between
 * (the one division, FX, is rounded straight back to minor units).
 */

export type Day = string;
export type Position = 'before' | 'in' | 'after';
export type GroupStatus = 'upcoming' | 'ongoing' | 'past';
type CurrencyBlock = ExpenseGroupSummary['currencies'][number];
type DayBucket = CurrencyBlock['byDay'][number];
type CategoryBucket = CurrencyBlock['byCategory'][number];

const MS_PER_DAY = 86_400_000;
/** 366 days including both ends: the API's GROUP_RANGE_TOO_LONG bound (MUT-267 R2). */
const MAX_RANGE_DAYS = 365;
/** The "Still going? Add an end date" nudge starts this many months after the start (10A). */
const NUDGE_MONTHS = 11;
/** The add-from-outside picker looks this far either side of the dates (12A). */
const PICKER_DAYS = 30;
/** Daily bars up to this many days, weekly beyond (19A). */
const DAILY_MAX_DAYS = 31;
/** On a phone, daily bars keep a 6 px minimum, so they turn weekly sooner (19A). */
const DAILY_MAX_DAYS_NARROW = 21;
const PERCENT = 100;
/** Week starts: Saturday for Arabic, Monday for English (UTC weekday numbers). */
const WEEK_START: Record<Language, number> = { ar: 6, en: 1 };

const toMs = (day: Day) => Date.parse(`${day}T00:00:00Z`);
const fromMs = (ms: number): Day => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: Day, days: number): Day {
  return fromMs(toMs(day) + days * MS_PER_DAY);
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((toMs(to) - toMs(from)) / MS_PER_DAY) + 1;
}

function addMonths(day: Day, months: number): Day {
  const date = new Date(toMs(day));
  date.setUTCMonth(date.getUTCMonth() + months);
  return fromMs(date.getTime());
}

const minDay = (a: Day, b: Day) => (a < b ? a : b);

/** The last day an end date may take (start + 365). */
export function maxEndOn(startOn: Day): Day {
  return addDays(startOn, MAX_RANGE_DAYS);
}

export function weekStart(day: Day, language: Language): Day {
  const weekday = new Date(toMs(day)).getUTCDay();
  return addDays(day, -((weekday - WEEK_START[language] + 7) % 7));
}

type GroupDates = Pick<ExpenseGroup, 'startOn' | 'endOn' | 'windowEnd'>;

export function groupStatus(group: GroupDates, today: Day): GroupStatus {
  if (today < group.startOn) return 'upcoming';
  return today > group.windowEnd ? 'past' : 'ongoing';
}

/** An open group stops collecting a year after it starts (MUT-267 R6). */
export function reachedYear(group: GroupDates, today: Day): boolean {
  return group.endOn === null && today > group.windowEnd;
}

export function needsEndDate(group: GroupDates, today: Day): boolean {
  return group.endOn === null && !reachedYear(group, today) && today >= addMonths(group.startOn, NUDGE_MONTHS);
}

/** Days covered so far: the whole range when closed, start → today when open; null for an open group not started. */
export function dayCount(group: GroupDates, today: Day): number | null {
  if (group.endOn !== null) return daysBetween(group.startOn, group.endOn);
  if (today < group.startOn) return null;
  return daysBetween(group.startOn, minDay(today, group.windowEnd));
}

export function inWindow(day: Day, group: GroupDates): boolean {
  return day >= group.startOn && day <= group.windowEnd;
}

export function positionOf(day: Day, group: GroupDates): Position {
  if (day < group.startOn) return 'before';
  return day > group.windowEnd ? 'after' : 'in';
}

/**
 * The action → request table (plan Pass 7). Member rows carry no mark: an
 * in-window member may be unmarked or kept, so Leave out is PUT excluded and its
 * Undo a DELETE (TD-166); an out-of-window member can only be kept.
 */
export type Verb = 'leaveOut' | 'remove' | 'bringBack' | 'add';
export type RowList = 'member' | 'excluded' | 'pool';

export function verbFor(list: RowList, occurredOn: Day, group: GroupDates): Verb {
  if (list === 'excluded') return 'bringBack';
  if (list === 'pool') return 'add';
  return inWindow(occurredOn, group) ? 'leaveOut' : 'remove';
}

/** A row's identity for its exit/return motion: the same expense can be in Members and Left out. */
export const motionKey = (list: RowList, id: string) => `${list}:${id}`;

/** The mark each verb sends; null = DELETE. */
export const VERB_MARK: Record<Verb, ExpenseGroupMark | null> = { leaveOut: 'excluded', remove: null, bringBack: null, add: 'included' };

/** Undo of a verb is the verb that puts the row back (spatially and on the server). */
export const INVERSE_VERB: Record<Verb, Verb> = { leaveOut: 'bringBack', bringBack: 'leaveOut', remove: 'add', add: 'remove' };

const LEAVES: ReadonlySet<Verb> = new Set(['leaveOut', 'remove']);

/** The currency tab's default (5A): most members, then the profile default, then alphabetical; a wanted one wins if present. */
export function defaultCurrency(blocks: CurrencyBlock[], profileDefault: Currency, wanted?: Currency): Currency | undefined {
  if (wanted && blocks.some((b) => b.currency === wanted)) return wanted;
  const most = Math.max(...blocks.map((b) => b.count));
  const tied = blocks.filter((b) => b.count === most).map((b) => b.currency);
  if (tied.includes(profileDefault)) return profileDefault;
  return [...tied].sort()[0];
}

const minorOf = (amount: string, currency: Currency) => parseAmountToMinor(amount, currency);

/** Half away from zero, the way money is usually rounded. */
const roundMinor = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

/** In-window spend ÷ elapsed in-window days (7A); null before day 1. Kept days outside the dates are left out of it. */
export function perDay(block: CurrencyBlock, group: GroupDates, today: Day): string | null {
  if (today < group.startOn) return null;
  const elapsed = daysBetween(group.startOn, minDay(today, group.endOn ?? group.windowEnd));
  // Spend on days still to come (a prepaid hotel) waits for its day, as an open group's 'after' buckets do
  const inMinor = block.byDay.filter((b) => b.position === 'in' && b.date <= today).reduce((sum, b) => sum + minorOf(b.total, block.currency), 0);
  return minorToDecimal(roundMinor(inMinor / elapsed), block.currency);
}

export type BarMode = 'daily' | 'weekly';

export function barMode(summary: Pick<ExpenseGroupSummary, 'seriesFrom' | 'seriesTo'>, narrow: boolean): BarMode {
  const days = daysBetween(summary.seriesFrom, summary.seriesTo);
  return days > (narrow ? DAILY_MAX_DAYS_NARROW : DAILY_MAX_DAYS) ? 'weekly' : 'daily';
}

export interface Bar {
  key: string;
  from: Day;
  to: Day;
  position: Position;
  minor: number;
  total: string;
  count: number;
  /** The tallest bar's minor units, for scaling. */
  max: number;
}

const POSITION_ORDER: Record<Position, number> = { before: 0, in: 1, after: 2 };

/** One bar per series day (or week) plus sparse bars for members outside the series (6A); they sum to the total. */
export function toBars(block: CurrencyBlock, mode: BarMode, language: Language): Bar[] {
  const grouped = new Map<string, Omit<Bar, 'total' | 'max' | 'key'>>();
  for (const b of block.byDay) {
    const from = mode === 'weekly' ? weekStart(b.date, language) : b.date;
    const key = `${b.position}:${from}`;
    const bar = grouped.get(key) ?? { from, to: mode === 'weekly' ? addDays(from, 6) : b.date, position: b.position, minor: 0, count: 0 };
    bar.minor += minorOf(b.total, block.currency);
    bar.count += b.count;
    grouped.set(key, bar);
  }
  const bars = [...grouped.entries()]
    .map(([key, bar]) => ({ ...bar, key }))
    .sort((a, b) => (a.from === b.from ? POSITION_ORDER[a.position] - POSITION_ORDER[b.position] : a.from < b.from ? -1 : 1));
  const max = Math.max(0, ...bars.map((b) => b.minor));
  return bars.map((bar) => ({ ...bar, total: minorToDecimal(bar.minor, block.currency), max }));
}

/** Series days with no spend in `currency` but some in another (20A's dot), with those currencies. */
export function otherCurrencyDays(summary: ExpenseGroupSummary, currency: Currency): Map<Day, Currency[]> {
  const own = summary.currencies.find((c) => c.currency === currency);
  const spentOwn = new Set(own?.byDay.filter((b) => b.count > 0).map((b) => b.date));
  const result = new Map<Day, Currency[]>();
  for (const block of summary.currencies) {
    if (block.currency === currency) continue;
    for (const b of block.byDay) {
      if (b.position !== 'in' || b.count === 0 || spentOwn.has(b.date)) continue;
      result.set(b.date, [...(result.get(b.date) ?? []), block.currency]);
    }
  }
  return result;
}

/** `?category=` value for expenses with no category (23A). */
export const UNCATEGORIZED = 'none';

export interface CategoryRow {
  key: string;
  name: string;
  total: string;
  count: number;
  /** Whole percent of the currency total. */
  share: number;
}

export function categoryRows(block: CurrencyBlock, names: Map<string, string>, uncategorized: string): CategoryRow[] {
  const whole = minorOf(block.total, block.currency);
  const row = (c: CategoryBucket): CategoryRow => ({
    key: c.categoryId ?? UNCATEGORIZED,
    name: c.categoryId === null ? uncategorized : names.get(c.categoryId) ?? '—',
    total: c.total,
    count: c.count,
    share: whole === 0 ? 0 : Math.round((minorOf(c.total, block.currency) * PERCENT) / whole),
  });
  const byAmount = (a: CategoryBucket, b: CategoryBucket) => minorOf(b.total, block.currency) - minorOf(a.total, block.currency);
  const named = block.byCategory.filter((c) => c.categoryId !== null).sort(byAmount);
  return [...named, ...block.byCategory.filter((c) => c.categoryId === null)].map(row);
}

/** The picker's pool (12A): 30 days before the start; 30 after the end, for a closed group only. */
export function pickerWindow(group: GroupDates, side: 'before' | 'after'): { from: Day; to: Day } | null {
  if (side === 'before') return { from: addDays(group.startOn, -PICKER_DAYS), to: addDays(group.startOn, -1) };
  if (group.endOn === null) return null;
  return { from: addDays(group.endOn, 1), to: addDays(group.endOn, PICKER_DAYS) };
}

export interface ConvertedTotal {
  total: string;
  currency: Currency;
  rateDate: string;
  stale: boolean;
  /** True if any line below is derived from a USD peg rather than a live ECB rate. */
  derived: boolean;
  /** The rates used, per 1 base unit, for the label; each line's own pegged/ECB status. */
  used: { currency: Currency; rate: number; derived: boolean }[];
}

/**
 * The ≈ line (2A, ADR-087): each currency's total in the base at today's rate.
 * `rate` is units of the currency per 1 base, so a currency goes to the base by
 * dividing; minor units are rescaled between exponents (3 for JOD, 2 for the rest).
 */
export function convertTotal(summary: { currencies: ReadonlyArray<{ currency: Currency; total: string }> }, rates: FxRatesResponse): ConvertedTotal | null {
  if (summary.currencies.length === 0) return null;
  const baseExponent = currencyExponent(rates.base);
  let minor = 0;
  const used: ConvertedTotal['used'] = [];
  let derived = false;
  for (const block of summary.currencies) {
    const rate = rates.rates.find((r) => r.currency === block.currency);
    if (!rate || rate.rate <= 0) return null;
    const scale = 10 ** (baseExponent - currencyExponent(block.currency));
    minor += (minorOf(block.total, block.currency) * scale) / rate.rate;
    derived ||= rate.derived;
    if (block.currency !== rates.base) used.push({ currency: block.currency, rate: rate.rate, derived: rate.derived ?? false });
  }
  return { total: minorToDecimal(roundMinor(minor), rates.base), currency: rates.base, rateDate: rates.rateDate, stale: rates.source === 'stale', derived, used };
}

/** How many times each read had loaded when a mark's request settled (TanStack's `dataUpdateCount`). */
export interface SeenReads {
  summary: number;
  members: number;
  excluded: number;
}

/** A leave-out (or its undo) shown before the server confirms it (craft spec 1, eng R1). */
export interface PendingMark {
  id: string;
  verb: Verb;
  row: Expense;
  /** The reads' load counts when its request settled; the overlay stops once a read loads again after that. */
  settled: SeenReads | null;
}

function addTo<T>(items: T[], match: (item: T) => boolean, make: () => T, change: (item: T) => T): T[] {
  return items.some(match) ? items.map((item) => (match(item) ? change(item) : item)) : [...items, change(make())];
}

function shiftBlock(block: CurrencyBlock, row: Expense, sign: 1 | -1, position: Position): CurrencyBlock {
  const delta = sign * minorOf(row.amount, block.currency);
  const plus = (total: string) => minorToDecimal(minorOf(total, block.currency) + delta, block.currency);
  const byDay = addTo<DayBucket>(
    block.byDay,
    (b) => b.date === row.occurredOn,
    () => ({ date: row.occurredOn, position, total: minorToDecimal(0, block.currency), count: 0 }),
    (b) => ({ ...b, total: plus(b.total), count: b.count + sign }),
  )
    .filter((b) => b.position === 'in' || b.count > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const categoryId = row.categoryId ?? null;
  const byCategory = addTo<CategoryBucket>(
    block.byCategory,
    (c) => c.categoryId === categoryId,
    () => ({ categoryId, total: minorToDecimal(0, block.currency), count: 0 }),
    (c) => ({ ...c, total: plus(c.total), count: c.count + sign }),
  ).filter((c) => c.count > 0);
  return { ...block, total: plus(block.total), count: block.count + sign, byDay, byCategory };
}

function seriesPosition(day: Day, summary: ExpenseGroupSummary): Position {
  if (day < summary.seriesFrom) return 'before';
  return day > summary.seriesTo ? 'after' : 'in';
}

/** The summary with pending marks applied: totals, day and category buckets move from the row's own figures. */
export function applyMarks(summary: ExpenseGroupSummary, marks: PendingMark[]): ExpenseGroupSummary {
  let currencies = summary.currencies;
  for (const mark of marks) {
    const sign = LEAVES.has(mark.verb) ? -1 : 1;
    const { currency } = mark.row;
    const empty: CurrencyBlock = { currency, total: minorToDecimal(0, currency), count: 0, byCategory: [], byCustomer: [], byDay: [] };
    currencies = addTo(
      currencies,
      (c) => c.currency === currency,
      () => empty,
      (c) => shiftBlock(c, mark.row, sign, seriesPosition(mark.row.occurredOn, summary)),
    );
  }
  return { ...summary, currencies: currencies.filter((c) => c.count > 0) };
}

const byDate = (a: Expense, b: Expense) => (a.occurredOn === b.occurredOn ? (a.id < b.id ? -1 : 1) : a.occurredOn < b.occurredOn ? -1 : 1);

/** Oldest first, then by id: the member list's order (4A). */
export function sortOldestFirst(rows: Expense[]): Expense[] {
  return [...rows].sort(byDate);
}

/** Members and Left out with pending marks applied: a row leaves one list and (when in the window) joins the other. */
export function applyRowMarks(members: Expense[], excluded: Expense[], marks: PendingMark[]): { members: Expense[]; excluded: Expense[] } {
  let m = members;
  let x = excluded;
  for (const { verb, row } of marks) {
    const without = (rows: Expense[]) => rows.filter((r) => r.id !== row.id);
    if (verb === 'leaveOut') [m, x] = [without(m), [row, ...without(x)]];
    if (verb === 'remove') m = without(m);
    if (verb === 'bringBack') [m, x] = [[...without(m), row].sort(byDate), without(x)];
    if (verb === 'add') m = [...without(m), row].sort(byDate);
  }
  return { members: m, excluded: x };
}

/** The member list behind a category row: that category within the selected currency (13A, eng R4). */
export function filterMembers(rows: Expense[], category: string | undefined, currency: Currency | undefined): Expense[] {
  if (!category) return rows;
  const wanted = category === UNCATEGORIZED ? null : category;
  return rows.filter((r) => (r.categoryId ?? null) === wanted && (!currency || r.currency === currency));
}

export interface MemberDay {
  date: Day;
  position: Position;
  rows: Expense[];
  /** From the summary, never summed from loaded rows (Pass 7). */
  subtotals: { currency: Currency; total: string }[];
}

/** Members by day, oldest first (4A); each day's subtotal per currency from the summary. */
export function groupByDay(rows: Expense[], summary: ExpenseGroupSummary): MemberDay[] {
  const days = new Map<Day, Expense[]>();
  for (const row of [...rows].sort(byDate)) days.set(row.occurredOn, [...(days.get(row.occurredOn) ?? []), row]);
  return [...days.entries()].map(([date, dayRows]) => {
    const buckets = summary.currencies.flatMap((c) => c.byDay.filter((b) => b.date === date && b.count > 0).map((b) => ({ currency: c.currency, total: b.total, position: b.position })));
    return { date, position: buckets[0]?.position ?? 'in', rows: dayRows, subtotals: buckets.map(({ currency, total }) => ({ currency, total })) };
  });
}

/** One save at a time, in order (12A, 13A: no batch API); the failures come back for a Retry of just those. */
export async function runSequential<T>(items: T[], save: (item: T) => Promise<unknown>): Promise<{ done: T[]; failed: T[] }> {
  const done: T[] = [];
  const failed: T[] = [];
  for (const item of items) {
    try {
      await save(item);
      done.push(item);
    } catch {
      failed.push(item);
    }
  }
  return { done, failed };
}
