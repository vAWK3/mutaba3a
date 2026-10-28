import { splitCredit } from '../payments/credit.js';
import { BP_SCALE, computeVat, roundHalfUpDiv, type PricingBasis, type VatTreatment } from '../vat.js';
import type { AmountChange } from './supplement.js';

/**
 * Lowering a fixed fee (MUT-480, ADR-222). Pure: given the gross to take off, the agreement's unbilled installments and
 * its open receivables, plans one write. Unbilled first, latest position first: whole installments are voided, and at
 * most one is lowered partly (the only rounding point). Then the open receivables, latest posting date first, are
 * credited. On a VAT-exclusive agreement a partial installment lands on the smallest reachable gross at or above its
 * target, so the plan never takes off more than asked; the gap (under one minor unit of net) is reported as `roundedBy`
 * and never becomes a credit (D5).
 */
export interface UnbilledInstallment extends AmountChange {
  position: number;
  vatTreatment: VatTreatment;
}

export interface OpenReceivable {
  id: string;
  postingDate: string;
  /** The installment position the receivable was posted from: the tiebreak on the same posting date. */
  position: number;
  outstandingMinor: bigint;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
}

export interface ReductionInput {
  byGrossMinor: bigint;
  pricingBasis: PricingBasis;
  /** The agreement's frozen standard rate. */
  rateBasisPoints: number;
  unbilled: readonly UnbilledInstallment[];
  openReceivables: readonly OpenReceivable[];
  /** Whether any live installment has posted (open or settled); with nothing posted, voiding them all is a cancel (D4). */
  hasPosted: boolean;
}

export interface PlannedCredit {
  receivableId: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
}

export type ReductionPlan =
  | { ok: true; changes: AmountChange[]; voids: string[]; credits: PlannedCredit[]; appliedMinor: bigint; roundedByMinor: bigint }
  | { ok: false; reason: 'AMOUNT_INVALID' | 'USE_CANCEL' }
  | { ok: false; reason: 'REDUCTION_EXCEEDS_OPEN'; unbilledMinor: bigint; outstandingMinor: bigint; maximumMinor: bigint };

export function planReduction(input: ReductionInput): ReductionPlan {
  const by = input.byGrossMinor;
  if (by <= 0n) return { ok: false, reason: 'AMOUNT_INVALID' };
  const unbilledMinor = sum(input.unbilled.map((i) => i.grossMinor));
  const outstandingMinor = sum(input.openReceivables.map((r) => r.outstandingMinor));
  // With nothing posted the whole unbilled amount is a cancel, so the largest accepted reduction is one minor unit less (O-F9).
  const maximumMinor = input.hasPosted ? unbilledMinor + outstandingMinor : unbilledMinor - 1n;
  if (by > maximumMinor) {
    if (!input.hasPosted && by === unbilledMinor) return { ok: false, reason: 'USE_CANCEL' };
    return { ok: false, reason: 'REDUCTION_EXCEEDS_OPEN', unbilledMinor, outstandingMinor, maximumMinor };
  }

  const installments = lowerUnbilled(input, by < unbilledMinor ? by : unbilledMinor);
  const credits = by > unbilledMinor ? creditOpen(input.openReceivables, by - unbilledMinor) : [];
  const appliedMinor = by - installments.roundedByMinor;
  if (appliedMinor === 0n) return { ok: false, reason: 'AMOUNT_INVALID' };
  return { ok: true, changes: installments.changes, voids: installments.voids, credits, appliedMinor, roundedByMinor: installments.roundedByMinor };
}

function lowerUnbilled(input: ReductionInput, takeMinor: bigint): { changes: AmountChange[]; voids: string[]; roundedByMinor: bigint } {
  const changes: AmountChange[] = [];
  const voids: string[] = [];
  let remaining = takeMinor;
  for (const i of [...input.unbilled].sort((a, b) => b.position - a.position)) {
    if (remaining === 0n) break;
    if (remaining >= i.grossMinor) {
      voids.push(i.id);
      remaining -= i.grossMinor;
      continue;
    }
    const amountMinor = amountForGrossAtLeast(i.grossMinor - remaining, input.pricingBasis, i.vatTreatment, input.rateBasisPoints);
    const vat = computeVat({ amountMinor, pricingBasis: input.pricingBasis, treatment: i.vatTreatment, rateBasisPoints: input.rateBasisPoints });
    if (vat.grossMinor < i.grossMinor) changes.push({ id: i.id, amountMinor, netMinor: vat.netMinor, vatMinor: vat.vatMinor, grossMinor: vat.grossMinor });
    remaining -= i.grossMinor - vat.grossMinor;
    break;
  }
  return { changes, voids, roundedByMinor: remaining };
}

function creditOpen(receivables: readonly OpenReceivable[], takeMinor: bigint): PlannedCredit[] {
  const credits: PlannedCredit[] = [];
  let remaining = takeMinor;
  const latestFirst = [...receivables].sort((a, b) => (a.postingDate !== b.postingDate ? (a.postingDate < b.postingDate ? 1 : -1) : b.position - a.position));
  for (const r of latestFirst) {
    if (remaining === 0n) break;
    const amountMinor = r.outstandingMinor < remaining ? r.outstandingMinor : remaining;
    if (amountMinor <= 0n) continue;
    credits.push({ receivableId: r.id, ...splitCredit({ amountMinor, treatment: r.vatTreatment, rateBasisPoints: r.rateBasisPoints }) });
    remaining -= amountMinor;
  }
  return credits;
}

/**
 * The smallest amount, in the pricing basis, whose gross is at least `targetGrossMinor`. Exact except on a
 * VAT-exclusive, standard-rated amount, where gross = net + round(net × rate) skips some values: the result is then at
 * most one minor unit above the target. Starts from the rounded inverse and walks the (at most one or two) steps.
 */
export function amountForGrossAtLeast(targetGrossMinor: bigint, pricingBasis: PricingBasis, treatment: VatTreatment, rateBasisPoints: number): bigint {
  if (pricingBasis === 'VAT_INCLUSIVE' || treatment !== 'STANDARD_RATED') return targetGrossMinor;
  const gross = (net: bigint) => computeVat({ amountMinor: net, pricingBasis, treatment, rateBasisPoints }).grossMinor;
  let net = roundHalfUpDiv(targetGrossMinor * BP_SCALE, BP_SCALE + BigInt(rateBasisPoints));
  while (gross(net) < targetGrossMinor) net += 1n;
  while (net > 0n && gross(net - 1n) >= targetGrossMinor) net -= 1n;
  return net;
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, v) => a + v, 0n);
}
