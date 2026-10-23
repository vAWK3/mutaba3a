import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setupLinkOrigin, setupLinkState, type SetupLinkState } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest, type SignInThrottle } from '../auth/sessions.js';
import { normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { Mailer } from '../email/ports.js';
import { sendPasswordNotice } from '../email/password-notice.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { AccountSetupTokenRecord, AuditEventInput, LedgerStore, UserRecord } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  SetupLinkCheckRequestSchema,
  SetupLinkCheckResponseSchema,
  SetupLinkRedeemRequestSchema,
  SetupLinkRedeemResponseSchema,
} from '../schemas.js';
import { staleTerms, termsAcceptanceOf, termsAcceptedAudit } from '../terms-acceptance.js';

/**
 * The two public routes a setup link reaches (MUT-235, ADR-088). They are the
 * only public account routes besides sign-in: no signup, invite or "forgot
 * password" exists (no-self-registration.test.ts pins the list).
 *
 * The token travels in the request body, never the URL. Both routes are
 * same-origin only (the portal is the one browser caller) and share the
 * sign-in IP limiter under their own key. Redeeming sets the password but
 * issues no session: the portal then signs in through POST /v1/sessions, so
 * there is still exactly one way to mint a session.
 */
export interface AccountSetupRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  settings: SessionSettings;
  ipLimiter: RateLimiter;
  /** The sign-in throttle (shared with both sign-in routes); a successful redeem clears the person's lock in it. */
  throttle: SignInThrottle;
  /** MUT-324: the terms a person must accept to finish setting up. */
  terms: CurrentTerms;
  /** MUT-359: mails "your password is set/changed" after a redeem (never changes the answer). */
  mailer: Mailer;
  logger: Logger;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function accountSetupRoutes(options: AccountSetupRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, ipLimiter, throttle, terms, mailer, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  async function guard(c: Context<AppEnv>): Promise<Date> {
    if (!isSamePortalOrigin(c.req, settings)) {
      throw new ApiError('CROSS_SITE_REQUEST', 'Set your password from the MTB3A portal itself');
    }
    const now = c.get('now')();
    const ip = await ipLimiter.check(`account-setup:${requestClientIp((name) => c.req.header(name), settings)}`, now);
    if (!ip.allowed) {
      c.header('Retry-After', String(ip.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
    }
    return now;
  }

  async function lookUp(token: string): Promise<{ link: AccountSetupTokenRecord | null; person: UserRecord | null }> {
    const link = await store.accountSetup.findByDigest(sessionDigest(settings.pepper, token));
    return { link, person: link ? await store.users.getById(link.userId) : null };
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/account-setup/check',
      tags: ['Sessions'],
      summary: 'Check a setup link before asking for a password',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SetupLinkCheckRequestSchema } } } },
      responses: {
        200: { description: 'What the link is good for; only a valid one names its account', content: { 'application/json': { schema: SetupLinkCheckResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await guard(c);
      const { link, person } = await lookUp(c.req.valid('json').token);
      const state = setupLinkState(link, person, now);
      if (state === 'valid' && link && person) {
        return c.json(
          { state, email: person.email, locale: person.locale, purpose: link.purpose, expiresAt: link.expiresAt.toISOString(), termsVersion: terms.version },
          200,
        );
      }
      return c.json({ state: refusalOf(state) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/account-setup',
      tags: ['Sessions'],
      summary: 'Set your password through a setup link (signs out every session; does not sign in)',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SetupLinkRedeemRequestSchema } } } },
      responses: {
        200: { description: 'Password set; sign in with POST /v1/sessions', content: { 'application/json': { schema: SetupLinkRedeemResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        409: errorResponse('TERMS_VERSION_STALE — acceptedTermsVersion is missing or not the current terms; details.current names it'),
        410: errorResponse('SETUP_LINK_UNUSABLE — details.state is expired, used, superseded or invalid'),
        422: errorResponse('Validation failed (the password is 12 to 128 characters)'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await guard(c);
      const { token, password, acceptedTermsVersion, termsLocale, clientRelease } = c.req.valid('json');
      const tokenDigest = sessionDigest(settings.pepper, token);
      const { link, person } = await lookUp(token);
      const state = setupLinkState(link, person, now);
      if (state !== 'valid' || !link || !person) throw unusable(refusalOf(state));
      // MUT-324 C4: after the link state (a dead link says why it is dead), before the slow hash.
      if (acceptedTermsVersion !== terms.version) throw staleTerms(terms);
      // Hash before claiming, so the slow part never runs inside the transaction.
      const passwordHash = await passwordHasher.hash(password);
      const audit = await passwordSetAudit(c, person, link);
      // The setup page is the portal: a cookie surface.
      const acceptance = termsAcceptanceOf(terms, termsLocale ?? person.locale, 'cookie', clientRelease);
      const termsAudit = await termsAcceptedAudit(store, person, acceptance, c.get('requestId'));
      // A fresh instant after the slow hash: the expiry check and passwordChangedAt must not predate a sign-in that ran meanwhile.
      const at = c.get('now')();
      const redeemed = await store.accountSetup.redeem({ tokenDigest, passwordHash, at, audit, terms: acceptance, termsAudit });
      if (!redeemed) {
        // Lost a race (another tab, a newer link, a disable, expiry during hashing): say what the link is now.
        const again = await lookUp(token);
        const after = setupLinkState(again.link, again.person, at);
        throw unusable(after === 'valid' ? 'used' : after);
      }
      // The database lockout is cleared by the redeem; the in-process sign-in throttle is cleared here, so the sign-in that follows works.
      throttle.clear(normalizeEmail(redeemed.email));
      // MUT-359 (A5): after the commit, and never able to change this answer. "Set" when the person had no password.
      await sendPasswordNotice(mailer, logger, { id: person.id, email: redeemed.email, locale: person.locale }, {
        first: person.passwordHash === null,
        signInLink: signInLinkOf(settings, c.req.url),
        requestId: c.get('requestId'),
      });
      return c.json({ email: redeemed.email }, 200);
    },
  );

  /** Names the link that set the password, so an investigation can tie it to the `user.setup_link_issued` that made it. */
  async function passwordSetAudit(c: Context<AppEnv>, person: UserRecord, link: AccountSetupTokenRecord): Promise<AuditEventInput[]> {
    return (await store.memberships.listByUser(person.id)).map((m) => ({
      organizationId: m.organizationId,
      actorType: 'USER',
      actorId: person.id,
      action: 'user.password_set',
      entityType: 'user',
      entityId: person.id,
      metadata: { purpose: link.purpose, linkId: link.id },
      requestId: c.get('requestId'),
    }));
  }

  return app;
}

type SetupLinkRefusal = Exclude<SetupLinkState, 'valid'>;

/** A 'valid' state reaching a refusal means its link or person vanished between reads: treat it as unknown. */
function refusalOf(state: SetupLinkState): SetupLinkRefusal {
  return state === 'valid' ? 'invalid' : state;
}

function unusable(state: SetupLinkRefusal): ApiError {
  return new ApiError('SETUP_LINK_UNUSABLE', 'This setup link can no longer be used; ask for a new one', { state });
}

/** MUT-359: where a password notice's "Sign in" goes: the same origin a setup link uses (https off loopback). */
export function signInLinkOf(settings: Pick<SessionSettings, 'portalOrigin'>, requestUrl: string): string {
  return `${setupLinkOrigin(settings.portalOrigin, requestUrl).replace(/\/+$/, '')}/`;
}
