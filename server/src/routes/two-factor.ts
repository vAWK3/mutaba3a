import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { renderSVG } from 'uqr';
import { verifyCurrentPassword } from '../auth/current-password.js';
import { personSession, type AppEnv, type SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp, type SignInThrottle } from '../auth/sessions.js';
import { generateTotpSecret, otpauthUri } from '../auth/totp.js';
import type { TwoFactorAuditAction, TwoFactorFlow } from '../auth/two-factor-flow.js';
import { generateRecoveryCodes, maskEmail } from '../auth/two-factor.js';
import type { PasswordHasher } from '../auth/users.js';
import type { Mailer, TemplateVars } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { AuditEventInput, LedgerStore, UserRecord } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  TwoFactorConfirmRequestSchema,
  TwoFactorEmailCodeRequestSchema,
  TwoFactorEmailCodeResponseSchema,
  TwoFactorEnrolmentRequestSchema,
  TwoFactorEnrolmentSchema,
  TwoFactorManageRequestSchema,
  TwoFactorRecoveryCodesSchema,
  TwoFactorStateSchema,
} from '../schemas.js';
import { signInLinkOf } from './account-setup.js';
import { twoFactorStateOf } from './me.js';

/**
 * MUT-710 (ADR-275): two-step sign-in routes that aren't a sign-in themselves. POST /v1/two-factor/email-code is public
 * (a challenge token is the only credential) and serves the portal and the phone alike.
 */
export interface TwoFactorRouteOptions {
  store: LedgerStore;
  settings: SessionSettings;
  ipLimiter: RateLimiter;
  twoFactor: TwoFactorFlow;
  passwordHasher: PasswordHasher;
  throttle: SignInThrottle;
  mailer: Mailer;
  logger: Logger;
}

/** Act on the person, not a profile: no X-Mutaba3a-Profile. */
export const TWO_FACTOR_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/me/two-factor',
  'POST /v1/me/two-factor/challenge',
  'POST /v1/me/two-factor/enrolment',
  'POST /v1/me/two-factor/enrolment/confirm',
  'POST /v1/me/two-factor/recovery-codes',
  'DELETE /v1/me/two-factor',
]);

const PERSON = [{ session: [] }, { deviceSession: [] }];
const ISSUER_LABEL = 'MTB3A';
type ManageBody = { currentPassword?: string | undefined; challengeToken?: string | undefined; code?: string | undefined; recoveryCode?: string | undefined };

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function twoFactorRoutes(options: TwoFactorRouteOptions): OpenAPIHono<AppEnv> {
  const { store, settings, ipLimiter, twoFactor, passwordHasher, throttle, mailer, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  /**
   * D8 (review 5): proof before any change. The current password when the person has their own; and, while two-step
   * sign-in is on, the current second step through a `manage` challenge (counted and locked like sign-in's).
   */
  async function prove(c: Context<AppEnv>, user: UserRecord, body: ManageBody, on: boolean): Promise<void> {
    if (user.passwordChosen) await verifyCurrentPassword({ store, passwordHasher, throttle }, user, body.currentPassword ?? '', c.get('now')(), c.get('requestId'));
    if (!on) return;
    if (!body.challengeToken) throw new ApiError('TWO_FACTOR_REQUIRED', 'Confirm with your current second step first', { manage: true });
    await twoFactor.verify(c, store, { challengeToken: body.challengeToken, code: body.code, recoveryCode: body.recoveryCode }, { purpose: 'manage', userId: user.id });
  }

  async function notify(c: Context<AppEnv>, user: UserRecord, vars: Omit<TemplateVars['two-factor-changed'], 'signInLink'>): Promise<void> {
    try {
      const sent = await mailer.send({ to: user.email, template: 'two-factor-changed', locale: user.locale, vars: { ...vars, signInLink: signInLinkOf(settings, c.req.url) }, idempotencyKey: `two-factor-changed:${user.id}:${c.get('requestId')}` });
      if (sent.status !== 'sent') logger.debug({ userId: user.id, outcome: sent.status }, 'two-step notice not sent');
    } catch (err) {
      logger.error({ err, userId: user.id }, 'two-step notice failed');
    }
  }

  async function auditRows(c: Context<AppEnv>, user: UserRecord, action: TwoFactorAuditAction, metadata: AuditEventInput['metadata']): Promise<AuditEventInput[]> {
    return (await store.memberships.listByUser(user.id)).map((m) => ({ organizationId: m.organizationId, actorType: 'USER', actorId: user.id, action, entityType: 'user', entityId: user.id, requestId: c.get('requestId'), ...(metadata ? { metadata } : {}) }));
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me/two-factor',
      tags: ['Sessions'],
      summary: 'Your two-step sign-in (MUT-710)',
      security: PERSON,
      responses: { 200: { description: 'The state', content: { 'application/json': { schema: TwoFactorStateSchema } } }, 401: errorResponse('No valid session'), 403: errorResponse('PRINCIPAL_NOT_ACCEPTED') },
    }),
    async (c) => c.json(await twoFactorStateOf(store, personSession(c).user.id), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/two-factor/challenge',
      tags: ['Sessions'],
      summary: 'Start a second step to change your two-step sign-in (MUT-710)',
      description: 'While it is on, switching method, new recovery codes and turning it off each need the current second step. With the email method the code is mailed now.',
      security: PERSON,
      responses: {
        201: { description: 'The challenge (the TWO_FACTOR_REQUIRED details)', content: { 'application/json': { schema: TwoFactorEnrolmentSchema.pick({ method: true, expiresAt: true, emailHint: true }).extend({ challengeToken: TwoFactorEnrolmentSchema.shape.enrolmentToken }) } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
        409: errorResponse('CONFLICT reason TWO_FACTOR_OFF'),
        429: errorResponse('RATE_LIMITED — a code was mailed a moment ago'),
      },
    }),
    async (c) => {
      const { user } = personSession(c);
      const state = await store.twoFactor.get(user.id);
      if (!state) throw new ApiError('CONFLICT', 'Two-step sign-in is off', { reason: 'TWO_FACTOR_OFF' });
      return c.json((await twoFactor.challenge(c, store, user, state, { purpose: 'manage' })).details, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/two-factor/enrolment',
      tags: ['Sessions'],
      summary: 'Start turning on (or switching) two-step sign-in (MUT-710)',
      description:
        'Proof (D8): the current password when you have your own; while it is already on, the current second step too (POST /v1/me/two-factor/challenge). The app method answers a new secret, its otpauth:// address and a QR code; the email method mails a code. Without a password of your own, the app method also mails a code (`emailCodeRequired`). Confirm within 10 minutes.',
      security: PERSON,
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorEnrolmentRequestSchema } } } },
      responses: {
        201: { description: 'What to confirm', content: { 'application/json': { schema: TwoFactorEnrolmentSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('CURRENT_PASSWORD_WRONG, TWO_FACTOR_REQUIRED (send the current second step), TWO_FACTOR_CODE_WRONG, TWO_FACTOR_TOO_MANY_TRIES, TWO_FACTOR_CHALLENGE_EXPIRED, PRINCIPAL_NOT_ACCEPTED'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      const { user } = personSession(c);
      const body = c.req.valid('json');
      const state = await store.twoFactor.get(user.id);
      await prove(c, user, body, state !== null);
      const secret = body.method === 'totp' ? generateTotpSecret() : null;
      const mailProof = body.method === 'totp' && !user.passwordChosen;
      const { token, challenge } = await twoFactor.enrolment(c, store, user, body.method, secret, mailProof);
      const uri = secret ? otpauthUri({ secret, account: user.email, issuer: ISSUER_LABEL }) : null;
      return c.json(
        {
          enrolmentToken: token,
          method: body.method,
          expiresAt: challenge.expiresAt.toISOString(),
          ...(secret && uri ? { secret, otpauthUri: uri, qrSvg: renderSVG(uri) } : {}),
          ...(body.method === 'email' || mailProof ? { emailHint: maskEmail(user.email) } : {}),
          emailCodeRequired: mailProof,
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/two-factor/enrolment/confirm',
      tags: ['Sessions'],
      summary: 'Turn on two-step sign-in with a code from the new method (MUT-710)',
      description:
        'Turns it on (or switches it), answers the 10 recovery codes once, stamps this session as having passed it, signs out your other sessions, and mails a notice. Runs under your row lock, so two confirmations can’t leave two sets of codes.',
      security: PERSON,
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorConfirmRequestSchema } } } },
      responses: {
        201: { description: 'On; the recovery codes, shown once', content: { 'application/json': { schema: TwoFactorRecoveryCodesSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('TWO_FACTOR_CODE_WRONG (details.triesLeft), TWO_FACTOR_TOO_MANY_TRIES, TWO_FACTOR_CHALLENGE_EXPIRED, PRINCIPAL_NOT_ACCEPTED'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      const { user, session } = personSession(c);
      const body = c.req.valid('json');
      const before = await store.twoFactor.get(user.id);
      const verified = await twoFactor.verify(c, store, { challengeToken: body.enrolmentToken, code: body.code, emailCode: body.emailCode }, { purpose: 'enrol', userId: user.id });
      const { challenge } = verified;
      const codes = generateRecoveryCodes();
      const at = c.get('now')();
      await store.twoFactor.enable({
        userId: user.id,
        method: challenge.method,
        totpSecretSealed: challenge.method === 'totp' ? challenge.pendingSecretSealed : null,
        lastUsedStep: verified.step ?? null,
        recoveryDigests: codes.map((code) => twoFactor.keys.recoveryDigest(user.id, code)),
        at,
        keepSessionId: session.id,
        audit: await auditRows(c, user, 'user.two_factor_enabled', { method: challenge.method, switched: before !== null }),
      });
      twoFactor.log(c, 'two_factor.enabled', user.id, { method: challenge.method, sessionKind: session.kind, ...(before ? { outcome: 'switched' } : {}) });
      await notify(c, user, { change: before ? 'switched' : 'enabled', method: challenge.method });
      return c.json({ recoveryCodes: codes }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/two-factor/recovery-codes',
      tags: ['Sessions'],
      summary: 'Make new recovery codes (the old ones stop working) (MUT-710)',
      security: PERSON,
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorManageRequestSchema } } } },
      responses: {
        201: { description: 'The new codes, shown once', content: { 'application/json': { schema: TwoFactorRecoveryCodesSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('CURRENT_PASSWORD_WRONG, TWO_FACTOR_REQUIRED, TWO_FACTOR_CODE_WRONG, TWO_FACTOR_TOO_MANY_TRIES, TWO_FACTOR_CHALLENGE_EXPIRED, PRINCIPAL_NOT_ACCEPTED'),
        409: errorResponse('CONFLICT reason TWO_FACTOR_OFF'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      const { user } = personSession(c);
      const state = await store.twoFactor.get(user.id);
      if (!state) throw new ApiError('CONFLICT', 'Two-step sign-in is off', { reason: 'TWO_FACTOR_OFF' });
      await prove(c, user, c.req.valid('json'), true);
      const codes = generateRecoveryCodes();
      await store.twoFactor.replaceRecoveryCodes(user.id, codes.map((code) => twoFactor.keys.recoveryDigest(user.id, code)), c.get('now')(), await auditRows(c, user, 'user.two_factor_recovery_codes_regenerated', undefined));
      twoFactor.log(c, 'two_factor.recovery_codes_regenerated', user.id, { method: state.method });
      await notify(c, user, { change: 'recovery_codes', method: state.method });
      return c.json({ recoveryCodes: codes }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/me/two-factor',
      tags: ['Sessions'],
      summary: 'Turn off two-step sign-in (MUT-710)',
      description: 'Needs the current password (when you have your own) and the current second step. Refused while you own a profile that issues documents or is connected to the Tax Authority.',
      security: PERSON,
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorManageRequestSchema } } } },
      responses: {
        204: { description: 'Off' },
        401: errorResponse('No valid session'),
        403: errorResponse('CURRENT_PASSWORD_WRONG, TWO_FACTOR_REQUIRED, TWO_FACTOR_CODE_WRONG, TWO_FACTOR_TOO_MANY_TRIES, TWO_FACTOR_CHALLENGE_EXPIRED, PRINCIPAL_NOT_ACCEPTED'),
        409: errorResponse('TWO_FACTOR_REQUIRED_FOR_ISSUING, or CONFLICT reason TWO_FACTOR_OFF'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      const { user } = personSession(c);
      const state = await store.twoFactor.get(user.id);
      if (!state) throw new ApiError('CONFLICT', 'Two-step sign-in is off', { reason: 'TWO_FACTOR_OFF' });
      if (await store.twoFactor.ownsIssuingProfile(user.id)) throw new ApiError('TWO_FACTOR_REQUIRED_FOR_ISSUING', 'Two-step sign-in stays on while you issue documents');
      await prove(c, user, c.req.valid('json'), true);
      await store.twoFactor.disable(user.id, c.get('now')(), await auditRows(c, user, 'user.two_factor_disabled', { method: state.method }));
      twoFactor.log(c, 'two_factor.disabled', user.id, { method: state.method });
      await notify(c, user, { change: 'disabled', method: state.method });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/two-factor/email-code',
      tags: ['Sessions'],
      summary: 'Email a fresh second-step code (MUT-710)',
      description:
        'For a challenge whose method is email (sign-in or a setup link). At most once every 30 seconds and 5 times per challenge, and 10 codes an hour per person; the newest code replaces the last. A browser call must come from the portal itself.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorEmailCodeRequestSchema } } } },
      responses: {
        202: { description: 'A new code is on its way', content: { 'application/json': { schema: TwoFactorEmailCodeResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST, or TWO_FACTOR_CHALLENGE_EXPIRED (unknown, used, expired, or not an email challenge)'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED — too soon after the last code, too many codes, or too many attempts from this address'),
      },
    }),
    async (c) => {
      // A phone sends no Origin; a browser that does must be the portal.
      if (c.req.header('origin') && !isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Ask for a code from the MTB3A portal itself');
      const ip = await ipLimiter.check(`sign-in:${requestClientIp((name) => c.req.header(name), settings)}`, c.get('now')());
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      return c.json(await twoFactor.resend(c, store, c.req.valid('json').challengeToken), 202);
    },
  );

  return app;
}
