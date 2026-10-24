import type { Currency } from '../api/client';
import { currencyExponent } from '../../lib/utils';

/**
 * The currencies the hosted API accepts, in the order every portal picker
 * shows them (MUT-183 R4, TD-125). The type check below fails `typecheck` the
 * day the API's `Currency` grows, so no picker can silently miss a currency
 * (JOD nearly did, MUT-140).
 */
export const HOSTED_CURRENCIES = ['USD', 'ILS', 'EUR', 'JOD'] as const satisfies readonly Currency[];

export type HostedCurrency = (typeof HOSTED_CURRENCIES)[number];

/** A new profile's currency until the person picks another (New profile; the signup setup page, MUT-368 D9). */
export const DEFAULT_HOSTED_CURRENCY: HostedCurrency = 'ILS';

type MissingFromList = Exclude<Currency, HostedCurrency>;
// Compile-time only: `true` unless the API has a currency this list lacks.
const coversEveryCurrency: [MissingFromList] extends [never] ? true : MissingFromList = true;
void coversEveryCurrency;

/** Minor units as a canonical decimal string with exactly the currency's digits; string arithmetic only. */
export function minorToDecimal(minor: number, currency: Currency): string {
  const exponent = currencyExponent(currency);
  const digits = String(Math.abs(minor)).padStart(exponent + 1, '0');
  const sign = minor < 0 ? '-' : '';
  return exponent === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
