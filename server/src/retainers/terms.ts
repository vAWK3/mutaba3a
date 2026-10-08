import { compareIsoDates, isIsoMonth, type IsoMonth } from '../dates.js';
import type { PaymentTerms } from '../dates.js';
import type { AgreementRecord, RetainerVersionRecord } from '../repositories/ports.js';
import type { PricingBasis, VatTreatment } from '../vat.js';
import { MAX_BILLING_DAY } from './schedule.js';

/**
 * Retainer terms over time (M5 brief §4). The agreement row keeps the original
 * terms; every change appends a version. Version 1 is synthesized from the
 * agreement, so retainers created before M5 need no backfill. Pure.
 */
export interface RetainerTerms {
  version: number;
  effectiveMonth: IsoMonth;
  monthlyAmountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  billingDay: number;
  paymentTerms: PaymentTerms;
  endMonth: IsoMonth | null;
  reason: string | null;
}

export function baseTerms(agreement: AgreementRecord): RetainerTerms {
  return {
    version: 1,
    effectiveMonth: agreement.startMonth ?? agreement.agreementDate.slice(0, 7),
    monthlyAmountMinor: agreement.amountMinor,
    netMinor: agreement.netMinor,
    vatMinor: agreement.vatMinor,
    grossMinor: agreement.grossMinor,
    pricingBasis: agreement.pricingBasis,
    vatTreatment: agreement.vatTreatment,
    rateBasisPoints: agreement.vatRateBasisPoints,
    billingDay: agreement.billingDay ?? 1,
    paymentTerms: agreement.paymentTerms,
    endMonth: agreement.endMonth,
    reason: null,
  };
}

export function fromVersion(v: RetainerVersionRecord): RetainerTerms {
  return {
    version: v.version,
    effectiveMonth: v.effectiveMonth,
    monthlyAmountMinor: v.monthlyAmountMinor,
    netMinor: v.netMinor,
    vatMinor: v.vatMinor,
    grossMinor: v.grossMinor,
    pricingBasis: v.pricingBasis,
    vatTreatment: v.vatTreatment,
    rateBasisPoints: v.rateBasisPoints,
    billingDay: v.billingDay,
    paymentTerms: v.paymentTerms,
    endMonth: v.endMonth,
    reason: v.reason,
  };
}

/** Version 1 from the agreement followed by every stored version, in version order. */
export function termsTimeline(agreement: AgreementRecord, versions: readonly RetainerVersionRecord[]): RetainerTerms[] {
  const stored = [...versions].sort((a, b) => a.version - b.version).map(fromVersion);
  return [baseTerms(agreement), ...stored.filter((v) => v.version > 1)];
}

/** The terms in force for a service month: the latest version whose effective month is on or before it. */
export function termsFor(timeline: readonly RetainerTerms[], month: IsoMonth): RetainerTerms {
  let current = timeline[0]!;
  for (const t of timeline) if (t.effectiveMonth <= month) current = t;
  return current;
}

export function latestTerms(timeline: readonly RetainerTerms[]): RetainerTerms {
  return timeline[timeline.length - 1]!;
}

/** The end month in force: the latest version's. */
export function effectiveEndMonth(timeline: readonly RetainerTerms[]): IsoMonth | null {
  return latestTerms(timeline).endMonth;
}

export interface TermsChange {
  effectiveMonth: IsoMonth;
  monthlyAmountMinor?: bigint | undefined;
  pricingBasis?: PricingBasis | undefined;
  vatTreatment?: VatTreatment | undefined;
  billingDay?: number | undefined;
  paymentTerms?: PaymentTerms | undefined;
  /** `null` clears the end month; `undefined` leaves it. */
  endMonth?: IsoMonth | null | undefined;
}

export type ChangeErrorReason = 'CHANGE_EFFECTIVE_INVALID' | 'CHANGE_NOTHING_CHANGED' | 'BILLING_DAY_INVALID' | 'END_MONTH_INVALID' | 'END_BEFORE_START' | 'AMOUNT_INVALID';

export type ChangeValidation = { ok: true; changed: string[] } | { ok: false; reason: ChangeErrorReason; detail?: string };

/**
 * A change must be strictly after the latest version's effective month, within
 * the retainer's life (start … end/cancel month), and must change something
 * (brief decisions 1, 3).
 */
export function validateChange(timeline: readonly RetainerTerms[], agreement: AgreementRecord, change: TermsChange): ChangeValidation {
  const latest = latestTerms(timeline);
  if (!isIsoMonth(change.effectiveMonth)) return { ok: false, reason: 'CHANGE_EFFECTIVE_INVALID', detail: 'effectiveMonth is not a month' };
  if (change.effectiveMonth <= latest.effectiveMonth) return { ok: false, reason: 'CHANGE_EFFECTIVE_INVALID', detail: `effectiveMonth must be after ${latest.effectiveMonth}` };
  if (change.billingDay !== undefined && (!Number.isInteger(change.billingDay) || change.billingDay < 1 || change.billingDay > MAX_BILLING_DAY)) return { ok: false, reason: 'BILLING_DAY_INVALID' };
  if (change.endMonth) {
    if (!isIsoMonth(change.endMonth)) return { ok: false, reason: 'END_MONTH_INVALID' };
    if (change.endMonth < change.effectiveMonth) return { ok: false, reason: 'END_BEFORE_START' };
  }
  const end = change.endMonth === undefined ? latest.endMonth : change.endMonth;
  if (end !== null && change.effectiveMonth > end) return { ok: false, reason: 'CHANGE_EFFECTIVE_INVALID', detail: `effectiveMonth is after the end month ${end}` };
  if (agreement.cancelEffectiveMonth && change.effectiveMonth > agreement.cancelEffectiveMonth) return { ok: false, reason: 'CHANGE_EFFECTIVE_INVALID', detail: 'effectiveMonth is after the cancellation month' };
  if (change.monthlyAmountMinor !== undefined && change.monthlyAmountMinor <= 0n) return { ok: false, reason: 'AMOUNT_INVALID' };
  const changed = diffTerms(latest, change);
  if (changed.length === 0) return { ok: false, reason: 'CHANGE_NOTHING_CHANGED' };
  return { ok: true, changed };
}

/** Which fields the change actually alters relative to the terms it follows. */
export function diffTerms(prev: RetainerTerms, change: TermsChange): string[] {
  const changed: string[] = [];
  if (change.monthlyAmountMinor !== undefined && change.monthlyAmountMinor !== prev.monthlyAmountMinor) changed.push('monthlyAmount');
  if (change.pricingBasis !== undefined && change.pricingBasis !== prev.pricingBasis) changed.push('pricingBasis');
  if (change.vatTreatment !== undefined && change.vatTreatment !== prev.vatTreatment) changed.push('vatTreatment');
  if (change.billingDay !== undefined && change.billingDay !== prev.billingDay) changed.push('billingDay');
  if (change.paymentTerms !== undefined && change.paymentTerms !== prev.paymentTerms) changed.push('paymentTerms');
  if (change.endMonth !== undefined && change.endMonth !== prev.endMonth) changed.push('endMonth');
  return changed;
}

/** The terms a change produces, before VAT is recomputed (the caller supplies the rate). */
export function applyChange(prev: RetainerTerms, change: TermsChange): Omit<RetainerTerms, 'version' | 'netMinor' | 'vatMinor' | 'grossMinor' | 'rateBasisPoints' | 'reason'> {
  return {
    effectiveMonth: change.effectiveMonth,
    monthlyAmountMinor: change.monthlyAmountMinor ?? prev.monthlyAmountMinor,
    pricingBasis: change.pricingBasis ?? prev.pricingBasis,
    vatTreatment: change.vatTreatment ?? prev.vatTreatment,
    billingDay: change.billingDay ?? prev.billingDay,
    paymentTerms: change.paymentTerms ?? prev.paymentTerms,
    endMonth: change.endMonth === undefined ? prev.endMonth : change.endMonth,
  };
}

/** Generated months on or after the change's effective month: they keep their terms (brief §1). */
export function chargesKept(generatedMonths: readonly IsoMonth[], effectiveMonth: IsoMonth): IsoMonth[] {
  return generatedMonths.filter((m) => compareIsoDates(`${m}-01`, `${effectiveMonth}-01`) >= 0).sort();
}
