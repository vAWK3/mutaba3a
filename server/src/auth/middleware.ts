import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { matchedRoutes } from 'hono/route';
import type { PostingActor } from '../agreements/posting.js';
import { ApiError, ownedProfileConflict } from '../errors.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { ApiKeyRecord, LedgerStore, MembershipRecord, MembershipRole, OAuthGrantRecord, Organization, SessionRecord, UserRecord } from '../repositories/ports.js';
import { isOAuthToken } from '../oauth/tokens.js';
import { hashApiKey, hashesMatch, parseApiKey, type ApiKeyEnvironment } from './api-key.js';
import { gatePersonLevel, gateSelectedProfile } from './billing-gate.js';
import { CLOSING_OPEN_ENDPOINTS, closingRefusal, isAccountGone } from '../accounts/closure.js';
import type { Entitlement } from '../billing/entitlement.js';
import { hasScope, isScope, type Scope } from './scopes.js';
import { DEFAULT_DEVICE_IDLE_DAYS, isDeviceSessionToken, isSamePortalOrigin, sessionCookieName, sessionDigest } from './sessions.js';
import { principalStoreGuard, unguarded, type StoreGuard } from './store-guard.js';
import { domainOfScope, matrixRow, profileWriterOf, sessionScopesFor, writeRefusal, type Principal, type ProfileWriter } from './writability.js';

/**
 * Two principals on /v1 (ADR-037 decisions 3–6):
 *  - an organization API key (Malafat's backend), which implies its organization;
 *  - a user session (the hosted portal), which selects one of the user's
 *    memberships per request with X-Mutaba3a-Profile.
 * Each route declares which it accepts in its OpenAPI `security`, and
 * `authenticate()` enforces exactly that declaration.
 */
export interface ApiKeyAuth {
  kind: 'apiKey';
  organization: Organization;
  apiKey: ApiKeyRecord;
}

export interface SessionAuth {
  kind: 'session';
  organization: Organization;
  user: UserRecord;
  session: SessionRecord;
  /** Effective scopes from the writability matrix's session column. */
  scopes: readonly Scope[];
  /** The selected profile's writer of record, for READ_ONLY_PROFILE. */
  writerOfRecord: ProfileWriter;
  /** MUT-373 (eng review A1): the caller's role on the selected profile, from the membership that admitted them — `ownsProfile` reads it. */
  membershipRole: MembershipRole;
}

/** What every organization-scoped route can read from the context. */
export type AuthContext = ApiKeyAuth | SessionAuth;

/** MUT-434: an MCP agent acting for a person through an OAuth access token. */
export interface AgentIdentity {
  user: UserRecord;
  grant: OAuthGrantRecord;
}

/** The signed-in person, set for every session request (including the organization-independent identity routes). */
export interface SessionIdentity {
  user: UserRecord;
  session: SessionRecord;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    auth: AuthContext;
    identity: SessionIdentity;
    /** MUT-434: set by authenticateAgent() on /mcp only — the person, their grant and its scopes. */
    agent: AgentIdentity;
    now: () => Date;
    /** Set by authenticate(); the store guard (store-guard.ts) every repository call consults. Absent on /admin, health and sign-in. */
    storeGuard: StoreGuard;
    /** Set by the If-Match middleware on PATCH routes. */
    expectedVersion: number;
    /** MUT-361: whether the lapse gate is enforced on this server (app-shell.ts, from BILLING_GATE). */
    billingGate: boolean;
    /** MUT-370 (D9): whether this server offers passkeys (app-shell.ts, from WEBAUTHN_RP_ID); /v1/me's suggestion reads it. */
    passkeys: boolean;
    /** MUT-474: a dev server's owned-profile cap (app-shell.ts, from QA_MAX_OWNED_PROFILES); unset = the product limit. */
    maxOwnedProfiles: number | undefined;
    /** MUT-361: on a person-level route, each of the person's profiles' entitlements (a cross-profile read leaves LOCKED ones out). */
    personEntitlements: ReadonlyMap<string, Entitlement>;
    /** MUT-447: report an error a route handled itself (a partial answer), as the shell reports an unhandled one (ADR-091). */
    reportError: (err: unknown) => void;
  };
};

export interface RouteAccess {
  public: boolean;
  principals: ReadonlySet<Principal>;
  /** From the route's `requireScope` middleware, in declaration order. */
  scopes: readonly Scope[];
}

/** Keyed `METHOD /hono/:path`, built from the OpenAPI registry so enforcement reads what the contract publishes. */
export type RouteAccessIndex = ReadonlyMap<string, RouteAccess>;

interface RouteDefinition {
  type: string;
  route?: { method: string; path: string; security?: Array<Record<string, unknown>> };
}

/** An entry of Hono's `app.routes`: each middleware and handler of a route, in order. */
interface RegisteredHandler {
  method: string;
  path: string;
  handler: unknown;
}

/**
 * Principals come from the published `security`; scopes from the tagged
 * `requireScope` middleware the route registered (the registry does not keep
 * middleware), so neither needs a second declaration.
 */
export function buildRouteAccessIndex(definitions: readonly RouteDefinition[], handlers: readonly RegisteredHandler[] = []): RouteAccessIndex {
  const scopes = new Map<string, Scope[]>();
  for (const h of handlers) {
    const scope = requiredScopeOf(h.handler);
    if (!scope) continue;
    const key = `${h.method} ${h.path}`;
    scopes.set(key, [...(scopes.get(key) ?? []), scope]);
  }
  const index = new Map<string, RouteAccess>();
  for (const def of definitions) {
    if (def.type !== 'route' || !def.route) continue;
    const security = def.route.security ?? [];
    const principals = new Set<Principal>();
    for (const requirement of security) {
      if ('apiKey' in requirement) principals.add('apiKey');
      if ('session' in requirement) principals.add('session');
      // A device session (MUT-64) is the 'session' Principal too — same writability, different transport.
      if ('deviceSession' in requirement) principals.add('session');
    }
    const key = `${def.route.method.toUpperCase()} ${def.route.path.replace(/\{([^}]+)\}/g, ':$1')}`;
    index.set(key, { public: Array.isArray(def.route.security) && security.length === 0, principals, scopes: scopes.get(key) ?? [] });
  }
  return index;
}

export interface SessionSettings {
  pepper: string;
  idleMinutes: number;
  absoluteHours: number;
  /** Secure + `__Host-` prefix; false only for plain-HTTP local development. */
  secureCookie: boolean;
  portalOrigin?: string;
  trustedProxyHops: number;
  /** MUT-326: the front door's shared secret; with it, requests that carry it are judged by PORTAL_ORIGIN and the IP it hands over. */
  frontDoorToken?: string;
  /** MUT-326 stage "redirect": portal page visits that bypass the front door go to the carry-over page, then the new host. */
  legacyRedirect?: boolean;
  /** MUT-64 device-session lifetime (native app bearer tokens). Defaults to 30/180 days when absent. */
  deviceIdleDays?: number;
  deviceAbsoluteDays?: number;
}

export interface AuthenticateOptions {
  store: LedgerStore;
  environment: ApiKeyEnvironment;
  rateLimiter: RateLimiter;
  sessions: SessionSettings;
  /** Resolved lazily: routes are registered after the middleware. */
  routeAccess: () => RouteAccessIndex;
  /** Session routes that act on the person, not on an organization (no X-Mutaba3a-Profile). */
  organizationIndependent: ReadonlySet<string>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** lastSeenAt is written at most once a minute. */
const TOUCH_INTERVAL_MS = 60_000;

export function authenticate(options: AuthenticateOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const endpoint = endpointKey(c);
    const access = endpoint ? options.routeAccess().get(endpoint) : undefined;
    if (access?.public) return next();

    const bearer = bearerToken(c);
    const cookie = getCookie(c, sessionCookieName(options.sessions.secureCookie));
    if (bearer && cookie) {
      throw new ApiError('UNAUTHENTICATED', 'Send either an API key or a session cookie, not both', { reason: 'ambiguous_credentials' });
    }

    if (bearer) {
      // MUT-434: an agent's OAuth token opens /mcp only; refused here explicitly rather than tried as an API key.
      if (isOAuthToken(bearer)) throw principalNotAccepted();
      if (isDeviceSessionToken(bearer)) {
        const identity = await authenticateDeviceSessionToken(c, bearer, options);
        if (access && !access.principals.has('session')) throw await keyOnlyRefusal(c, identity, access, options.store);
        await finishSessionAuth(c, identity, endpoint, options);
        return next();
      }
      const auth = await authenticateApiKey(c, bearer, options);
      if (access && !access.principals.has('apiKey')) throw principalNotAccepted();
      c.set('auth', auth);
      c.set('storeGuard', principalStoreGuard('apiKey', null));
      return next();
    }

    if (cookie) {
      const identity = await authenticateSession(c, cookie, options);
      if (access && !access.principals.has('session')) throw await keyOnlyRefusal(c, identity, access, options.store);
      if (!SAFE_METHODS.has(c.req.method) && !isSamePortalOrigin(c.req, options.sessions)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'This request must come from the MTB3A portal itself');
      }
      await finishSessionAuth(c, identity, endpoint, options);
      return next();
    }

    throw new ApiError('UNAUTHENTICATED', 'Missing credentials: an API key (Authorization: Bearer) or a session cookie');
  };
}

/**
 * The tail shared by a cookie session and a device-session bearer token once
 * the credential itself has verified (MUT-64): name the signed-in person,
 * select the organization a profile-scoped route needs, and set the store
 * guard. CSRF/same-origin enforcement is NOT here — it's cookie-only and stays
 * inline in the cookie branch above, since a device bearer has no comparable
 * signal to check.
 */
async function finishSessionAuth(c: Context<AppEnv>, identity: SessionIdentity, endpoint: string | null, options: AuthenticateOptions): Promise<void> {
  c.set('identity', identity);
  // MUT-333 (D3): a closing account reaches only Me, Keep my account and sign-out, before any profile or gate.
  const closure = identity.user.closure;
  if (closure && endpoint && !CLOSING_OPEN_ENDPOINTS.has(endpoint)) throw closingRefusal(closure);
  let profileWriter: ProfileWriter = null;
  // MUT-361 (ADR-181): the lapse gate, before any route work. An unmatched route (null endpoint) is never gated: its 404 answers.
  const gated = c.get('billingGate') === true;
  if (endpoint && !options.organizationIndependent.has(endpoint)) {
    const auth = await selectProfile(c, identity, options.store);
    c.set('auth', auth);
    profileWriter = auth.writerOfRecord;
    if (gated) await gateSelectedProfile(c, auth, endpoint, options.store);
  } else if (endpoint && gated) {
    await gatePersonLevel(c, identity, endpoint, options.store);
  }
  c.set('storeGuard', principalStoreGuard('session', profileWriter));
}

/**
 * Bearer API-key authentication (plan §13.2: validity, scope, organization,
 * revocation, environment — in that order, every request, uncached).
 * Failure modes are distinct codes so Malafat can tell a Partner exactly what
 * happened (UX brief D13). Scope is checked per route by `requireScope`.
 */
async function authenticateApiKey(c: Context<AppEnv>, presented: string, options: AuthenticateOptions): Promise<ApiKeyAuth> {
  const parsed = parseApiKey(presented);
  if (!parsed) throw new ApiError('INVALID_API_KEY', 'The API key is malformed');

  if (parsed.environment !== options.environment) {
    throw new ApiError(
      'API_KEY_ENVIRONMENT_MISMATCH',
      `This deployment accepts "${options.environment}" keys; the presented key is "${parsed.environment}"`,
    );
  }

  const record = await options.store.apiKeys.findByPrefix(parsed.prefix);
  if (!record || !hashesMatch(record.keyHash, hashApiKey(presented))) {
    throw new ApiError('INVALID_API_KEY', 'The API key is not recognised');
  }

  const now = c.get('now')();
  if (record.revokedAt) throw new ApiError('API_KEY_REVOKED', 'The API key has been revoked');
  if (record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError('API_KEY_EXPIRED', 'The API key has expired');
  }

  const organization = await options.store.organizations.getById(record.organizationId);
  if (!organization) throw new ApiError('INVALID_API_KEY', 'The API key is not attached to an organization');
  // MUT-120/182: no key is ever issued for a profile a person owns (admin.ts); one that exists anyway reaches nothing —
  // which is also what keeps such a profile from ever being bound to Malafat (/v1/integration/bind takes a key).
  if (profileOwnerOf(organization)) throw ownedProfileConflict(organization, 'A profile a person owns cannot be reached with an API key');

  await enforceRateLimit(c, options.rateLimiter, record.id, now, 'Too many requests for this API key');
  await options.store.apiKeys.touchLastUsed(record.id, now);
  return { kind: 'apiKey', organization, apiKey: record };
}

/** A session is valid while unrevoked, inside both deadlines, and its user is ACTIVE with no password change since it began. */
async function authenticateSession(c: Context<AppEnv>, token: string, options: AuthenticateOptions): Promise<SessionIdentity> {
  const { store, sessions: settings } = options;
  const digest = sessionDigest(settings.pepper, token);
  return validateSessionRecord(c, store, digest, options.rateLimiter, 'session', settings.idleMinutes * 60_000);
}

/** The device-session bearer equivalent of authenticateSession (MUT-64): same validity rule, device-length idle window. */
async function authenticateDeviceSessionToken(c: Context<AppEnv>, token: string, options: AuthenticateOptions): Promise<SessionIdentity> {
  const { store, sessions: settings } = options;
  const digest = sessionDigest(settings.pepper, token);
  const idleMs = (settings.deviceIdleDays ?? DEFAULT_DEVICE_IDLE_DAYS) * 86_400_000;
  return validateSessionRecord(c, store, digest, options.rateLimiter, 'device-session', idleMs);
}

/**
 * Shared by a cookie session and a device-session token: valid while
 * unrevoked, inside both deadlines, and its user is ACTIVE with no password
 * change since the session last proved the password (sign-in, or MUT-237's
 * own change, which re-stamps only the session that made it). `rateLimitPrefix` keeps the two kinds'
 * per-session rate-limit buckets separate; `idleMs` is the caller's idle
 * window (cookie minutes vs. device days) for the touch recompute.
 */
async function validateSessionRecord(
  c: Context<AppEnv>,
  store: LedgerStore,
  digest: string,
  rateLimiter: RateLimiter,
  rateLimitPrefix: string,
  idleMs: number,
): Promise<SessionIdentity> {
  const now = c.get('now')();
  const session = await store.sessions.findByDigest(digest);
  if (
    !session ||
    !hashesMatch(session.tokenDigest, digest) ||
    session.revokedAt ||
    now.getTime() >= session.idleExpiresAt.getTime() ||
    now.getTime() >= session.absoluteExpiresAt.getTime()
  ) {
    throw sessionExpired();
  }

  const user = await store.users.getById(session.userId);
  // MUT-333 (D5): past its deadline, or claimed by the hard delete, a closed account keeps no session.
  if (!user || user.status !== 'ACTIVE' || isAccountGone(user.closure, now)) {
    await store.sessions.revoke(session.id, 'account_changed', now);
    throw sessionExpired();
  }
  const verified = await verifiedSincePasswordChange(store, session, digest, user, now);

  await enforceRateLimit(c, rateLimiter, `${rateLimitPrefix}:${verified.id}`, now, 'Too many requests for this session');
  if (now.getTime() - verified.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const idleExpiresAt = new Date(Math.min(now.getTime() + idleMs, verified.absoluteExpiresAt.getTime()));
    await store.sessions.touch(verified.id, now, idleExpiresAt);
  }
  return { user, session: verified };
}

/**
 * A session verified before the person's last password change is revoked (MUT-237). But the session and the person
 * are two reads: this session's own change may have committed between them, and it stamps the kept session in the
 * same transaction that moves `passwordChangedAt`. So a session that looks stale is read once more, and revoked only
 * if it still is: a concurrent request never signs out the device that just changed the password (MUT-238 review).
 */
async function verifiedSincePasswordChange(store: LedgerStore, session: SessionRecord, digest: string, user: UserRecord, now: Date): Promise<SessionRecord> {
  const isStale = (s: SessionRecord) => user.passwordChangedAt.getTime() > s.credentialsVerifiedAt.getTime();
  if (!isStale(session)) return session;
  const fresh = await store.sessions.findByDigest(digest);
  if (fresh && !fresh.revokedAt && !isStale(fresh)) return fresh;
  await store.sessions.revoke(session.id, 'account_changed', now);
  throw sessionExpired();
}

/** ADR-025 §2 as amended by ADR-037: a session names one of its memberships; anything else is indistinguishable from absent. */
async function selectProfile(c: Context<AppEnv>, identity: SessionIdentity, store: LedgerStore): Promise<SessionAuth> {
  if (!c.req.header('x-mutaba3a-profile')) {
    throw new ApiError('VALIDATION_FAILED', 'Name the profile to act on in the X-Mutaba3a-Profile header', { reason: 'PROFILE_REQUIRED' });
  }
  const named = await namedMembership(c, identity, store);
  // MUT-374 D6: the reason tells a client the named profile itself is gone for this person (left, removed, never
  // theirs), not a record under it, so the phone re-reads /v1/me and drops it.
  if (!named) throw new ApiError('NOT_FOUND', 'Profile not found', { reason: 'PROFILE_NOT_FOUND' });
  const { organization, membership } = named;
  const writerOfRecord = await profileWriterOf(store, organization.id);
  return { kind: 'session', organization, user: identity.user, session: identity.session, scopes: sessionScopesFor(writerOfRecord), writerOfRecord, membershipRole: membership.role };
}

async function namedMembership(c: Context<AppEnv>, identity: SessionIdentity, store: LedgerStore): Promise<{ organization: Organization; membership: MembershipRecord } | null> {
  const requested = c.req.header('x-mutaba3a-profile');
  const membership = requested && UUID_RE.test(requested) ? await store.memberships.find(identity.user.id, requested) : null;
  const organization = membership ? await store.organizations.getById(membership.organizationId) : null;
  return organization && membership ? { organization, membership } : null;
}

/**
 * hosted-portal.md §5 layer 2: a session on a key-only route that writes a
 * domain Malafat owns is told the profile is read-only; any other key-only
 * route was never the session's to use. The writer of record is resolved only
 * for a member organization, so the refusal says nothing about anyone else's.
 */
async function keyOnlyRefusal(c: Context<AppEnv>, identity: SessionIdentity, access: RouteAccess, store: LedgerStore): Promise<ApiError> {
  const domain = access.scopes
    .filter((s) => s.endsWith(':write'))
    .map(domainOfScope)
    .find((d) => d !== undefined && matrixRow(d).writerOfRecord === 'MALAFAT');
  if (!domain) return principalNotAccepted();
  const named = await namedMembership(c, identity, store);
  return writeRefusal(domain, named ? await profileWriterOf(store, named.organization.id) : null);
}

async function enforceRateLimit(c: Context<AppEnv>, limiter: RateLimiter, key: string, now: Date, message: string): Promise<void> {
  const decision = await limiter.check(key, now);
  c.header('X-RateLimit-Limit', String(decision.limit));
  c.header('X-RateLimit-Remaining', String(decision.remaining));
  if (!decision.allowed) {
    c.header('Retry-After', String(decision.retryAfterSeconds));
    throw new ApiError('RATE_LIMITED', message, { retryAfterSeconds: decision.retryAfterSeconds });
  }
}

const REQUIRED_SCOPE = Symbol('requiredScope');

/** The scope a `requireScope` middleware enforces, or undefined for any other handler. */
export function requiredScopeOf(handler: unknown): Scope | undefined {
  const scope: unknown = typeof handler === 'function' ? (handler as unknown as Record<symbol, unknown>)[REQUIRED_SCOPE] : undefined;
  return typeof scope === 'string' && isScope(scope) ? scope : undefined;
}

/**
 * The per-route scope check. Tagged with its scope so buildRouteAccessIndex
 * can read every route's requirement. A session lacking a write the matrix
 * gives Malafat is told the profile is read-only, not that a scope is missing
 * (hosted-portal.md §5 layer 1).
 */
export function requireScope(scope: Scope): MiddlewareHandler<AppEnv> {
  const middleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    const auth = c.get('auth');
    const granted = auth.kind === 'apiKey' ? auth.apiKey.scopes : auth.scopes;
    if (!hasScope(granted, scope)) {
      const domain = domainOfScope(scope);
      if (auth.kind === 'session' && scope.endsWith(':write') && domain && matrixRow(domain).writerOfRecord === 'MALAFAT') {
        throw writeRefusal(domain, auth.writerOfRecord);
      }
      throw new ApiError('INSUFFICIENT_SCOPE', `This operation requires the "${scope}" scope`, {
        required: scope,
        granted,
      });
    }
    await next();
  };
  return Object.assign(middleware, { [REQUIRED_SCOPE]: scope });
}

/** Structural view of a route context, so helpers accept any route's typed Context. */
interface AuthReader {
  get(key: 'auth'): AuthContext;
  get(key: 'requestId'): string;
}

/**
 * For handlers of key-only routes. authenticate() already refused a session
 * there; this narrows the type and refuses again if a route is ever mis-declared.
 */
export function keyAuth(c: AuthReader): ApiKeyAuth {
  const auth = c.get('auth');
  if (auth.kind !== 'apiKey') throw principalNotAccepted();
  return auth;
}

/** For handlers of session-only routes (MUT-42): the mirror of keyAuth. */
export function sessionAuth(c: AuthReader): SessionAuth {
  const auth = c.get('auth');
  if (auth.kind !== 'session') throw principalNotAccepted();
  return auth;
}

/**
 * Who lazy posting is attributed to (ADR-037 decision 8): the calling key for
 * Malafat, SYSTEM for a session — catching up due items is the reconcile job's
 * work done early, not the person writing the ledger.
 */
export function postingActorOf(c: AuthReader): PostingActor {
  return postingActorFor(c.get('auth'), c.get('requestId'));
}

function postingActorFor(auth: AuthContext, requestId: string): PostingActor {
  return auth.kind === 'apiKey' ? { actorType: 'API_KEY', actorId: auth.apiKey.id, requestId } : { actorType: 'SYSTEM', actorId: null, requestId };
}

/** The real caller behind a request, for an audit row (MUT-65: unlike postingActorOf, never SYSTEM — this is for a write the caller actually asked for, not lazy catch-up). */
export interface AuditActor {
  actorType: 'API_KEY' | 'USER';
  actorId: string;
}

/**
 * Who to credit a write to when a route accepts both principals (MUT-65:
 * `POST /v1/customers`, `POST /v1/projects`, now reachable by a session too).
 * Mirrors `postingActorOf`'s shape for the two principals that write on
 * request, rather than the lazy-posting SYSTEM case.
 */
export function actorOf(c: AuthReader): AuditActor {
  const auth = c.get('auth');
  return auth.kind === 'apiKey' ? { actorType: 'API_KEY', actorId: auth.apiKey.id } : { actorType: 'USER', actorId: auth.user.id };
}

/**
 * The store and actor for lazy posting during a read (ADR-037 decision 8).
 * A key posts through the guarded store as itself; a session's read posts as
 * SYSTEM on the store beneath the guard, because the catch-up is the reconcile
 * job's, not a write by the person. The two always travel together.
 */
export function lazyPostingOf(c: PostingReader, store: LedgerStore): { store: LedgerStore; actor: PostingActor } {
  const auth = c.get('auth');
  const actor = auth ? postingActorFor(auth, c.get('requestId')) : personPostingActorOf(c);
  return { store: actor.actorType === 'SYSTEM' ? unguarded(store) : store, actor };
}

interface PostingReader {
  get(key: 'auth'): AuthContext | undefined;
  get(key: 'identity'): SessionIdentity | undefined;
  get(key: 'requestId'): string;
}

/**
 * MUT-447 (review): a person-level read (the verdict) selects no profile, so authenticate() set no `auth`. Its
 * catch-up posting is SYSTEM, as a session's always is, but only for a signed-in person: anything else is refused
 * rather than handed the store beneath the guard.
 */
function personPostingActorOf(c: PostingReader): PostingActor {
  if (!c.get('identity')) throw principalNotAccepted();
  return { actorType: 'SYSTEM', actorId: null, requestId: c.get('requestId') };
}

/** Exported for requireMinimumBuild (MUT-293), which needs the same public-route exemption authenticate() uses. */
export function endpointKey(c: Context): string | null {
  const endpoint = matchedRoutes(c).find((r) => r.method !== 'ALL' && !r.path.endsWith('*'));
  return endpoint ? `${endpoint.method} ${endpoint.path}` : null;
}

function bearerToken(c: Context): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function principalNotAccepted(): ApiError {
  return new ApiError('PRINCIPAL_NOT_ACCEPTED', 'This operation does not accept this kind of credential');
}

function sessionExpired(): ApiError {
  return new ApiError('SESSION_EXPIRED', 'The session has expired or was signed out; sign in again');
}
