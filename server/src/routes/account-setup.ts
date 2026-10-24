import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setupLinkOrigin, setupLinkState, type SetupLinkState } from '../auth/account-setup.js';
import { defaultDisplayName, signupAccountOutcome, signupLinkState } from '../auth/self-service.js';
import { personalProfileFor } from '../personal-profile.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest, type SignInThrottle } from '../auth/sessions.js';
import { normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { Mailer } from '../email/ports.js';
import { sendPasswordNotice } from '../email/password-notice.js';
import type { ReviewDigest } from '../email/review-digest.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { AuditEventInput, LedgerStore, PersonSetupLinkRecord, SignupLinkRecord, UserRecord } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  SetupLinkCheckRequestSchema,
  SetupLinkCheckResponseSchema,
  SetupLinkRedeemRequestSchema,
  SetupLinkRedeemResponseSchema,
} from '../schemas.js';
import { staleTerms, termsAcceptanceOf, termsAcceptedAudit, termsAcceptedEvent } from '../terms-acceptance.js';

/**
 * The two public routes a setup link reaches (MUT-235, ADR-088). MUT-366: a
 * SIGNUP link (mailed by POST /v1/signups) is redeemed here too, and creates
 * the account it was for; recovery's links are ordinary SETUP/RESET links.
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
  /** MUT-367: told after a SIGNUP redeem opens an account that waits for review. */
  reviewDigest: ReviewDigest;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function accountSetupRoutes(options: AccountSetupRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, ipLimiter, throttle, terms, mailer, logger, reviewDigest } = options;
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

  type Found =
    | { kind: 'person'; link: PersonSetupLinkRecord | null; person: UserRecord | null }
    | { kind: 'signup'; link: SignupLinkRecord; holder: UserRecord | null };

  async function lookUp(token: string): Promise<Found> {
    const link = await store.accountSetup.findByDigest(sessionDigest(settings.pepper, token));
    // MUT-366: a SIGNUP link names an address; whoever holds it (nobody, until the link is used) decides its state.
    if (link?.purpose === 'SIGNUP') return { kind: 'signup', link, holder: await store.users.findByEmail(link.email) };
    return { kind: 'person', link, person: link ? await store.users.getById(link.userId) : null };
  }

  function stateOf(found: Found, now: Date): SetupLinkState {
    return found.kind === 'signup' ? signupLinkState(found.link, found.holder, now) : setupLinkState(found.link, found.person, now);
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
      const found = await lookUp(c.req.valid('json').token);
      const state = stateOf(found, now);
      if (state === 'valid' && found.kind === 'signup') {
        const { link } = found;
        return c.json({ state, email: link.email, locale: link.locale, purpose: link.purpose, expiresAt: link.expiresAt.toISOString(), termsVersion: terms.version }, 200);
      }
      if (state === 'valid' && found.kind === 'person' && found.link && found.person) {
        const { link, person } = found;
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
      const body = c.req.valid('json');
      const found = await lookUp(body.token);
      const state = stateOf(found, now);
      if (state !== 'valid') throw unusable(refusalOf(state));
      // MUT-324 C4: after the link state (a dead link says why it is dead), before the slow hash.
      if (body.acceptedTermsVersion !== terms.version) throw staleTerms(terms);
      if (found.kind === 'signup') return c.json(await redeemSignup(c, found.link, body), 200);
      if (!found.link || !found.person) throw unusable('invalid');
      return c.json(await redeemPersonLink(c, found.link, found.person, body), 200);
    },
  );

  type RedeemBody = { token: string; password: string; termsLocale?: 'en' | 'ar' | undefined; clientRelease?: string | undefined; displayName?: string | undefined; defaultCurrency?: string | undefined; timezone?: string | undefined };
  /** MUT-367 (D22): the account's status after the redeem; PENDING_REVIEW signs in to 403 ACCOUNT_UNDER_REVIEW. */
  type Redeemed = { email: string; status: 'ACTIVE' | 'PENDING_REVIEW' };
  const redeemedStatus = (status: UserRecord['status']): Redeemed['status'] => (status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'ACTIVE');

  async function redeemPersonLink(c: Context<AppEnv>, link: PersonSetupLinkRecord, person: UserRecord, body: RedeemBody): Promise<Redeemed> {
    const tokenDigest = sessionDigest(settings.pepper, body.token);
    // Hash before claiming, so the slow part never runs inside the transaction.
    const passwordHash = await passwordHasher.hash(body.password);
    const audit = await passwordSetAudit(c, person, link);
    // The setup page is the portal: a cookie surface.
    const acceptance = termsAcceptanceOf(terms, body.termsLocale ?? person.locale, 'cookie', body.clientRelease);
    const termsAudit = await termsAcceptedAudit(store, person, acceptance, c.get('requestId'));
    // A fresh instant after the slow hash: the expiry check and passwordChangedAt must not predate a sign-in that ran meanwhile.
    const at = c.get('now')();
    const redeemed = await store.accountSetup.redeem({ tokenDigest, passwordHash, at, audit, terms: acceptance, termsAudit });
    if (!redeemed) throw unusable(await stateAfterLosing(body.token, at));
    // The database lockout is cleared by the redeem; the in-process sign-in throttle is cleared here, so the sign-in that follows works.
    throttle.clear(normalizeEmail(redeemed.email));
    // MUT-359 (A5): after the commit, and never able to change this answer. "Set" when the person had no password.
    await sendPasswordNotice(mailer, logger, { id: person.id, email: redeemed.email, locale: person.locale }, {
      first: person.passwordHash === null,
      signInLink: signInLinkOf(settings, c.req.url),
      requestId: c.get('requestId'),
    });
    return { email: redeemed.email, status: redeemedStatus(redeemed.status) };
  }

  /**
   * MUT-366: a SIGNUP link creates the account it was for: the user, their personal profile (in the page's currency
   * and timezone), the trial and the terms, in one transaction. No session (ADR-088 §5) and no password notice (D11).
   * MUT-367: an address the screen didn't pass as BUSINESS opens PENDING_REVIEW with no trial and a review row; the
   * person is told it's under review (D14) and the operator digest is nudged.
   */
  async function redeemSignup(c: Context<AppEnv>, link: SignupLinkRecord, body: RedeemBody): Promise<Redeemed> {
    const { defaultCurrency, timezone } = body;
    if (!defaultCurrency || !timezone) {
      throw new ApiError('VALIDATION_FAILED', 'A new account needs its currency and timezone', { fields: [...(defaultCurrency ? [] : ['defaultCurrency']), ...(timezone ? [] : ['timezone'])] });
    }
    const passwordHash = await passwordHasher.hash(body.password);
    const acceptance = termsAcceptanceOf(terms, body.termsLocale ?? link.locale, 'cookie', body.clientRelease);
    const requestId = c.get('requestId');
    const at = c.get('now')();
    const outcome = signupAccountOutcome(link, at);
    const created = await store.accountSetup.redeemSignup({
      tokenDigest: link.tokenDigest,
      passwordHash,
      at,
      displayName: body.displayName ?? defaultDisplayName(link.email),
      personal: personalProfileFor(link.locale, { defaultCurrency, timezone }),
      status: outcome.status,
      review: outcome.review,
      trialStartsAt: outcome.trialStartsAt,
      terms: acceptance,
      auditFor: ({ userId, personalOrganizationId }) => [
        { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'organization.created', entityType: 'organization', entityId: personalOrganizationId, metadata: { personal: true, ownerUserId: userId }, requestId },
        { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'user.signed_up', entityType: 'user', entityId: userId, metadata: { linkId: link.id, locale: link.locale, status: outcome.status }, requestId },
        termsAcceptedEvent(personalOrganizationId, userId, acceptance, requestId),
      ],
    });
    if (!created) throw unusable(await stateAfterLosing(body.token, at));
    if (outcome.status === 'PENDING_REVIEW') await afterPendingSignup(created.user);
    return { email: created.user.email, status: redeemedStatus(created.user.status) };
  }

  /** After the commit, and never able to change the answer: the person's "we're reviewing" mail, then the digest. */
  async function afterPendingSignup(user: UserRecord): Promise<void> {
    try {
      const sent = await mailer.send({ to: user.email, template: 'account-under-review', locale: user.locale, vars: {}, idempotencyKey: `account-under-review:${user.id}` });
      if (sent.status !== 'sent') logger.info({ template: 'account-under-review', outcome: sent.status }, 'review mail not sent');
    } catch (err) {
      logger.error({ err, template: 'account-under-review' }, 'review mail failed');
    }
    // Not awaited: the person's answer never waits on the operator's mail; the hourly sweep catches a send this loses.
    void reviewDigest.announce();
  }

  /** Lost a race (another tab, a newer link, a disable, the account made meanwhile, expiry during hashing): say what the link is now. */
  async function stateAfterLosing(token: string, at: Date): Promise<SetupLinkRefusal> {
    const after = stateOf(await lookUp(token), at);
    return after === 'valid' ? 'used' : after;
  }

  /** Names the link that set the password, so an investigation can tie it to the `user.setup_link_issued` that made it. */
  async function passwordSetAudit(c: Context<AppEnv>, person: UserRecord, link: PersonSetupLinkRecord): Promise<AuditEventInput[]> {
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
