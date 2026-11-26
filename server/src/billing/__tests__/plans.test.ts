import { describe, expect, it } from 'vitest';
import {
  changeTimingOf,
  cheapestPlanWith,
  ENFORCED_BUSINESS_CAPS,
  currentPlanOf,
  FREE_PLAN,
  HARD_CAP_PLANS,
  nextPlanAbove,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_NAMES,
  planOfTier,
  RANK,
  TIER_OF,
  type ProfilePlanTier,
  ALL_PLAN_LOOKUP_KEYS,
  listLookupKey,
  planOfLookupKey,
} from '../plans.js';

/** MUT-702 Part A (ADR-275): Solo, Business and Firm as provider-neutral tiers; legacy Freelancer kept. */
describe('plans', () => {
  it('sells Solo, Business and Firm, in rank order', () => {
    expect(PLAN_NAMES).toEqual(['solo', 'business', 'firm']);
  });

  it('maps each plan, and legacy freelancer, to its tier and back', () => {
    expect(TIER_OF).toEqual({ starter: 'STARTER', solo: 'SOLO', business: 'BUSINESS', firm: 'FIRM', freelancer: 'FREELANCER' });
    for (const [plan, tier] of Object.entries(TIER_OF)) expect(planOfTier(tier)).toBe(plan);
  });

  it('ranks Solo = Freelancer < Business < Firm', () => {
    expect(RANK.SOLO).toBe(RANK.FREELANCER);
    expect(RANK.SOLO).toBeLessThan(RANK.BUSINESS);
    expect(RANK.BUSINESS).toBeLessThan(RANK.FIRM);
    expect(Object.keys(RANK).sort()).toEqual(['BUSINESS', 'FIRM', 'FREELANCER', 'SOLO', 'STARTER']);
  });

  describe('changeTimingOf: up now, same or lower rank at the period end', () => {
    const cases: Array<[ProfilePlanTier, 'solo' | 'business' | 'firm', 'now' | 'period_end' | 'same']> = [
      ['SOLO', 'solo', 'same'],
      ['SOLO', 'business', 'now'],
      ['SOLO', 'firm', 'now'],
      ['BUSINESS', 'solo', 'period_end'],
      ['BUSINESS', 'business', 'same'],
      ['BUSINESS', 'firm', 'now'],
      ['FIRM', 'solo', 'period_end'],
      ['FIRM', 'business', 'period_end'],
      ['FIRM', 'firm', 'same'],
      ['FREELANCER', 'solo', 'period_end'],
      ['FREELANCER', 'business', 'now'],
      ['FREELANCER', 'firm', 'now'],
    ];
    it.each(cases)('%s → %s is %s', (current, target, timing) => {
      expect(changeTimingOf(current, target)).toBe(timing);
    });
  });

  it('nextPlanAbove: the cheapest plan that ranks higher, none above Firm', () => {
    expect(nextPlanAbove('SOLO')).toBe('business');
    expect(nextPlanAbove('FREELANCER')).toBe('business');
    expect(nextPlanAbove('BUSINESS')).toBe('firm');
    expect(nextPlanAbove('FIRM')).toBeNull();
  });

  it('holds the plan limits MUT-704 enforces (businesses exclude the personal profile)', () => {
    expect(PLAN_LIMITS).toEqual({
      starter: { businesses: 1, partners: 0, documentsPerMonth: 3, scansPerMonth: 12 },
      solo: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
      business: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 },
      firm: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 },
    });
    for (const [lower, higher] of [['starter', 'solo'], ['solo', 'business'], ['business', 'firm']] as const) {
      for (const key of ['businesses', 'partners', 'documentsPerMonth', 'scansPerMonth'] as const) {
        expect(PLAN_LIMITS[higher][key]).toBeGreaterThanOrEqual(PLAN_LIMITS[lower][key]);
      }
    }
  });

  describe('currentPlanOf: the best covering tier across the person’s own profiles', () => {
    const active = (tier: ProfilePlanTier | null) => ({ state: 'ACTIVE' as const, tier });
    it('is null with nothing covering', () => {
      expect(currentPlanOf([])).toBeNull();
      expect(currentPlanOf([{ state: 'READ_ONLY', tier: null }])).toBeNull();
    });

    it('ignores read-only and locked profiles, whatever their tier, and Malafat (no tier)', () => {
      expect(currentPlanOf([{ state: 'READ_ONLY', tier: 'BUSINESS' }, { state: 'LOCKED', tier: 'BUSINESS' }, active(null)])).toBeNull();
    });

    it('counts ACTIVE and GRACE', () => {
      expect(currentPlanOf([active('SOLO')])).toBe('solo');
      expect(currentPlanOf([{ state: 'GRACE', tier: 'FREELANCER' }])).toBe('freelancer');
    });

    it('takes the highest rank, Firm over Business over Solo', () => {
      expect(currentPlanOf([active('SOLO'), active('FIRM'), active('BUSINESS')])).toBe('firm');
      expect(currentPlanOf([active('SOLO'), active('BUSINESS')])).toBe('business');
    });

    it('prefers Solo over legacy Freelancer on a tie of rank', () => {
      expect(currentPlanOf([active('FREELANCER'), active('SOLO')])).toBe('solo');
      expect(currentPlanOf([active('SOLO'), active('FREELANCER')])).toBe('solo');
    });
  });

  describe('PLAN_FEATURES (MUT-736): the Tax Authority connection is on the paid plans only', () => {
    it('is off on the free plan, on for every paid plan and legacy Freelancer', () => {
      expect(FREE_PLAN).toBe('starter');
      expect(PLAN_FEATURES.starter.taxAuthority).toBe(false);
      for (const plan of [...PLAN_NAMES, 'freelancer'] as const) expect(PLAN_FEATURES[plan].taxAuthority, plan).toBe(true);
    });

    it('names Solo as the cheapest plan on sale with the connection', () => {
      expect(cheapestPlanWith('taxAuthority')).toBe('solo');
    });

    it('never puts the free plan on sale', () => {
      expect(PLAN_NAMES).not.toContain(FREE_PLAN);
    });
  });

  describe('Starter (MUT-731, ADR-284): the free plan, rank 0', () => {
    it('is rank 0, below every paid plan, and maps to its tier and back', () => {
      expect(RANK.STARTER).toBe(0);
      for (const plan of PLAN_NAMES) expect(RANK[TIER_OF[plan]]).toBeGreaterThan(RANK.STARTER);
      expect(TIER_OF.starter).toBe('STARTER');
      expect(planOfTier('STARTER')).toBe('starter');
    });

    it('upgrades to Solo, now', () => {
      expect(nextPlanAbove('STARTER')).toBe('solo');
      for (const plan of PLAN_NAMES) expect(changeTimingOf('STARTER', plan)).toBe('now');
    });

    it('is the only hard-capped plan and the only one whose business count is enforced (until MUT-704/733)', () => {
      expect([...HARD_CAP_PLANS]).toEqual(['starter']);
      expect([...ENFORCED_BUSINESS_CAPS]).toEqual(['starter']);
    });

    it('currentPlanOf: Starter alone is starter; any paid plan alongside wins (legacy Freelancer included)', () => {
      expect(currentPlanOf([{ state: 'ACTIVE', tier: 'STARTER' }])).toBe('starter');
      expect(currentPlanOf([{ state: 'ACTIVE', tier: 'STARTER' }, { state: 'ACTIVE', tier: 'SOLO' }])).toBe('solo');
      expect(currentPlanOf([{ state: 'ACTIVE', tier: 'STARTER' }, { state: 'GRACE', tier: 'FREELANCER' }])).toBe('freelancer');
    });
  });

  describe('list lookup keys (MUT-702 Part B, ADR-288)', () => {
    it('names each plan, interval and currency', () => {
      expect(listLookupKey('solo', 'month', 'ILS')).toBe('solo_list_monthly_ils');
      expect(listLookupKey('business', 'year', 'USD')).toBe('business_list_yearly_usd');
      expect(listLookupKey('firm', 'month', 'USD')).toBe('firm_list_monthly_usd');
    });

    it('lists all twelve, four per plan', () => {
      expect(ALL_PLAN_LOOKUP_KEYS).toHaveLength(12);
      expect(new Set(ALL_PLAN_LOOKUP_KEYS).size).toBe(12);
      for (const plan of PLAN_NAMES) expect(ALL_PLAN_LOOKUP_KEYS.filter((k) => k.startsWith(`${plan}_`))).toHaveLength(4);
    });

    it('reads the plan back from any key; legacy and unknown keys name none', () => {
      for (const key of ALL_PLAN_LOOKUP_KEYS) expect(listLookupKey(planOfLookupKey(key)!, key.includes('yearly') ? 'year' : 'month', key.endsWith('_ils') ? 'ILS' : 'USD')).toBe(key);
      expect(planOfLookupKey('freelancer_list_monthly_ils')).toBeNull();
      expect(planOfLookupKey('freelancer_founder_yearly_ils')).toBeNull();
      expect(planOfLookupKey('accountant_list_monthly_ils')).toBeNull();
      expect(planOfLookupKey('solo_list_weekly_ils')).toBeNull();
    });
  });
});
