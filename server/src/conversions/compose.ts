import { assertIsoDate, parseAmount, validationError } from '../agreements/compose.js';
import type { IsoDate } from '../dates.js';
import type { Currency } from '../money.js';

/**
 * Conversion rules shared by routes/conversions.ts (MUT-161). Pure, like
 * expenses/compose.ts and income/compose.ts's own small helpers — no store
 * lookups, since a conversion links to no client or project.
 */

export function conversionDate(value: string): IsoDate {
  return assertIsoDate(value, 'occurredOn');
}

/**
 * A conversion leg's amount: canonical, in the currency's digits, greater
 * than zero. `field` is 'amount' or 'toAmount' so a bad leg reports itself,
 * not always 'amount' — the two legs can have different currencies and so
 * different fractional-digit rules (ADR-065: no currency default).
 */
export function parseConversionAmount(text: string, currency: Currency, field: 'amount' | 'toAmount'): bigint {
  const minor = parseAmount(text, currency, field);
  if (minor <= 0n) throw validationError('AMOUNT_INVALID', `${field} must be greater than zero`, { field });
  return minor;
}

/**
 * Ports the local app's rule (src/components/drawers/conversionFormSchema.ts:39-45):
 * a conversion's two legs must be different currencies. Missing from the
 * ticket's own description — without it, the hosted route would be laxer
 * than the local drawer it's meant to match.
 */
export function assertDifferentCurrencies(currency: Currency, toCurrency: Currency): void {
  if (currency === toCurrency) throw validationError('SAME_CURRENCY', 'toCurrency must differ from currency', { field: 'toCurrency' });
}
