import type { Currency } from '../types';
import type { Language } from './i18n';

/**
 * Get the locale string for Intl APIs based on language
 */
export function getLocaleFromLanguage(language: Language): string {
  return language === 'ar' ? 'ar' : 'en-US';
}

export function formatAmount(amountMinor: number, currency: Currency, locale: string = 'en-US'): string {
  const amount = amountMinor / 100;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return formatter.format(amount);
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

export function parseAmountToMinor(value: string): number {
  const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
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

export function getDaysUntil(dateString: string): number {
  const target = new Date(dateString);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getDateRangePreset(preset: 'this-month' | 'last-month' | 'this-year' | 'all'): { dateFrom: string; dateTo: string } {
  const now = new Date();

  switch (preset) {
    case 'this-month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        dateFrom: firstDay.toISOString().split('T')[0],
        dateTo: lastDay.toISOString().split('T')[0],
      };
    }
    case 'last-month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        dateFrom: firstDay.toISOString().split('T')[0],
        dateTo: lastDay.toISOString().split('T')[0],
      };
    }
    case 'this-year': {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      const lastDay = new Date(now.getFullYear(), 11, 31);
      return {
        dateFrom: firstDay.toISOString().split('T')[0],
        dateTo: lastDay.toISOString().split('T')[0],
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

export function todayISO(): string {
  return new Date().toISOString().split('T')[0];
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
