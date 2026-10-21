import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';
import { resolveEntitlement, type Entitlement } from './entitlement.js';

export interface ProfileForBilling {
  organization: Pick<Organization, 'id' | 'ownerUserId' | 'personalOwnerUserId'>;
  /** Already known to the caller (buildMe reads the Malafat integration for writerOfRecord). */
  malafatConnected: boolean;
}

/**
 * MUT-358 (brief §2.3): every profile's entitlement from one `billing.factsFor` call, however many profiles there are.
 * The facts are the owners' subscriptions, grants and trial starts, plus anything tied to the profiles themselves.
 */
export async function entitlementsFor(store: Pick<LedgerStore, 'billing'>, profiles: readonly ProfileForBilling[], now: Date): Promise<Map<string, Entitlement>> {
  const owners = new Set<string>();
  for (const { organization } of profiles) {
    const owner = profileOwnerOf(organization);
    if (owner) owners.add(owner);
  }
  const facts = await store.billing.factsFor({ ownerUserIds: [...owners], organizationIds: profiles.map((p) => p.organization.id) });
  return new Map(
    profiles.map(({ organization, malafatConnected }) => [
      organization.id,
      resolveEntitlement({ organizationId: organization.id, ownerUserId: profileOwnerOf(organization), malafatConnected }, facts, now),
    ]),
  );
}

/** The wire shape on `/v1/me` (BillingEntitlementSchema): ISO timestamps. */
export function serializeEntitlement(entitlement: Entitlement) {
  return { state: entitlement.state, source: entitlement.source, tier: entitlement.tier, until: entitlement.until?.toISOString() ?? null };
}
