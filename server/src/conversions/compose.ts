import { assertIsoDate, parseAmount, validationError } from '../agreements/compose.js';
import type { IsoDate } from '../dates.js';
import type { Currency } from '../money.js';
import type { ConversionRecord, UpdateConversionPatch } from '../repositories/ports.js';

/**
 * Conversion rules shared by routes/conversions.ts (MUT-161, MUT-194). Pure, like
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

/** The PATCH body's shape (UpdateConversionRequestSchema), every field optional. */
export interface ConversionPatchBody {
  occurredOn?: string | undefined;
  amount?: string | undefined;
  currency?: Currency | undefined;
  toAmount?: string | undefined;
  toCurrency?: Currency | undefined;
  notes?: string | null | undefined;
}

/**
 * MUT-194 (ADR-075): a PATCH body against the row it edits, as the store's patch.
 * The rules hold on the merged row (the body's value, else the row's):
 *
 *   currency sent ──▶ amount must be sent too ── else 422 AMOUNT_REQUIRED (field amount)
 *   toCurrency sent ─▶ toAmount must be sent too ─ else 422 AMOUNT_REQUIRED (field toAmount)
 *   amount sent ────▶ parsed in the merged currency's digits (a JOD row keeps 3)
 *   merged pair ────▶ currency ≠ toCurrency ───── else 422 SAME_CURRENCY (field toCurrency)
 *
 * A currency never travels alone because a leg's minor units depend on it: switching
 * USD → JOD without re-sending the amount would silently rescale the money. The route
 * checks occurredOn against today only when it is sent (this stays pure).
 */
export function conversionPatch(existing: ConversionRecord, body: ConversionPatchBody): UpdateConversionPatch {
  if (body.currency !== undefined && body.amount === undefined) throw amountRequired('amount', 'currency');
  if (body.toCurrency !== undefined && body.toAmount === undefined) throw amountRequired('toAmount', 'toCurrency');
  const currency = body.currency ?? (existing.currency as Currency);
  const toCurrency = body.toCurrency ?? (existing.toCurrency as Currency);
  const patch: UpdateConversionPatch = {};
  if (body.occurredOn !== undefined) patch.occurredOn = conversionDate(body.occurredOn);
  if (body.amount !== undefined) patch.amountMinor = parseConversionAmount(body.amount, currency, 'amount');
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.toAmount !== undefined) patch.toAmountMinor = parseConversionAmount(body.toAmount, toCurrency, 'toAmount');
  if (body.toCurrency !== undefined) patch.toCurrency = body.toCurrency;
  if (body.notes !== undefined) patch.notes = body.notes;
  assertDifferentCurrencies(currency, toCurrency);
  return patch;
}

function amountRequired(field: 'amount' | 'toAmount', currencyField: 'currency' | 'toCurrency') {
  return validationError('AMOUNT_REQUIRED', `${currencyField} can only change together with ${field}`, { field });
}
