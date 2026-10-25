import { currencyExponent } from '../../lib/utils';
import type { components } from '../api/schema';
import type { HostedExpenseFormValues } from '../components/expenseForm/useHostedExpenseForm';

/**
 * A receipt's suggestion as expense form values (MUT-260 D7, A13). Pure. The input is the server's
 * `ReceiptSuggestion`, whoever read it (the phone today; MUT-301/304's portal readers later), so every reader feeds
 * the same function. Every source counts: confidence never gates a field, it only colours the hint. VAT,
 * registration number, phone and email are not form fields (no VAT UI, the epic's decision) and are ignored.
 *
 * Amounts stay strings: minor-unit digits are split at the currency's exponent, never parsed as a number (the
 * portal's lint bans Number()/parseFloat for money).
 */
export type ReceiptSuggestion = components['schemas']['ReceiptSuggestion'];

/** The form fields a suggestion can fill, as the review page hints them. */
export type SuggestedField = 'date' | 'amount' | 'currency' | 'vendor';

/** Below this, the hint says the reader was unsure (display only). */
export const LOW_CONFIDENCE = 0.5;

export interface SuggestionPrefill {
  values: Partial<HostedExpenseFormValues>;
  /** The fields filled, with the reader's confidence in each. */
  prefilled: Partial<Record<SuggestedField, number>>;
  /** A total in a currency the portal doesn't offer (A14): shown as a hint beside the empty amount. */
  unsupported: { currency: string; amount: string | null } | null;
}

/** Minor-unit digits ("8420") as a decimal string in `exponent` digits ("84.20"); string work only. */
export function minorDigitsToDecimal(minor: string, exponent: number): string {
  if (exponent === 0) return minor;
  const digits = minor.padStart(exponent + 1, '0');
  return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** An ISO 4217 code's minor-unit digits from the platform's own table (2 for a well-formed code it doesn't list), or null for a malformed one. */
export function isoExponent(currency: string): number | null {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

const ZERO = /^0+$/;

export function suggestionToFormValues(
  suggested: ReceiptSuggestion | null | undefined,
  options: { currencies: readonly HostedExpenseFormValues['currency'][] },
): SuggestionPrefill {
  const values: Partial<HostedExpenseFormValues> = {};
  const prefilled: Partial<Record<SuggestedField, number>> = {};
  let unsupported: SuggestionPrefill['unsupported'] = null;
  if (!suggested) return { values, prefilled, unsupported };

  if (suggested.date) {
    values.occurredAt = suggested.date.value;
    prefilled.date = suggested.date.confidence;
  }
  if (suggested.vendorName) {
    values.vendor = suggested.vendorName.value;
    prefilled.vendor = suggested.vendorName.confidence;
  }

  const code = suggested.currency?.value;
  const total = suggested.totalMinor && !ZERO.test(suggested.totalMinor.value) ? suggested.totalMinor : undefined;
  const offered = code ? options.currencies.find((c) => c === code) : undefined;
  if (offered && suggested.currency) {
    values.currency = offered;
    prefilled.currency = suggested.currency.confidence;
    if (total) {
      // The form's own exponent (JOD 3, the rest 2), the one its amount check uses.
      values.amount = minorDigitsToDecimal(total.value, currencyExponent(offered));
      prefilled.amount = total.confidence;
    }
  } else if (code) {
    // A13/A14: the form keeps its default currency and an empty amount; the hint says what the receipt read.
    const exponent = isoExponent(code);
    unsupported = { currency: code, amount: total && exponent !== null ? minorDigitsToDecimal(total.value, exponent) : null };
  }

  return { values, prefilled, unsupported };
}
