/* eslint-disable react-refresh/only-export-components */
import { getLocale, useLanguage } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import type { Currency } from '../api/client';

/**
 * Money on the wire is a canonical decimal string with its currency
 * (hosted-portal.md §7.3). `Intl.NumberFormat` v3 formats such a string exactly,
 * so the value never becomes a float: no `Number()`, no `parseFloat`, no
 * rounding, however many digits. The app's `CellAmount`/`formatAmount` take
 * minor-unit numbers and are deliberately not reused.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;
const MISSING = '—';

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(language: Language, currency: Currency): Intl.NumberFormat {
  const key = `${language}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getLocale(language), { style: 'currency', currency });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * The lib typings (ES2022) still declare `format(number | bigint)`; the runtime
 * accepts a decimal string and formats it without converting it to a number.
 */
type IntlDecimal = number;

export function formatDecimal(value: string, currency: Currency, language: Language): string {
  if (!DECIMAL.test(value)) return MISSING;
  return formatterFor(language, currency).format(value as unknown as IntlDecimal);
}

/** True when the decimal string is exactly zero, in any spelling ("0", "0.00", "-0.00"). */
export function isZeroDecimal(value: string): boolean {
  return /^-?0+(\.0+)?$/.test(value);
}

export function DecimalAmount({ value, currency, className = '' }: { value: string; currency: Currency; className?: string }) {
  const { language } = useLanguage();
  const negative = value.startsWith('-') && !isZeroDecimal(value);
  return (
    <bdi className={`hp-amount ${negative ? 'hp-amount-negative' : ''} ${className}`}>
      {formatDecimal(value, currency, language)}
    </bdi>
  );
}
