import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { matchedRoutes } from 'hono/route';
import type { PostingActor } from '../agreements/posting.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { ApiKeyRecord, LedgerStore, Organization, SessionRecord, UserRecord } from '../repositories/ports.js';
import { hashApiKey, hashesMatch, parseApiKey, type ApiKeyEnvironment } from './api-key.js';
import { hasScope, isScope, type Scope } from './scopes.js';
import { isSameOriginRequest, sessionCookieName, sessionDigest } from './sessions.js';
import { principalStoreGuard, unguarded, type StoreGuard } from './store-guard.js';
import { domainOfScope, matrixRow, profileWriterOf, sessionScopes, writeRefusal, type Principal, type ProfileWriter } from './writability.js';

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
}

/** What every organization-scoped route can read from the context. */
export type AuthContext = ApiKeyAuth | SessionAuth;

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
    now: () => Date;
    /** Set by authenticate(); the store guard (store-guard.ts) every repository call consults. Absent on /admin, health and sign-in. */
    storeGuard: StoreGuard;
    /** Set by the If-Match middleware on PATCH routes. */
    expectedVersion: number;
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
      const auth = await authenticateApiKey(c, bearer, options);
      if (access && !access.principals.has('apiKey')) throw principalNotAccepted();
      c.set('auth', auth);
      c.set('storeGuard', principalStoreGuard('apiKey', null));
      return next();
    }

    if (cookie) {
      const identity = await authenticateSession(c, cookie, options);
      if (access && !access.principals.has('session')) throw await keyOnlyRefusal(c, identity, access, options.store);
      if (!SAFE_METHODS.has(c.req.method) && !isSameOriginRequest(c.req, options.sessions.portalOrigin)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'This request must come from the Mutaba3a portal itself');
      }
      c.set('identity', identity);
      let profileWriter: ProfileWriter = null;
      if (endpoint && !options.organizationIndependent.has(endpoint)) {
        const auth = await selectProfile(c, identity, options.store);
        c.set('auth', auth);
        profileWriter = auth.writerOfRecord;
      }
      c.set('storeGuard', principalStoreGuard('session', profileWriter));
      return next();
    }

    throw new ApiError('UNAUTHENTICATED', 'Missing credentials: an API key (Authorization: Bearer) or a session cookie');
  };
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

  await enforceRateLimit(c, options.rateLimiter, record.id, now, 'Too many requests for this API key');
  await options.store.apiKeys.touchLastUsed(record.id, now);
  return { kind: 'apiKey', organization, apiKey: record };
}

/** A session is valid while unrevoked, inside both deadlines, and its user is ACTIVE with no password change since it began. */
async function authenticateSession(c: Context<AppEnv>, token: string, options: AuthenticateOptions): Promise<SessionIdentity> {
  const { store, sessions: settings } = options;
  const now = c.get('now')();
  const digest = sessionDigest(settings.pepper, token);
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
  if (!user || user.status !== 'ACTIVE' || user.passwordChangedAt.getTime() > session.createdAt.getTime()) {
    await store.sessions.revoke(session.id, 'account_changed', now);
    throw sessionExpired();
  }

  await enforceRateLimit(c, options.rateLimiter, `session:${session.id}`, now, 'Too many requests for this session');
  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    const idleExpiresAt = new Date(Math.min(now.getTime() + settings.idleMinutes * 60_000, session.absoluteExpiresAt.getTime()));
    await store.sessions.touch(session.id, now, idleExpiresAt);
  }
  return { user, session };
}

/** ADR-025 §2 as amended by ADR-037: a session names one of its memberships; anything else is indistinguishable from absent. */
async function selectProfile(c: Context<AppEnv>, identity: SessionIdentity, store: LedgerStore): Promise<SessionAuth> {
  if (!c.req.header('x-mutaba3a-profile')) {
    throw new ApiError('VALIDATION_FAILED', 'Name the profile to act on in the X-Mutaba3a-Profile header', { reason: 'PROFILE_REQUIRED' });
  }
  const organization = await namedMemberOrganization(c, identity, store);
  if (!organization) throw new ApiError('NOT_FOUND', 'Profile not found');
  const writerOfRecord = await profileWriterOf(store, organization.id);
  return { kind: 'session', organization, user: identity.user, session: identity.session, scopes: sessionScopes(), writerOfRecord };
}

async function namedMemberOrganization(c: Context<AppEnv>, identity: SessionIdentity, store: LedgerStore): Promise<Organization | null> {
  const requested = c.req.header('x-mutaba3a-profile');
  const membership = requested && UUID_RE.test(requested) ? await store.memberships.find(identity.user.id, requested) : null;
  return membership ? store.organizations.getById(membership.organizationId) : null;
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
  const organization = await namedMemberOrganization(c, identity, store);
  return writeRefusal(domain, organization ? await profileWriterOf(store, organization.id) : null);
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

/**
 * Who lazy posting is attributed to (ADR-037 decision 8): the calling key for
 * Malafat, SYSTEM for a session — catching up due items is the reconcile job's
 * work done early, not the person writing the ledger.
 */
export function postingActorOf(c: AuthReader): PostingActor {
  const auth = c.get('auth');
  return auth.kind === 'apiKey'
    ? { actorType: 'API_KEY', actorId: auth.apiKey.id, requestId: c.get('requestId') }
    : { actorType: 'SYSTEM', actorId: null, requestId: c.get('requestId') };
}

/**
 * The store and actor for lazy posting during a read (ADR-037 decision 8).
 * A key posts through the guarded store as itself; a session's read posts as
 * SYSTEM on the store beneath the guard, because the catch-up is the reconcile
 * job's, not a write by the person. The two always travel together.
 */
export function lazyPostingOf(c: AuthReader, store: LedgerStore): { store: LedgerStore; actor: PostingActor } {
  const actor = postingActorOf(c);
  return { store: actor.actorType === 'SYSTEM' ? unguarded(store) : store, actor };
}

function endpointKey(c: Context): string | null {
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
