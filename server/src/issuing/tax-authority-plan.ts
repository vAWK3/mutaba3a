import { cheapestPlanWith, PLAN_FEATURES, type PlanName } from '../billing/plans.js';
import { ApiError } from '../errors.js';
import type { Organization } from '../repositories/ports.js';
import type { UsagePlan } from '../usage/kinds.js';
import { payerPlanOf } from '../usage/plan-of.js';

/** MUT-736 (ADR-282): whether the payer's plan includes the Tax Authority connection, and the plan that would. */
export interface TaxAuthorityPlan {
  allowed: boolean;
  /** The plan to upgrade to when not allowed; null when allowed. */
  nextPlan: PlanName | null;
}

/**
 * The connection is a paid-plan feature (PLAN_FEATURES). A payer with no plan keeps today's answer: `none` (nothing
 * covers them; whether they may write at all is the lapse gate's business) and `malafat` (issuing is off there). So
 * only Starter (MUT-731) is ever refused, and nothing changes before it exists.
 */
export function taxAuthorityPlanFor(plan: UsagePlan): TaxAuthorityPlan {
  const features = plan === 'none' || plan === 'malafat' ? null : PLAN_FEATURES[plan];
  const allowed = features?.taxAuthority ?? true;
  return { allowed, nextPlan: allowed ? null : cheapestPlanWith('taxAuthority') };
}

/** The payer's plan (MUT-735's `payerPlanOf`: the profile's creator's, never a co-owner's or an accountant's). */
export async function taxAuthorityPlanOf(store: Parameters<typeof payerPlanOf>[0], organization: Organization, now: Date): Promise<TaxAuthorityPlan & { plan: UsagePlan }> {
  const plan = await payerPlanOf(store, organization, now);
  return { plan, ...taxAuthorityPlanFor(plan) };
}

/**
 * MUT-736 (brief §3.3): the plan's limit refuses the action, 409 PLAN_LIMIT (not 402: that is the lapse gate's "plan
 * ended"). `canUpgrade`: a paid plan can be bought on this server now (Checkout configured); without it the clients
 * show no Upgrade button. MUT-731 adds the monthly meters' `used`, `cap` and `resetsOn`.
 */
export function planLimitError(details: { limit: 'taxAuthority'; plan: UsagePlan; nextPlan: PlanName | null; canUpgrade: boolean }): ApiError {
  return new ApiError('PLAN_LIMIT', 'The Tax Authority connection is on Solo and above', details);
}
