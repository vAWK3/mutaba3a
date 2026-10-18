import type { Currency } from '../../types';

/**
 * The name of every currency the app supports, for the landing page's
 * currency answer. A `Record<Currency, …>` so adding a currency to the type
 * without naming it here fails to compile — the page can't under-claim or
 * over-claim what the app supports.
 */
export const CURRENCY_NAME_KEYS: Record<Currency, string> = {
  USD: 'landing.currency.USD',
  ILS: 'landing.currency.ILS',
  EUR: 'landing.currency.EUR',
  JOD: 'landing.currency.JOD',
  AED: 'landing.currency.AED',
  SAR: 'landing.currency.SAR',
  QAR: 'landing.currency.QAR',
  BHD: 'landing.currency.BHD',
  OMR: 'landing.currency.OMR',
};

/** Number of FAQ entries; keys are `landing.faq.q1..qN` / `a1..aN`. */
export const FAQ_COUNT = 6;

/** The FAQ entry whose answer lists the supported currencies. */
export const FAQ_CURRENCY_INDEX = 5;

/** Joins the localized currency names as a natural-language list. */
export function formatCurrencyList(names: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
}
