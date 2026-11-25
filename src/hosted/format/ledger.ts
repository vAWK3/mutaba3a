import { getLocale } from '../../lib/i18n/core';
import type { Language } from '../../lib/i18n/types';
import type { Currency } from '../api/client';
import { formatDecimal, isZeroDecimal } from './DecimalAmount';

/** MUT-664: the ledger card's money and months, shared with MUT-665's statement. */

/** D15: a balance is what the client owes; below zero the client is in credit, shown without a minus sign. */
export function formatBalance(value: string, currency: Currency, language: Language): { inCredit: boolean; text: string } {
  const inCredit = value.startsWith('-') && !isZeroDecimal(value);
  return { inCredit, text: formatDecimal(inCredit ? value.slice(1) : value, currency, language) };
}

/** "تشرين الثاني 2026": Levantine month names come from the ar-PS locale (never يناير/أكتوبر). */
export function formatMonth(date: string, language: Language): string {
  return new Intl.DateTimeFormat(getLocale(language), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 7)}-01T00:00:00Z`));
}
