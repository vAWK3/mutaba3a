import { profileOwnerOf } from '../personal-profile.js';
import type { BillingFactsRecord, LedgerStore, Organization } from '../repositories/ports.js';
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
  const facts = await factsOf(store, profiles);
  return new Map(profiles.map((profile) => [profile.organization.id, resolve(profile, facts, now)]));
}

/**
 * MUT-360 review (`billing:status`): the same single read, resolved twice per profile: as /v1/me reports it, and with
 * operator grants left out, so the operator can see Stripe covering before revoking a pilot grant.
 */
export async function billingStatusOf(store: Pick<LedgerStore, 'billing'>, profiles: readonly ProfileForBilling[], now: Date) {
  const facts = await factsOf(store, profiles);
  const withoutGrants = { ...facts, grants: [] };
  return {
    subscriptions: facts.subscriptions,
    entitlements: new Map(profiles.map((profile) => [profile.organization.id, { current: resolve(profile, facts, now), withoutGrants: resolve(profile, withoutGrants, now) }])),
  };
}

async function factsOf(store: Pick<LedgerStore, 'billing'>, profiles: readonly ProfileForBilling[]) {
  const owners = new Set<string>();
  for (const { organization } of profiles) {
    const owner = profileOwnerOf(organization);
    if (owner) owners.add(owner);
  }
  return store.billing.factsFor({ ownerUserIds: [...owners], organizationIds: profiles.map((p) => p.organization.id) });
}

function resolve({ organization, malafatConnected }: ProfileForBilling, facts: BillingFactsRecord, now: Date): Entitlement {
  return resolveEntitlement({ organizationId: organization.id, ownerUserId: profileOwnerOf(organization), malafatConnected }, facts, now);
}

/** The wire shape on `/v1/me` (BillingEntitlementSchema): ISO timestamps. */
export function serializeEntitlement(entitlement: Entitlement) {
  return { state: entitlement.state, source: entitlement.source, tier: entitlement.tier, until: entitlement.until?.toISOString() ?? null };
}
