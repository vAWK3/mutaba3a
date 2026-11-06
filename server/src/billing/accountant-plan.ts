import { bestSubscription, coveringState, grantIsLive, NEVER_PAID_STATUSES, pausedNow, periodOver, type GrantFact, type SubscriptionFact } from './entitlement.js';

/**
 * MUT-565 (ADR-251): the Accountant plan. A person reads up to `freeClients` client books for free; the plan (a Stripe
 * subscription on a product tagged `tier: accountant`, or an operator grant on the person) lifts that to `maxClients`.
 * It is the person's, never a profile's: entitlement.ts leaves every ACCOUNTANT fact out of a profile's coverage.
 * Pure: the routes and selectProfile gather the facts (one `billing.factsFor`), this decides. Same rule order as a
 * profile's: a live grant, then a covering subscription (period + 7 days, not paused), then a once-paid one (LAPSED).
 *
 *   accept ──► clientCapOf(plan) ──► repository counts ACTIVE grants under a lock ──► 402 at the cap
 *   selectProfile ──► rank of the grant (indexed count) < free? ──► else plan ──► 402 outside readableClientIds
 *   /v1/me, /v1/clients ──► clientBooksSummaryOf + readableClientIds (needsPlan)
 */

export type AccountantPlanState = 'NONE' | 'ACTIVE' | 'GRACE' | 'LAPSED';
export type AccountantPlanSource = 'OPERATOR' | 'STRIPE';

export interface AccountantPlan {
  state: AccountantPlanState;
  source: AccountantPlanSource | null;
  /** A grant's expiry or the paid period's end; null with no end known (or nothing). */
  until: Date | null;
  /** The subscription ends at its period end (Customer Portal cancel). False for a grant. */
  cancelAtPeriodEnd: boolean;
}

/** From ACCOUNTANT_PLAN, ACCOUNTANT_FREE_CLIENTS and ACCOUNTANT_PLAN_MAX_CLIENTS (config.ts). */
export interface AccountantPlanConfig {
  /** Off: no cap at all (pilot accountants keep accepting); `clientBooks.cap` is null. */
  on: boolean;
  freeClients: number;
  /** The ceiling with the plan (abuse guard; "Contact us" past it). */
  maxClients: number;
}

export const ACCOUNTANT_FREE_CLIENTS_DEFAULT = 3;
export const ACCOUNTANT_PLAN_MAX_CLIENTS_DEFAULT = 100;
export const ACCOUNTANT_PLAN_OFF: AccountantPlanConfig = { on: false, freeClients: ACCOUNTANT_FREE_CLIENTS_DEFAULT, maxClients: ACCOUNTANT_PLAN_MAX_CLIENTS_DEFAULT };

export interface AccountantPlanFacts {
  subscriptions: readonly (SubscriptionFact & { cancelAtPeriodEnd?: boolean })[];
  grants: readonly GrantFact[];
}

const NO_PLAN: AccountantPlan = { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false };

export function resolveAccountantPlan(userId: string, facts: AccountantPlanFacts, now: Date): AccountantPlan {
  const grants = facts.grants.filter((g) => g.tier === 'ACCOUNTANT' && g.organizationId === null && g.userId === userId && grantIsLive(g, now));
  if (grants.length > 0) {
    const lasts = (g: GrantFact) => g.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const best = [...grants].sort((a, b) => lasts(b) - lasts(a))[0]!;
    return { state: 'ACTIVE', source: 'OPERATOR', until: best.expiresAt, cancelAtPeriodEnd: false };
  }
  const subscriptions = accountantPlanSubscriptions(facts.subscriptions).filter((s) => s.userId === userId);
  const covering = bestSubscription(subscriptions.filter((s) => coveringState(s) !== undefined && !periodOver(s, now) && !pausedNow(s, now)));
  if (covering) return { state: coveringState(covering)!, source: 'STRIPE', until: covering.currentPeriodEnd, cancelAtPeriodEnd: covering.cancelAtPeriodEnd ?? false };
  if (subscriptions.some((s) => !NEVER_PAID_STATUSES.has(s.status))) return { state: 'LAPSED', source: 'STRIPE', until: null, cancelAtPeriodEnd: false };
  return NO_PLAN;
}

/** The ACCOUNTANT subscriptions of a list (the complement of `profilePlanSubscriptions`). */
export function accountantPlanSubscriptions<T extends { tier?: string | null }>(subscriptions: readonly T[]): T[] {
  return subscriptions.filter((s) => s.tier === 'ACCOUNTANT');
}

/** The plan pays now: ACTIVE, or GRACE while Stripe retries a failed card. */
export function planCovers(plan: Pick<AccountantPlan, 'state'>): boolean {
  return plan.state === 'ACTIVE' || plan.state === 'GRACE';
}

/** How many ACTIVE client books the person may hold (and read): null while the flag is off (no cap). */
export function clientCapOf(plan: Pick<AccountantPlan, 'state'>, config: AccountantPlanConfig): number | null {
  if (!config.on) return null;
  return planCovers(plan) ? config.maxClients : config.freeClients;
}

/**
 * The ACTIVE grants the person may read: the `cap` oldest by accept, ties by id. A revoke or leave frees a slot and
 * the next-oldest becomes readable by itself; nothing is stored. Null cap: all.
 */
export function readableClientIds<G extends { id: string; acceptedAt: Date | null }>(activeGrants: readonly G[], cap: number | null): Set<string> {
  const ordered = [...activeGrants].sort((a, b) => (a.acceptedAt?.getTime() ?? 0) - (b.acceptedAt?.getTime() ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Set((cap === null ? ordered : ordered.slice(0, cap)).map((g) => g.id));
}

/** The wire shape of a plan (ISO timestamps). */
export function serializeAccountantPlan(plan: AccountantPlan) {
  return { state: plan.state, source: plan.source, until: plan.until?.toISOString() ?? null, cancelAtPeriodEnd: plan.cancelAtPeriodEnd };
}

/** `/v1/me.clientBooks`: ACTIVE grants, the free limit, the cap (null while off), how many are readable, the plan. No price. */
export function clientBooksSummaryOf(activeCount: number, plan: AccountantPlan, config: AccountantPlanConfig) {
  const cap = clientCapOf(plan, config);
  return { count: activeCount, freeLimit: config.freeClients, cap, readable: cap === null ? activeCount : Math.min(activeCount, cap), plan: serializeAccountantPlan(plan) };
}
