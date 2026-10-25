import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { signIn, signInWithPasskey, warmDummyHash } from '../auth/sign-in.js';
import type { WebauthnConfig } from '../auth/webauthn.js';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { DEFAULT_DEVICE_ABSOLUTE_DAYS, DEFAULT_DEVICE_IDLE_DAYS, requestClientIp, type SignInThrottle } from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore } from '../repositories/ports.js';
import { DeviceSessionSchema, ErrorEnvelopeSchema, PasskeySignInRequestSchema, SignInRequestSchema } from '../schemas.js';
import { buildMe, passkeysClockOf } from './me.js';

/**
 * Native-app sign-in and sign-out (MUT-64): the bearer-token mirror of
 * POST/DELETE /v1/sessions. Shares signIn()'s credential-verification core
 * with the portal route, so the throttle/lockout/audit behavior is identical
 * — the two differences are the transport (a returned token instead of a
 * cookie) and that this route never checks same-origin: a native app has no
 * Origin/Sec-Fetch-Site signal comparable to a browser's.
 */
export interface DeviceSessionRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  settings: SessionSettings;
  throttle: SignInThrottle;
  ipLimiter: RateLimiter;
  /** MUT-324: the current terms, reported in the signed-in Me. */
  terms: CurrentTerms;
  /** MUT-115: the WebAuthn relying party; null = no passkeys (POST /v1/device-sessions/passkey answers 404). */
  webauthn?: WebauthnConfig | null;
}

/** Acts on the person, not an organization — mirrors ORGANIZATION_INDEPENDENT_ROUTES in routes/sessions.ts. */
export const DEVICE_SESSION_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['DELETE /v1/device-sessions/current']);

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function deviceSessionRoutes(options: DeviceSessionRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, throttle, ipLimiter, terms } = options;
  const webauthn = options.webauthn ?? null;
  const deviceLifetime = () => ({
    idleMs: (settings.deviceIdleDays ?? DEFAULT_DEVICE_IDLE_DAYS) * 86_400_000,
    absoluteMs: (settings.deviceAbsoluteDays ?? DEFAULT_DEVICE_ABSOLUTE_DAYS) * 86_400_000,
  });
  const app = new OpenAPIHono<AppEnv>();
  warmDummyHash(passwordHasher);

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/device-sessions',
      tags: ['Device sessions'],
      summary: 'Sign in from a native app (returns a bearer token)',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SignInRequestSchema } } } },
      responses: {
        201: { description: 'Signed in; the token is shown once', content: { 'application/json': { schema: DeviceSessionSchema } } },
        401: errorResponse('INVALID_CREDENTIALS — the same answer for every refusal'),
        403: errorResponse('ACCOUNT_UNDER_REVIEW — the right password for a self-service account the operator has not approved yet (MUT-367); no token'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = c.get('now')();
      const ip = await ipLimiter.check(`sign-in:${requestClientIp((name) => c.req.header(name), settings)}`, now);
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }

      const { email, password } = c.req.valid('json');
      const { user, token } = await signIn(c, { store, passwordHasher, throttle, pepper: settings.pepper }, { email, password }, 'device', deviceLifetime());
      const me = await buildMe(store, user, terms, c.get('now')(), c.get('billingGate'), passkeysClockOf(c));
      return c.json({ ...me, token }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/device-sessions/passkey',
      tags: ['Device sessions'],
      summary: 'Sign in from a native app with a passkey (returns a bearer token) (MUT-115)',
      description:
        'Send the `challengeId` from POST /v1/passkey-challenges and the platform\'s assertion (WebAuthn JSON; on iOS the origin is https://<rp id>). The same IP budget, throttle and lockout as the password sign-in; every refusal is the same 401.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: PasskeySignInRequestSchema } } } },
      responses: {
        201: { description: 'Signed in; the token is shown once', content: { 'application/json': { schema: DeviceSessionSchema } } },
        401: errorResponse('INVALID_CREDENTIALS — the same answer for every refusal'),
        403: errorResponse('ACCOUNT_UNDER_REVIEW (as the password sign-in)'),
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      if (!webauthn) throw new ApiError('NOT_FOUND', 'Passkeys are not available on this server');
      const now = c.get('now')();
      const ip = await ipLimiter.check(`sign-in:${requestClientIp((name) => c.req.header(name), settings)}`, now);
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      const { challengeId, response } = c.req.valid('json');
      const { user, token } = await signInWithPasskey(
        c,
        { store, passwordHasher, throttle, pepper: settings.pepper, webauthn },
        { challengeId, response: response as unknown as AuthenticationResponseJSON },
        'device',
        deviceLifetime(),
      );
      const me = await buildMe(store, user, terms, c.get('now')(), c.get('billingGate'), passkeysClockOf(c));
      return c.json({ ...me, token }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/device-sessions/current',
      tags: ['Device sessions'],
      summary: 'Sign out (revokes the device-session token server-side)',
      security: [{ deviceSession: [] }],
      responses: {
        204: { description: 'Signed out' },
        401: errorResponse('No valid device session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => {
      await store.sessions.revoke(c.get('identity').session.id, 'signed_out', c.get('now')());
      return c.body(null, 204);
    },
  );

  return app;
}
