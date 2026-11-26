import { describe, expect, it } from 'vitest';
import { USAGE_PLANS } from '../../usage/kinds.js';
import { taxAuthorityPlanFor } from '../tax-authority-plan.js';

/**
 * MUT-736 (ADR-282): the Tax Authority connection is a paid-plan feature. Only the free plan (Starter, MUT-731) is
 * refused; it names Solo as the plan that has it. `none` (nothing covers the payer: the lapse gate's business) and
 * `malafat` (issuing is off there) keep today's answer, so nothing changes until Starter exists.
 */
describe('taxAuthorityPlanFor', () => {
  it('refuses Starter and names Solo', () => {
    expect(taxAuthorityPlanFor('starter')).toEqual({ allowed: false, nextPlan: 'solo' });
  });

  it('allows every paid plan and legacy Freelancer', () => {
    for (const plan of ['solo', 'business', 'firm', 'freelancer'] as const) expect(taxAuthorityPlanFor(plan), plan).toEqual({ allowed: true, nextPlan: null });
  });

  it('keeps today’s answer where the payer has no plan (none, malafat)', () => {
    expect(taxAuthorityPlanFor('none')).toEqual({ allowed: true, nextPlan: null });
    expect(taxAuthorityPlanFor('malafat')).toEqual({ allowed: true, nextPlan: null });
  });

  it('answers for every plan the usage ledger knows', () => {
    for (const plan of USAGE_PLANS) expect(typeof taxAuthorityPlanFor(plan).allowed).toBe('boolean');
  });
});
