import type { BillingPlanChangeRecord, BillingSubscriptionRecord } from '../repositories/ports.js';
import { changeTimingOf, FREE_PLAN, PLAN_LIMITS, PLAN_NAMES, TIER_OF, type FreePlanName, type PlanName, type ProfilePlanTier } from './plans.js';

/**
 * MUT-734 (ADR-291): what changing a profile plan does. Pure: the route reads Stripe's live subscription and the
 * person's businesses, this decides, and the Stripe door carries it out.
 *
 *   up a rank (changeTimingOf 'now')    charged now with Stripe's proration; the tier changes when Stripe confirms
 *   down to a lower paid plan           at the paid period's end, through a Stripe subscription schedule
 *   to Starter                          cancel at the period end and choose Starter now (no read-only gap, ADR-284 row 7)
 *
 * Going below the person's business count needs their pick of which stay active (Basel's MUT-731 Q5: no default).
 * The interval is kept (Q1); the legacy Freelancer and founder plans are refused until MUT-707 moves them (Q3).
 */
export type PlanChangeTarget = PlanName | FreePlanName;

export type PlanChangeRefusal =
  | 'NOT_SUBSCRIBED'
  | 'SAME_PLAN'
  | 'PAUSED'
  | 'PAST_DUE'
  | 'CANCELLING'
  | 'SCHEDULE_PENDING'
  | 'LEGACY_PLAN'
  | 'ACTIVE_BUSINESSES_REQUIRED';

export interface PlanChangeCurrent {
  tier: ProfilePlanTier | 'ACCOUNTANT';
  /** Stripe's status. */
  status: string;
  currentPeriodEnd: Date | null;
  /** A pause set or running (MUT-532). */
  paused: boolean;
  /** MUT-532's cancel at the period end (or a move to Starter already asked). */
  cancelAtPeriodEnd: boolean;
  /** On a Stripe subscription schedule: a founder price, or a change already scheduled. */
  managedBySchedule: boolean;
  /** The person already has a SCHEDULED change. */
  scheduled: boolean;
}

export interface PlanChangeInput {
  current: PlanChangeCurrent | null;
  target: PlanChangeTarget;
  /** The person's own business profiles (their personal one left out). */
  ownedBusinesses: readonly string[];
  /** The businesses the person picked to keep active (only needed when the target holds fewer). */
  chosenActive: readonly string[] | null;
}

export type PlanChangeDecision =
  | { kind: 'upgrade' }
  | { kind: 'downgrade' | 'to_starter'; effectiveAt: Date; cap: number; active: string[]; readOnly: string[] }
  | { refused: PlanChangeRefusal; cap?: number };

const SOLD_TIERS: ReadonlySet<string> = new Set(['SOLO', 'BUSINESS', 'FIRM']);
const CHANGEABLE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);
const DUNNING_STATUSES: ReadonlySet<string> = new Set(['past_due', 'unpaid', 'incomplete']);

export function planChangeOf(input: PlanChangeInput): PlanChangeDecision {
  const { current, target } = input;
  if (!current) return { refused: 'NOT_SUBSCRIBED' };
  if (current.scheduled) return { refused: 'SCHEDULE_PENDING' };
  if (!SOLD_TIERS.has(current.tier) || current.managedBySchedule) return { refused: 'LEGACY_PLAN' };
  if (DUNNING_STATUSES.has(current.status)) return { refused: 'PAST_DUE' };
  if (!CHANGEABLE_STATUSES.has(current.status) || !current.currentPeriodEnd) return { refused: 'NOT_SUBSCRIBED' };
  if (current.paused) return { refused: 'PAUSED' };
  if (current.cancelAtPeriodEnd) return { refused: 'CANCELLING' };
  const tier = current.tier as ProfilePlanTier;
  if (target !== FREE_PLAN) {
    const timing = changeTimingOf(tier, target);
    if (timing === 'same') return { refused: 'SAME_PLAN' };
    if (timing === 'now') return { kind: 'upgrade' };
  }
  const cap = PLAN_LIMITS[target].businesses;
  const kept = keptBusinesses(input.ownedBusinesses, input.chosenActive, cap);
  if (!kept) return { refused: 'ACTIVE_BUSINESSES_REQUIRED', cap };
  return { kind: target === FREE_PLAN ? 'to_starter' : 'downgrade', effectiveAt: current.currentPeriodEnd, cap, ...kept };
}

/** Within the cap every business stays; past it, a valid pick (theirs, no repeats, 1 to `cap`) decides; else null. */
function keptBusinesses(owned: readonly string[], chosen: readonly string[] | null, cap: number): { active: string[]; readOnly: string[] } | null {
  if (owned.length <= cap) return { active: [...owned], readOnly: [] };
  const pick = chosen ?? [];
  const valid = pick.length >= 1 && pick.length <= cap && new Set(pick).size === pick.length && pick.every((id) => owned.includes(id));
  if (!valid) return null;
  return { active: [...pick], readOnly: owned.filter((id) => !pick.includes(id)) };
}

/** GET /v1/billing `planChange`: where the person may move from their current plan (empty when they can't change). */
export function planChangeOptionsOf(current: PlanChangeCurrent | null): { canUpgradeTo: PlanName[]; canDowngradeTo: PlanChangeTarget[] } {
  const probe = planChangeOf({ current, target: FREE_PLAN, ownedBusinesses: [], chosenActive: null });
  if ('refused' in probe || !current) return { canUpgradeTo: [], canDowngradeTo: [] };
  const tier = current.tier as ProfilePlanTier;
  const up: PlanName[] = [];
  const down: PlanChangeTarget[] = [];
  for (const plan of ['solo', 'business', 'firm'] as const) {
    const timing = changeTimingOf(tier, plan);
    if (timing === 'now') up.push(plan);
    else if (timing === 'period_end') down.push(plan);
  }
  return { canUpgradeTo: up, canDowngradeTo: [...down, FREE_PLAN] };
}

/** GET /v1/billing: the scheduled change and where the person may move, from the mirror (the routes re-check Stripe). */
export function planChangeView(shown: BillingSubscriptionRecord | undefined, changes: readonly BillingPlanChangeRecord[]) {
  const scheduled = changes.find((ch) => ch.state === 'SCHEDULED') ?? null;
  const pending = changes.find((ch) => ch.state === 'PENDING') ?? null;
  const current: PlanChangeCurrent | null = shown
    ? { tier: shown.tier, status: shown.status, currentPeriodEnd: shown.currentPeriodEnd, paused: shown.pausedFrom !== null, cancelAtPeriodEnd: shown.cancelAtPeriodEnd, managedBySchedule: false, scheduled: scheduled !== null }
    : null;
  return {
    scheduledChange: scheduled ? { plan: planNameOf(scheduled.toTier), at: scheduled.effectiveAt.toISOString(), kind: scheduled.kind } : null,
    pendingChange: pending ? { plan: planNameOf(pending.toTier), since: pending.createdAt.toISOString() } : null,
    planChange: planChangeOptionsOf(current),
  };
}

export function changeView(change: BillingPlanChangeRecord) {
  return {
    id: change.id,
    kind: change.kind,
    state: change.state,
    fromPlan: planNameOf(change.fromTier),
    toPlan: planNameOf(change.toTier),
    effectiveAt: change.effectiveAt.toISOString(),
    amountMinor: change.amountMinor,
    currency: change.currency,
    createdAt: change.createdAt.toISOString(),
  };
}

function planNameOf(tier: string): string {
  if (tier === 'STARTER') return FREE_PLAN;
  const plan = (PLAN_NAMES as readonly string[]).find((p) => TIER_OF[p as PlanName] === tier);
  return plan ?? tier.toLowerCase();
}

