import { HARD_CAP_PLANS, PAID_HARD_CAP_PLANS, PLAN_LIMITS, type FreePlanName, type PlanName } from '../billing/plans.js';
import type { UsageMeter, UsagePlan } from './kinds.js';

/**
 * MUT-733 (ADR-292): what a stamp carries about the paid caps: PAID_HARD_CAPS, and the meter the over-cap gift lifts
 * this month (null: none). Absent = only Starter is hard-capped (as before).
 */
export interface CapRule {
  paidHardCaps: boolean;
  giftMeter: UsageMeter | null;
  /** The gift can still be offered (a refusal says `gift: 'available'`). */
  giftAvailable: boolean;
}

/**
 * MUT-735 (ADR-281): a plan's monthly cap per meter, and how close a count is to it. Pure. MUT-731 (ADR-284): Starter's
 * row, and `hardCapOf`, the cap a metered write passes to the counter (only the plans that refuse at the cap).
 */

const LIMIT_FIELD: Readonly<Record<UsageMeter, 'documentsPerMonth' | 'scansPerMonth'>> = { DOCUMENTS: 'documentsPerMonth', SCANS: 'scansPerMonth' };

function hasLimits(plan: UsagePlan): plan is PlanName | FreePlanName {
  return Object.hasOwn(PLAN_LIMITS, plan);
}

/** The cap, or null for no cap: Malafat, no plan and legacy Freelancer (until MUT-707). */
export function capOf(plan: UsagePlan, meter: UsageMeter): number | null {
  return hasLimits(plan) ? PLAN_LIMITS[plan][LIMIT_FIELD[meter]] : null;
}

/**
 * MUT-731 (ADR-284): the cap a write passes to the counter's conditional upsert: the plan's cap where the plan refuses
 * at it (HARD_CAP_PLANS: Starter), else null (counted, never refused; MUT-733 adds the paid plans).
 */
export function hardCapOf(plan: UsagePlan, meter: UsageMeter, rule?: CapRule | null): number | null {
  if (HARD_CAP_PLANS.has(plan)) return capOf(plan, meter);
  // MUT-733: Solo and Business with PAID_HARD_CAPS on, except the meter the gift lifts this month.
  if (rule?.paidHardCaps && PAID_HARD_CAP_PLANS.has(plan) && rule.giftMeter !== meter) return capOf(plan, meter);
  return null;
}

/** Basel (2026-11-25): usage lines show 80% (near) and 90% (nudge) before the cap itself. */
export const NEAR_SHARE = 0.8;
export const NUDGE_SHARE = 0.9;
export const USAGE_LEVELS = ['ok', 'near', 'nudge', 'at_cap'] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];

/**
 * 80% and 90% of the cap, but never later than two steps and one step before it. Basel (MUT-731, 2026-11-26): on a
 * small cap (Starter's 3 documents) the heads-up and the nudge must still come before the limit: 1 of 3 is the heads-up,
 * 2 of 3 the nudge. For every larger cap (12 scans and up) this is exactly 80% and 90%.
 */
export function levelOf(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'ok';
  if (used >= limit) return 'at_cap';
  if (used >= Math.min(limit * NUDGE_SHARE, limit - 1)) return 'nudge';
  if (used >= Math.min(limit * NEAR_SHARE, limit - 2)) return 'near';
  return 'ok';
}

export interface MeterView {
  meter: Lowercase<UsageMeter>;
  used: number;
  limit: number | null;
  level: UsageLevel;
}

export function meterView(meter: UsageMeter, used: number, plan: UsagePlan): MeterView {
  const limit = capOf(plan, meter);
  return { meter: meter.toLowerCase() as Lowercase<UsageMeter>, used, limit, level: levelOf(used, limit) };
}

/** A stock limit of the plan (businesses owned, partners on a business), or null where the plan has no row. */
export function stockLimitOf(plan: UsagePlan, stock: 'businesses' | 'partners'): number | null {
  return hasLimits(plan) ? PLAN_LIMITS[plan][stock] : null;
}

export interface UsageView {
  month: string;
  resetsOn: string;
  plan: UsagePlan;
  meters: MeterView[];
  businesses: { used: number; limit: number | null };
  partners: { limit: number | null };
}

/** GET /v1/billing's `usage`: this month's counters against the payer's limits. Pure. */
export function usageView(input: { month: string; resetsOn: string; plan: UsagePlan; counts: Readonly<Record<UsageMeter, number>>; businessesOwned: number }): UsageView {
  return {
    month: input.month,
    resetsOn: input.resetsOn,
    plan: input.plan,
    meters: (['DOCUMENTS', 'SCANS'] as const).map((meter) => meterView(meter, input.counts[meter], input.plan)),
    businesses: { used: input.businessesOwned, limit: stockLimitOf(input.plan, 'businesses') },
    partners: { limit: stockLimitOf(input.plan, 'partners') },
  };
}
