/**
 * MUT-358 (ADR-160, billing-spike.md §4): whether one hosted profile is entitled, and why.
 *
 * The person pays; the profile is what's entitled. Pure: the loader (coverage.ts) gathers the facts, this decides.
 * Rules run in order and the first that matches wins (mut-358-billing-core.md §2.2):
 *
 *   1 MALAFAT   CONNECTED Malafat integration          → ACTIVE (Malafat's add-on pays, MAL-870)
 *   2 OPERATOR  an unrevoked, unexpired grant           → ACTIVE
 *   3 STRIPE    a covering subscription, active/past_due → ACTIVE / GRACE
 *   4 TRIAL     trialStartedAt + 14 days > now          → ACTIVE
 *   5 STRIPE    a covering subscription that lapsed     → READ_ONLY, for good (a payer is never LOCKED)
 *   6 TRIAL     ended, nobody ever paid                 → READ_ONLY until day 30, then LOCKED
 *   7 NONE      anything else (operator-issued, no trial) → READ_ONLY
 *
 * Nothing enforces this yet: MUT-361 adds the gate.
 */

export type BillingTier = 'FREELANCER' | 'FIRM';
export type EntitlementState = 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'LOCKED';
export type EntitlementSource = 'MALAFAT' | 'OPERATOR' | 'STRIPE' | 'TRIAL' | 'NONE';

export interface Entitlement {
  state: EntitlementState;
  source: EntitlementSource;
  tier: BillingTier | null;
  /** When this state ends, if it is known to: a grant's expiry, a period end, the trial's end or its lock date. */
  until: Date | null;
}

/** D3: the trial runs 14 days from `trialStartedAt`; the account is read-only after that and locked from day 30. */
export const TRIAL_DAYS = 14;
export const TRIAL_LOCK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProfileFacts {
  organizationId: string;
  /** `profileOwnerOf(organization)`: null on an operator-provisioned firm. */
  ownerUserId: string | null;
  malafatConnected: boolean;
}

export interface SubscriptionFact {
  /** The paying person (the subscription's BillingAccount.userId); null while the Stripe customer is unlinked. */
  userId: string | null;
  /** The organization a Firm subscription (or a pilot firm on the Freelancer price) is tied to. */
  organizationId: string | null;
  tier: BillingTier;
  /** Stripe's own status string, kept as Stripe sends it. */
  status: string;
  currentPeriodEnd: Date;
}

export interface GrantFact {
  /** Exactly one of userId (the person's own profiles) and organizationId (that profile) is set. */
  userId: string | null;
  organizationId: string | null;
  tier: BillingTier;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface BillingFacts {
  subscriptions: readonly SubscriptionFact[];
  grants: readonly GrantFact[];
  /** Owner id → trialStartedAt (null: never trialled). A missing owner counts as never trialled. */
  trialStarts: ReadonlyMap<string, Date | null>;
}

const COVERING_STATUSES: Readonly<Record<string, 'ACTIVE' | 'GRACE'>> = { active: 'ACTIVE', trialing: 'ACTIVE', past_due: 'GRACE' };
/** A subscription that was paid for and then stopped. `incomplete_expired` is an abandoned checkout, never paid. */
const LAPSED_STATUSES: ReadonlySet<string> = new Set(['unpaid', 'canceled', 'paused']);
/** Statuses that never meant money changed hands: they neither cover nor count as having paid. */
const NEVER_PAID_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

export function resolveEntitlement(profile: ProfileFacts, facts: BillingFacts, now: Date): Entitlement {
  if (profile.malafatConnected) return { state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null };

  const grant = bestGrant(facts.grants.filter((g) => grantCovers(g, profile) && grantIsLive(g, now)));
  if (grant) return { state: 'ACTIVE', source: 'OPERATOR', tier: grant.tier, until: grant.expiresAt };

  const subscriptions = facts.subscriptions.filter((s) => subscriptionCovers(s, profile));
  const covering = bestSubscription(subscriptions.filter((s) => Object.hasOwn(COVERING_STATUSES, s.status)));
  if (covering) return { state: COVERING_STATUSES[covering.status], source: 'STRIPE', tier: covering.tier, until: covering.currentPeriodEnd };

  const trialStartedAt = profile.ownerUserId ? (facts.trialStarts.get(profile.ownerUserId) ?? null) : null;
  const trialEnd = trialStartedAt && addDays(trialStartedAt, TRIAL_DAYS);
  if (trialEnd && now < trialEnd) return { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: trialEnd };

  const lapsed = bestSubscription(subscriptions.filter((s) => LAPSED_STATUSES.has(s.status)));
  if (lapsed) return { state: 'READ_ONLY', source: 'STRIPE', tier: lapsed.tier, until: null };

  const everPaid = subscriptions.some((s) => !NEVER_PAID_STATUSES.has(s.status));
  if (trialStartedAt && !everPaid) {
    const lockAt = addDays(trialStartedAt, TRIAL_LOCK_DAYS);
    return now < lockAt
      ? { state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: lockAt }
      : { state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null };
  }
  return { state: 'READ_ONLY', source: 'NONE', tier: null, until: null };
}

function grantCovers(grant: GrantFact, profile: ProfileFacts): boolean {
  if (grant.organizationId !== null) return grant.organizationId === profile.organizationId;
  return grant.userId !== null && grant.userId === profile.ownerUserId;
}

function grantIsLive(grant: GrantFact, now: Date): boolean {
  return grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt > now);
}

/** The Firm tier, then the one that lasts longest (no expiry beats any expiry). */
function bestGrant(grants: readonly GrantFact[]): GrantFact | undefined {
  const lasts = (g: GrantFact) => g.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...grants].sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || lasts(b) - lasts(a))[0];
}

/** The payer's own profiles are covered by all their subscriptions (Firm includes Freelancer); a tied organization by its own. */
function subscriptionCovers(subscription: SubscriptionFact, profile: ProfileFacts): boolean {
  if (subscription.organizationId === profile.organizationId) return true;
  return subscription.userId !== null && subscription.userId === profile.ownerUserId;
}

/** ACTIVE before GRACE, then the Firm tier, then the later period end. */
function bestSubscription(subscriptions: readonly SubscriptionFact[]): SubscriptionFact | undefined {
  const stateRank = (s: SubscriptionFact) => (COVERING_STATUSES[s.status] === 'ACTIVE' ? 1 : 0);
  return [...subscriptions].sort(
    (a, b) => stateRank(b) - stateRank(a) || tierRank(b.tier) - tierRank(a.tier) || b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime(),
  )[0];
}

function tierRank(tier: BillingTier): number {
  return tier === 'FIRM' ? 1 : 0;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
