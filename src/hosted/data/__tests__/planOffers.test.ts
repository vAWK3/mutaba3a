import { describe, expect, it } from 'vitest';
import type { BillingOverview } from '../../api/client';
import { eligibleOfferOf, planComebackOf, planLaunchOf, planOfferFor, renewalPriceOf } from '../billingView';

const NOW = new Date('2026-12-01T09:00:00Z');
const solo = {
  plan: 'solo',
  catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } },
  limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
  launch: { id: 'launch-plans-2026', firstYear: { ILS: 19500, USD: null } },
} as NonNullable<BillingOverview['plans']>[number];
const offer = { id: 'launch-plans-2026', percentOff: 50, endsAt: '2027-02-21T22:59:00.000Z', interval: 'year', eligible: true, firstYear: { ILS: 19500, USD: null } };
const overview = (over: Partial<BillingOverview> = {}) =>
  ({ configured: true, subscription: null, trial: null, catalog: { ILS: null, USD: null }, offer, plans: [solo], currentPlan: 'starter', ...over }) as unknown as BillingOverview;

describe('planLaunchOf', () => {
  it('is the plans launch while eligible and some plan has one', () => {
    expect(planLaunchOf(overview())?.id).toBe('launch-plans-2026');
  });
  it('is null when not eligible, not yearly, or no plan has a launch', () => {
    expect(planLaunchOf(overview({ offer: { ...offer, eligible: false } as never }))).toBeNull();
    expect(planLaunchOf(overview({ offer: { ...offer, interval: 'month' } as never }))).toBeNull();
    expect(planLaunchOf(overview({ plans: [{ ...solo, launch: undefined }] as never }))).toBeNull();
  });
});

describe('planOfferFor', () => {
  it('reads the first year from the plan and the list from its catalog', () => {
    expect(planOfferFor(overview(), solo, 'ILS', NOW)).toMatchObject({ id: 'launch-plans-2026', list: 39000, firstYear: 19500, percentOff: 50 });
  });
  it('is null with no currency yet, or no first-year amount in it', () => {
    expect(planOfferFor(overview(), solo, null, NOW)).toBeNull();
    expect(planOfferFor(overview(), solo, 'USD', NOW)).toBeNull();
  });
});

describe('eligibleOfferOf with plans on sale', () => {
  it('is takeable through a plan sold in the currency though the legacy catalog is empty', () => {
    expect(eligibleOfferOf(overview())?.id).toBe('launch-plans-2026');
  });
});

describe('planComebackOf', () => {
  it('is the plan comeback, or null', () => {
    expect(planComebackOf(solo)).toBeNull();
    const comeback = { id: 'comeback-plans-2026', firstMonth: { ILS: 1, USD: 1 }, listMonth: { ILS: 3, USD: 3 }, firstYear: null, listYear: null };
    expect(planComebackOf({ ...solo, comeback } as never)).toEqual(comeback);
  });
});

describe('renewalPriceOf', () => {
  const sub = { tier: 'SOLO', status: 'active', interval: 'year', currency: 'ILS', cancelAtPeriodEnd: false, renewsAtListPrice: true };
  it('a plan subscription renews at its own plan list price', () => {
    expect(renewalPriceOf(overview({ currentPlan: 'solo', subscription: sub as never }))).toEqual({ minor: 39000, currency: 'ILS' });
  });
});
