/**
 * MUT-752 (ADR-296, plan `docs/designs/pilot-testers-business-plan.md`, eng review D1 and D4): the free pilot.
 *
 * A pilot is an operator grant with a `cohort` (and, usually, the accountant who referred the tester). Its expiry is
 * required (60 days by default), so a pilot always ends. Pure: GET /v1/billing gathers the facts it already read for
 * the entitlement and asks `pilotOf` with the same `now`; `resolveEntitlement` is not changed.
 */
import pricesFile from './pilot-prices.json' with { type: 'json' };
import { coveringState, pausedNow, periodOver, profilePlanSubscriptions, type EntitlementSource, type GrantFact, type SubscriptionFact } from './entitlement.js';
import { PLAN_LIMITS, PLAN_NAMES, type PlanLimits, type PlanName } from './plans.js';

/** Plan premise 1: Business for 60 days from the grant, unless the operator gives another end. */
export const PILOT_DEFAULT_DAYS = 60;
/**
 * A short lowercase slug (`dec-2026`, `acct-nasser`): it is sent with the pilot's analytics events (MUT-758), which
 * never carry personal data, so a tester's or an accountant's name is refused.
 */
const COHORT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PilotGrantFact extends GrantFact {
  cohort: string | null;
  referredByUserId: string | null;
  createdAt: Date;
}

export interface Pilot {
  cohort: string;
  /** MUT-758: the person's first pilot grant (revoked ones included), so an extension keeps the start. */
  startedAt: Date;
  endsAt: Date;
  referredByUserId: string | null;
}

export interface PilotFacts {
  userId: string;
  grants: readonly PilotGrantFact[];
  /** The person's own subscriptions (any tier; the Accountant plan is left out here). */
  subscriptions: readonly SubscriptionFact[];
  /** The entitlement source of each profile the person created, read at the same `now`. */
  sources: readonly EntitlementSource[];
}

export function isPilotCohort(value: string): boolean {
  return COHORT_RE.test(value);
}

/** The end of a pilot granted at `at`: the given expiry, else PILOT_DEFAULT_DAYS later. */
export function pilotExpiryOf(expiresAt: Date | null, at: Date): Date {
  return expiresAt ?? new Date(at.getTime() + PILOT_DEFAULT_DAYS * DAY_MS);
}

/**
 * The person's pilot, or null. Only when an operator grant covers one of their profiles (source OPERATOR), they don't
 * also pay for a profile plan (a tester who subscribes leaves the pilot view), and a pilot grant of theirs is live at
 * `now`: their own (never a profile's), not ACCOUNTANT, not revoked, not expired. Several (an extension is a revoke
 * and a new grant, or a second grant): the latest expiry.
 */
export function pilotOf(facts: PilotFacts, now: Date): Pilot | null {
  if (!facts.sources.includes('OPERATOR')) return null;
  if (payingNow(facts.subscriptions, now)) return null;
  const live = facts.grants.filter(
    (g): g is PilotGrantFact & { cohort: string; expiresAt: Date } =>
      g.userId === facts.userId && g.tier !== 'ACCOUNTANT' && g.cohort !== null && g.revokedAt === null && g.expiresAt !== null && g.expiresAt > now,
  );
  const latest = [...live].sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  if (!latest) return null;
  const starts = facts.grants.filter((g) => g.userId === facts.userId && g.tier !== 'ACCOUNTANT' && g.cohort !== null).map((g) => g.createdAt.getTime());
  return { cohort: latest.cohort, startedAt: new Date(Math.min(...starts)), endsAt: latest.expiresAt, referredByUserId: latest.referredByUserId };
}

/** A profile-plan subscription that covers now (active, trialing or past due, not stale, not paused). */
function payingNow(subscriptions: readonly SubscriptionFact[], now: Date): boolean {
  return profilePlanSubscriptions(subscriptions).some((s) => coveringState(s) !== undefined && !periodOver(s, now) && !pausedNow(s, now));
}

// ---- Expected prices (eng review D4) --------------------------------------------------------------------------------

export interface PilotPlanPrice {
  plan: PlanName;
  /** Minor units, monthly, before VAT; null where the plan has no price in that currency. */
  expectedMonthly: { ILS: number | null; USD: number | null };
}

export interface PilotPlanView extends PilotPlanPrice {
  limits: PlanLimits;
}

const isAmount = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);

/** pilot-prices.json, checked. Anything malformed gives no prices (the panel then shows the plans without one). */
export function parsePilotPrices(raw: unknown): PilotPlanPrice[] {
  const plans = (raw as { plans?: unknown } | null | undefined)?.plans;
  if (!Array.isArray(plans)) return [];
  const parsed: PilotPlanPrice[] = [];
  for (const entry of plans as unknown[]) {
    const { plan, monthly } = (entry ?? {}) as { plan?: unknown; monthly?: { ILS?: unknown; USD?: unknown } | null };
    if (!PLAN_NAMES.includes(plan as PlanName) || !monthly || !isAmount(monthly.ILS ?? null) || !isAmount(monthly.USD ?? null)) return [];
    parsed.push({ plan: plan as PlanName, expectedMonthly: { ILS: (monthly.ILS ?? null) as number | null, USD: (monthly.USD ?? null) as number | null } });
  }
  return parsed;
}

/** Each plan's Expected price with its limits, cheapest first, as `pilot.plans` returns them. */
export function pilotPlansOf(prices: readonly PilotPlanPrice[]): PilotPlanView[] {
  return [...prices]
    .sort((a, b) => PLAN_NAMES.indexOf(a.plan) - PLAN_NAMES.indexOf(b.plan))
    .map((p) => ({ plan: p.plan, expectedMonthly: { ...p.expectedMonthly }, limits: { ...PLAN_LIMITS[p.plan] } }));
}

/** Until MUT-761 puts the final prices in, they are marked "Expected" (absent or anything but false reads as expected). */
export const PILOT_PRICES_EXPECTED: boolean = (pricesFile as { expected?: unknown }).expected !== false;

/** The shipped file, read once. */
export const PILOT_PRICES: readonly PilotPlanPrice[] = parsePilotPrices(pricesFile);
