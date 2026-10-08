import { computeVat, type PricingBasis } from '../vat.js';
import type { InstallmentRecord } from '../repositories/ports.js';

/**
 * Supplement distribution (brief §2.3, decision 4). Pure: given the signed
 * delta and the unposted installments, returns the new amounts per
 * installment (VAT recomputed per installment with its own treatment and the
 * agreement's frozen rate) or a structured refusal.
 */
export type Distribution = 'LAST_UNPOSTED' | 'PRORATE_UNPOSTED' | 'NEW_INSTALLMENT';

export interface SupplementPlanInput {
  deltaMinor: bigint;
  distribution: Distribution;
  pricingBasis: PricingBasis;
  rateBasisPoints: number;
  unposted: readonly Pick<InstallmentRecord, 'id' | 'position' | 'amountMinor' | 'vatTreatment'>[];
  posted: readonly Pick<InstallmentRecord, 'id' | 'position' | 'amountMinor' | 'receivableId'>[];
  hasNewInstallment: boolean;
}

export interface AmountChange {
  id: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
}

export type SupplementPlan =
  | { ok: true; changes: AmountChange[]; newInstallmentAmountMinor: bigint | null }
  | { ok: false; reason: 'NEW_INSTALLMENT_REQUIRED' }
  | { ok: false; reason: 'NEGATIVE_NEW_INSTALLMENT' }
  | { ok: false; reason: 'SUPPLEMENT_EXCEEDS_UNPOSTED'; capacityMinor: bigint; shortfallMinor: bigint; postedReceivables: Array<{ installmentId: string; receivableId: string | null; amountMinor: bigint }> };

export function planSupplement(input: SupplementPlanInput): SupplementPlan {
  const delta = input.deltaMinor;
  const refuse = (capacity: bigint): SupplementPlan => ({
    ok: false,
    reason: 'SUPPLEMENT_EXCEEDS_UNPOSTED',
    capacityMinor: capacity,
    shortfallMinor: -delta - capacity,
    postedReceivables: input.posted.map((p) => ({ installmentId: p.id, receivableId: p.receivableId, amountMinor: p.amountMinor })),
  });

  if (input.distribution === 'NEW_INSTALLMENT') {
    if (delta <= 0n) return { ok: false, reason: 'NEGATIVE_NEW_INSTALLMENT' };
    if (!input.hasNewInstallment) return { ok: false, reason: 'NEW_INSTALLMENT_REQUIRED' };
    return { ok: true, changes: [], newInstallmentAmountMinor: delta };
  }

  const unposted = [...input.unposted].sort((a, b) => a.position - b.position);
  if (unposted.length === 0) {
    if (delta > 0n) return input.hasNewInstallment ? { ok: true, changes: [], newInstallmentAmountMinor: delta } : { ok: false, reason: 'NEW_INSTALLMENT_REQUIRED' };
    return refuse(0n);
  }

  const capacity = unposted.reduce((a, i) => a + i.amountMinor, 0n);
  const newAmounts = new Map<string, bigint>();
  if (input.distribution === 'LAST_UNPOSTED') {
    const last = unposted[unposted.length - 1]!;
    newAmounts.set(last.id, last.amountMinor + delta);
  } else {
    let allocated = 0n;
    unposted.forEach((i, idx) => {
      const isLast = idx === unposted.length - 1;
      const share = isLast ? delta - allocated : roundShare(delta, i.amountMinor, capacity);
      allocated += share;
      newAmounts.set(i.id, i.amountMinor + share);
    });
  }
  // Every touched installment must stay strictly positive.
  for (const [, amount] of newAmounts) if (amount <= 0n) return refuse(capacity - 1n);

  const changes: AmountChange[] = [];
  for (const i of unposted) {
    const amountMinor = newAmounts.get(i.id);
    if (amountMinor === undefined || amountMinor === i.amountMinor) continue;
    const vat = computeVat({ amountMinor, pricingBasis: input.pricingBasis, treatment: i.vatTreatment, rateBasisPoints: input.rateBasisPoints });
    changes.push({ id: i.id, amountMinor, netMinor: vat.netMinor, vatMinor: vat.vatMinor, grossMinor: vat.grossMinor });
  }
  return { ok: true, changes, newInstallmentAmountMinor: null };
}

/** delta × part / whole, half-up, symmetric. */
function roundShare(delta: bigint, part: bigint, whole: bigint): bigint {
  if (whole === 0n) return 0n;
  const n = delta * part;
  const half = whole / 2n;
  return n >= 0n ? (n + half) / whole : -((-n + half) / whole);
}
