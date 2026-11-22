/**
 * MUT-702 Part A (ADR-270): the one source of truth for the profile plans. Pure, and provider-neutral: no payment
 * provider, price or lookup key is named here (that is Part B, held for MUT-700's seller decision).
 *
 *   solo      SOLO        rank 1   one business, one person
 *   business  BUSINESS    rank 2   a few businesses, with partners; what a running trial gets
 *   firm      FIRM        rank 3   a firm's books
 *   freelancer FREELANCER rank 1   legacy: the ₪29 payers and ₪21 founders, never sold again (MUT-707 moves them)
 *
 * ACCOUNTANT (ADR-251) is a person's plan for client books, never a profile's, so it has no rank here.
 */

/** The plans on sale, cheapest first. */
export const PLAN_NAMES = ['solo', 'business', 'firm'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];
/** Not sold: the plan of the ₪29 payers and the ₪21 founders until MUT-707 moves them. */
export type LegacyPlanName = 'freelancer';
export type AnyPlanName = PlanName | LegacyPlanName;

/** The tiers a profile can be entitled by (Prisma `BillingTier` less ACCOUNTANT). */
export type ProfilePlanTier = 'SOLO' | 'BUSINESS' | 'FIRM' | 'FREELANCER';

export const TIER_OF: Readonly<Record<AnyPlanName, ProfilePlanTier>> = { solo: 'SOLO', business: 'BUSINESS', firm: 'FIRM', freelancer: 'FREELANCER' };

const PLAN_OF: Readonly<Record<ProfilePlanTier, AnyPlanName>> = { SOLO: 'solo', BUSINESS: 'business', FIRM: 'firm', FREELANCER: 'freelancer' };

export function planOfTier(tier: ProfilePlanTier): AnyPlanName {
  return PLAN_OF[tier];
}

/** Higher covers more. Solo and legacy Freelancer share a rank: moving between them is never an upgrade. */
export const RANK: Readonly<Record<ProfilePlanTier, number>> = { SOLO: 1, FREELANCER: 1, BUSINESS: 2, FIRM: 3 };

export type PlanChangeTiming = 'now' | 'period_end' | 'same';

/** Up a rank takes effect now; the same or a lower rank (a different plan) waits for the paid period to end. */
export function changeTimingOf(current: ProfilePlanTier, target: PlanName): PlanChangeTiming {
  const targetTier = TIER_OF[target];
  if (targetTier === current) return 'same';
  return RANK[targetTier] > RANK[current] ? 'now' : 'period_end';
}

/** The cheapest plan on sale that ranks above `tier`; null above Firm. */
export function nextPlanAbove(tier: ProfilePlanTier): PlanName | null {
  return PLAN_NAMES.find((plan) => RANK[TIER_OF[plan]] > RANK[tier]) ?? null;
}

export interface PlanLimits {
  /** Business profiles the person may own; the personal profile is never counted. */
  businesses: number;
  /** Partners (co-owners) on a business profile. */
  partners: number;
  /** Issued documents a month. */
  documentsPerMonth: number;
  /** Receipt and invoice scans a month. */
  scansPerMonth: number;
}

/**
 * Defined here, enforced by MUT-704. Legacy Freelancer has no row on purpose: MUT-704 decides whether it keeps today's
 * limits until MUT-707 moves it (plan §Part A 7).
 */
export const PLAN_LIMITS: Readonly<Record<PlanName, Readonly<PlanLimits>>> = {
  solo: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
  business: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 },
  firm: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 },
};

/** The part of an entitlement `currentPlanOf` reads (structural, so this module imports nothing). */
export interface CoveringFact {
  state: 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'LOCKED';
  tier: ProfilePlanTier | null;
}

/**
 * The person's plan: the highest-ranked tier that covers (ACTIVE or GRACE) any of their own profiles, from a grant, a
 * subscription or the trial. Null when nothing covers them; Malafat carries no tier, so it never names a plan. On a tie
 * of rank the plan on sale wins over legacy Freelancer.
 */
export function currentPlanOf(entitlements: readonly CoveringFact[]): AnyPlanName | null {
  let best: ProfilePlanTier | null = null;
  for (const { state, tier } of entitlements) {
    if (tier === null || (state !== 'ACTIVE' && state !== 'GRACE')) continue;
    if (best === null || RANK[tier] > RANK[best] || (RANK[tier] === RANK[best] && best === 'FREELANCER')) best = tier;
  }
  return best === null ? null : planOfTier(best);
}
