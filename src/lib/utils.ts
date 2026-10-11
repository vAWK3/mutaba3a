import type { Currency } from '../types';
import type { Language } from './i18n';
import { formatLocalDate, todayLocalISO, daysUntilDue } from './dates';

/**
 * Get the locale string for Intl APIs based on language
 */
export function getLocaleFromLanguage(language: Language): string {
  return language === 'ar' ? 'ar' : 'en-US';
}

// Intl.NumberFormat is costly to build and formatAmount runs once per amount
// cell, so one formatter per locale + currency is kept and reused.
const amountFormatters = new Map<string, Intl.NumberFormat>();

export function formatAmount(amountMinor: number, currency: Currency, locale: string = 'en-US'): string {
  const key = `${locale}|${currency}`;
  let formatter = amountFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    amountFormatters.set(key, formatter);
  }
  return formatter.format(amountMinor / 100);
}

export function formatAmountShort(amountMinor: number, currency: Currency): string {
  const amount = amountMinor / 100;
  const symbol = currency === 'USD' ? '$' : '₪';

  // For short format, use Western numerals and abbreviations for clarity
  // K and M are internationally recognized even in Arabic financial contexts
  const shortFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  if (amount >= 1000000) {
    const formatted = shortFormatter.format(amount / 1000000);
    return `${symbol}${formatted}M`;
  }
  if (amount >= 1000) {
    const formatted = shortFormatter.format(amount / 1000);
    return `${symbol}${formatted}K`;
  }
  return `${symbol}${amount.toFixed(0)}`;
}

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
const EXTENDED_ARABIC_INDIC_DIGITS = /[\u06F0-\u06F9]/g;
const ARABIC_DECIMAL_SEPARATOR = /\u066B/g;
const ARABIC_THOUSANDS_SEPARATORS = /[\u066C\u060C]/g;
// Bidi marks an RTL keyboard or a paste can carry: LRM, RLM, ALM
const BIDI_MARKS = /[\u200E\u200F\u061C]/g;
// Spaces that may group thousands: space, NBSP, thin space, narrow NBSP
const GROUP_SPACES = /[ \u00A0\u2009\u202F]+/g;
// The only words an amount may carry: a currency symbol or code, before or after it
const CURRENCY_PREFIX = /^(?:US\$|USD|ILS|NIS|EUR|[$\u20AA\u20AC\u00A3])\s*/i;
const CURRENCY_SUFFIX = /\s*(?:US\$|USD|ILS|NIS|EUR|[$\u20AA\u20AC\u00A3])$/i;
// Whole digits, or digits grouped by commas in threes (no leading 0 group), then decimals.
// Anything else ("12,5", "1.200,50", "0,500", "2k") is ambiguous and is rejected, never guessed at.
const AMOUNT_PATTERN = /^(-?)(\d+|[1-9]\d{0,2}(?:,\d{3})+)?(?:\.(\d*))?$/;
const MINOR_DIGITS = 2;

/**
 * Convert Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9)
 * digits to ASCII, and the Arabic decimal / thousands separators to "." / ",".
 */
export function normalizeNumerals(value: string): string {
  return value
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(EXTENDED_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .replace(ARABIC_DECIMAL_SEPARATOR, '.')
    .replace(ARABIC_THOUSANDS_SEPARATORS, ',');
}

export interface ParseAmountOptions {
  /**
   * Most decimals accepted (default 2). Pass Infinity to round extra decimals
   * half-up instead of rejecting them (the lenient wrappers below).
   */
  maxDecimals?: number;
}

/**
 * Parse a typed amount to minor units, or null when it is not a number we can
 * read without guessing. Accepts Arabic-Indic digits, comma- or space-grouped
 * thousands and one currency symbol or code before or after the number. The
 * conversion runs on the digits, so no float rounding creeps in.
 */
export function parseAmountInput(value: string, options: ParseAmountOptions = {}): number | null {
  const { maxDecimals = MINOR_DIGITS } = options;
  const bare = normalizeNumerals(value)
    .replace(BIDI_MARKS, '')
    .trim()
    .replace(CURRENCY_PREFIX, '')
    .replace(CURRENCY_SUFFIX, '')
    .replace(GROUP_SPACES, ',');

  const match = AMOUNT_PATTERN.exec(bare);
  if (!match) return null;
  const [, sign, wholePart = '', fraction = ''] = match;
  if (!wholePart && !fraction) return null;
  if (fraction.length > maxDecimals) return null;

  const whole = Number(wholePart.replace(/,/g, '') || '0');
  const cents = Number(fraction.slice(0, MINOR_DIGITS).padEnd(MINOR_DIGITS, '0'));
  const roundUp = fraction.length > MINOR_DIGITS && Number(fraction[MINOR_DIGITS]) >= 5 ? 1 : 0;
  const minor = whole * 100 + cents + roundUp;
  if (!Number.isSafeInteger(minor)) return null;
  return sign ? -minor : minor;
}

export function parseAmountToMinor(value: string): number {
  return parseAmountInput(value, { maxDecimals: Infinity }) ?? 0;
}

/**
 * Parse a currency input string to minor units (cents).
 * Handles various formats like "100", "100.50", "$100", etc.; 0 when unreadable.
 */
export function parseCurrencyInput(value: string): number {
  return parseAmountInput(value, { maxDecimals: Infinity }) ?? 0;
}

/**
 * Format a currency input string to a clean decimal format.
 * Used for input fields to maintain consistent format while typing.
 */
export function formatCurrencyInput(value: string): string {
  // Remove non-numeric characters except . and -
  const cleaned = normalizeNumerals(value).replace(/[^0-9.-]/g, '');

  // Handle empty or invalid input
  if (!cleaned || cleaned === '-' || cleaned === '.') return cleaned;

  // Parse and validate
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    // Too many decimal points, keep only first two parts
    return parts[0] + '.' + parts[1];
  }

  // Limit decimal places to 2
  if (parts.length === 2 && parts[1].length > 2) {
    return parts[0] + '.' + parts[1].slice(0, 2);
  }

  return cleaned;
}

export function formatDate(isoString: string, locale: string = 'en-US'): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateShort(isoString: string, locale: string = 'en-US'): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateCompact(isoString: string): string {
  const date = new Date(isoString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Type for translation function used in formatRelativeDate
 */
type TranslationFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Format a relative date using translation function for labels
 * @param isoString - ISO date string
 * @param t - Translation function from useT() hook
 */
export function formatRelativeDate(isoString: string, t?: TranslationFn): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Default English fallback if no translation function provided
  if (!t) {
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  }

  // Use translation function for localized labels
  if (diffDays === 0) return t('time.today');
  if (diffDays === 1) return t('time.yesterday');
  if (diffDays < 7) return t('time.daysAgo', { days: diffDays });
  if (diffDays < 30) return t('time.weeksAgo', { weeks: Math.floor(diffDays / 7) });
  if (diffDays < 365) return t('time.monthsAgo', { months: Math.floor(diffDays / 30) });
  return t('time.yearsAgo', { years: Math.floor(diffDays / 365) });
}

/**
 * Days from today until `dateString` (date-only). 0 = today, negative = past.
 *
 * Delegates to the canonical local-date logic in ./dates. The previous
 * implementation parsed the date as UTC midnight and then compared against
 * local midnight, which was off by one day for every timezone west of UTC.
 */
export function getDaysUntil(dateString: string): number {
  return daysUntilDue(dateString, todayLocalISO());
}

export function getDateRangePreset(preset: 'this-month' | 'last-month' | 'this-year' | 'all'): { dateFrom: string; dateTo: string } {
  const now = new Date();

  switch (preset) {
    case 'this-month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        dateFrom: formatLocalDate(firstDay),
        dateTo: formatLocalDate(lastDay),
      };
    }
    case 'last-month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        dateFrom: formatLocalDate(firstDay),
        dateTo: formatLocalDate(lastDay),
      };
    }
    case 'this-year': {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      return {
        dateFrom: formatLocalDate(firstDay),
        dateTo: formatLocalDate(lastDay),
      };
    }
    case 'all':
    default:
      return {
        dateFrom: '2000-01-01',
        dateTo: '2100-12-31',
      };
  }
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Today's date as YYYY-MM-DD in the user's LOCAL timezone.
 *
 * Used both for overdue comparisons and as the default date on new records.
 * Previously derived from toISOString(), i.e. the UTC date, so a user in
 * Asia/Jerusalem adding income at 01:00 got it dated yesterday.
 */
export function todayISO(): string {
  return todayLocalISO();
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Copy text to clipboard
 * Returns true on success, false on failure
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
