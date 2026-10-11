import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { matchedRoutes } from 'hono/route';
import type { PostingActor } from '../agreements/posting.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { ApiKeyRecord, LedgerStore, Organization, SessionRecord, UserRecord } from '../repositories/ports.js';
import { hashApiKey, hashesMatch, parseApiKey, type ApiKeyEnvironment } from './api-key.js';
import { hasScope, type Scope } from './scopes.js';
import { isSameOriginRequest, sessionCookieName, sessionDigest } from './sessions.js';
import { sessionScopes } from './writability.js';

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
    /** Set by the If-Match middleware on PATCH routes. */
    expectedVersion: number;
  };
};

export type Principal = 'apiKey' | 'session';

export interface RouteAccess {
  public: boolean;
  principals: ReadonlySet<Principal>;
}

/** Keyed `METHOD /hono/:path`, built from the OpenAPI registry so enforcement reads what the contract publishes. */
export type RouteAccessIndex = ReadonlyMap<string, RouteAccess>;

interface RouteDefinition {
  type: string;
  route?: { method: string; path: string; security?: Array<Record<string, unknown>> };
}

export function buildRouteAccessIndex(definitions: readonly RouteDefinition[]): RouteAccessIndex {
  const index = new Map<string, RouteAccess>();
  for (const def of definitions) {
    if (def.type !== 'route' || !def.route) continue;
    const security = def.route.security ?? [];
    const principals = new Set<Principal>();
    for (const requirement of security) {
      if ('apiKey' in requirement) principals.add('apiKey');
      if ('session' in requirement) principals.add('session');
    }
    const path = def.route.path.replace(/\{([^}]+)\}/g, ':$1');
    index.set(`${def.route.method.toUpperCase()} ${path}`, { public: Array.isArray(def.route.security) && security.length === 0, principals });
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
      return next();
    }

    if (cookie) {
      const identity = await authenticateSession(c, cookie, options);
      if (access && !access.principals.has('session')) throw principalNotAccepted();
      if (!SAFE_METHODS.has(c.req.method) && !isSameOriginRequest(c.req, options.sessions.portalOrigin)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'This request must come from the Mutaba3a portal itself');
      }
      c.set('identity', identity);
      if (endpoint && !options.organizationIndependent.has(endpoint)) c.set('auth', await selectProfile(c, identity, options.store));
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
  const requested = c.req.header('x-mutaba3a-profile');
  if (!requested) {
    throw new ApiError('VALIDATION_FAILED', 'Name the profile to act on in the X-Mutaba3a-Profile header', { reason: 'PROFILE_REQUIRED' });
  }
  const membership = UUID_RE.test(requested) ? await store.memberships.find(identity.user.id, requested) : null;
  const organization = membership ? await store.organizations.getById(membership.organizationId) : null;
  if (!organization) throw new ApiError('NOT_FOUND', 'Profile not found');
  return { kind: 'session', organization, user: identity.user, session: identity.session, scopes: sessionScopes() };
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

export function requireScope(scope: Scope): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    const granted = auth.kind === 'apiKey' ? auth.apiKey.scopes : auth.scopes;
    if (!hasScope(granted, scope)) {
      throw new ApiError('INSUFFICIENT_SCOPE', `This operation requires the "${scope}" scope`, {
        required: scope,
        granted,
      });
    }
    await next();
  };
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
