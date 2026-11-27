/**
 * MUT-702 Part A (ADR-275): the one source of truth for the profile plans. Pure, and provider-neutral: no payment
 * provider, price or lookup key is named here (that is Part B, held for MUT-700's seller decision).
 *
 *   solo      SOLO        rank 1   one business, one person
 *   business  BUSINESS    rank 2   a few businesses, with partners; what a running trial gets
 *   firm      FIRM        rank 3   a firm's books
 *   freelancer FREELANCER rank 1   legacy: the ₪29 payers and ₪21 founders, never sold again (MUT-707 moves them)
 *
 * ACCOUNTANT (ADR-251) is a person's plan for client books, never a profile's, so it has no rank here.
 */

/**
 * MUT-731 (ADR-284): Starter «البداية» is rank 0, the free plan everyone with nothing else falls back to (with
 * STARTER_PLAN on). Never sold: it isn't in PLAN_NAMES, so Checkout, the catalog and the offers never see it.
 */

/** The plans on sale, cheapest first. */
export const PLAN_NAMES = ['solo', 'business', 'firm'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];
/** Not sold: the plan of the ₪29 payers and the ₪21 founders until MUT-707 moves them. */
export type LegacyPlanName = 'freelancer';
/**
 * MUT-736 (ADR-282) named it; MUT-731 (ADR-284) makes it a tier: rank 0, its limits, the hard caps.
 */
export const FREE_PLAN = 'starter' as const;
export type FreePlanName = typeof FREE_PLAN;
export type AnyPlanName = PlanName | LegacyPlanName | FreePlanName;

/**
 * The tiers a profile can be entitled by (Prisma `BillingTier` less ACCOUNTANT, plus STARTER). STARTER is never stored
 * as a subscription's or a grant's tier: it is the resolver's fallback (billing/entitlement.ts), so Prisma has no value.
 */
export type ProfilePlanTier = 'STARTER' | 'SOLO' | 'BUSINESS' | 'FIRM' | 'FREELANCER';

export const TIER_OF: Readonly<Record<AnyPlanName, ProfilePlanTier>> = { starter: 'STARTER', solo: 'SOLO', business: 'BUSINESS', firm: 'FIRM', freelancer: 'FREELANCER' };

const PLAN_OF: Readonly<Record<ProfilePlanTier, AnyPlanName>> = { STARTER: 'starter', SOLO: 'solo', BUSINESS: 'business', FIRM: 'firm', FREELANCER: 'freelancer' };

export function planOfTier(tier: ProfilePlanTier): AnyPlanName {
  return PLAN_OF[tier];
}

/** Higher covers more. Solo and legacy Freelancer share a rank: moving between them is never an upgrade. Starter is 0. */
export const RANK: Readonly<Record<ProfilePlanTier, number>> = { STARTER: 0, SOLO: 1, FREELANCER: 1, BUSINESS: 2, FIRM: 3 };

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
 * Defined here; Starter's are enforced by MUT-731 (HARD_CAP_PLANS), the paid plans' by MUT-704/733. Legacy Freelancer
 * has no row on purpose: MUT-704 decides whether it keeps today's limits until MUT-707 moves it (plan §Part A 7).
 */
export const PLAN_LIMITS: Readonly<Record<PlanName | FreePlanName, Readonly<PlanLimits>>> = {
  starter: { businesses: 1, partners: 0, documentsPerMonth: 3, scansPerMonth: 12 },
  solo: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 },
  business: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 },
  firm: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 },
};

/** What a plan includes beyond its limits. */
export interface PlanFeatures {
  /** The Tax Authority connection: automatic allocation numbers (MUT-571/572). Without it, numbers are typed by hand (MUT-711). */
  taxAuthority: boolean;
}

export const PLAN_FEATURES: Readonly<Record<AnyPlanName, Readonly<PlanFeatures>>> = {
  starter: { taxAuthority: false },
  solo: { taxAuthority: true },
  business: { taxAuthority: true },
  firm: { taxAuthority: true },
  freelancer: { taxAuthority: true },
};

/** The cheapest plan on sale that includes the feature (the upgrade a refusal offers); null when none does. */
export function cheapestPlanWith(feature: keyof PlanFeatures): PlanName | null {
  return PLAN_NAMES.find((plan) => PLAN_FEATURES[plan][feature]) ?? null;
}

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

/**
 * MUT-731 (ADR-284): the plans whose limits refuse at the cap (409 PLAN_LIMIT): Starter only. The paid plans join with
 * MUT-733 (a heads-up, the one-time gift, then the cap); until then their monthly meters count and never refuse.
 */
export const HARD_CAP_PLANS: ReadonlySet<string> = new Set<AnyPlanName>([FREE_PLAN]);

/**
 * MUT-733 (ADR-293): the paid plans whose monthly meters refuse at the cap with PAID_HARD_CAPS on (after the one-time
 * gift). Firm stays soft (Basel's default on Q2: the top plan has nowhere to move); legacy Freelancer has no limits.
 */
export const PAID_HARD_CAP_PLANS: ReadonlySet<string> = new Set<AnyPlanName>(['solo', 'business']);

/**
 * MUT-731: the plans whose business count is enforced by making the businesses past the cap read-only (billing/
 * business-cap.ts). Starter only; MUT-704 adds the paid plans.
 */
export const ENFORCED_BUSINESS_CAPS: ReadonlySet<string> = new Set<AnyPlanName>([FREE_PLAN]);

/** MUT-734 (ADR-291): with PAID_BUSINESS_CAPS on, the paid plans' business counts are enforced too (legacy Freelancer never). */
const ENFORCED_WITH_PAID_CAPS: ReadonlySet<string> = new Set<AnyPlanName>([FREE_PLAN, 'solo', 'business', 'firm']);

export function enforcedBusinessCapsOf(paidBusinessCaps: boolean): ReadonlySet<string> {
  return paidBusinessCaps ? ENFORCED_WITH_PAID_CAPS : ENFORCED_BUSINESS_CAPS;
}

/**
 * MUT-702 Part B (ADR-288): each plan's list prices by lookup key, `{plan}_list_{monthly|yearly}_{ils|usd}`. The amounts
 * live in the payment provider's catalog, written only by the catalog script (scripts/stripe-plans.ts).
 */
export type ListInterval = 'month' | 'year';
export type ListCurrency = 'ILS' | 'USD';

export function listLookupKey(plan: PlanName, interval: ListInterval, currency: ListCurrency): string {
  return `${plan}_list_${interval === 'month' ? 'monthly' : 'yearly'}_${currency.toLowerCase()}`;
}

/** Every plan's four list keys, cheapest plan first. */
export const ALL_PLAN_LOOKUP_KEYS: readonly string[] = PLAN_NAMES.flatMap((plan) =>
  (['month', 'year'] as const).flatMap((interval) => (['ILS', 'USD'] as const).map((currency) => listLookupKey(plan, interval, currency))),
);

const PLAN_KEY = /^(solo|business|firm)_list_(monthly|yearly)_(ils|usd)$/;

/** The plan a list key sells; null for legacy (`freelancer_*`), Accountant and anything else. */
export function planOfLookupKey(key: string): PlanName | null {
  return (PLAN_KEY.exec(key)?.[1] as PlanName | undefined) ?? null;
}
