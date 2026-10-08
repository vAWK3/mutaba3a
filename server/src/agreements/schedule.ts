import type { IsoDate, PaymentTerms } from '../dates.js';
import { computeVat, type PricingBasis, type VatTreatment } from '../vat.js';

/**
 * Installment split for a fixed-fee agreement (brief rev. 2 §A). Pure.
 *
 * Installments divide the contractual amount in its pricing basis; each one
 * computes its own net / VAT / gross from its treatment and the frozen rate;
 * the agreement totals are the sums, so they reconcile by construction.
 */
export const MAX_INSTALLMENTS = 60;

export type TriggerType = 'IMMEDIATE' | 'DATE' | 'MANUAL';

export interface InstallmentTrigger {
  type: TriggerType;
  date?: IsoDate | undefined;
}

export interface InstallmentSpec {
  label: string;
  amount?: bigint | undefined;
  percentBasisPoints?: number | undefined;
  vatTreatment?: VatTreatment | undefined;
  trigger: InstallmentTrigger;
  paymentTerms?: PaymentTerms | undefined;
  dueDate?: IsoDate | undefined;
}

export interface ScheduledInstallment {
  position: number;
  label: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  trigger: InstallmentTrigger;
  paymentTerms?: PaymentTerms | undefined;
  dueDate?: IsoDate | undefined;
}

export interface ScheduleTotals {
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
}

export type ScheduleError =
  | { reason: 'NO_INSTALLMENTS' }
  | { reason: 'TOO_MANY_INSTALLMENTS'; max: number }
  | { reason: 'MIXED_INSTALLMENT_BASIS' }
  | { reason: 'INSTALLMENTS_DO_NOT_SUM'; differenceMinor: bigint }
  | { reason: 'PERCENTS_DO_NOT_SUM'; totalBasisPoints: number }
  | { reason: 'NON_POSITIVE_INSTALLMENT'; position: number };

export type ScheduleResult = { ok: true; items: ScheduledInstallment[]; totals: ScheduleTotals } | { ok: false; error: ScheduleError };

export interface SplitInput {
  amountMinor: bigint;
  pricingBasis: PricingBasis;
  defaultTreatment: VatTreatment;
  rateBasisPoints: number;
  installments: readonly InstallmentSpec[];
}

export function splitInstallments(input: SplitInput): ScheduleResult {
  const specs = input.installments;
  if (specs.length === 0) return { ok: false, error: { reason: 'NO_INSTALLMENTS' } };
  if (specs.length > MAX_INSTALLMENTS) return { ok: false, error: { reason: 'TOO_MANY_INSTALLMENTS', max: MAX_INSTALLMENTS } };

  const byAmount = specs.every((s) => s.amount !== undefined && s.percentBasisPoints === undefined);
  const byPercent = specs.every((s) => s.percentBasisPoints !== undefined && s.amount === undefined);
  if (!byAmount && !byPercent) return { ok: false, error: { reason: 'MIXED_INSTALLMENT_BASIS' } };

  if (byAmount) {
    const sumError = checkAmountsSum(specs, input.amountMinor);
    if (sumError) return { ok: false, error: sumError };
  }
  const amounts = byAmount ? amountsFromSpecs(specs) : amountsFromPercents(specs, input.amountMinor);
  if (!amounts.ok) return amounts;

  const items: ScheduledInstallment[] = [];
  const totals: ScheduleTotals = { amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n };
  specs.forEach((spec, i) => {
    const amountMinor = amounts.values[i] ?? 0n;
    const treatment = spec.vatTreatment ?? input.defaultTreatment;
    const vat = computeVat({ amountMinor, pricingBasis: input.pricingBasis, treatment, rateBasisPoints: input.rateBasisPoints });
    items.push({
      position: i + 1,
      label: spec.label,
      amountMinor,
      netMinor: vat.netMinor,
      vatMinor: vat.vatMinor,
      grossMinor: vat.grossMinor,
      vatTreatment: treatment,
      rateBasisPoints: vat.rateBasisPoints,
      trigger: spec.trigger,
      paymentTerms: spec.paymentTerms,
      dueDate: spec.dueDate,
    });
    totals.amountMinor += amountMinor;
    totals.netMinor += vat.netMinor;
    totals.vatMinor += vat.vatMinor;
    totals.grossMinor += vat.grossMinor;
  });
  return { ok: true, items, totals };
}

type Amounts = { ok: true; values: bigint[] } | { ok: false; error: ScheduleError };

function amountsFromSpecs(specs: readonly InstallmentSpec[]): Amounts {
  const values = specs.map((s) => s.amount ?? 0n);
  const nonPositive = values.findIndex((v) => v <= 0n);
  if (nonPositive !== -1) return { ok: false, error: { reason: 'NON_POSITIVE_INSTALLMENT', position: nonPositive + 1 } };
  return { ok: true, values };
}

function amountsFromPercents(specs: readonly InstallmentSpec[], amountMinor: bigint): Amounts {
  const pcts = specs.map((s) => s.percentBasisPoints ?? 0);
  const total = pcts.reduce((a, b) => a + b, 0);
  if (total !== 10000 || pcts.some((p) => !Number.isInteger(p) || p < 0)) return { ok: false, error: { reason: 'PERCENTS_DO_NOT_SUM', totalBasisPoints: total } };
  const values: bigint[] = [];
  let allocated = 0n;
  pcts.forEach((p, i) => {
    const last = i === pcts.length - 1;
    const v = last ? amountMinor - allocated : (amountMinor * BigInt(p) + 5000n) / 10000n;
    values.push(v);
    allocated += v;
  });
  const nonPositive = values.findIndex((v) => v <= 0n);
  if (nonPositive !== -1) return { ok: false, error: { reason: 'NON_POSITIVE_INSTALLMENT', position: nonPositive + 1 } };
  return { ok: true, values };
}

/** Amounts given explicitly must sum to the contractual amount exactly. */
export function checkAmountsSum(specs: readonly InstallmentSpec[], amountMinor: bigint): ScheduleError | null {
  if (!specs.every((s) => s.amount !== undefined)) return null;
  const sum = specs.reduce((a, s) => a + (s.amount ?? 0n), 0n);
  return sum === amountMinor ? null : { reason: 'INSTALLMENTS_DO_NOT_SUM', differenceMinor: amountMinor - sum };
}
