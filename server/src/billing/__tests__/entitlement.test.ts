import { describe, expect, it } from 'vitest';
import {
  PERIOD_GRACE_DAYS,
  resolveEntitlement,
  TRIAL_DAYS,
  TRIAL_LOCK_DAYS,
  type BillingFacts,
  type GrantFact,
  type ProfileFacts,
  type SubscriptionFact,
} from '../entitlement.js';

/** MUT-358 (ADR-160, billing-spike.md §4.3): which profile is covered, by what, and in which state. */
const NOW = new Date('2026-11-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);

const OWNER = 'user-owner';
const OTHER = 'user-other';
const PERSONAL: ProfileFacts = { organizationId: 'org-personal', ownerUserId: OWNER, malafatConnected: false };
const BUSINESS: ProfileFacts = { organizationId: 'org-business', ownerUserId: OWNER, malafatConnected: false };
const FIRM_BY_OPERATOR: ProfileFacts = { organizationId: 'org-firm', ownerUserId: null, malafatConnected: false };

function facts(partial: Partial<BillingFacts> = {}): BillingFacts {
  return { subscriptions: [], grants: [], trialStarts: new Map(), ...partial };
}

function sub(partial: Partial<SubscriptionFact>): SubscriptionFact {
  return { userId: OWNER, organizationId: null, tier: 'FREELANCER', status: 'active', currentPeriodEnd: daysFromNow(20), ...partial };
}

function grant(partial: Partial<GrantFact>): GrantFact {
  return { userId: OWNER, organizationId: null, tier: 'FREELANCER', expiresAt: null, revokedAt: null, ...partial };
}

describe('resolveEntitlement', () => {
  describe('MALAFAT', () => {
    it('covers a Malafat-connected profile ahead of everything else', () => {
      const malafat = { ...FIRM_BY_OPERATOR, malafatConnected: true };
      const result = resolveEntitlement(malafat, facts({ subscriptions: [sub({ organizationId: malafat.organizationId, status: 'canceled' })] }), NOW);
      expect(result).toEqual({ state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null });
    });
  });

  describe('OPERATOR', () => {
    it('covers the owner’s profiles through a grant on the person', () => {
      expect(resolveEntitlement(BUSINESS, facts({ grants: [grant({})] }), NOW)).toEqual({ state: 'ACTIVE', source: 'OPERATOR', tier: 'FREELANCER', until: null });
    });

    it('covers an operator firm through a grant on the organization, until it expires', () => {
      const until = daysFromNow(10);
      const firmGrant = grant({ userId: null, organizationId: FIRM_BY_OPERATOR.organizationId, tier: 'FIRM', expiresAt: until });
      expect(resolveEntitlement(FIRM_BY_OPERATOR, facts({ grants: [firmGrant] }), NOW)).toEqual({ state: 'ACTIVE', source: 'OPERATOR', tier: 'FIRM', until });
    });

    it('ignores an expired grant and a revoked one', () => {
      const lapsed = [grant({ expiresAt: daysFromNow(-1) }), grant({ revokedAt: daysFromNow(-2) })];
      expect(resolveEntitlement(BUSINESS, facts({ grants: lapsed }), NOW)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
    });

    it('ignores another person’s grant', () => {
      expect(resolveEntitlement(BUSINESS, facts({ grants: [grant({ userId: OTHER })] }), NOW).source).toBe('NONE');
    });

    it('prefers a grant with no expiry over one that ends', () => {
      const result = resolveEntitlement(BUSINESS, facts({ grants: [grant({ expiresAt: daysFromNow(3) }), grant({})] }), NOW);
      expect(result.until).toBeNull();
    });
  });

  describe('STRIPE', () => {
    it('a Freelancer subscription covers every profile the payer owns', () => {
      const f = facts({ subscriptions: [sub({})] });
      for (const profile of [PERSONAL, BUSINESS]) {
        expect(resolveEntitlement(profile, f, NOW)).toEqual({ state: 'ACTIVE', source: 'STRIPE', tier: 'FREELANCER', until: daysFromNow(20) });
      }
    });

    it('a Freelancer subscription does not cover a firm its payer is only a member of', () => {
      expect(resolveEntitlement(FIRM_BY_OPERATOR, facts({ subscriptions: [sub({})] }), NOW).source).toBe('NONE');
    });

    it('a Firm subscription covers its organization and the payer’s own profiles (Firm includes Freelancer)', () => {
      const firm = sub({ userId: OTHER, organizationId: FIRM_BY_OPERATOR.organizationId, tier: 'FIRM' });
      const payerOwn: ProfileFacts = { organizationId: 'org-other-personal', ownerUserId: OTHER, malafatConnected: false };
      expect(resolveEntitlement(FIRM_BY_OPERATOR, facts({ subscriptions: [firm] }), NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FIRM' });
      expect(resolveEntitlement(payerOwn, facts({ subscriptions: [firm] }), NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FIRM' });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [firm] }), NOW).source).toBe('NONE');
    });

    // MUT-360 D8/D9: Stripe metadata names the organization by hand, so a tie only counts on a firm the payer owns
    // (or an owner-less operator firm), checked here at read time so a later `billing link` needs no re-sync.
    it('a subscription tied to someone else’s owned profile does not cover it', () => {
      const tiedByStranger = sub({ userId: OTHER, organizationId: BUSINESS.organizationId, tier: 'FIRM' });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [tiedByStranger] }), NOW).source).toBe('NONE');
    });

    it('an unlinked customer’s tie covers an operator firm but not an owned profile, until the payer is linked', () => {
      const unlinkedFirm = sub({ userId: null, organizationId: FIRM_BY_OPERATOR.organizationId, tier: 'FIRM' });
      expect(resolveEntitlement(FIRM_BY_OPERATOR, facts({ subscriptions: [unlinkedFirm] }), NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FIRM' });
      const unlinkedOwned = sub({ userId: null, organizationId: BUSINESS.organizationId, tier: 'FIRM' });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [unlinkedOwned] }), NOW).source).toBe('NONE');
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [{ ...unlinkedOwned, userId: OWNER }] }), NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE', tier: 'FIRM' });
    });

    it('a lapsed tie to someone else’s owned profile does not count as having paid for it', () => {
      const lapsedStranger = sub({ userId: OTHER, organizationId: BUSINESS.organizationId, status: 'canceled' });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsedStranger] }), NOW).source).toBe('NONE');
    });

    // MUT-360 review: a mirror that stopped syncing (a deleted customer, an untagged product, a dead key) must not
    // cover for ever. A covering status counts only until its period ends plus PERIOD_GRACE_DAYS.
    it('an active subscription past its period plus the grace no longer covers: read-only, as a lapse', () => {
      const stale = sub({ currentPeriodEnd: daysFromNow(-(PERIOD_GRACE_DAYS + 1)) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [stale] }), NOW)).toEqual({ state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null });
      const inGrace = sub({ currentPeriodEnd: daysFromNow(-(PERIOD_GRACE_DAYS - 1)) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [inGrace] }), NOW)).toMatchObject({ state: 'ACTIVE', source: 'STRIPE' });
      const pastDue = sub({ status: 'past_due', currentPeriodEnd: daysFromNow(-(PERIOD_GRACE_DAYS + 1)) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [pastDue] }), NOW)).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE' });
    });

    it('a stale active row never makes someone LOCKED: having paid still counts', () => {
      const stale = sub({ currentPeriodEnd: daysFromNow(-90) });
      const f = facts({ subscriptions: [stale], trialStarts: new Map([[OWNER, daysFromNow(-60)]]) });
      expect(resolveEntitlement(BUSINESS, f, NOW).state).toBe('READ_ONLY');
    });

    // TD-193 (Basel's open decision): coverage follows the creator, so a co-owner's tie to the shared firm covers
    // nothing yet. Pinned so a change to that rule is a decision, not an accident.
    it('a co-owner paying for a firm they don’t create is not counted (TD-193)', () => {
      const coOwned: ProfileFacts = { organizationId: 'org-shared', ownerUserId: OWNER, malafatConnected: false };
      const byCoOwner = sub({ userId: OTHER, organizationId: 'org-shared', tier: 'FIRM' });
      expect(resolveEntitlement(coOwned, facts({ subscriptions: [byCoOwner] }), NOW).source).toBe('NONE');
    });

    it('treats trialing as active', () => {
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [sub({ status: 'trialing' })] }), NOW).state).toBe('ACTIVE');
    });

    it('past_due is GRACE', () => {
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [sub({ status: 'past_due' })] }), NOW)).toEqual({
        state: 'GRACE',
        source: 'STRIPE',
        tier: 'FREELANCER',
        until: daysFromNow(20),
      });
    });

    it('ACTIVE beats GRACE, and FIRM beats FREELANCER on a tie', () => {
      const graceFirm = sub({ status: 'past_due', tier: 'FIRM' });
      const activeFreelancer = sub({});
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [graceFirm, activeFreelancer] }), NOW)).toMatchObject({ state: 'ACTIVE', tier: 'FREELANCER' });
      const activeFirm = sub({ tier: 'FIRM', currentPeriodEnd: daysFromNow(5) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [activeFreelancer, activeFirm] }), NOW)).toMatchObject({ tier: 'FIRM', until: daysFromNow(5) });
    });

    it('a lapsed paid subscription leaves the profile read-only for good', () => {
      for (const status of ['unpaid', 'canceled', 'paused']) {
        expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [sub({ status })] }), NOW)).toEqual({ state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null });
      }
    });

    it('ignores an incomplete subscription (checkout still in progress)', () => {
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [sub({ status: 'incomplete' })] }), NOW).source).toBe('NONE');
    });
  });

  describe('TRIAL (D3: 14 days active, read-only until day 30, then locked)', () => {
    const started = (days: number) => facts({ trialStarts: new Map([[OWNER, daysFromNow(-days)]]) });
    const end = (days: number) => daysFromNow(TRIAL_DAYS - days);
    const lock = (days: number) => daysFromNow(TRIAL_LOCK_DAYS - days);

    it('is ACTIVE from the start until just before day 14', () => {
      expect(resolveEntitlement(BUSINESS, started(0), NOW)).toEqual({ state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: end(0) });
      expect(resolveEntitlement(BUSINESS, started(13.99), NOW)).toMatchObject({ state: 'ACTIVE', source: 'TRIAL' });
    });

    it('is READ_ONLY from day 14 until the lock on day 30', () => {
      expect(resolveEntitlement(BUSINESS, started(14), NOW)).toEqual({ state: 'READ_ONLY', source: 'TRIAL', tier: 'FREELANCER', until: lock(14) });
      expect(resolveEntitlement(BUSINESS, started(29.99), NOW)).toMatchObject({ state: 'READ_ONLY', source: 'TRIAL' });
    });

    it('is LOCKED from day 30', () => {
      expect(resolveEntitlement(BUSINESS, started(TRIAL_LOCK_DAYS), NOW)).toEqual({ state: 'LOCKED', source: 'TRIAL', tier: 'FREELANCER', until: null });
    });

    it('a person who once paid is never LOCKED, however old their trial (AC2)', () => {
      const paidThenCanceled = facts({ subscriptions: [sub({ status: 'canceled' })], trialStarts: new Map([[OWNER, daysFromNow(-90)]]) });
      expect(resolveEntitlement(BUSINESS, paidThenCanceled, NOW)).toEqual({ state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null });
    });

    it('an expired checkout (incomplete_expired) is not paying, so the old trial still locks', () => {
      const neverPaid = facts({ subscriptions: [sub({ status: 'incomplete_expired' })], trialStarts: new Map([[OWNER, daysFromNow(-40)]]) });
      expect(resolveEntitlement(BUSINESS, neverPaid, NOW).state).toBe('LOCKED');
    });

    it('a running trial wins over a lapsed subscription', () => {
      const f = facts({ subscriptions: [sub({ status: 'canceled' })], trialStarts: new Map([[OWNER, daysFromNow(-1)]]) });
      expect(resolveEntitlement(BUSINESS, f, NOW)).toMatchObject({ state: 'ACTIVE', source: 'TRIAL' });
    });

    it('an operator firm with no owner never trials', () => {
      expect(resolveEntitlement(FIRM_BY_OPERATOR, facts(), NOW)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
    });
  });

  describe('NONE', () => {
    it('an operator-issued account with no trial and no coverage is READ_ONLY, never LOCKED', () => {
      expect(resolveEntitlement(BUSINESS, facts({ trialStarts: new Map([[OWNER, null]]) }), NOW)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
    });
  });
});

describe('trialTimelineOf (MUT-361, read by MUT-419)', () => {
  it('ends the trial on day 14 and locks on day 30', async () => {
    const { trialTimelineOf } = await import('../entitlement.js');
    const startedAt = new Date('2026-10-01T09:00:00.000Z');
    expect(trialTimelineOf(startedAt)).toEqual({
      startedAt,
      endsAt: new Date('2026-10-15T09:00:00.000Z'),
      lockAt: new Date('2026-10-31T09:00:00.000Z'),
    });
  });
});
