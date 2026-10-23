import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';

/**
 * Two kinds of time on the wire (M6): calendar dates (`YYYY-MM-DD`, already in
 * the organization's calendar) and instants (ISO date-times). A calendar date is
 * formatted as that same day in UTC, so no zone can move it to the day before;
 * an instant is shown in the organization's own zone.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING = '—';

/**
 * The browser's local calendar date, `YYYY-MM-DD` — used only as the expense
 * drawer's default `occurredOn` (MUT-44). Deliberately not `toISOString()`,
 * which reads the UTC date: a user in Asia/Jerusalem recording an expense at
 * 01:00 local time would otherwise get it dated yesterday — the exact bug
 * `src/lib/dates.ts`'s `todayLocalISO()` was written to fix on the local app.
 */
export function todayLocalISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDay(value: string | null | undefined, language: Language): string {
  if (!value || !CALENDAR_DATE.test(value)) return MISSING;
  return new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function formatInstant(value: string | null | undefined, language: Language, timeZone: string): string {
  if (!value) return MISSING;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return MISSING;
  return new Intl.DateTimeFormat(getLocale(language), { dateStyle: 'medium', timeZone }).format(date);
}

const KIB = 1024;
const MIB = KIB * KIB;

/** A file size for people: KB below a megabyte, MB with one decimal above. */
export function formatSize(bytes: number, language: Language): string {
  const locale = getLocale(language);
  if (bytes < MIB) {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / KIB)));
  }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / MIB);
}

/**
 * Today's calendar date in an IANA zone, `YYYY-MM-DD` (MUT-133, R3). The server
 * refuses a future `occurredOn`/`paidAt` against the profile's zone
 * (`todayIn(organization.timezone)`), so a date default or `max` that predicts
 * that check must use the same zone, not the browser's. An unknown zone falls
 * back to the browser calendar rather than throwing inside a form.
 */
/** MUT-227: the server refuses a money date more than this many days before the profile's today (ADR-086). */
export const MONEY_DATE_FLOOR_DAYS = 3660;

/** The earliest money date the server accepts, given the profile's today (YYYY-MM-DD). */
export function moneyDateFloor(today: string): string {
  return shiftDays(today, -MONEY_DATE_FLOOR_DAYS);
}

/** MUT-392: the server refuses an Owed or expense date more than this many days after the profile's today (ADR-169). */
export const MONEY_DATE_CEILING_DAYS = 3660;

/** The latest date the server accepts for an Owed or an expense, given the profile's today (YYYY-MM-DD). */
export function moneyDateCeiling(today: string): string {
  return shiftDays(today, MONEY_DATE_CEILING_DAYS);
}

/** MUT-392 (D3): the server's default Owed due date, EOM_15 — the 15th of the month after `occurredOn`. */
export function owedDefaultDueDate(occurredOn: string): string {
  const [y, m] = occurredOn.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 15)).toISOString().slice(0, 10);
}

function shiftDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function todayInZone(timeZone: string, now: Date = new Date()): string {
  try {
    // en-CA formats a calendar date as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return todayLocalISO(now);
  }
}
