import { profileOwnerOf } from '../personal-profile.js';
import type { BillingFactsRecord, LedgerStore, MembershipRecord, Organization } from '../repositories/ports.js';
import { resolveEntitlement, type Entitlement } from './entitlement.js';
import { personStanding, type Standing } from './gate.js';

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

/** A profile the person belongs to, with what billing needs to resolve it. */
export interface MemberProfile extends ProfileForBilling {
  organization: Organization;
  membership: MembershipRecord;
}

/**
 * MUT-361 (review R7): every profile a person belongs to, in membership order, for `/v1/me` and the lapse gate's
 * standing. The organizations and their Malafat integrations are read in one tick each, not one membership at a time.
 */
export async function memberProfilesForBilling(store: Pick<LedgerStore, 'memberships' | 'organizations' | 'integrations'>, userId: string): Promise<MemberProfile[]> {
  const memberships = await store.memberships.listByUser(userId);
  const organizations = await Promise.all(memberships.map((m) => store.organizations.getById(m.organizationId)));
  const integrations = await Promise.all(organizations.map((o) => (o ? store.integrations.findByOrganizationAndProvider(o.id, 'MALAFAT') : null)));
  return memberships.flatMap((membership, i) => {
    const organization = organizations[i];
    return organization ? [{ organization, membership, malafatConnected: integrations[i]?.status === 'CONNECTED' }] : [];
  });
}

/** MUT-361: the person's standing (gate.ts `personStanding`) and each profile's entitlement, from one billing read. */
export async function standingOfPerson(
  store: Pick<LedgerStore, 'memberships' | 'organizations' | 'integrations' | 'billing'>,
  userId: string,
  now: Date,
): Promise<{ standing: Standing; entitlements: Map<string, Entitlement> }> {
  const profiles = await memberProfilesForBilling(store, userId);
  const entitlements = profiles.length > 0 ? await entitlementsFor(store, profiles, now) : new Map<string, Entitlement>();
  return { standing: personStanding([...entitlements.values()].map((e) => e.state)), entitlements };
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
