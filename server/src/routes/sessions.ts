import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { signIn, warmDummyHash } from '../auth/sign-in.js';
import { clientIp, isSameOriginRequest, sessionCookieName, type SignInThrottle } from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import { sessionAccessFor, WRITABILITY_MATRIX } from '../auth/writability.js';
import { incomeCaptureRulesFor } from '../income/compose.js';
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

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function sessionRoutes(options: SessionRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, throttle, ipLimiter } = options;
  const app = new OpenAPIHono<AppEnv>();
  const cookieName = sessionCookieName(settings.secureCookie);
  const cookieOptions = { path: '/', httpOnly: true, secure: settings.secureCookie, sameSite: 'Strict' } as const;
  warmDummyHash(passwordHasher);

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
      const { user, token } = await signIn(
        c,
        { store, passwordHasher, throttle, pepper: settings.pepper },
        { email, password },
        'cookie',
        { idleMs: settings.idleMinutes * 60_000, absoluteMs: settings.absoluteHours * 3_600_000 },
      );
      setCookie(c, cookieName, token, { ...cookieOptions, maxAge: settings.absoluteHours * 3600 });
      return c.json(await buildMe(store, user), 201);
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
      security: [{ session: [] }, { deviceSession: [] }],
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

/** Exported for routes/device-sessions.ts (MUT-64): both sign-in surfaces return the same Me shape. */
export async function buildMe(store: LedgerStore, user: UserRecord) {
  const profiles = [];
  for (const membership of await store.memberships.listByUser(user.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (!organization) continue;
    const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
    const writerOfRecord = malafat?.status === 'CONNECTED' ? ('MALAFAT' as const) : null;
    // MUT-65: per-organization, not a constant — three rows' access depend on whether a Malafat writer of record feeds this profile (not on isPersonalDefault).
    const access = Object.fromEntries(WRITABILITY_MATRIX.map((row) => [row.domain, sessionAccessFor(row.domain, writerOfRecord)]));
    profiles.push({
      id: organization.id,
      name: organization.name,
      source: 'hosted' as const,
      defaultCurrency: organization.defaultCurrency as 'ILS' | 'USD' | 'EUR',
      timezone: organization.timezone,
      writerOfRecord,
      access,
      // MUT-61: the same rules POST /v1/income enforces, so the app reads them instead of inferring them.
      income: incomeCaptureRulesFor(writerOfRecord),
      // MUT-120: explicit, from the row already loaded; another user's personal profile is never this user's default.
      isPersonalDefault: organization.personalOwnerUserId === user.id,
    });
  }
  // MUT-120: the personal membership is created in the same instant as the firm's, so membership order alone ties on a
  // random id. Firms keep membership order and the caller's personal profile goes last (stable sort); the portal opens profiles[0].
  profiles.sort((a, b) => Number(a.isPersonalDefault) - Number(b.isPersonalDefault));
  return { user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale }, profiles };
}
