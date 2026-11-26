/**
 * MUT-358 (ADR-160, billing-spike.md §4): whether one hosted profile is entitled, and why.
 *
 * The person pays; the profile is what's entitled. Pure: the loader (coverage.ts) gathers the facts, this decides.
 * Rules run in order and the first that matches wins (mut-358-billing-core.md §2.2):
 *
 *   1 MALAFAT   CONNECTED Malafat integration          → ACTIVE (Malafat's add-on pays, MAL-870)
 *   2 OPERATOR  an unrevoked, unexpired grant           → ACTIVE
 *   3 STRIPE    a covering subscription, active/past_due → ACTIVE / GRACE (until its period end + 7 days, MUT-360)
 *   4 TRIAL     trialStartedAt + 14 days > now          → ACTIVE
 *   5 STRIPE    a pause running now (MUT-532)           → READ_ONLY until it resumes, `paused`
 *     STRIPE    a covering subscription that lapsed, or  → READ_ONLY, for good (a payer is never LOCKED)
 *               one whose period + 7 days has passed
 *   6 TRIAL     ended, nobody ever paid                 → READ_ONLY until day 30, then LOCKED
 *   7 NONE      anything else (operator-issued, no trial) → READ_ONLY
 *
 * MUT-731 (ADR-284), with STARTER_PLAN on, rows 5–7 change (the option `starter`):
 *     STARTER   anything else, with an owner              → ACTIVE, tier STARTER (the free plan; never LOCKED)
 *     STRIPE    except: the latest lapse was a deliberate  → READ_ONLY, offering "Continue free on Starter"
 *               cancel after paying, with no Starter choice since
 *     NONE      no owner (an operator firm)               → READ_ONLY
 *
 * MUT-361 enforces it at the door (billing/gate.ts, ADR-181).
 * MUT-702 (ADR-275): tiers rank by plans.ts `RANK` (Firm > Business > Solo = legacy Freelancer); a trial is Business.
 */
import { RANK, type ProfilePlanTier } from './plans.js';

/**
 * MUT-565 (ADR-251): ACCOUNTANT is a person's plan for client books, never a profile's. It lives in the same tables
 * (one mirror, one grant path) and is kept out of every profile reading by `profileFacts` / `profilePlanSubscriptions`.
 */
export type BillingTier = Exclude<ProfilePlanTier, 'STARTER'> | 'ACCOUNTANT';
/** The tiers a profile can be entitled by: the stored ones, and (MUT-731) STARTER, which is never stored. */
export type ProfileBillingTier = ProfilePlanTier;
/** MUT-702 (ADR-275): what a running trial, and the trial's read-only and locked ends, resolve to. */
export const TRIAL_TIER: ProfileBillingTier = 'BUSINESS';
export type EntitlementState = 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'LOCKED';
export type EntitlementSource = 'MALAFAT' | 'OPERATOR' | 'STRIPE' | 'TRIAL' | 'STARTER' | 'NONE';

export interface Entitlement {
  state: EntitlementState;
  source: EntitlementSource;
  tier: ProfileBillingTier | null;
  /** When this state ends, if it is known to: a grant's expiry, a period end, the trial's end or its lock date. */
  until: Date | null;
  /** MUT-532: READ_ONLY because the person paused their plan, until it restarts on `until`. Absent is false. */
  paused?: boolean;
  /**
   * MUT-731 (ADR-284): READ_ONLY because the owner is on Starter with more businesses than it allows and this one isn't
   * the one they keep active (billing/business-cap.ts). Absent is false.
   */
  planLimit?: boolean;
}

/** D3: the trial runs 14 days from `trialStartedAt`; the account is read-only after that and locked from day 30. */
export const TRIAL_DAYS = 14;
export const TRIAL_LOCK_DAYS = 30;
/**
 * MUT-360 review: a covering status counts only until its period ends plus this many days. A mirror that stopped
 * syncing (deleted customer, untagged product, revoked key) then ends in read-only, never in "paid for ever".
 */
export const PERIOD_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialTimeline {
  startedAt: Date;
  /** Day 14: the trial ends and the person's own profiles go read-only (unless something else covers them). */
  endsAt: Date;
  /** Day 30: a person who never paid is locked out, except Subscribe and Download my records. */
  lockAt: Date;
}

/**
 * MUT-361: the trial's dates from `User.trialStartedAt`. With `resolveEntitlement` (source TRIAL: ACTIVE, READ_ONLY,
 * LOCKED) this is what a trial reminder needs (MUT-419: day 11, the end, day 27). One rule, so the mails, Settings ›
 * Billing and the gate can't disagree about a date.
 */
export function trialTimelineOf(startedAt: Date): TrialTimeline {
  return { startedAt, endsAt: addDays(startedAt, TRIAL_DAYS), lockAt: addDays(startedAt, TRIAL_LOCK_DAYS) };
}

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
  /** MUT-532: when a pause takes effect (Stripe keeps the status `active`); null or absent with none set. */
  pausedFrom?: Date | null;
  /** MUT-532: when it ends; null with a pause set means until someone resumes it. */
  pauseResumesAt?: Date | null;
  /** MUT-534: when Stripe ended it; null while it runs. MUT-731 orders lapses by it. */
  endedAt?: Date | null;
  /** MUT-731: Stripe's `trial_end`; null without a trial. */
  trialEnd?: Date | null;
  /** MUT-731: Stripe's `cancellation_details.reason`; null while it runs, or not mirrored yet (read as a deliberate cancel). */
  endedReason?: string | null;
  /** MUT-731: when the row was first mirrored, so a Starter choice made before this subscription doesn't apply to it. */
  createdAt?: Date;
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
  /** MUT-731: owner id → when they chose "Continue free on Starter" (null: never). Absent: nobody chose. */
  starterChosen?: ReadonlyMap<string, Date | null>;
}

/** MUT-731 (ADR-284): the server's STARTER_PLAN. Off resolves exactly as before Starter existed. */
export interface ResolveOptions {
  starter: boolean;
}

/** MUT-731: Stripe ends a trial cancelled at its end seconds after `trial_end`; within a day it never was paid for. */
export const TRIAL_END_TOLERANCE_DAYS = 1;
/** MUT-731: Stripe's reasons that are not the person's own decision (a failed or disputed payment). */
const NOT_CHOSEN_REASONS: ReadonlySet<string> = new Set(['payment_failed', 'payment_disputed']);

export const COVERING_STATUSES: ReadonlyMap<string, 'ACTIVE' | 'GRACE'> = new Map([
  ['active', 'ACTIVE'],
  ['trialing', 'ACTIVE'],
  ['past_due', 'GRACE'],
]);
/** A subscription that was paid for and then stopped. `incomplete_expired` is an abandoned checkout, never paid. */
const LAPSED_STATUSES: ReadonlySet<string> = new Set(['unpaid', 'canceled', 'paused']);
/** Statuses that never meant money changed hands: they neither cover nor count as having paid. */
export const NEVER_PAID_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

/**
 * MUT-565 (ADR-251): the person's subscriptions as a profile plan sees them: without ACCOUNTANT ones. Every reader of
 * "the person's subscription" (Billing's shown plan, the yearly switch, pause and cancel, the offers, the Freelancer
 * Checkout's refusals, the come-back rule) goes through this, so the Accountant plan never stands in for it.
 */
export function profilePlanSubscriptions<T extends { tier?: BillingTier | null }>(subscriptions: readonly T[]): Array<T & { tier: Exclude<T['tier'], 'ACCOUNTANT'> }> {
  return subscriptions.filter((s): s is T & { tier: Exclude<T['tier'], 'ACCOUNTANT'> } => s.tier !== 'ACCOUNTANT');
}

/** MUT-565: the facts with every ACCOUNTANT subscription and grant left out (resolveEntitlement's first line). */
export function profileFacts<F extends BillingFacts>(facts: F): F {
  return { ...facts, subscriptions: profilePlanSubscriptions(facts.subscriptions), grants: facts.grants.filter((g) => g.tier !== 'ACCOUNTANT') };
}

type ProfileSubscriptionFact = SubscriptionFact & { tier: ProfileBillingTier };
type ProfileGrantFact = GrantFact & { tier: ProfileBillingTier };

export function resolveEntitlement(profile: ProfileFacts, allFacts: BillingFacts, now: Date, options: ResolveOptions = { starter: false }): Entitlement {
  // MUT-565: the Accountant plan is the person's, for client books: it never entitles their own profiles.
  const filtered = profileFacts(allFacts);
  const facts = { ...filtered, subscriptions: filtered.subscriptions as readonly ProfileSubscriptionFact[], grants: filtered.grants as readonly ProfileGrantFact[] };
  if (profile.malafatConnected) return { state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null };

  const grant = bestGrant(facts.grants.filter((g) => grantCovers(g, profile) && grantIsLive(g, now)));
  if (grant) return { state: 'ACTIVE', source: 'OPERATOR', tier: grant.tier, until: grant.expiresAt };

  const subscriptions = facts.subscriptions.filter((s) => subscriptionCovers(s, profile));
  const covering = bestSubscription(subscriptions.filter((s) => coveringState(s) !== undefined && !periodOver(s, now) && !pausedNow(s, now)));
  if (covering) return { state: coveringState(covering)!, source: 'STRIPE', tier: covering.tier, until: covering.currentPeriodEnd };

  const trialStartedAt = profile.ownerUserId ? (facts.trialStarts.get(profile.ownerUserId) ?? null) : null;
  const trialEnd = trialStartedAt && trialTimelineOf(trialStartedAt).endsAt;
  if (trialEnd && now < trialEnd) return { state: 'ACTIVE', source: 'TRIAL', tier: TRIAL_TIER, until: trialEnd };

  // MUT-532: before the lapse and the trial lock, so a pause is never LOCKED and says when it restarts.
  const paused = bestSubscription(subscriptions.filter((s) => pausedNow(s, now)));
  if (paused) return { state: 'READ_ONLY', source: 'STRIPE', tier: paused.tier, until: paused.pauseResumesAt ?? null, paused: true };

  const lapsedAll = subscriptions.filter((s) => LAPSED_STATUSES.has(s.status) || (coveringState(s) !== undefined && periodOver(s, now)));
  if (options.starter) return starterOrReadOnly(profile, lapsedAll, facts.starterChosen?.get(profile.ownerUserId ?? '') ?? null);

  const lapsed = bestSubscription(lapsedAll);
  if (lapsed) return { state: 'READ_ONLY', source: 'STRIPE', tier: lapsed.tier, until: null };

  const everPaid = subscriptions.some((s) => !NEVER_PAID_STATUSES.has(s.status));
  if (trialStartedAt && !everPaid) {
    const { lockAt } = trialTimelineOf(trialStartedAt);
    return now < lockAt
      ? { state: 'READ_ONLY', source: 'TRIAL', tier: TRIAL_TIER, until: lockAt }
      : { state: 'LOCKED', source: 'TRIAL', tier: TRIAL_TIER, until: null };
  }
  return { state: 'READ_ONLY', source: 'NONE', tier: null, until: null };
}

export const STARTER_ENTITLEMENT: Readonly<Entitlement> = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null };

/**
 * MUT-731 (brief §2 rows 6–8): nothing covers the profile now. Starter, unless the most recent lapse (by when it ended,
 * not by rank) was a deliberate cancel of a plan that was paid for, and the person hasn't chosen Starter since that
 * subscription began: then read-only, as before, and the read-only screen offers Starter. No owner: no person to be on
 * Starter, read-only.
 */
function starterOrReadOnly(profile: ProfileFacts, lapsed: readonly ProfileSubscriptionFact[], starterChosenAt: Date | null): Entitlement {
  if (profile.ownerUserId === null) {
    const any = bestSubscription(lapsed);
    return { state: 'READ_ONLY', source: any ? 'STRIPE' : 'NONE', tier: any?.tier ?? null, until: null };
  }
  const latest = [...lapsed].sort((a, b) => endedTime(b) - endedTime(a))[0];
  if (latest && deliberateCancelAfterPaying(latest) && !(starterChosenAt && latest.createdAt && starterChosenAt >= latest.createdAt)) {
    return { state: 'READ_ONLY', source: 'STRIPE', tier: latest.tier, until: null };
  }
  return { ...STARTER_ENTITLEMENT };
}

function endedTime(s: SubscriptionFact): number {
  return (s.endedAt ?? s.currentPeriodEnd).getTime();
}

/**
 * A lapse the person chose, after money changed hands. Not: a failed or disputed payment (`unpaid`, or the reason says
 * so), Stripe's own `paused` (a trial that ended with no card), or a trial cancelled before it was paid (ended within a
 * day of `trial_end`). A reason not mirrored yet (null) counts as chosen: read-only, never a silent free plan.
 */
function deliberateCancelAfterPaying(s: SubscriptionFact): boolean {
  if (s.status === 'unpaid' || s.status === 'paused') return false;
  if (s.endedReason && NOT_CHOSEN_REASONS.has(s.endedReason)) return false;
  const trialEnd = s.trialEnd ?? null;
  if (trialEnd && s.endedAt && s.endedAt.getTime() <= addDays(trialEnd, TRIAL_END_TOLERANCE_DAYS).getTime()) return false;
  return true;
}

function grantCovers(grant: GrantFact, profile: ProfileFacts): boolean {
  if (grant.organizationId !== null) return grant.organizationId === profile.organizationId;
  return grant.userId !== null && grant.userId === profile.ownerUserId;
}

export function grantIsLive(grant: Pick<GrantFact, 'revokedAt' | 'expiresAt'>, now: Date): boolean {
  return grant.revokedAt === null && (grant.expiresAt === null || grant.expiresAt > now);
}

/** The highest-ranked tier (plans.ts RANK), then the one that lasts longest (no expiry beats any expiry). */
function bestGrant<G extends GrantFact>(grants: readonly G[]): G | undefined {
  const lasts = (g: G) => g.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...grants].sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || lasts(b) - lasts(a))[0];
}

/**
 * The payer's own profiles are covered by all their subscriptions (Firm includes Freelancer); a tied organization by
 * its own, but only when nobody owns it (an operator firm) or the payer does (MUT-360 D8/D9: the tie is typed by hand
 * in Stripe, so a wrong but real id must not cover a stranger's profile). Read time, so a later link needs no re-sync.
 */
function subscriptionCovers(subscription: SubscriptionFact, profile: ProfileFacts): boolean {
  const paidByOwner = subscription.userId !== null && subscription.userId === profile.ownerUserId;
  if (subscription.organizationId === profile.organizationId) return profile.ownerUserId === null || paidByOwner;
  return paidByOwner;
}

/** ACTIVE before GRACE, then the highest-ranked tier (plans.ts RANK), then the later period end. */
export function bestSubscription<S extends SubscriptionFact>(subscriptions: readonly S[]): S | undefined {
  const stateRank = (s: S) => (coveringState(s) === 'ACTIVE' ? 1 : 0);
  return [...subscriptions].sort(
    (a, b) => stateRank(b) - stateRank(a) || tierRank(b.tier) - tierRank(a.tier) || b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime(),
  )[0];
}

/** Past the period end plus PERIOD_GRACE_DAYS: Stripe would have renewed or ended it by now, so the row is stale. */
export function periodOver(subscription: Pick<SubscriptionFact, 'currentPeriodEnd'>, now: Date): boolean {
  return addDays(subscription.currentPeriodEnd, PERIOD_GRACE_DAYS) <= now;
}

/** MUT-532: from `pausedFrom` (inclusive) to `pauseResumesAt` (exclusive), or for good with no end. */
export function pausedNow(subscription: Pick<SubscriptionFact, 'pausedFrom' | 'pauseResumesAt'>, now: Date): boolean {
  const from = subscription.pausedFrom ?? null;
  if (from === null || now < from) return false;
  const until = subscription.pauseResumesAt ?? null;
  return until === null || now < until;
}

export function coveringState(subscription: Pick<SubscriptionFact, 'status'>): 'ACTIVE' | 'GRACE' | undefined {
  return COVERING_STATUSES.get(subscription.status);
}

/** MUT-702: plans.ts RANK; ACCOUNTANT is never a profile's plan (profileFacts leaves it out), so it ranks below all. */
function tierRank(tier: BillingTier): number {
  return tier === 'ACCOUNTANT' ? 0 : RANK[tier];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
