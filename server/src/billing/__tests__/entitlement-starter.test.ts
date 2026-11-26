import { describe, expect, it } from 'vitest';
import { resolveEntitlement, TRIAL_DAYS, type BillingFacts, type GrantFact, type ProfileFacts, type SubscriptionFact } from '../entitlement.js';

/**
 * MUT-731 (ADR-284, brief §2): with STARTER_PLAN on, a person nothing else covers is ACTIVE on Starter, unless their
 * latest lapse was a deliberate cancel after paying with no Starter choice since. Off: today's answers, unchanged.
 */
const NOW = new Date('2026-12-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const OWNER = 'user-owner';
const BUSINESS: ProfileFacts = { organizationId: 'org-business', ownerUserId: OWNER, malafatConnected: false };
const FIRM_BY_OPERATOR: ProfileFacts = { organizationId: 'org-firm', ownerUserId: null, malafatConnected: false };
const ON = { starter: true };
const OFF = { starter: false };
const STARTER = { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null };

function facts(partial: Partial<BillingFacts> = {}): BillingFacts {
  return { subscriptions: [], grants: [], trialStarts: new Map(), ...partial };
}

/** A paid Solo-era subscription (FREELANCER stands in for any paid tier) that lapsed `endedDaysAgo`. */
function lapsed(partial: Partial<SubscriptionFact> = {}): SubscriptionFact {
  return {
    userId: OWNER,
    organizationId: null,
    tier: 'FREELANCER',
    status: 'canceled',
    currentPeriodEnd: daysAgo(10),
    endedAt: daysAgo(10),
    endedReason: 'cancellation_requested',
    trialEnd: null,
    createdAt: daysAgo(100),
    ...partial,
  };
}

function grant(partial: Partial<GrantFact>): GrantFact {
  return { userId: OWNER, organizationId: null, tier: 'SOLO', expiresAt: null, revokedAt: null, ...partial };
}

describe('resolveEntitlement with Starter (MUT-731)', () => {
  it('an owner with nothing at all is ACTIVE on Starter; off, read-only NONE as before', () => {
    expect(resolveEntitlement(BUSINESS, facts(), NOW, ON)).toEqual(STARTER);
    expect(resolveEntitlement(BUSINESS, facts(), NOW, OFF)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
  });

  it('defaults to off when no option is given (every caller before MUT-731)', () => {
    expect(resolveEntitlement(BUSINESS, facts(), NOW).source).toBe('NONE');
  });

  it('a covering subscription, a grant, Malafat and a running legacy trial still win', () => {
    expect(resolveEntitlement(BUSINESS, facts({ grants: [grant({})] }), NOW, ON).source).toBe('OPERATOR');
    expect(resolveEntitlement({ ...BUSINESS, malafatConnected: true }, facts(), NOW, ON).source).toBe('MALAFAT');
    expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsed({ status: 'active', endedAt: null, endedReason: null, currentPeriodEnd: daysAgo(-20) })] }), NOW, ON).source).toBe('STRIPE');
    expect(resolveEntitlement(BUSINESS, facts({ trialStarts: new Map([[OWNER, daysAgo(3)]]) }), NOW, ON)).toMatchObject({ state: 'ACTIVE', source: 'TRIAL' });
  });

  it('a covering subscription wins over an earlier Starter choice', () => {
    const live = lapsed({ status: 'active', endedAt: null, endedReason: null, currentPeriodEnd: daysAgo(-20) });
    expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [live], starterChosen: new Map([[OWNER, daysAgo(1)]]) }), NOW, ON).source).toBe('STRIPE');
  });

  it('a legacy trial that ended (day 15, and past the day-30 lock) is Starter, never READ_ONLY or LOCKED', () => {
    for (const started of [TRIAL_DAYS + 1, 31]) {
      const f = facts({ trialStarts: new Map([[OWNER, daysAgo(started)]]) });
      expect(resolveEntitlement(BUSINESS, f, NOW, ON)).toEqual(STARTER);
      expect(resolveEntitlement(BUSINESS, f, NOW, OFF).source).toBe('TRIAL');
    }
    expect(resolveEntitlement(BUSINESS, facts({ trialStarts: new Map([[OWNER, daysAgo(31)]]) }), NOW, OFF).state).toBe('LOCKED');
  });

  describe('row 6: lapses that go to Starter', () => {
    const cases: Array<[string, Partial<SubscriptionFact>]> = [
      ['a failed card past grace (canceled, payment_failed)', { endedReason: 'payment_failed' }],
      ['a disputed payment', { endedReason: 'payment_disputed' }],
      ['Stripe’s unpaid status', { status: 'unpaid', endedAt: null, endedReason: null }],
      ['a card-up-front trial cancelled before paying', { trialEnd: daysAgo(12), endedAt: daysAgo(15) }],
      ['a trial cancelled at its end, ended 30 s after trial_end', { trialEnd: daysAgo(10), endedAt: new Date(daysAgo(10).getTime() + 30_000) }],
      ['Stripe’s native paused (a trial ended with no card)', { status: 'paused', endedAt: null, endedReason: null, pausedFrom: null }],
    ];
    for (const [name, partial] of cases) {
      it(name, () => {
        expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsed(partial)] }), NOW, ON)).toEqual(STARTER);
        expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsed(partial)] }), NOW, OFF)).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE' });
      });
    }
  });

  describe('row 7: a deliberate cancel after paying stays read-only', () => {
    it('cancelled by request after the trial → READ_ONLY STRIPE', () => {
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsed({ trialEnd: daysAgo(60) })] }), NOW, ON)).toEqual({ state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null });
    });

    it('a reason not mirrored yet (null) reads as a deliberate cancel', () => {
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [lapsed({ endedReason: null })] }), NOW, ON).state).toBe('READ_ONLY');
    });

    it('Starter chosen after that subscription began → Starter (incl. a choice made before the end, MUT-734)', () => {
      for (const chosen of [daysAgo(1), daysAgo(20)]) {
        const f = facts({ subscriptions: [lapsed()], starterChosen: new Map([[OWNER, chosen]]) });
        expect(resolveEntitlement(BUSINESS, f, NOW, ON)).toEqual(STARTER);
      }
    });

    it('a Starter choice older than the subscription doesn’t apply to it (re-subscribed, then cancelled)', () => {
      const f = facts({ subscriptions: [lapsed({ createdAt: daysAgo(50) })], starterChosen: new Map([[OWNER, daysAgo(80)]]) });
      expect(resolveEntitlement(BUSINESS, f, NOW, ON).state).toBe('READ_ONLY');
    });

    it('the latest lapse decides, not the highest rank', () => {
      const oldFirmFailed = lapsed({ tier: 'FIRM', endedReason: 'payment_failed', endedAt: daysAgo(40), createdAt: daysAgo(200) });
      const newSoloCancelled = lapsed({ tier: 'SOLO', endedAt: daysAgo(5) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [oldFirmFailed, newSoloCancelled] }), NOW, ON)).toMatchObject({ state: 'READ_ONLY', tier: 'SOLO' });
      const oldSoloCancelled = lapsed({ tier: 'SOLO', endedAt: daysAgo(40) });
      const newFirmFailed = lapsed({ tier: 'FIRM', endedReason: 'payment_failed', endedAt: daysAgo(5) });
      expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [oldSoloCancelled, newFirmFailed] }), NOW, ON)).toEqual(STARTER);
    });
  });

  it('row 8: no owner (an operator firm) is READ_ONLY NONE, never Starter', () => {
    expect(resolveEntitlement(FIRM_BY_OPERATOR, facts(), NOW, ON)).toEqual({ state: 'READ_ONLY', source: 'NONE', tier: null, until: null });
  });

  it('a pause running now stays READ_ONLY paused', () => {
    const paused = lapsed({ status: 'active', endedAt: null, endedReason: null, currentPeriodEnd: daysAgo(-30), pausedFrom: daysAgo(2), pauseResumesAt: daysAgo(-20) });
    expect(resolveEntitlement(BUSINESS, facts({ subscriptions: [paused] }), NOW, ON)).toMatchObject({ state: 'READ_ONLY', paused: true });
  });
});
