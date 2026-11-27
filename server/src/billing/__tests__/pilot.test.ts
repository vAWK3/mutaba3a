import { describe, expect, it } from 'vitest';
import pricesFile from '../pilot-prices.json' with { type: 'json' };
import { isPilotCohort, parsePilotPrices, PILOT_DEFAULT_DAYS, PILOT_ENDED_SHOWN_DAYS, pilotEndedOf, pilotExpiryOf, pilotOf, pilotPlansOf, type PilotGrantFact } from '../pilot.js';
import type { EntitlementSource, SubscriptionFact } from '../entitlement.js';

/** MUT-752 (ADR-296, plan eng review D1/D4): who is a pilot tester, until when, and the Expected prices. */
const NOW = new Date('2026-12-10T10:00:00Z');
const ME = '00000000-0000-4000-8000-000000000001';
const ACCOUNTANT = '00000000-0000-4000-8000-0000000000aa';

function grant(over: Partial<PilotGrantFact> = {}): PilotGrantFact {
  return { userId: ME, organizationId: null, tier: 'BUSINESS', expiresAt: new Date('2027-01-27T10:00:00Z'), revokedAt: null, cohort: 'dec-2026', referredByUserId: ACCOUNTANT, createdAt: new Date('2026-11-28T10:00:00Z'), ...over };
}

function sub(over: Partial<SubscriptionFact> = {}): SubscriptionFact {
  return { userId: ME, organizationId: null, tier: 'SOLO', status: 'active', currentPeriodEnd: new Date('2027-01-01T00:00:00Z'), ...over };
}

const covered = (...sources: EntitlementSource[]) => ({ userId: ME, subscriptions: [] as SubscriptionFact[], sources });

describe('pilotOf', () => {
  it('a live pilot grant covering the person is a pilot: cohort, end, accountant', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant()] }, NOW)).toEqual({ cohort: 'dec-2026', startedAt: new Date('2026-11-28T10:00:00Z'), endsAt: new Date('2027-01-27T10:00:00Z'), referredByUserId: ACCOUNTANT });
  });

  it('an expired pilot grant is not (the same `now` the entitlement used; the end instant is already over)', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ expiresAt: NOW })] }, NOW)).toBeNull();
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ expiresAt: new Date(NOW.getTime() - 1) })] }, NOW)).toBeNull();
  });

  it('a revoked pilot grant is not', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ revokedAt: new Date('2026-12-01T00:00:00Z') })] }, NOW)).toBeNull();
  });

  it('an ACCOUNTANT grant is never a pilot, even with a cohort', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ tier: 'ACCOUNTANT' })] }, NOW)).toBeNull();
  });

  it('a plain grant (no cohort) is not a pilot', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ cohort: null, referredByUserId: null })] }, NOW)).toBeNull();
  });

  it('with two live pilot grants (an extension), the latest expiry wins', () => {
    const first = grant({ cohort: 'dec-2026', expiresAt: new Date('2027-01-27T10:00:00Z') });
    const extended = grant({ cohort: 'dec-2026-ext', expiresAt: new Date('2027-02-27T10:00:00Z') });
    expect(pilotOf({ ...covered('OPERATOR'), grants: [extended, first] }, NOW)?.endsAt).toEqual(new Date('2027-02-27T10:00:00Z'));
    expect(pilotOf({ ...covered('OPERATOR'), grants: [first, extended] }, NOW)?.cohort).toBe('dec-2026-ext');
  });

  it('MUT-758: the start is the first pilot grant’s, revoked ones included (an extension keeps it)', () => {
    const first = grant({ createdAt: new Date('2026-11-01T10:00:00Z'), revokedAt: new Date('2026-12-01T00:00:00Z') });
    const extended = grant({ createdAt: new Date('2026-12-01T00:00:00Z'), expiresAt: new Date('2027-02-27T10:00:00Z') });
    const plain = grant({ cohort: null, referredByUserId: null, createdAt: new Date('2026-01-01T00:00:00Z') });
    expect(pilotOf({ ...covered('OPERATOR'), grants: [extended, first, plain] }, NOW)?.startedAt).toEqual(new Date('2026-11-01T10:00:00Z'));
  });

  it('a person who also pays (a covering subscription) is not shown a pilot', () => {
    expect(pilotOf({ ...covered('OPERATOR'), subscriptions: [sub()], grants: [grant()] }, NOW)).toBeNull();
    expect(pilotOf({ ...covered('OPERATOR'), subscriptions: [sub({ status: 'past_due' })], grants: [grant()] }, NOW)).toBeNull();
  });

  it('a lapsed, never-paid or long-stale subscription does not hide the pilot', () => {
    for (const s of [sub({ status: 'canceled' }), sub({ status: 'incomplete' }), sub({ currentPeriodEnd: new Date('2026-11-01T00:00:00Z') })]) {
      expect(pilotOf({ ...covered('OPERATOR'), subscriptions: [s], grants: [grant()] }, NOW)).not.toBeNull();
    }
  });

  it('an Accountant-plan subscription is not paying for the profile plan', () => {
    expect(pilotOf({ ...covered('OPERATOR'), subscriptions: [sub({ tier: 'ACCOUNTANT' })], grants: [grant()] }, NOW)).not.toBeNull();
  });

  it('no pilot unless an OPERATOR entitlement covers one of the person’s profiles (Malafat, trial, none)', () => {
    for (const source of ['MALAFAT', 'TRIAL', 'STARTER', 'NONE', 'STRIPE'] as const) {
      expect(pilotOf({ ...covered(source), grants: [grant()] }, NOW)).toBeNull();
    }
    expect(pilotOf({ ...covered('MALAFAT', 'OPERATOR'), grants: [grant()] }, NOW)).not.toBeNull();
  });

  it('only the person’s own grants count: another person’s or a profile grant is not their pilot', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ userId: ACCOUNTANT })] }, NOW)).toBeNull();
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ userId: null, organizationId: '00000000-0000-4000-8000-0000000000bb' })] }, NOW)).toBeNull();
  });

  it('a pilot grant without an expiry (impossible by the CHECK) is ignored rather than shown as never ending', () => {
    expect(pilotOf({ ...covered('OPERATOR'), grants: [grant({ expiresAt: null })] }, NOW)).toBeNull();
  });
});

describe('pilotEndedOf (MUT-753, ADR-330)', () => {
  const DAY = 86_400_000;
  const ended = (at: Date, over: Partial<PilotGrantFact> = {}) => grant({ expiresAt: at, ...over });
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

  it('a pilot that expired is ended: its cohort and the end instant', () => {
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(ago(2))] }, NOW)).toEqual({ cohort: 'dec-2026', endedAt: ago(2) });
    expect(pilotEndedOf({ ...covered('NONE'), grants: [ended(NOW)] }, NOW)).toEqual({ cohort: 'dec-2026', endedAt: NOW });
  });

  it('a revoked pilot ends at the revoke, even when its expiry was later', () => {
    expect(pilotEndedOf({ ...covered('TRIAL'), grants: [grant({ revokedAt: ago(1) })] }, NOW)).toEqual({ cohort: 'dec-2026', endedAt: ago(1) });
  });

  it('the latest end wins when there were several pilot grants', () => {
    const first = ended(ago(20), { cohort: 'dec-2026' });
    const extended = ended(ago(3), { cohort: 'dec-2026-ext' });
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [first, extended] }, NOW)).toEqual({ cohort: 'dec-2026-ext', endedAt: ago(3) });
  });

  it('is null while a pilot runs, for a person who never had one, and for plain or ACCOUNTANT grants', () => {
    expect(pilotEndedOf({ ...covered('OPERATOR'), grants: [grant()] }, NOW)).toBeNull();
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [] }, NOW)).toBeNull();
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(ago(1), { cohort: null })] }, NOW)).toBeNull();
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(ago(1), { tier: 'ACCOUNTANT' })] }, NOW)).toBeNull();
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(ago(1), { userId: ACCOUNTANT })] }, NOW)).toBeNull();
  });

  it('is null once another operator grant covers the person, or they pay', () => {
    expect(pilotEndedOf({ ...covered('OPERATOR'), grants: [ended(ago(1))] }, NOW)).toBeNull();
    expect(pilotEndedOf({ ...covered('STRIPE'), subscriptions: [sub()], grants: [ended(ago(1))] }, NOW)).toBeNull();
  });

  it(`is shown for ${PILOT_ENDED_SHOWN_DAYS} days after the end, then the person is simply on their plan`, () => {
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(ago(PILOT_ENDED_SHOWN_DAYS))] }, NOW)).not.toBeNull();
    expect(pilotEndedOf({ ...covered('STARTER'), grants: [ended(new Date(ago(PILOT_ENDED_SHOWN_DAYS).getTime() - 1))] }, NOW)).toBeNull();
  });
});

describe('pilotExpiryOf', () => {
  it('defaults to 60 days from the grant', () => {
    expect(PILOT_DEFAULT_DAYS).toBe(60);
    expect(pilotExpiryOf(null, NOW)).toEqual(new Date('2027-02-08T10:00:00Z'));
  });

  it('keeps an expiry the operator gave', () => {
    const given = new Date('2027-01-31T22:00:00Z');
    expect(pilotExpiryOf(given, NOW)).toBe(given);
  });
});

describe('isPilotCohort', () => {
  it('accepts a short lowercase slug and refuses names, spaces and capitals (it goes to analytics)', () => {
    for (const ok of ['dec-2026', 'p1', 'acct.nasser_2026-12']) expect(isPilotCohort(ok)).toBe(true);
    for (const bad of ['', 'Dec 2026', 'Rana Haddad', '-dec', 'x'.repeat(65), 'رنا']) expect(isPilotCohort(bad)).toBe(false);
  });
});

describe('pilot prices', () => {
  it('the shipped file gives Solo, Business and Firm, monthly, in minor units (MUT-701, excl. VAT)', () => {
    expect(parsePilotPrices(pricesFile)).toEqual([
      { plan: 'solo', expectedMonthly: { ILS: 3900, USD: 1200 } },
      { plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 } },
      { plan: 'firm', expectedMonthly: { ILS: 24900, USD: 7500 } },
    ]);
  });

  it('a malformed or missing file gives no prices, never a throw', () => {
    for (const raw of [undefined, null, 42, {}, { plans: 'x' }, { plans: [{ plan: 'gold', monthly: { ILS: 1, USD: 1 } }] }, { plans: [{ plan: 'solo', monthly: { ILS: -1, USD: 1 } }] }]) {
      expect(parsePilotPrices(raw)).toEqual([]);
    }
  });

  it('pilot.plans carries each plan’s limits beside its Expected price', () => {
    expect(pilotPlansOf([{ plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 } }])).toEqual([
      { plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
    ]);
  });
});
