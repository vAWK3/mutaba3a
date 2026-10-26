import type { Context } from 'hono';
import { entitlementsFor, standingOfPerson } from '../billing/coverage.js';
import type { Entitlement } from '../billing/entitlement.js';
import { PERSON_LEVEL_GATE, lapsedError, profileGateRefuses, standingOf, standingRefuses, type Standing } from '../billing/gate.js';
import type { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { AppEnv, SessionAuth, SessionIdentity } from './middleware.js';

/**
 * MUT-361 (ADR-181): where `authenticate()` applies the lapse gate (billing/gate.ts) to a session request, before any
 * route work: the facts are read here, the rules are gate.ts's. Only called while the gate is on (BILLING_GATE).
 */

export type GateStore = Pick<LedgerStore, 'memberships' | 'organizations' | 'integrations' | 'billing'>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A profile-scoped request: the selected profile's own entitlement decides. */
export async function gateSelectedProfile(c: Context<AppEnv>, auth: SessionAuth, endpoint: string, store: GateStore): Promise<void> {
  const entitlement = await entitlementOf(store, auth.organization, auth.writerOfRecord === 'MALAFAT', c.get('now')());
  if (profileGateRefuses(standingOf(entitlement.state), c.req.method, endpoint)) throw lapsedError(auth.organization.id, entitlement);
}

/**
 * An organization-independent request, by its class in PERSON_LEVEL_GATE. An endpoint missing there is refused
 * loudly in tests (gate.test / billing-gate-routes), never silently opened in production: it falls to `person`.
 */
export async function gatePersonLevel(c: Context<AppEnv>, identity: SessionIdentity, endpoint: string, store: GateStore): Promise<void> {
  const rule = PERSON_LEVEL_GATE[endpoint] ?? 'person';
  if (rule === 'open') return;
  const now = c.get('now')();
  if (rule === 'pathProfile') return gatePathProfile(c, identity, endpoint, store, now);

  const { standing, entitlements } = await standingOfPerson(store, identity.user.id, now);
  c.set('personEntitlements', entitlements);
  if (standingRefuses(standing, c.req.method)) throw lapsedError(null, representativeOf(standing, entitlements));
}

/** The profile named in the path, when the caller is one of its members; otherwise the route's own 404 answers. */
async function gatePathProfile(c: Context<AppEnv>, identity: SessionIdentity, endpoint: string, store: GateStore, now: Date): Promise<void> {
  const profileId = pathParam(endpoint, c.req.path, 'profileId');
  // Not a profile id at all: the route's own validation answers. A failing read is never "not a member" (fail closed).
  if (!profileId || !UUID_RE.test(profileId)) return;
  const membership = await store.memberships.find(identity.user.id, profileId);
  const organization = membership ? await store.organizations.getById(profileId) : null;
  if (!organization) return;
  const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
  const entitlement = await entitlementOf(store, organization, malafat?.status === 'CONNECTED', now);
  if (standingRefuses(standingOf(entitlement.state), c.req.method)) throw lapsedError(organization.id, entitlement);
}

/**
 * MUT-434 (guardrail; called by MUT-436's write tools): an agent's write to one profile follows that profile's lapse
 * state exactly as a session's write would — refused with 402 SUBSCRIPTION_LAPSED when it is read-only or locked.
 * `enforced` is the server's BILLING_GATE (off in tests and wherever the gate is off).
 */
export async function agentWriteGate(store: GateStore, organization: SessionAuth['organization'], now: Date, enforced: boolean): Promise<void> {
  if (!enforced) return;
  const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
  const entitlement = await entitlementOf(store, organization, malafat?.status === 'CONNECTED', now);
  if (standingRefuses(standingOf(entitlement.state), 'POST')) throw lapsedError(organization.id, entitlement);
}

/**
 * MUT-435 (review D2): an agent's read of one profile follows that profile's lapse state as a session's read would —
 * refused (402 SUBSCRIPTION_LAPSED) on a LOCKED profile, where a person only gets the records export; READ_ONLY reads
 * pass. Returns the refusal instead of throwing so a search across profiles can skip a locked one, as /v1/entries does.
 */
export async function agentReadRefusal(store: GateStore, organization: SessionAuth['organization'], now: Date, enforced: boolean): Promise<ApiError | null> {
  if (!enforced) return null;
  const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
  const entitlement = await entitlementOf(store, organization, malafat?.status === 'CONNECTED', now);
  return standingRefuses(standingOf(entitlement.state), 'GET') ? lapsedError(organization.id, entitlement) : null;
}

/**
 * MUT-435 (re-review finding 2): the person-level twin of agentReadRefusal, for reads on no profile (the inbox). A
 * session's inbox follows the person's best standing (PERSON_LEVEL_GATE `person`); so does an agent's: refused only
 * when every profile the person has is LOCKED.
 */
export async function agentPersonReadRefusal(store: GateStore, userId: string, now: Date, enforced: boolean): Promise<ApiError | null> {
  if (!enforced) return null;
  const { standing, entitlements } = await standingOfPerson(store, userId, now);
  return standingRefuses(standing, 'GET') ? lapsedError(null, representativeOf(standing, entitlements)) : null;
}

/**
 * MUT-436: an agent's write on no profile (the inbox) follows the person's standing exactly as a session's POST
 * /v1/inbox does (PERSON_LEVEL_GATE `person`): refused when the person's best standing is read-only or locked.
 */
export async function agentPersonWriteGate(store: GateStore, userId: string, now: Date, enforced: boolean): Promise<void> {
  if (!enforced) return;
  const { standing, entitlements } = await standingOfPerson(store, userId, now);
  if (standingRefuses(standing, 'POST')) throw lapsedError(null, representativeOf(standing, entitlements));
}

async function entitlementOf(store: GateStore, organization: SessionAuth['organization'], malafatConnected: boolean, now: Date): Promise<Entitlement> {
  const entitlements = await entitlementsFor(store, [{ organization, malafatConnected }], now);
  return entitlements.get(organization.id)!;
}

/** For a person-level refusal: the entitlement behind the person's standing (the details name its source and date). */
function representativeOf(standing: Standing, entitlements: ReadonlyMap<string, Entitlement>): Entitlement {
  const match = [...entitlements.values()].find((e) => standingOf(e.state) === standing);
  return match ?? { state: 'LOCKED', source: 'NONE', tier: null, until: null };
}

/**
 * A path parameter read from the request path against its endpoint template (`PATCH /v1/profiles/:profileId`). The
 * gate runs in `/v1/*` middleware, where Hono's `c.req.param()` holds the middleware's own (empty) parameters.
 */
export function pathParam(endpoint: string, path: string, name: string): string | null {
  const template = endpoint.slice(endpoint.indexOf(' ') + 1).split('/');
  const actual = path.split('/');
  if (template.length !== actual.length) return null;
  const index = template.indexOf(`:${name}`);
  // c.req.path is already decoded by Hono: decoding again would throw on a literal '%'.
  return index >= 0 ? actual[index]! : null;
}
