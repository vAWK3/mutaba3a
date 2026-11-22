import { describe, expect, it } from 'vitest';
import {
  changeTimingOf,
  currentPlanOf,
  nextPlanAbove,
  PLAN_LIMITS,
  PLAN_NAMES,
  planOfTier,
  RANK,
  TIER_OF,
  type ProfilePlanTier,
} from '../plans.js';

/** MUT-702 Part A (ADR-270): Solo, Business and Firm as provider-neutral tiers; legacy Freelancer kept. */
describe('plans', () => {
  it('sells Solo, Business and Firm, in rank order', () => {
    expect(PLAN_NAMES).toEqual(['solo', 'business', 'firm']);
  });

  it('maps each plan, and legacy freelancer, to its tier and back', () => {
    expect(TIER_OF).toEqual({ solo: 'SOLO', business: 'BUSINESS', firm: 'FIRM', freelancer: 'FREELANCER' });
    for (const [plan, tier] of Object.entries(TIER_OF)) expect(planOfTier(tier)).toBe(plan);
  });

  it('ranks Solo = Freelancer < Business < Firm', () => {
    expect(RANK.SOLO).toBe(RANK.FREELANCER);
    expect(RANK.SOLO).toBeLessThan(RANK.BUSINESS);
    expect(RANK.BUSINESS).toBeLessThan(RANK.FIRM);
    expect(Object.keys(RANK).sort()).toEqual(['BUSINESS', 'FIRM', 'FREELANCER', 'SOLO']);
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
      solo: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
      business: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 },
      firm: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 },
    });
    for (const [lower, higher] of [['solo', 'business'], ['business', 'firm']] as const) {
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
});
