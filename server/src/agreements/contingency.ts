import { BP_SCALE, roundHalfUpDiv, type PricingBasis } from '../vat.js';

/**
 * Contingency fee agreements (MUT-100): an upfront fee scheduled like a fixed
 * fee's installments, plus a commission of one rate on the awarded amount,
 * billed once when the outcome is recorded. Pure; minor units throughout, in
 * the agreement's pricing basis.
 *
 *   commission = award × rate                         (half up to minor units)
 *
 *   SEPARATE   upfront ─────────────┐  stays on top
 *              commission ──────────┴─► billable = commission
 *
 *   CREDITED   upfront counted ──┐
 *              commission ───────┴─► applied  = min(counted, commission)
 *                                    billable = commission − applied
 *                                    (commission < upfront: the firm keeps the upfront, nothing is refunded)
 *
 *   NO_RECOVERY                    ─► nothing billed; the upfront stands
 *
 * "Counted" is every live upfront installment, posted or not, paid or not,
 * less the credits issued against the posted ones, read from the stored
 * credit rows (never re-split), so the figure matches the firm's credit notes.
 */
export const UPFRONT_TREATMENTS = ['SEPARATE', 'CREDITED'] as const;
export type UpfrontTreatment = (typeof UPFRONT_TREATMENTS)[number];

export const CONTINGENCY_OUTCOMES = ['AWARDED', 'NO_RECOVERY'] as const;
export type ContingencyOutcome = (typeof CONTINGENCY_OUTCOMES)[number];

export const MIN_COMMISSION_RATE_BASIS_POINTS = 1;
export const MAX_COMMISSION_RATE_BASIS_POINTS = 10000;

/** The 422 COMMISSION_RATE_INVALID message, built from the bounds so it cannot drift from them. */
export const COMMISSION_RATE_RULE = `commissionRateBasisPoints must be an integer from ${MIN_COMMISSION_RATE_BASIS_POINTS} to ${MAX_COMMISSION_RATE_BASIS_POINTS}`;

export function isCommissionRate(rateBasisPoints: number): boolean {
  return Number.isInteger(rateBasisPoints) && rateBasisPoints >= MIN_COMMISSION_RATE_BASIS_POINTS && rateBasisPoints <= MAX_COMMISSION_RATE_BASIS_POINTS;
}

export function commissionMinor(awardedMinor: bigint, rateBasisPoints: number): bigint {
  return roundHalfUpDiv(awardedMinor * BigInt(rateBasisPoints), BP_SCALE);
}

export interface UpfrontLine {
  amountMinor: bigint;
  isCommission: boolean;
  voidedAt: Date | null;
  receivableId: string | null;
}

export interface StoredCredit {
  amountMinor: bigint;
  netMinor: bigint;
}

export function upfrontCountedMinor(input: { installments: readonly UpfrontLine[]; creditsByReceivableId: ReadonlyMap<string, readonly StoredCredit[]>; pricingBasis: PricingBasis }): bigint {
  let counted = 0n;
  for (const line of input.installments) {
    if (line.isCommission || line.voidedAt !== null) continue;
    counted += line.amountMinor;
    const credits = line.receivableId ? (input.creditsByReceivableId.get(line.receivableId) ?? []) : [];
    for (const credit of credits) counted -= input.pricingBasis === 'VAT_EXCLUSIVE' ? credit.netMinor : credit.amountMinor;
  }
  return counted > 0n ? counted : 0n;
}

export interface OutcomePlan {
  commissionMinor: bigint;
  appliedUpfrontMinor: bigint;
  billableMinor: bigint;
}

export function planOutcome(input: { outcome: ContingencyOutcome; treatment: UpfrontTreatment; awardedMinor: bigint | null; rateBasisPoints: number; upfrontCountedMinor: bigint }): OutcomePlan {
  if (input.outcome === 'NO_RECOVERY' || input.awardedMinor === null) return { commissionMinor: 0n, appliedUpfrontMinor: 0n, billableMinor: 0n };
  const commission = commissionMinor(input.awardedMinor, input.rateBasisPoints);
  if (input.treatment === 'SEPARATE') return { commissionMinor: commission, appliedUpfrontMinor: 0n, billableMinor: commission };
  const applied = input.upfrontCountedMinor < commission ? input.upfrontCountedMinor : commission;
  return { commissionMinor: commission, appliedUpfrontMinor: applied, billableMinor: commission - applied };
}
