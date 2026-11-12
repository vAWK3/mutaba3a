import { getLocale } from '../../../lib/i18n/core';
import type { Language } from '../../../lib/i18n/types';
import type { AccountantClient, AccountantClientWithStats, ActivitySummary, Currency, Entry } from '../../api/client';

/**
 * MUT-562: the Client books desk's rules, pure so each is a unit test. A client book's period is whole months (D5, the
 * same rule as share links and MUT-314's download, so a download can follow it exactly); the search keeps it in the
 * URL; the totals come per currency from the activity summary and are never summed across currencies (ADR-004).
 */

// ---- Months --------------------------------------------------------------------------------------------------------

/** `YYYY-MM`. */
export type Month = string;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** The activity summary reads at most 13 calendar months (ACTIVITY_RANGE_MAX_MONTHS); a desk period is at most a year. */
export const MAX_PERIOD_MONTHS = 12;
const MONTHS_PER_QUARTER = 3;
const MONTHS_PER_YEAR = 12;

export function isMonth(value: unknown): value is Month {
  return typeof value === 'string' && MONTH.test(value);
}

/** A date's digits as numbers. Not an amount: a calendar part, already checked to be digits. */
function digitsOf(text: string): number[] {
  // eslint-disable-next-line no-restricted-syntax
  return text.split('-').map((part) => Number.parseInt(part, 10));
}

function parts(month: Month): [number, number] {
  const [year, m] = digitsOf(month);
  return [year, m];
}

function monthOf(year: number, m: number): Month {
  const index = year * MONTHS_PER_YEAR + (m - 1);
  const y = Math.floor(index / MONTHS_PER_YEAR);
  const mm = (index % MONTHS_PER_YEAR) + 1;
  return `${String(y).padStart(4, '0')}-${String(mm).padStart(2, '0')}`;
}

export function addMonths(month: Month, delta: number): Month {
  const [year, m] = parts(month);
  return monthOf(year, m + delta);
}

/** How many months `from`…`to` spans, both included (0 when `to` is before `from`). */
export function monthsBetween(from: Month, to: Month): number {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  return Math.max(0, (ty - fy) * MONTHS_PER_YEAR + (tm - fm) + 1);
}

/** The month a day is in, on this device's calendar. */
export function monthOfDate(date: Date): Month {
  return monthOf(date.getFullYear(), date.getMonth() + 1);
}

/** `YYYY-MM-DD` of a month's first day. */
export const firstDay = (month: Month) => `${month}-01`;

/** `YYYY-MM-DD` of a month's last day. */
export function lastDay(month: Month): string {
  const [year, m] = parts(month);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

// ---- The search ----------------------------------------------------------------------------------------------------

export type Preset = 'month' | 'quarter' | 'year' | 'custom';
/** Which entries show: both (absent), or one kind only. Income on the desk is received payments. */
export type KindFilter = 'expense' | 'income';

/** `/client-books/$profileId`'s search: the period, the type filter, "only with a receipt" and the open receipt pane. */
export interface ClientBookSearch {
  preset?: Preset;
  from?: Month;
  to?: Month;
  kind?: KindFilter;
  receipts?: 'only';
  entry?: string;
}

const PRESETS: readonly Preset[] = ['month', 'quarter', 'year', 'custom'];
const ENTRY_ID = /^[0-9a-f-]{36}$/i;

/** Only the keys the desk knows, each checked: a stray drawer key (`?newExpense=1`) never reaches the page (AC3). */
export function parseClientBookSearch(raw: Record<string, unknown>): ClientBookSearch {
  const preset = PRESETS.find((p) => p === raw.preset);
  const kind = raw.kind === 'expense' || raw.kind === 'income' ? raw.kind : undefined;
  const entry = typeof raw.entry === 'string' && ENTRY_ID.test(raw.entry) ? raw.entry : undefined;
  return {
    ...(preset ? { preset } : {}),
    ...(isMonth(raw.from) ? { from: raw.from } : {}),
    ...(isMonth(raw.to) ? { to: raw.to } : {}),
    ...(kind ? { kind } : {}),
    ...(raw.receipts === 'only' ? { receipts: 'only' as const } : {}),
    ...(entry ? { entry } : {}),
  };
}

export interface Period {
  preset: Preset;
  from: Month;
  to: Month;
}

/** The months a preset covers, ending this month (never a future one). */
export function presetPeriod(preset: Exclude<Preset, 'custom'>, current: Month): Period {
  const [year, m] = parts(current);
  if (preset === 'month') return { preset, from: current, to: current };
  if (preset === 'quarter') return { preset, from: monthOf(year, m - ((m - 1) % MONTHS_PER_QUARTER)), to: current };
  return { preset, from: monthOf(year, 1), to: current };
}

/**
 * The period a search names, made safe: this month by default; a custom range is ordered, never past this month and
 * at most a year long (the start moves, so the months a person picked last are kept).
 */
export function periodOf(search: ClientBookSearch, current: Month): Period {
  const preset = search.preset ?? (search.from || search.to ? 'custom' : 'month');
  if (preset !== 'custom') return presetPeriod(preset, current);
  let from = search.from ?? search.to ?? current;
  let to = search.to ?? from;
  if (from > to) [from, to] = [to, from];
  if (to > current) to = current;
  if (from > to) from = to;
  if (monthsBetween(from, to) > MAX_PERIOD_MONTHS) from = addMonths(to, 1 - MAX_PERIOD_MONTHS);
  return { preset, from, to };
}

/** The search that names a period: a preset alone, or a custom range with its months. */
export function periodSearch(period: Period): Pick<ClientBookSearch, 'preset' | 'from' | 'to'> {
  return period.preset === 'custom' ? { preset: 'custom', from: period.from, to: period.to } : { preset: period.preset };
}

/** The feed's bounds for a period: from its first day, before the day after its last month. */
export function feedBounds(period: Period): { occurredFrom: string; occurredBefore: string } {
  return { occurredFrom: firstDay(period.from), occurredBefore: firstDay(addMonths(period.to, 1)) };
}

/** The feed's kinds for the type filter: expenses and received payments only (D14). */
export function feedKinds(kind: KindFilter | undefined): ('expense' | 'received')[] {
  if (kind === 'expense') return ['expense'];
  if (kind === 'income') return ['received'];
  return ['expense', 'received'];
}

// ---- Rows ----------------------------------------------------------------------------------------------------------

/** The rows a desk shows: expenses and received payments (the feed may hold others from an owner's own read). */
export type DeskEntry = Extract<Entry, { kind: 'expense' | 'received' }>;

export function isDeskEntry(entry: Entry): entry is DeskEntry {
  return entry.kind === 'expense' || entry.kind === 'received';
}

/** "Only with a receipt": expenses with at least one ready receipt; a received payment has none. */
export function withReceipt(entry: DeskEntry): boolean {
  return entry.kind === 'expense' && entry.expense.receiptCount > 0;
}

export function visibleRows(entries: readonly Entry[], receiptsOnly: boolean): DeskEntry[] {
  return entries.filter(isDeskEntry).filter((entry) => !receiptsOnly || withReceipt(entry));
}

/** A page of 100 (the server's largest); "only with a receipt" keeps paging until this many show, or the feed ends. */
export const DESK_PAGE = 100;

// ---- Totals --------------------------------------------------------------------------------------------------------

export interface CurrencyTotals {
  currency: Currency;
  spent: string;
  received: string;
}

/** One block per currency, as the summary names them (never summed across currencies). */
export function totalsOf(summary: Pick<ActivitySummary, 'currencies'>): CurrencyTotals[] {
  return summary.currencies.map(({ currency, spent, received }) => ({ currency, spent, received }));
}

// ---- The list ------------------------------------------------------------------------------------------------------

/** The desk's search box: any part of the owner's or the profile's name, ignoring case. */
export function matchesClient(client: Pick<AccountantClient, 'name' | 'ownerName'>, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [client.name, client.ownerName ?? ''].some((text) => text.toLocaleLowerCase().includes(q));
}

/** AW4: an ended client stays, faded, until removed. */
export const isEnded = (client: Pick<AccountantClientWithStats, 'status'>) => client.status === 'ended';

/** The corner link (13246, Basel 13247 Q1): shown while any client is listed, active or ended and not yet removed. */
export function showsClientBooks(clients: readonly unknown[] | undefined): boolean {
  return (clients?.length ?? 0) > 0;
}

// ---- Words ---------------------------------------------------------------------------------------------------------

/** "Oct 2026", or "Aug – Oct 2026" for a range (month names in the language, Western digits). */
export function periodLabel(from: Month, to: Month, language: Language): string {
  const format = (month: Month, withYear: boolean) => {
    const [year, m] = parts(month);
    return new Intl.DateTimeFormat(getLocale(language), { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, 1)));
  };
  if (from === to) return format(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${format(from, !sameYear)} – ${format(to, true)}`;
}

/** "12 Oct 2026": an instant's day, for "since …". */
export function dayLabel(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(getLocale(language), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** A money date (`YYYY-MM-DD`) as "30 Oct". */
export function moneyDay(isoDate: string, language: Language): string {
  const [year, m, d] = digitsOf(isoDate);
  return new Intl.DateTimeFormat(getLocale(language), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m - 1, d)));
}
