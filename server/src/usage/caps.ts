import { PLAN_LIMITS, type PlanName } from '../billing/plans.js';
import type { UsageMeter, UsagePlan } from './kinds.js';

/**
 * MUT-735 (ADR-281): a plan's monthly cap per meter, and how close a count is to it. Pure. Read only: MUT-731 enforces
 * the caps (and adds Starter's row); nothing here refuses anything.
 */

const LIMIT_FIELD: Readonly<Record<UsageMeter, 'documentsPerMonth' | 'scansPerMonth'>> = { DOCUMENTS: 'documentsPerMonth', SCANS: 'scansPerMonth' };

function isPlanOnSale(plan: UsagePlan): plan is PlanName {
  return Object.hasOwn(PLAN_LIMITS, plan);
}

/** The cap, or null for no cap: Malafat, no plan, legacy Freelancer (until MUT-707), and Starter until MUT-731. */
export function capOf(plan: UsagePlan, meter: UsageMeter): number | null {
  return isPlanOnSale(plan) ? PLAN_LIMITS[plan][LIMIT_FIELD[meter]] : null;
}

/** Basel (2026-11-25): usage lines show 80% (near) and 90% (nudge) before the cap itself. */
export const NEAR_SHARE = 0.8;
export const NUDGE_SHARE = 0.9;
export const USAGE_LEVELS = ['ok', 'near', 'nudge', 'at_cap'] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];

export function levelOf(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'ok';
  if (used >= limit) return 'at_cap';
  if (used >= limit * NUDGE_SHARE) return 'nudge';
  if (used >= limit * NEAR_SHARE) return 'near';
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
