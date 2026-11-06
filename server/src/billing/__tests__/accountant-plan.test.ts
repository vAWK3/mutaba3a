import { describe, expect, it } from 'vitest';
import {
  ACCOUNTANT_PLAN_OFF,
  clientBooksSummaryOf,
  clientCapOf,
  planCovers,
  readableClientIds,
  resolveAccountantPlan,
  type AccountantPlan,
  type AccountantPlanConfig,
  type AccountantPlanFacts,
} from '../accountant-plan.js';
import { PERIOD_GRACE_DAYS, profileFacts, profilePlanSubscriptions, resolveEntitlement, type GrantFact, type ProfileFacts, type SubscriptionFact } from '../entitlement.js';

/** MUT-565 (ADR-251): the Accountant plan of one person, the cap rule, and the filter that keeps it off their profiles. */
const NOW = new Date('2026-11-08T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);
const ME = 'user-accountant';
const OTHER = 'user-other';
const ON: AccountantPlanConfig = { on: true, freeClients: 3, maxClients: 100 };

function sub(partial: Partial<SubscriptionFact & { cancelAtPeriodEnd: boolean }> = {}): SubscriptionFact & { cancelAtPeriodEnd: boolean } {
  return { userId: ME, organizationId: null, tier: 'ACCOUNTANT', status: 'active', currentPeriodEnd: daysFromNow(20), cancelAtPeriodEnd: false, ...partial };
}
function grant(partial: Partial<GrantFact> = {}): GrantFact {
  return { userId: ME, organizationId: null, tier: 'ACCOUNTANT', expiresAt: null, revokedAt: null, ...partial };
}
const facts = (partial: Partial<AccountantPlanFacts> = {}): AccountantPlanFacts => ({ subscriptions: [], grants: [], ...partial });
const plan = (partial: Partial<AccountantPlan> = {}): AccountantPlan => ({ state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, ...partial });

describe('resolveAccountantPlan (T1)', () => {
  it('NONE with nothing, and with only Freelancer or Firm facts', () => {
    expect(resolveAccountantPlan(ME, facts(), NOW)).toEqual(plan());
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ tier: 'FREELANCER' })], grants: [grant({ tier: 'FIRM' })] }), NOW)).toEqual(plan());
  });

  it('a live operator grant on the person is ACTIVE/OPERATOR until it expires; expired or revoked is not', () => {
    expect(resolveAccountantPlan(ME, facts({ grants: [grant()] }), NOW)).toEqual(plan({ state: 'ACTIVE', source: 'OPERATOR' }));
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ expiresAt: daysFromNow(5) })] }), NOW)).toEqual(plan({ state: 'ACTIVE', source: 'OPERATOR', until: daysFromNow(5) }));
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ expiresAt: daysFromNow(-1) })] }), NOW).state).toBe('NONE');
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ revokedAt: daysFromNow(-1) })] }), NOW).state).toBe('NONE');
  });

  it('the longest grant wins (no expiry beats any expiry)', () => {
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ expiresAt: daysFromNow(5) }), grant()] }), NOW).until).toBeNull();
  });

  it('only the person’s own facts count: another person’s grant or subscription, or an organization grant, never', () => {
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ userId: OTHER })], subscriptions: [sub({ userId: OTHER })] }), NOW).state).toBe('NONE');
    expect(resolveAccountantPlan(ME, facts({ grants: [grant({ userId: null, organizationId: 'org-1' })] }), NOW).state).toBe('NONE');
  });

  it('a covering subscription: active and trialing are ACTIVE, past_due is GRACE; until its period end', () => {
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub()] }), NOW)).toEqual(plan({ state: 'ACTIVE', source: 'STRIPE', until: daysFromNow(20) }));
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ status: 'trialing' })] }), NOW).state).toBe('ACTIVE');
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ status: 'past_due' })] }), NOW)).toEqual(plan({ state: 'GRACE', source: 'STRIPE', until: daysFromNow(20) }));
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ cancelAtPeriodEnd: true })] }), NOW).cancelAtPeriodEnd).toBe(true);
  });

  it('unpaid, canceled, paused, a pause running now, or a period over by the grace days are LAPSED', () => {
    for (const status of ['unpaid', 'canceled', 'paused']) expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ status })] }), NOW)).toEqual(plan({ state: 'LAPSED', source: 'STRIPE' }));
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ pausedFrom: daysFromNow(-1), pauseResumesAt: null })] }), NOW).state).toBe('LAPSED');
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ currentPeriodEnd: daysFromNow(-PERIOD_GRACE_DAYS) })] }), NOW).state).toBe('LAPSED');
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ currentPeriodEnd: daysFromNow(-PERIOD_GRACE_DAYS + 1) })] }), NOW).state).toBe('ACTIVE');
  });

  it('an abandoned Checkout (incomplete, incomplete_expired) never paid: NONE, not LAPSED', () => {
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ status: 'incomplete' }), sub({ status: 'incomplete_expired' })] }), NOW).state).toBe('NONE');
  });

  it('a grant beats a subscription; ACTIVE beats GRACE between subscriptions', () => {
    expect(resolveAccountantPlan(ME, facts({ grants: [grant()], subscriptions: [sub({ status: 'past_due' })] }), NOW).source).toBe('OPERATOR');
    expect(resolveAccountantPlan(ME, facts({ subscriptions: [sub({ status: 'past_due', currentPeriodEnd: daysFromNow(40) }), sub()] }), NOW).state).toBe('ACTIVE');
  });

  it('planCovers: ACTIVE and GRACE only', () => {
    expect(['NONE', 'ACTIVE', 'GRACE', 'LAPSED'].map((state) => planCovers(plan({ state: state as AccountantPlan['state'] })))).toEqual([false, true, true, false]);
  });
});

describe('the profile filter (T2): an ACCOUNTANT fact never reaches a profile', () => {
  const PERSONAL: ProfileFacts = { organizationId: 'org-personal', ownerUserId: ME, malafatConnected: false };
  const trialStarts = new Map([[ME, null]]);

  it('an ACCOUNTANT subscription or grant leaves the accountant’s personal profile as it was (no trial: READ_ONLY/NONE)', () => {
    const before = resolveEntitlement(PERSONAL, { subscriptions: [], grants: [], trialStarts }, NOW);
    expect(before).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
    expect(resolveEntitlement(PERSONAL, { subscriptions: [sub()], grants: [grant()], trialStarts }, NOW)).toEqual(before);
  });

  it('a lapsed ACCOUNTANT subscription never flips everPaid: a trial past day 30 still locks', () => {
    const trialled = new Map([[ME, daysFromNow(-40)]]);
    const locked = resolveEntitlement(PERSONAL, { subscriptions: [], grants: [], trialStarts: trialled }, NOW);
    expect(locked.state).toBe('LOCKED');
    expect(resolveEntitlement(PERSONAL, { subscriptions: [sub({ status: 'canceled' })], grants: [], trialStarts: trialled }, NOW)).toEqual(locked);
  });

  it('a Freelancer subscription beside it still covers the profile', () => {
    expect(resolveEntitlement(PERSONAL, { subscriptions: [sub(), sub({ tier: 'FREELANCER' })], grants: [], trialStarts }, NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER' });
  });

  it('profileFacts and profilePlanSubscriptions keep every other tier, in order', () => {
    const subs = [sub({ tier: 'FREELANCER' }), sub(), sub({ tier: 'FIRM' })];
    expect(profilePlanSubscriptions(subs).map((s) => s.tier)).toEqual(['FREELANCER', 'FIRM']);
    const f = profileFacts({ subscriptions: subs, grants: [grant(), grant({ tier: 'FREELANCER' })], trialStarts });
    expect(f.subscriptions.map((s) => s.tier)).toEqual(['FREELANCER', 'FIRM']);
    expect(f.grants.map((g) => g.tier)).toEqual(['FREELANCER']);
    expect(f.trialStarts).toBe(trialStarts);
  });
});

describe('the cap rule (T3)', () => {
  const g = (id: string, acceptedMinute: number) => ({ id, acceptedAt: new Date(Date.UTC(2026, 10, 1, 9, acceptedMinute)) });

  it('off: no cap whatever the plan', () => {
    expect(clientCapOf(plan(), ACCOUNTANT_PLAN_OFF)).toBeNull();
    expect(clientCapOf(plan({ state: 'ACTIVE' }), { ...ON, on: false })).toBeNull();
  });

  it('on: the free 3 without a covering plan, the ceiling with one', () => {
    expect(clientCapOf(plan(), ON)).toBe(3);
    expect(clientCapOf(plan({ state: 'LAPSED' }), ON)).toBe(3);
    expect(clientCapOf(plan({ state: 'ACTIVE' }), ON)).toBe(100);
    expect(clientCapOf(plan({ state: 'GRACE' }), ON)).toBe(100);
  });

  it('readable: the oldest accepted first, ties by id; null cap reads all', () => {
    const grants = [g('d', 4), g('b', 1), g('a', 1), g('c', 3)];
    expect([...readableClientIds(grants, 3)]).toEqual(['a', 'b', 'c']);
    expect([...readableClientIds(grants, null)].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a revoke of #2 promotes #4 by itself (derived, no state)', () => {
    const grants = [g('one', 1), g('two', 2), g('three', 3), g('four', 4)];
    expect(readableClientIds(grants, 3).has('four')).toBe(false);
    expect(readableClientIds(grants.filter((x) => x.id !== 'two'), 3).has('four')).toBe(true);
  });

  it('clientBooksSummaryOf: count, free limit, cap and readable, with the plan on the wire', () => {
    expect(clientBooksSummaryOf(5, plan(), ON)).toEqual({ count: 5, freeLimit: 3, cap: 3, readable: 3, plan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false } });
    expect(clientBooksSummaryOf(2, plan(), ON).readable).toBe(2);
    expect(clientBooksSummaryOf(5, plan(), ACCOUNTANT_PLAN_OFF)).toMatchObject({ count: 5, cap: null, readable: 5 });
    expect(clientBooksSummaryOf(1, plan({ state: 'ACTIVE', source: 'STRIPE', until: daysFromNow(3) }), ON).plan).toEqual({ state: 'ACTIVE', source: 'STRIPE', until: daysFromNow(3).toISOString(), cancelAtPeriodEnd: false });
  });
});
