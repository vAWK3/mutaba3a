import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { signIn, warmDummyHash } from '../auth/sign-in.js';
import { clientIp, isSameOriginRequest, sessionCookieName, type SignInThrottle } from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, MalafatSuggestionsChangeSchema, MalafatSuggestionsSchema, MeSchema, SignInRequestSchema } from '../schemas.js';
import { resolveMalafatSuggestions } from '../malafat-suggestions.js';
import { hostedProfileFor } from '../serializers.js';
import { MAX_OWNED_PROFILES } from './profiles.js';

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
export const ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me', 'PATCH /v1/me/malafat-suggestions', 'DELETE /v1/sessions/current']);

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

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/me/malafat-suggestions',
      tags: ['Sessions'],
      summary: "The person's Malafat suggestion preferences (MUT-191)",
      description:
        '`off` replaces the switch; `dismiss` adds moments to what is stored (never removes one), so two devices never undo each other. Idempotent by construction, so no Idempotency-Key. Writes no audit row: a preference is not an event a firm sees.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: MalafatSuggestionsChangeSchema } } } },
      responses: {
        200: { description: 'The preferences now stored', content: { 'application/json': { schema: MalafatSuggestionsSchema } } },
        422: errorResponse('Invalid body'),
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED or CROSS_SITE_REQUEST'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const change = { ...(body.off === undefined ? {} : { off: body.off }), ...(body.dismiss === undefined ? {} : { dismiss: body.dismiss }) };
      const user = await store.users.updateMalafatSuggestions(c.get('identity').user.id, change, c.get('now')());
      return c.json(resolveMalafatSuggestions(user?.malafatSuggestions ?? null), 200);
    },
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
    profiles.push(hostedProfileFor(organization, malafat?.status === 'CONNECTED' ? 'MALAFAT' : null, user.id));
  }
  // MUT-120: the personal membership is created in the same instant as the firm's, so membership order alone ties on a
  // random id. A stable sort on rank keeps membership order (oldest first) inside each group: firms, then the profiles
  // the caller created (MUT-182), then the caller's personal profile last. The portal opens profiles[0].
  const rank = (p: { isPersonalDefault: boolean; owned: boolean }) => (p.isPersonalDefault ? 2 : p.owned ? 1 : 0);
  profiles.sort((a, b) => rank(a) - rank(b));
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, malafatSuggestions: resolveMalafatSuggestions(user.malafatSuggestions) },
    profiles,
    limits: { ownedProfiles: await store.organizations.countOwnedBy(user.id), maxOwnedProfiles: MAX_OWNED_PROFILES },
  };
}
