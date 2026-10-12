import type { Currency } from '../types';
import { amountInputCurrency, parseAmountInput } from './utils';

/**
 * What a typed payment amount means against the most that may still be paid
 * (MUT-86). The Record payment drawer's live line ("Paid in full", "₪1,775
 * still owed") and its field errors both read this one classification, so the
 * line can never promise what the button then refuses.
 *
 * Parsing is MUT-5's strict grammar (`parseAmountInput`): Arabic-Indic digits,
 * grouped thousands and one currency symbol or code are read; anything
 * ambiguous is `invalid`, never guessed at.
 */
export type PaymentAmountState =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'notPositive' }
  | { kind: 'currencyMismatch'; typed: Currency }
  /** More than may be paid: overpayment is refused (ADR-030) */
  | { kind: 'over'; allowedMinor: number }
  | { kind: 'paidInFull'; amountMinor: number }
  | { kind: 'stillOwed'; amountMinor: number; leftMinor: number };

/**
 * @param raw the amount as typed
 * @param currency the entry's currency; a payment is always in it
 * @param allowedMinor what may still be paid: the remaining balance, plus the
 *   record's own amount when an existing payment is being edited
 */
export function describePaymentAmount(raw: string, currency: Currency, allowedMinor: number): PaymentAmountState {
  if (!raw.trim()) return { kind: 'empty' };
  const amountMinor = parseAmountInput(raw);
  if (amountMinor === null) return { kind: 'invalid' };
  const typed = amountInputCurrency(raw);
  if (typed && typed !== currency) return { kind: 'currencyMismatch', typed };
  if (amountMinor <= 0) return { kind: 'notPositive' };
  if (amountMinor > allowedMinor) return { kind: 'over', allowedMinor };
  if (amountMinor === allowedMinor) return { kind: 'paidInFull', amountMinor };
  return { kind: 'stillOwed', amountMinor, leftMinor: allowedMinor - amountMinor };
}

const MINOR_PER_MAJOR = 100;
const MINOR_DIGITS = 2;

/**
 * Minor units as the text an amount field is prefilled with: "3550" or
 * "887.50". Never grouped, so deleting a digit can't leave an unreadable
 * "3,55"; cents always as two digits. Integer arithmetic, so no float noise.
 */
export function minorToAmountInput(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / MINOR_PER_MAJOR);
  const cents = amountMinor % MINOR_PER_MAJOR;
  if (cents === 0) return String(whole);
  return `${whole}.${String(cents).padStart(MINOR_DIGITS, '0')}`;
}
