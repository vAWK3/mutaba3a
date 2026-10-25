import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { verifyCurrentPassword } from '../auth/current-password.js';
import { signIn, signInWithPasskey, warmDummyHash } from '../auth/sign-in.js';
import type { WebauthnConfig } from '../auth/webauthn.js';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import {
  generateDeviceSessionToken,
  generateSessionToken,
  isSamePortalOrigin,
  requestClientIp,
  sessionCookieName,
  sessionDigest,
  sessionLifetime,
  type SignInThrottle,
} from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { RateLimiter } from '../rate-limit.js';
import { StateConflict } from '../repositories/memory.js';
import type { AuditEventInput, LedgerStore, SessionRecord, UserRecord } from '../repositories/ports.js';
import {
  ChangePasswordRequestSchema,
  ErrorEnvelopeSchema,
  PasskeySignInRequestSchema,
  PasswordChangedTokenSchema,
  MalafatSuggestionsChangeSchema,
  MalafatSuggestionsSchema,
  MeSchema,
  SignInRequestSchema,
  TermsAcceptanceRequestSchema,
  TermsStatusSchema,
  TrialPromptChangeSchema,
  TrialPromptSchema,
} from '../schemas.js';
import { resolveTrialPrompt } from '../billing/trial-prompt.js';
import { staleTerms, termsAcceptanceOf, termsAcceptedAudit } from '../terms-acceptance.js';
import { resolveMalafatSuggestions } from '../malafat-suggestions.js';
import { buildMe, passkeysClockOf } from './me.js';
import { signInLinkOf } from './account-setup.js';
import type { Mailer } from '../email/ports.js';
import { sendPasswordNotice } from '../email/password-notice.js';
import type { Logger } from '../logger.js';

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
  /** MUT-324: the current terms, reported by sign-in's Me and accepted through POST /v1/me/terms-acceptance. */
  terms: CurrentTerms;
  /** MUT-359: mails "your password was changed" after POST /v1/me/password (never changes the answer). */
  mailer: Mailer;
  logger: Logger;
  /** MUT-115: the WebAuthn relying party; null = no passkeys (POST /v1/sessions/passkey answers 404). */
  webauthn?: WebauthnConfig | null;
}

/** Session routes that act on the person rather than an organization: no X-Mutaba3a-Profile. */
export const ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'PATCH /v1/me/malafat-suggestions',
  'PATCH /v1/me/trial-prompt',
  'POST /v1/me/terms-acceptance',
  'DELETE /v1/sessions/current',
  'POST /v1/me/password',
]);

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function sessionRoutes(options: SessionRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, throttle, ipLimiter, terms, mailer, logger } = options;
  const webauthn = options.webauthn ?? null;
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
        403: errorResponse('CROSS_SITE_REQUEST, or ACCOUNT_UNDER_REVIEW — the right password for a self-service account the operator has not approved yet (MUT-367); no session'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      if (!isSamePortalOrigin(c.req, settings)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'Sign in from the MTB3A portal itself');
      }
      const now = c.get('now')();
      const ip = await ipLimiter.check(`sign-in:${requestClientIp((name) => c.req.header(name), settings)}`, now);
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
        sessionLifetime('cookie', settings),
      );
      setCookie(c, cookieName, token, { ...cookieOptions, maxAge: settings.absoluteHours * 3600 });
      return c.json(await buildMe(store, user, terms, c.get('now')(), c.get('billingGate'), passkeysClockOf(c)), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/sessions/passkey',
      tags: ['Sessions'],
      summary: 'Sign in with a passkey (sets the session cookie) (MUT-115)',
      description:
        'Send the `challengeId` from POST /v1/passkey-challenges and the platform\'s assertion (WebAuthn JSON). The same same-origin check, IP budget, throttle and lockout as the password sign-in: a failed assertion counts toward the account\'s lockout, and every refusal is the same 401.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: PasskeySignInRequestSchema } } } },
      responses: {
        201: { description: 'Signed in; the session cookie is set', content: { 'application/json': { schema: MeSchema } } },
        401: errorResponse('INVALID_CREDENTIALS — the same answer for every refusal'),
        403: errorResponse('CROSS_SITE_REQUEST, or ACCOUNT_UNDER_REVIEW (as the password sign-in)'),
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      if (!webauthn) throw new ApiError('NOT_FOUND', 'Passkeys are not available on this server');
      if (!isSamePortalOrigin(c.req, settings)) {
        throw new ApiError('CROSS_SITE_REQUEST', 'Sign in from the MTB3A portal itself');
      }
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
        'cookie',
        sessionLifetime('cookie', settings),
      );
      setCookie(c, cookieName, token, { ...cookieOptions, maxAge: settings.absoluteHours * 3600 });
      return c.json(await buildMe(store, user, terms, c.get('now')(), c.get('billingGate'), passkeysClockOf(c)), 201);
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

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/me/trial-prompt',
      tags: ['Sessions'],
      summary: "The person's answers to the free trial's card prompt (MUT-418)",
      description:
        '`welcome-accepted` / `welcome-skipped` answer the first-run "Your free trial has started" step; the first answer wins, so ' +
        'two devices never undo each other. `banner-snoozed` hides the Home trial banner for 3 days from now (server clock). Idempotent ' +
        'by construction, so no Idempotency-Key. Writes no audit row: a preference is not an event a firm sees.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialPromptChangeSchema } } } },
      responses: {
        200: { description: 'The answers now stored', content: { 'application/json': { schema: TrialPromptSchema } } },
        422: errorResponse('Invalid body'),
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED or CROSS_SITE_REQUEST'),
      },
    }),
    async (c) => {
      const { action } = c.req.valid('json');
      const user = await store.users.updateTrialPrompt(c.get('identity').user.id, action, c.get('now')());
      return c.json(resolveTrialPrompt(user?.trialPrompt ?? null), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/terms-acceptance',
      tags: ['Sessions'],
      summary: 'Accept the current terms of service (MUT-324)',
      description:
        'Records that the signed-in person accepted `version`, read in `locale`, from the portal or the phone, with the optional `clientRelease` that showed it (MUT-354, stored as sent). Idempotent per version: accepting again changes nothing and writes no second audit row. The person accepts for themselves and, as owner, for their own profiles, so `user.terms_accepted` is audited on each profile they own.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TermsAcceptanceRequestSchema } } } },
      responses: {
        200: { description: 'The terms status after accepting', content: { 'application/json': { schema: TermsStatusSchema } } },
        409: errorResponse('TERMS_VERSION_STALE — `version` is not the current terms; details.current names it'),
        422: errorResponse('Invalid body'),
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED or CROSS_SITE_REQUEST'),
      },
    }),
    async (c) => {
      const { version, locale, clientRelease } = c.req.valid('json');
      if (version !== terms.version) throw staleTerms(terms);
      const { user, session } = c.get('identity');
      const acceptance = termsAcceptanceOf(terms, locale, session.kind, clientRelease);
      const audit = await termsAcceptedAudit(store, user, acceptance, c.get('requestId'));
      await store.users.acceptTerms({ userId: user.id, ...acceptance, at: c.get('now')(), audit });
      // The version is the current one, so the person's latest now covers it (D10): no need to read it back
      return c.json({ version: terms.version, accepted: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/password',
      tags: ['Sessions'],
      summary: 'Change your own password (MUT-237)',
      description:
        'Revokes every other session, web and device. This session stays signed in under a new token (MUT-262), so a leaked copy of the old one stops working too: ' +
        'a cookie session always gets a new cookie (204, Set-Cookie, never past the old absolute deadline); a device session gets one only when it sends ' +
        '`rotateToken: true`, in a 200 body, and otherwise keeps its token (204). A wrong current password counts toward the same lockout a wrong sign-in attempt would.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: ChangePasswordRequestSchema } } } },
      responses: {
        200: {
          description: 'Password changed; a device session that sent `rotateToken: true` continues under this token',
          content: { 'application/json': { schema: PasswordChangedTokenSchema } },
        },
        204: { description: 'Password changed; a cookie session continues under the new cookie set here, a device session that did not ask keeps its token' },
        // Not 401: the session is still valid, and a 401 here would trip the portal's generic session-expired handler.
        403: errorResponse(
          'CURRENT_PASSWORD_WRONG (the current password is wrong, the account is locked, or another change landed first), CROSS_SITE_REQUEST or PRINCIPAL_NOT_ACCEPTED',
        ),
        422: errorResponse('Validation failed (the new password is 12 to 128 characters; the current one at most 1024)'),
      },
    }),
    async (c) => {
      // No same-origin check here: authenticate() already enforces it for the cookie branch (middleware.ts:172),
      // and a device bearer token has no comparable CSRF signal to check (same reasoning as GET /v1/me below).
      const { user, session } = c.get('identity');
      const { currentPassword, newPassword, rotateToken } = c.req.valid('json');
      // MUT-333: the same check closing an account makes (auth/current-password.ts).
      const verifiedPasswordHash = await verifyCurrentPassword({ store, passwordHasher, throttle }, user, currentPassword, c.get('now')(), c.get('requestId'));
      // Hash before the transaction, same reasoning as redeem (account-setup.ts): the slow part never runs inside the lock.
      const passwordHash = await passwordHasher.hash(newPassword);
      const at = c.get('now')();
      // MUT-262 (D1): the portal ships with this API, so a cookie always rotates; a device build only once it reads the 200.
      const rotated = session.kind === 'cookie' || rotateToken === true ? rotatedToken(session) : null;
      const audit = await changePasswordAudit(store, c.get('requestId'), user, rotated !== null);
      try {
        const rotation = rotated ? { rotation: { tokenDigest: sessionDigest(settings.pepper, rotated), idleMs: sessionLifetime(session.kind, settings).idleMs } } : {};
        await store.users.changePassword({ userId: user.id, passwordHash, verifiedPasswordHash, exceptSessionId: session.id, ...rotation, at, audit });
      } catch (err) {
        // Another change (or an operator lock) committed while this one was hashing: the password just verified no longer
        // works, and this session was signed out by it. Not a failed attempt, so no lockout count (MUT-238 review).
        if (err instanceof StateConflict) throw new ApiError('CURRENT_PASSWORD_WRONG', 'Current password is wrong');
        throw err;
      }
      // MUT-359 (A5): after the commit, and never able to change this answer.
      await sendPasswordNotice(mailer, logger, user, { first: false, signInLink: signInLinkOf(settings, c.req.url), requestId: c.get('requestId') });
      if (!rotated) return c.body(null, 204);
      if (session.kind === 'device') return c.json({ token: rotated }, 200);
      // D4: the cookie lives as long as the session can, never past the deadline sign-in set.
      const maxAge = Math.max(0, Math.floor((session.absoluteExpiresAt.getTime() - at.getTime()) / 1000));
      setCookie(c, cookieName, rotated, { ...cookieOptions, maxAge });
      return c.body(null, 204);
    },
  );

  return app;

  function rotatedToken(session: SessionRecord): string {
    return session.kind === 'device' ? generateDeviceSessionToken() : generateSessionToken();
  }

  async function changePasswordAudit(ledger: LedgerStore, requestId: string | null, person: UserRecord, tokenRotated: boolean): Promise<AuditEventInput[]> {
    return (await ledger.memberships.listByUser(person.id)).map((m) => ({
      organizationId: m.organizationId,
      actorType: 'USER',
      actorId: person.id,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: person.id,
      requestId,
      metadata: { tokenRotated },
    }));
  }
}
