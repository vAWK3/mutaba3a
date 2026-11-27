import { ENFORCED_BUSINESS_CAPS, PLAN_LIMITS, planOfTier } from './plans.js';

/** MUT-734 (ADR-291): which entitlements a cap applies to: Starter's always; a paid plan's with PAID_BUSINESS_CAPS on. */
const PAID_CAPPED_TIERS: ReadonlySet<string> = new Set(['SOLO', 'BUSINESS', 'FIRM']);
import type { Entitlement } from './entitlement.js';

/**
 * MUT-731 (ADR-284, brief §2 post-pass, Basel Q5): a person on Starter keeps one business active; the others they
 * created are READ_ONLY with `planLimit` (visible, exportable, nothing deleted). Pure: coverage.ts gathers the owner's
 * businesses and their choice, this decides, so the gate, /v1/me, /v1/billing and the agents all read one answer.
 *
 * Counted: the owner's own business profiles (every profile they created but their built-in personal one) whose
 * entitlement is Starter. A business covered by something else (Malafat, a grant or subscription tied to it) isn't
 * Starter's, so it neither counts nor turns read-only. The personal profile never counts.
 *
 * Which stay active: the businesses the person chose (`activeBusinessIds`), still theirs and still on Starter, up to
 * the cap. Nothing chosen (or nothing valid left): every counted business is read-only until they pick. No default.
 */

export interface OwnedBusiness {
  organizationId: string;
  ownerUserId: string;
}

export interface BusinessCapState {
  /** The plan's business count (1 on Starter). */
  cap: number;
  /** The owner's Starter businesses, in the order given. */
  businesses: string[];
  /** The ones kept active (a valid choice, at most `cap`); empty while the person has to pick. */
  active: string[];
  /** The ones read-only for the plan's count. */
  readOnly: string[];
  /** More businesses than the cap and no valid choice: the person must pick before anything else. */
  mustChoose: boolean;
}

/** The cap of an entitlement's plan when the plan's business count is enforced; null otherwise. */
export function enforcedBusinessCapOf(entitlement: Pick<Entitlement, 'tier' | 'state'>, enforced: ReadonlySet<string> = ENFORCED_BUSINESS_CAPS): number | null {
  if (entitlement.tier === null || entitlement.state !== 'ACTIVE') return null;
  const plan = planOfTier(entitlement.tier);
  if (!enforced.has(plan) || !Object.hasOwn(PLAN_LIMITS, plan)) return null;
  return PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS].businesses;
}

/** One owner's businesses against the cap. `businesses` are already only the Starter-covered ones. */
export function businessCapStateOf(businesses: readonly string[], chosen: readonly string[] | null, cap: number): BusinessCapState {
  const all = [...businesses];
  if (all.length <= cap) return { cap, businesses: all, active: all, readOnly: [], mustChoose: false };
  const active = (chosen ?? []).filter((id, i, list) => all.includes(id) && list.indexOf(id) === i).slice(0, cap);
  const readOnly = all.filter((id) => !active.includes(id));
  return { cap, businesses: all, active, readOnly, mustChoose: active.length === 0 };
}

/**
 * Applies every owner's cap to `entitlements` (only the profiles present in the map change). `owned` lists each
 * owner's created businesses (personal profile excluded); `chosen` their `activeBusinessIds`.
 */
export function applyBusinessCap(
  entitlements: Map<string, Entitlement>,
  owned: readonly OwnedBusiness[],
  chosen: ReadonlyMap<string, readonly string[] | null>,
  enforced: ReadonlySet<string> = ENFORCED_BUSINESS_CAPS,
): Map<string, BusinessCapState> {
  const byOwner = new Map<string, string[]>();
  // MUT-734: one cap per owner (an owner's businesses share the plan that covers them: Starter's, or their subscription's).
  const capOf = new Map<string, number>();
  for (const { organizationId, ownerUserId } of owned) {
    const entitlement = entitlements.get(organizationId);
    const ownerCap = entitlement && cappedSource(entitlement, enforced) ? enforcedBusinessCapOf(entitlement, enforced) : null;
    if (ownerCap === null) continue;
    capOf.set(ownerUserId, Math.min(capOf.get(ownerUserId) ?? ownerCap, ownerCap));
    byOwner.set(ownerUserId, [...(byOwner.get(ownerUserId) ?? []), organizationId]);
  }
  const states = new Map<string, BusinessCapState>();
  for (const [owner, businesses] of byOwner) {
    const state = businessCapStateOf(businesses, chosen.get(owner) ?? null, capOf.get(owner)!);
    states.set(owner, state);
    for (const id of state.readOnly) {
      const entitlement = entitlements.get(id)!;
      entitlements.set(id, { ...entitlement, state: 'READ_ONLY', planLimit: true });
    }
  }
  return states;
}

/** Starter's fallback always; a paid plan's own subscription only once its cap is enforced (PAID_BUSINESS_CAPS). */
function cappedSource(entitlement: Entitlement, enforced: ReadonlySet<string>): boolean {
  if (entitlement.source === 'STARTER') return true;
  return entitlement.source === 'STRIPE' && entitlement.tier !== null && PAID_CAPPED_TIERS.has(entitlement.tier) && enforced !== ENFORCED_BUSINESS_CAPS;
}

/** The wire shape (GET /v1/billing `activeBusinesses`, PUT /v1/billing/active-businesses). */
export function businessCapView(state: BusinessCapState) {
  return { cap: state.cap, active: state.active, readOnly: state.readOnly, mustChoose: state.mustChoose };
}
