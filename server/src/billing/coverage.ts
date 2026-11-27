import { profileOwnerOf } from '../personal-profile.js';
import type { BillingFactsRecord, LedgerStore, MembershipRecord, Organization } from '../repositories/ports.js';
import { applyBusinessCap, enforcedBusinessCapOf, type BusinessCapState } from './business-cap.js';
import { enforcedBusinessCapsOf } from './plans.js';
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
  return (await entitlementsWithFactsFor(store, profiles, now)).entitlements;
}

/**
 * MUT-565 (ADR-251): the same single read, also handing back the facts, so /v1/me resolves the person's Accountant
 * plan from them with no query of its own. `personUserId` joins the owners asked about (always already there through
 * the personal profile; the set keeps it to one read either way).
 */
export async function entitlementsWithFactsFor(
  store: Pick<LedgerStore, 'billing'>,
  profiles: readonly ProfileForBilling[],
  now: Date,
  personUserId?: string,
): Promise<{ entitlements: Map<string, Entitlement>; facts: BillingFactsRecord; businessCaps: Map<string, BusinessCapState> }> {
  const facts = await factsOf(store, profiles, personUserId);
  const starter = starterOn(store);
  const entitlements = new Map(profiles.map((profile) => [profile.organization.id, resolve(profile, facts, now, starter)]));
  const paidCaps = store.billing.paidBusinessCaps === true;
  const businessCaps = starter || paidCaps ? await applyStarterBusinessCap(store, profiles, entitlements, facts, now, enforcedBusinessCapsOf(paidCaps)) : new Map<string, BusinessCapState>();
  return { entitlements, facts, businessCaps };
}

/** MUT-731 (ADR-284): the server's STARTER_PLAN, as the store was built with it. */
function starterOn(store: Pick<LedgerStore, 'billing'>): boolean {
  return store.billing.starterPlan === true;
}

/**
 * MUT-731 (brief §2 post-pass, eng review #6): an owner on Starter keeps one business active. The owners whose business
 * resolved to Starter here have all their created businesses read (one extra query, Starter owners only), the ones not
 * asked about resolved too (their own grants and subscriptions with them), and the cap applied over the whole set, so a
 * single-profile gate and /v1/me give the same answer. Only the profiles asked about change in `entitlements`.
 */
async function applyStarterBusinessCap(
  store: Pick<LedgerStore, 'billing'>,
  profiles: readonly ProfileForBilling[],
  entitlements: Map<string, Entitlement>,
  facts: BillingFactsRecord,
  now: Date,
  enforced: ReadonlySet<string>,
): Promise<Map<string, BusinessCapState>> {
  const owners = new Set<string>();
  for (const { organization } of profiles) {
    const isBusiness = organization.ownerUserId !== null && organization.personalOwnerUserId === null;
    const entitlement = entitlements.get(organization.id);
    // MUT-734: a paid plan's businesses too, once PAID_BUSINESS_CAPS enforces their count.
    if (isBusiness && entitlement && (entitlement.source === 'STARTER' || enforcedBusinessCapOf(entitlement, enforced) !== null)) owners.add(organization.ownerUserId!);
  }
  if (owners.size === 0) return new Map();
  const owned = await store.billing.ownedBusinessesOf([...owners]);
  const missing = owned.filter((b) => !entitlements.has(b.organization.id));
  const all = new Map(entitlements);
  if (missing.length > 0) {
    const more = await store.billing.factsFor({ ownerUserIds: [...owners], organizationIds: missing.map((b) => b.organization.id) });
    for (const b of missing) all.set(b.organization.id, resolve({ organization: b.organization, malafatConnected: b.malafatConnected }, more, now, starterOn(store)));
  }
  const states = applyBusinessCap(all, owned.map((b) => ({ organizationId: b.organization.id, ownerUserId: b.ownerUserId })), facts.activeBusinesses ?? new Map(), enforced);
  for (const id of entitlements.keys()) entitlements.set(id, all.get(id)!);
  return states;
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
  const { entitlements: current, facts } = await entitlementsWithFactsFor(store, profiles, now);
  const withoutGrants = { ...facts, grants: [] };
  const starter = starterOn(store);
  return {
    subscriptions: facts.subscriptions,
    entitlements: new Map(profiles.map((profile) => [profile.organization.id, { current: current.get(profile.organization.id)!, withoutGrants: resolve(profile, withoutGrants, now, starter) }])),
  };
}

async function factsOf(store: Pick<LedgerStore, 'billing'>, profiles: readonly ProfileForBilling[], personUserId?: string) {
  const owners = new Set<string>(personUserId ? [personUserId] : []);
  for (const { organization } of profiles) {
    const owner = profileOwnerOf(organization);
    if (owner) owners.add(owner);
  }
  return store.billing.factsFor({ ownerUserIds: [...owners], organizationIds: profiles.map((p) => p.organization.id) });
}

function resolve({ organization, malafatConnected }: ProfileForBilling, facts: BillingFactsRecord, now: Date, starter = false): Entitlement {
  return resolveEntitlement({ organizationId: organization.id, ownerUserId: profileOwnerOf(organization), malafatConnected }, facts, now, { starter });
}

/** The wire shape on `/v1/me` (BillingEntitlementSchema): ISO timestamps. */
export function serializeEntitlement(entitlement: Entitlement) {
  return {
    state: entitlement.state,
    source: entitlement.source,
    tier: entitlement.tier,
    until: entitlement.until?.toISOString() ?? null,
    paused: entitlement.paused === true,
    // MUT-731: read-only for the plan's business count (the person picks the active one); absent otherwise (additive).
    ...(entitlement.planLimit ? { planLimit: true } : {}),
  };
}
