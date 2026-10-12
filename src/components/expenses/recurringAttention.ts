/**
 * Expenses › Needs attention, one row per recurring rule (MUT-87, ADR-052).
 *
 * Pure shaping for the rows and the mark-paid drawer: the missed payments of
 * each rule grouped together, oldest first; per-currency totals that are never
 * combined; month and date labels read as local calendar dates, so a payment
 * due on the 1st never shows as the previous month west of UTC (TD-014).
 */

import { formatLocalDate } from '../../lib/dates';
import { orderCurrencyAmounts, type CurrencyAmount } from '../../lib/currencyAmounts';
import { parseAmountInput, amountInputCurrency } from '../../lib/utils';
import type { Currency, ExpenseFrequency, VirtualOccurrenceDisplay } from '../../types';

export interface RecurringAttentionGroup {
  ruleId: string;
  profileId: string;
  title: string;
  frequency: ExpenseFrequency;
  currency: Currency;
  /** What one payment costs ("$80 monthly"): the newest payment's amount */
  periodAmountMinor: number;
  /** Sum of the missed payments, in the rule's one currency */
  totalMinor: number;
  /** The missed payments, oldest first */
  occurrences: VirtualOccurrenceDisplay[];
}

const byExpectedDate = (a: VirtualOccurrenceDisplay, b: VirtualOccurrenceDisplay) =>
  a.expectedDate.localeCompare(b.expectedDate);

function toGroup(occurrences: VirtualOccurrenceDisplay[]): RecurringAttentionGroup {
  const sorted = [...occurrences].sort(byExpectedDate);
  const newest = sorted[sorted.length - 1];
  return {
    ruleId: newest.ruleId,
    profileId: newest.profileId,
    title: newest.ruleTitle,
    frequency: newest.frequency,
    currency: newest.effectiveCurrency,
    periodAmountMinor: newest.effectiveAmount,
    totalMinor: sorted.reduce((sum, occurrence) => sum + occurrence.effectiveAmount, 0),
    occurrences: sorted,
  };
}

/**
 * One group per rule, its payments oldest first. Rules are ordered by their
 * oldest payment, then title, then id, so equal rows never reshuffle.
 */
export function groupOccurrencesByRule(
  occurrences: readonly VirtualOccurrenceDisplay[]
): RecurringAttentionGroup[] {
  const byRule = new Map<string, VirtualOccurrenceDisplay[]>();
  for (const occurrence of occurrences) {
    const list = byRule.get(occurrence.ruleId);
    if (list) list.push(occurrence);
    else byRule.set(occurrence.ruleId, [occurrence]);
  }

  return Array.from(byRule.values(), toGroup).sort(
    (a, b) =>
      a.occurrences[0].expectedDate.localeCompare(b.occurrences[0].expectedDate) ||
      a.title.localeCompare(b.title) ||
      a.ruleId.localeCompare(b.ruleId)
  );
}

/** The section total: each non-zero currency once, USD → ILS → EUR, never combined. */
export function currencyTotals(groups: readonly RecurringAttentionGroup[]): CurrencyAmount[] {
  const totals: Partial<Record<Currency, number>> = {};
  for (const group of groups) {
    totals[group.currency] = (totals[group.currency] ?? 0) + group.totalMinor;
  }
  return orderCurrencyAmounts(totals);
}

/** A YYYY-MM-DD value as a local Date at midnight (never `new Date(iso)`, which is UTC). */
function localDate(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const yearOf = (dateOnly: string) => dateOnly.slice(0, 4);

/** "Aug, Sep, Oct"; "Dec 2025, Jan 2026" when the payments span two years. */
export function formatMonthList(expectedDates: readonly string[], locale: string): string {
  const spansYears = new Set(expectedDates.map(yearOf)).size > 1;
  const month = new Intl.DateTimeFormat(locale, spansYears ? { month: 'short', year: 'numeric' } : { month: 'short' });
  const list = new Intl.ListFormat(locale, { style: 'short', type: 'unit' });
  return list.format(expectedDates.map((date) => month.format(localDate(date))));
}

/** "August 2026": the drawer's name for one payment. */
export function formatMonthYear(expectedDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(localDate(expectedDate));
}

/** "Aug 5, 2026": the payment's expected date. */
export function formatDateOnly(expectedDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
    localDate(expectedDate)
  );
}

/** `today` plus `days` calendar days, as YYYY-MM-DD. */
export function snoozeDateAfter(today: string, days: number): string {
  const date = localDate(today);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

/** What the drawer's amount field holds before anyone edits it: "80", "95.5". */
export function amountInputValue(amountMinor: number): string {
  return (amountMinor / 100).toString();
}

/** A typed payment amount, or the translation key that says why it can't be read. */
export type PaymentAmountReading =
  | { amountMinor: number; error?: undefined }
  | { amountMinor?: undefined; error: { key: string; vars?: Record<string, string> } };

/**
 * Read a payment amount typed in the drawer with the app's one parser
 * (Arabic digits, grouping, a currency symbol). A symbol naming another
 * currency is refused rather than dropped (PATTERNS: a typed currency must
 * match the entry's currency).
 */
export function readPaymentAmount(value: string, currency: Currency): PaymentAmountReading {
  const amountMinor = parseAmountInput(value);
  if (amountMinor === null) return { error: { key: 'validation.amountInvalid' } };
  const typed = amountInputCurrency(value);
  if (typed && typed !== currency) {
    return { error: { key: 'validation.amountCurrencyMismatch', vars: { typed, currency } } };
  }
  if (amountMinor <= 0) return { error: { key: 'validation.amountPositive' } };
  return { amountMinor };
}
