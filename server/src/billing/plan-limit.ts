import { ApiError } from '../errors.js';
import type { UsagePlan } from '../usage/kinds.js';
import { nextPlanAbove, TIER_OF, type PlanName } from './plans.js';

/**
 * MUT-731 (ADR-284) / MUT-736 (ADR-282): the one shape of a plan's refusal, 409 PLAN_LIMIT (never 402: that is the lapse
 * gate's "plan ended"). Nothing was done, so the idempotency key is released (idempotency.ts) and the same request
 * succeeds after an upgrade or the monthly reset.
 *
 *   limit      documents | scans (monthly, with used, cap, resetsOn) · businesses | partners (stock, with cap) · taxAuthority
 *   plan       the payer's plan ("starter")
 *   nextPlan   the plan to upgrade to (solo); null above Firm
 *   canUpgrade a paid plan can be bought on this server now (Checkout configured); false = no Upgrade button
 */
export type PlanLimitKind = 'documents' | 'scans' | 'businesses' | 'partners' | 'taxAuthority';

export interface PlanLimitDetails {
  limit: PlanLimitKind;
  plan: UsagePlan;
  nextPlan: PlanName | null;
  canUpgrade: boolean;
  used?: number;
  cap?: number;
  /** The first day of the next Asia/Jerusalem month (YYYY-MM-DD), for the monthly meters. */
  resetsOn?: string;
  /**
   * MUT-733 (ADR-293): the account's once-ever over-cap gift can be taken for this meter (POST /v1/billing/over-cap-gift,
   * then retry). Only on a monthly meter, a Solo or Business payer, and an unused gift. Additive since 1.159.0-mut733.
   */
  gift?: 'available';
}

/** MUT-733: `gift: 'available'` on a monthly refusal when the stamp says the gift can still be taken. */
export function giftDetail(stamp: { caps?: { giftAvailable: boolean } | undefined } | null | undefined): { gift?: 'available' } {
  return stamp?.caps?.giftAvailable ? { gift: 'available' } : {};
}

const MESSAGES: Readonly<Record<PlanLimitKind, string>> = {
  documents: 'This month’s documents on your plan are used up',
  scans: 'This month’s scans on your plan are used up',
  businesses: 'Your plan includes no more businesses',
  partners: 'Your plan includes no partners',
  taxAuthority: 'The Tax Authority connection is on Solo and above',
};

export function planLimitError(details: PlanLimitDetails): ApiError {
  return new ApiError('PLAN_LIMIT', MESSAGES[details.limit], { ...details });
}

/** The plan a refusal offers: the cheapest plan on sale above the payer's. */
export function nextPlanFor(plan: UsagePlan): PlanName | null {
  if (plan === 'none' || plan === 'malafat') return null;
  return nextPlanAbove(TIER_OF[plan]);
}

/** True for a refusal built here (a response body or a thrown ApiError's envelope). */
export function isPlanLimitBody(body: unknown): boolean {
  const error = (body as { error?: { code?: unknown } } | null)?.error;
  return error?.code === 'PLAN_LIMIT';
}
