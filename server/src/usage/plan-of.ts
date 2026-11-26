import { entitlementsFor } from '../billing/coverage.js';
import { currentPlanOf } from '../billing/plans.js';
import { ownedProfilesOf, profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, Organization, UsageStamp } from '../repositories/ports.js';
import { doorOf, type DoorPrincipal, type UsagePlan } from './kinds.js';
import { subjectKeyOf } from './subject.js';

type PlanStore = Pick<LedgerStore, 'billing' | 'memberships' | 'organizations' | 'integrations'>;

/**
 * MUT-735 (ADR-281, eng review #17): the payer's plan for an action on `organization`. The counter is the payer's, so
 * the plan is too: `currentPlanOf` over the payer's own profiles (not the actor's: a co-owner's entitlements are their
 * own), from one `entitlementsFor` read. A profile whose entitlement source is MALAFAT is `malafat` (ADR-160 decision
 * 4: never capped). Run only on metered actions, whether or not BILLING_GATE is on.
 */
export async function payerPlanOf(store: PlanStore, organization: Organization, now: Date): Promise<UsagePlan> {
  const owner = profileOwnerOf(organization);
  const owned = owner ? await ownedProfilesOf(store, owner) : [];
  const profiles = owned.some((p) => p.id === organization.id) ? owned : [...owned, organization];
  const withMalafat = await Promise.all(
    profiles.map(async (p) => ({ organization: p, malafatConnected: (await store.integrations.findByOrganizationAndProvider(p.id, 'MALAFAT'))?.status === 'CONNECTED' })),
  );
  const entitlements = await entitlementsFor(store, withMalafat, now);
  if (entitlements.get(organization.id)?.source === 'MALAFAT') return 'malafat';
  const payerOwn = owner ? owned.map((p) => entitlements.get(p.id)!) : [entitlements.get(organization.id)!];
  return currentPlanOf(payerOwn.filter(Boolean)) ?? 'none';
}

/**
 * MUT-731 (ADR-284): a person's own plan (`currentPlanOf` over the profiles they created), for the stock limits they
 * hit as themselves: a new business, a partner. `none` when nothing covers them.
 */
export async function personPlanOf(store: PlanStore, userId: string, now: Date): Promise<UsagePlan> {
  const owned = await ownedProfilesOf(store, userId);
  if (owned.length === 0) return 'none';
  const withMalafat = await Promise.all(
    owned.map(async (p) => ({ organization: p, malafatConnected: (await store.integrations.findByOrganizationAndProvider(p.id, 'MALAFAT'))?.status === 'CONNECTED' })),
  );
  const entitlements = await entitlementsFor(store, withMalafat, now);
  return currentPlanOf([...entitlements.values()]) ?? 'none';
}

/**
 * The stamp a metered action carries: who pays, their plan, the door, the actor. Anything Malafat writes (an API key,
 * a delegated call, a profile whose writer of record is Malafat) is plan `malafat`, never capped (eng review #7).
 */
export async function usageStampFor(
  store: PlanStore,
  action: { organization: Organization; principal: DoorPrincipal; actorUserId: string | null; writerOfRecord?: 'MALAFAT' | null },
  now: Date,
): Promise<UsageStamp> {
  const door = doorOf(action.principal);
  const byMalafat = door === 'MALAFAT' || action.writerOfRecord === 'MALAFAT';
  const plan = byMalafat ? 'malafat' : await payerPlanOf(store, action.organization, now);
  return { subjectKey: subjectKeyOf(action.organization), plan, door, actorUserId: action.actorUserId };
}
