import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { clientIp, generateSessionToken, isSameOriginRequest, sessionCookieName, sessionDigest, type SignInThrottle } from '../auth/sessions.js';
import { generateOneTimePassword, normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { sessionAccess } from '../auth/writability.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, MeSchema, SignInRequestSchema } from '../schemas.js';

/**
 * Sign-in, sign-out and the signed-in person (MUT-38, hosted-portal.md §4, §6).
 *
 * Sign-in never reveals whether an email has an account: every refusal is the
 * same 401 INVALID_CREDENTIALS, every attempt runs exactly one argon2 verify
 * (against a dummy hash with the same parameters when there is no user), and
 * lockout keys on the normalised email string whether or not it exists.
 */
export interface SessionRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  settings: SessionSettings;
  throttle: SignInThrottle;
  ipLimiter: RateLimiter;
}

/** Session routes that act on the person rather than an organization: no X-Mutaba3a-Profile. */
export const ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me', 'DELETE /v1/sessions/current']);

const USER_AGENT_MAX = 200;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function sessionRoutes(options: SessionRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, throttle, ipLimiter } = options;
  const app = new OpenAPIHono<AppEnv>();
  const cookieName = sessionCookieName(settings.secureCookie);
  const cookieOptions = { path: '/', httpOnly: true, secure: settings.secureCookie, sameSite: 'Strict' } as const;

  // One hash with the configured parameters, made on first use, so an unknown email costs what a known one does.
  let dummy: Promise<string> | undefined;
  const dummyHash = () => (dummy ??= passwordHasher.hash(generateOneTimePassword()));
  void dummyHash(); // warm it now, so the first unknown email is not slower than the rest

  async function auditToMembers(c: Context<AppEnv>, user: UserRecord, action: 'user.signed_in' | 'user.locked_out') {
    for (const m of await store.memberships.listByUser(user.id)) {
      await store.audit.append({
        organizationId: m.organizationId,
        actorType: action === 'user.signed_in' ? 'USER' : 'SYSTEM',
        actorId: action === 'user.signed_in' ? user.id : null,
        action,
        entityType: 'user',
        entityId: user.id,
        requestId: c.get('requestId'),
      });
    }
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/sessions',
      tags: ['Sessions'],
      summary: 'Sign in (sets the session cookie)',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SignInRequestSchema } } } },
      responses: {
        201: { description: 'Signed in; the session cookie is set', content: { 'application/json': { schema: MeSchema } } },
        401: errorResponse('INVALID_CREDENTIALS — the same answer for every refusal'),
        403: errorResponse('CROSS_SITE_REQUEST'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      if (!isSameOriginRequest(c.req, settings.portalOrigin)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'Sign in from the Mutaba3a portal itself');
      }
      const now = c.get('now')();
      const ip = await ipLimiter.check(`sign-in:${clientIp((name) => c.req.header(name), settings.trustedProxyHops)}`, now);
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }

      const { email, password } = c.req.valid('json');
      const key = normalizeEmail(email);
      const user = await store.users.findByEmail(key);
      const locked = throttle.isLocked(key, now) || (user?.lockedUntil ? user.lockedUntil.getTime() > now.getTime() : false);
      const matches = await passwordHasher.verify(user?.passwordHash ?? (await dummyHash()), password);

      if (!user || locked || !matches || user.status !== 'ACTIVE') {
        if (!locked) {
          const lockUntil = throttle.recordFailure(key, now);
          if (user) {
            await store.users.recordFailedSignIn(user.id, now, lockUntil);
            if (lockUntil) await auditToMembers(c, user, 'user.locked_out');
          }
        }
        throw new ApiError('INVALID_CREDENTIALS', 'That email and password do not match');
      }

      throttle.clear(key);
      const signedIn = (await store.users.recordSignIn(user.id, now)) ?? user;
      const token = generateSessionToken();
      const absoluteExpiresAt = new Date(now.getTime() + settings.absoluteHours * 3_600_000);
      await store.sessions.create({
        userId: user.id,
        tokenDigest: sessionDigest(settings.pepper, token),
        at: now,
        idleExpiresAt: new Date(Math.min(now.getTime() + settings.idleMinutes * 60_000, absoluteExpiresAt.getTime())),
        absoluteExpiresAt,
        userAgent: c.req.header('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      });
      setCookie(c, cookieName, token, { ...cookieOptions, maxAge: settings.absoluteHours * 3600 });
      await auditToMembers(c, signedIn, 'user.signed_in');
      return c.json(await buildMe(store, signedIn), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/sessions/current',
      tags: ['Sessions'],
      summary: 'Sign out (revokes the session server-side and clears the cookie)',
      security: [{ session: [] }],
      responses: {
        204: { description: 'Signed out' },
        401: errorResponse('No valid session'),
        403: errorResponse('CROSS_SITE_REQUEST or PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => {
      await store.sessions.revoke(c.get('identity').session.id, 'signed_out', c.get('now')());
      deleteCookie(c, cookieName, cookieOptions);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Sessions'],
      summary: 'The signed-in person and the hosted profiles they may open',
      security: [{ session: [] }],
      responses: {
        200: { description: 'Me', content: { 'application/json': { schema: MeSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => c.json(await buildMe(store, c.get('identity').user), 200),
  );

  return app;
}

async function buildMe(store: LedgerStore, user: UserRecord) {
  const access = sessionAccess();
  const profiles = [];
  for (const membership of await store.memberships.listByUser(user.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (!organization) continue;
    const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
    profiles.push({
      id: organization.id,
      name: organization.name,
      source: 'hosted' as const,
      defaultCurrency: organization.defaultCurrency as 'ILS' | 'USD' | 'EUR',
      timezone: organization.timezone,
      writerOfRecord: malafat?.status === 'CONNECTED' ? ('MALAFAT' as const) : null,
      access,
    });
  }
  return { user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale }, profiles };
}
