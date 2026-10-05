/**
 * Canonical date logic for date-only values (YYYY-MM-DD).
 *
 * Two rules make this module correct where the code it replaces was not:
 *
 * 1. "Today" is the user's LOCAL calendar date, never the UTC date.
 *    `new Date().toISOString().split('T')[0]` yields the UTC date, which is the
 *    wrong day for part of every day: in Asia/Jerusalem between 00:00 and 03:00
 *    local it returns yesterday, and in America/New_York after ~20:00 local it
 *    returns tomorrow.
 *
 * 2. Day arithmetic goes through `dayIndex`, which is DST-immune.
 *    Subtracting two local `Date` objects is not safe: across a DST boundary a
 *    calendar day is 23 or 25 hours, so dividing milliseconds by 86_400_000
 *    yields 0.958 or 1.042 days and truncates to the wrong integer. Asia/
 *    Jerusalem observes DST, so this is a live concern, not a hypothetical.
 *
 * Every predicate takes `today` as an explicit argument, which keeps it pure and
 * timezone-independent. `todayLocalISO()` is the single place that reads the
 * clock.
 *
 * Overdue semantics are fixed by ADR-010: a receivable is income with
 * status 'unpaid', and it is overdue when its due date is strictly before today.
 * An item due today is NOT overdue.
 *
 * See MUT-17.
 */

import type { Transaction } from '../types';

/** The fields any overdue/due-soon check needs. Keeps these helpers usable with
 *  partial rows and display types, not just full Transaction records. */
export type ReceivableLike = Pick<Transaction, 'kind' | 'status' | 'dueDate'>;

const MS_PER_DAY = 86_400_000;

/**
 * Format a Date as YYYY-MM-DD using its LOCAL calendar fields.
 * Unlike toISOString(), this preserves the date the user actually sees.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The user's current local calendar date as YYYY-MM-DD.
 *
 * This is the only function in the module that reads the clock. Pass `now` to
 * make callers testable without fake timers.
 */
export function todayLocalISO(now: Date = new Date()): string {
  return formatLocalDate(now);
}

/**
 * Whole days since the epoch for a date-only string.
 *
 * Uses Date.UTC so the result is a pure calendar-day ordinal with no timezone
 * or DST component: differences between two dayIndex values are always exact
 * integers. Never use this to display a time.
 */
function dayIndex(dateOnly: string): number {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** True for a well-formed YYYY-MM-DD string with a real calendar date. */
export function isValidDateOnly(value: string | undefined | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  // Reject Feb 30 and friends by round-tripping through a UTC date.
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Whole calendar days from `fromISO` to `toISO`. Positive when `toISO` is later.
 * Exact across DST boundaries.
 */
export function daysBetweenLocal(fromISO: string, toISO: string): number {
  return dayIndex(toISO) - dayIndex(fromISO);
}

/**
 * Days from `today` until `dueDate`.
 * 0 means due today, negative means the due date has passed.
 */
export function daysUntilDue(dueDate: string, today: string): number {
  return daysBetweenLocal(today, dueDate);
}

/** A receivable per ADR-010: unpaid income. */
export function isReceivable(tx: ReceivableLike): boolean {
  return tx.kind === 'income' && tx.status === 'unpaid';
}

/**
 * Overdue per ADR-010: an unpaid income whose due date is strictly before today.
 * Items with no due date are never overdue. Items due today are never overdue.
 */
export function isOverdueReceivable(tx: ReceivableLike, today: string): boolean {
  if (!isReceivable(tx)) return false;
  if (!tx.dueDate) return false;
  return dayIndex(tx.dueDate) < dayIndex(today);
}

/**
 * Whole days a receivable is overdue, or undefined when it is not overdue.
 * Always >= 1 when defined.
 */
export function daysOverdue(tx: ReceivableLike, today: string): number | undefined {
  if (!isOverdueReceivable(tx, today)) return undefined;
  return daysBetweenLocal(tx.dueDate!, today);
}

/**
 * A receivable due within the next `windowDays` days, inclusive of today and of
 * the final day. Already-overdue items are excluded -- they are overdue, not
 * due soon, and the two lists should not double-count.
 */
export function isDueSoon(tx: ReceivableLike, today: string, windowDays = 7): boolean {
  if (!isReceivable(tx)) return false;
  if (!tx.dueDate) return false;
  const days = daysUntilDue(tx.dueDate, today);
  return days >= 0 && days <= windowDays;
}
