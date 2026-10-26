import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import { currencyExponent } from '../../lib/utils';
import type { Currency } from '../api/client';
import type { Period, Range } from '../data/reports';
import { minorToDecimal } from './currencies';
import { formatDecimal } from './DecimalAmount';

/**
 * Reports' display formats (MUT-175). Calendar dates are shown as that same
 * day in UTC, like `formatDay`, so no zone can move them. The hero shows whole
 * units (DR4); exact amounts live in the ≈ breakdown.
 */

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const formatters = new Map<string, Intl.DateTimeFormat>();

function dates(language: Language, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${language}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(getLocale(language), { ...options, timeZone: 'UTC' });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** "September" in this year, "September 2025" otherwise. */
export function formatMonth(month: string, language: Language, today: string): string {
  const sameYear = month.slice(0, 4) === today.slice(0, 4);
  return dates(language, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }).format(at(`${month}-01`));
}

/** "October 2026", "2026", or "19 Oct – 25 Oct": the hero's caption for a period. */
export function formatPeriod(period: Period, range: Range, language: Language): string {
  if (period === 'year') return range.from.slice(0, 4);
  if (period === 'month') return dates(language, { month: 'long', year: 'numeric' }).format(at(range.from));
  const short = dates(language, { day: 'numeric', month: 'short' });
  return `${short.format(at(range.from))} – ${short.format(at(range.to))}`;
}

/** A bar's date: "Thu 22 Oct" for a day, "October 2026" for a month. */
export function formatBucket(start: string, bucket: 'day' | 'month', language: Language): string {
  return bucket === 'day' ? dates(language, { weekday: 'short', day: 'numeric', month: 'short' }).format(at(start)) : dates(language, { month: 'long', year: 'numeric' }).format(at(start));
}

/** The micro axis label under a bar. */
export function formatAxis(start: string, period: Period, language: Language): string {
  if (period === 'week') return dates(language, { weekday: 'narrow' }).format(at(start));
  if (period === 'year') return dates(language, { month: 'narrow' }).format(at(start));
  return dates(language, { day: 'numeric' }).format(at(start));
}

/** Minor units as an exact currency amount ("₪1,234.50"). */
export function formatMinor(minor: number, currency: Currency, language: Language): string {
  return formatDecimal(minorToDecimal(minor, currency), currency, language);
}

const wholeFormatters = new Map<string, Intl.NumberFormat>();

/** Minor units rounded to whole units ("₪1,235"): the hero (DR4). */
export function formatWhole(minor: number, currency: Currency, language: Language): string {
  const key = `${language}|${currency}`;
  let formatter = wholeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getLocale(language), { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    wholeFormatters.set(key, formatter);
  }
  return formatter.format(wholeUnits(minor, currency));
}

/**
 * MUT-448: a business line's net with its sign, "+₪9,040" or "−₪3,100" (U+2212, not a hyphen); zero carries none.
 * The sign is part of the same Intl string, so Arabic places it as the locale does inside the amount's <bdi>.
 */
export function formatSigned(minor: number, currency: Currency, language: Language): string {
  const key = `${language}|${currency}|signed`;
  let formatter = wholeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getLocale(language), { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0, signDisplay: 'exceptZero' });
    wholeFormatters.set(key, formatter);
  }
  return formatter.format(wholeUnits(minor, currency)).replace('-', '\u2212');
}

/** Whole units, halves away from zero, and never −0 (review: a 0.40 loss read "-₪0"). */
export function wholeUnits(minor: number, currency: Currency): number {
  const units = minor / 10 ** currencyExponent(currency);
  const rounded = Math.sign(units) * Math.round(Math.abs(units));
  return rounded === 0 ? 0 : rounded;
}
