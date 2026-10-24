import type { Context } from 'hono';
import { entitlementsFor, standingOfPerson } from '../billing/coverage.js';
import type { Entitlement } from '../billing/entitlement.js';
import { PERSON_LEVEL_GATE, lapsedError, profileGateRefuses, standingOf, standingRefuses, type Standing } from '../billing/gate.js';
import type { LedgerStore } from '../repositories/ports.js';
import type { AppEnv, SessionAuth, SessionIdentity } from './middleware.js';

/**
 * MUT-361 (ADR-181): where `authenticate()` applies the lapse gate (billing/gate.ts) to a session request, before any
 * route work: the facts are read here, the rules are gate.ts's. Only called while the gate is on (BILLING_GATE).
 */

type GateStore = Pick<LedgerStore, 'memberships' | 'organizations' | 'integrations' | 'billing'>;

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
  c.set('lockedProfileIds', new Set([...entitlements].filter(([, e]) => e.state === 'LOCKED').map(([id]) => id)));
  if (standingRefuses(standing, c.req.method)) throw lapsedError(null, representativeOf(standing, entitlements));
}

/** The profile named in the path, when the caller is one of its members; otherwise the route's own 404 answers. */
async function gatePathProfile(c: Context<AppEnv>, identity: SessionIdentity, endpoint: string, store: GateStore, now: Date): Promise<void> {
  const profileId = pathParam(endpoint, c.req.path, 'profileId');
  if (!profileId) return;
  const membership = await store.memberships.find(identity.user.id, profileId).catch(() => null);
  const organization = membership ? await store.organizations.getById(profileId) : null;
  if (!organization) return;
  const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
  const entitlement = await entitlementOf(store, organization, malafat?.status === 'CONNECTED', now);
  if (standingRefuses(standingOf(entitlement.state), c.req.method)) throw lapsedError(organization.id, entitlement);
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
  return index >= 0 ? decodeURIComponent(actual[index]!) : null;
}
