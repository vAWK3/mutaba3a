import { daysInMonth as daysIn, monthOf, type IsoDate, type IsoMonth } from '../dates.js';
import type { ReceivableRecord, RetainerChargeRecord } from '../repositories/ports.js';
import { computeVat, type PricingBasis, type VatTreatment } from '../vat.js';
import { splitCredit } from '../payments/credit.js';

/**
 * Calendar-day proration of a retainer's final month and the outcome of a
 * cancellation (M5 brief §4, decisions 4–5). Pure BigInt arithmetic, half-up
 * on minor units; no floats.
 */
export type FinalMonthOption = 'FULL' | 'PRORATE' | 'WAIVE';

export interface Proration {
  days: number;
  daysInMonth: number;
  amountMinor: bigint;
}

/** `amount × days ÷ daysInMonth`, days = the cancellation day of month (inclusive), half-up. */
export function prorate(input: { amountMinor: bigint; effectiveDate: IsoDate }): Proration {
  const year = Number(input.effectiveDate.slice(0, 4));
  const month = Number(input.effectiveDate.slice(5, 7));
  const days = Number(input.effectiveDate.slice(8, 10));
  const total = daysIn(year, month);
  if (days >= total) return { days: total, daysInMonth: total, amountMinor: input.amountMinor };
  const numerator = input.amountMinor * BigInt(days);
  const denominator = BigInt(total);
  const amountMinor = (numerator + denominator / 2n) / denominator;
  return { days, daysInMonth: total, amountMinor };
}

export interface FinalMonthTerms {
  monthlyAmountMinor: bigint;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
}

export interface FinalCharge {
  serviceMonth: IsoMonth;
  days: number;
  daysInMonth: number;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
}

export interface Adjustment {
  /** Gross credited on the posted charge's receivable. */
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  /** True when the credit had to stop at the outstanding (what was paid is not refunded by a credit). */
  limitedByPayments: boolean;
}

export interface CancelOutcome {
  effectiveMonth: IsoMonth;
  finalMonth: FinalMonthOption;
  /** What the final month charges: the full month (FULL), the prorated part (PRORATE), or nothing (WAIVE). Null for WAIVE. */
  finalCharge: FinalCharge | null;
  /** The credit a posted final month needs to match `finalCharge`; null when nothing is posted or nothing to credit. */
  adjustment: Adjustment | null;
}

/** The whole final-month story for a cancellation, from the terms in force that month and what is already posted. */
export function cancelOutcome(input: { terms: FinalMonthTerms; effectiveDate: IsoDate; finalMonth: FinalMonthOption; posted: { charge: RetainerChargeRecord; receivable: ReceivableRecord } | null }): CancelOutcome {
  const effectiveMonth = monthOf(input.effectiveDate);
  const full = computeVat({ amountMinor: input.terms.monthlyAmountMinor, pricingBasis: input.terms.pricingBasis, treatment: input.terms.vatTreatment, rateBasisPoints: input.terms.rateBasisPoints });
  const days = prorate({ amountMinor: input.terms.monthlyAmountMinor, effectiveDate: input.effectiveDate });
  let finalCharge: FinalCharge | null;
  if (input.finalMonth === 'WAIVE') {
    finalCharge = null;
  } else if (input.finalMonth === 'FULL') {
    finalCharge = { serviceMonth: effectiveMonth, days: days.daysInMonth, daysInMonth: days.daysInMonth, amountMinor: input.terms.monthlyAmountMinor, netMinor: full.netMinor, vatMinor: full.vatMinor, grossMinor: full.grossMinor };
  } else {
    const part = computeVat({ amountMinor: days.amountMinor, pricingBasis: input.terms.pricingBasis, treatment: input.terms.vatTreatment, rateBasisPoints: input.terms.rateBasisPoints });
    finalCharge = { serviceMonth: effectiveMonth, days: days.days, daysInMonth: days.daysInMonth, amountMinor: days.amountMinor, netMinor: part.netMinor, vatMinor: part.vatMinor, grossMinor: part.grossMinor };
  }
  if (!input.posted || input.finalMonth === 'FULL') return { effectiveMonth, finalMonth: input.finalMonth, finalCharge, adjustment: null };
  const { receivable } = input.posted;
  const outstanding = receivable.grossMinor - receivable.paidMinor - receivable.creditedMinor;
  // What the month should come down to, less what earlier credits already took off; capped at the outstanding.
  const wanted = input.posted.charge.grossMinor - (finalCharge?.grossMinor ?? 0n) - receivable.creditedMinor;
  if (wanted <= 0n || outstanding <= 0n) return { effectiveMonth, finalMonth: input.finalMonth, finalCharge, adjustment: null };
  const amountMinor = wanted > outstanding ? outstanding : wanted;
  const split = splitCredit({ amountMinor, treatment: receivable.vatTreatment, rateBasisPoints: receivable.vatRateBasisPoints });
  return { effectiveMonth, finalMonth: input.finalMonth, finalCharge, adjustment: { amountMinor, netMinor: split.netMinor, vatMinor: split.vatMinor, limitedByPayments: wanted > outstanding } };
}
