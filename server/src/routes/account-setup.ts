import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setupLinkOrigin, setupLinkState, type SetupLinkState } from '../auth/account-setup.js';
import { grantAudit } from '../accountants/grants.js';
import { claimContextOf, claimOfLink, isClaimCodeLocked, verifyClaimCode } from '../accountants/claim.js';
import { defaultDisplayName, signupAccountOutcome, signupLinkState } from '../auth/self-service.js';
import { personalProfileFor } from '../personal-profile.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest, type SignInThrottle } from '../auth/sessions.js';
import { normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { Mailer } from '../email/ports.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import { sendPasswordNotice } from '../email/password-notice.js';
import type { ReviewDigest } from '../email/review-digest.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { AuditEventInput, LedgerStore, PersonSetupLinkRecord, SignupLinkRecord, UserRecord } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  SetupLinkCheckRequestSchema,
  SetupLinkCheckResponseSchema,
  SetupLinkClaimCodeRequestSchema,
  SetupLinkClaimCodeResponseSchema,
  SetupLinkRedeemRequestSchema,
  SetupLinkRedeemResponseSchema,
  SetupLinkTwoFactorResponseSchema,
} from '../schemas.js';
import { twoFactorRequired, type TwoFactorFlow } from '../auth/two-factor-flow.js';
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
  /** MUT-710 (ADR-274 D11): every person link asks for the second step when the person has it on. */
  twoFactor: TwoFactorFlow;
  /** MUT-737 (ADR-289): OPEN_SIGNUP. On, every SIGNUP link opens ACTIVE (no review); absent = off. */
  openSignup?: boolean;
  /** MUT-766 (eng R5): sets the verified address on the Stripe customer an accountant's activation made with none. Null: no Stripe. */
  checkout?: Pick<CheckoutGateway, 'customerIdOf' | 'setCustomerEmail'> | null;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function accountSetupRoutes(options: AccountSetupRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, settings, ipLimiter, throttle, terms, mailer, logger, reviewDigest, twoFactor } = options;
  const openSignup = options.openSignup ?? false;
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
        // MUT-710 (D11): the method only; the email code is mailed on POST /v1/account-setup/two-factor, never here (every page load checks).
        const second = await twoFactor.stateOf(store, person.id);
        // MUT-765: a provisioned link names who set it up and asks for the claim code first.
        const claim = await claimOfLink(store, link);
        const context = claim ? await claimContextOf(store, person) : null;
        return c.json(
          {
            state,
            email: person.email,
            locale: person.locale,
            purpose: link.purpose,
            expiresAt: link.expiresAt.toISOString(),
            termsVersion: terms.version,
            twoFactor: second ? { method: second.method } : null,
            ...(claim && context ? { claim: { accountantName: context.accountantName, businessName: context.business?.name ?? null, codeLocked: isClaimCodeLocked(claim) } } : {}),
          },
          200,
        );
      }
      // MUT-368 (D2): a dead link names what it was for, to its holder only; an unknown token names nothing.
      const purpose = state === 'valid' || state === 'invalid' ? null : found.link?.purpose ?? null;
      // MUT-769 (ADR-320): a dead accountant's link says so, so the page sends the customer back to him, not to recovery.
      const provisioned = purpose !== null && found.kind === 'person' && found.link ? (await claimOfLink(store, found.link)) !== null : false;
      return c.json({ state: refusalOf(state), ...(purpose ? { purpose } : {}), ...(provisioned ? { provisioned: true as const } : {}) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/account-setup/claim-code',
      tags: ['Sessions'],
      summary: 'Check the claim code of an account an accountant created, before the password step (MUT-765)',
      description:
        'For a valid link whose check answered `claim`. The code the accountant said; spaces are ignored. A wrong one is counted (403 CLAIM_CODE_WRONG, `details.triesLeft`); the fifth locks it (403 CLAIM_CODE_LOCKED: the accountant issues a new link and code). The redeem checks it again. 409 CONFLICT reason NO_CLAIM_CODE for a link that carries none. Additive since 1.160.0-mut765.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SetupLinkClaimCodeRequestSchema } } } },
      responses: {
        200: { description: 'The code is right', content: { 'application/json': { schema: SetupLinkClaimCodeResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST, CLAIM_CODE_WRONG (details.triesLeft) or CLAIM_CODE_LOCKED'),
        409: errorResponse('CONFLICT reason NO_CLAIM_CODE — this link needs no code'),
        410: errorResponse('SETUP_LINK_UNUSABLE — details.state is expired, used, superseded or invalid'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await guard(c);
      const body = c.req.valid('json');
      const found = await lookUp(body.token);
      const state = stateOf(found, now);
      if (state !== 'valid' || found.kind !== 'person' || !found.link || !found.person) throw unusable(refusalOf(state === 'valid' ? 'invalid' : state));
      const claim = await claimOfLink(store, found.link);
      if (!claim) throw new ApiError('CONFLICT', 'This link needs no code', { reason: 'NO_CLAIM_CODE' });
      await verifyClaimWithLog(found.person, claim, body.claimCode);
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/account-setup/two-factor',
      tags: ['Sessions'],
      summary: 'Start the second step a setup link needs (MUT-710)',
      description:
        'For a valid person link (setup, reset, an operator link) whose person has two-step sign-in on, whatever the link is for. Creates a challenge bound to this link (10 minutes, 5 tries) and, with the email method, mails the code. Send its `challengeToken` with the code (or a recovery code) to POST /v1/account-setup.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SetupLinkCheckRequestSchema } } } },
      responses: {
        201: { description: 'The challenge', content: { 'application/json': { schema: SetupLinkTwoFactorResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        409: errorResponse('CONFLICT reason TWO_FACTOR_OFF — this link needs no second step'),
        410: errorResponse('SETUP_LINK_UNUSABLE — details.state is expired, used, superseded or invalid'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address, or a code was mailed a moment ago'),
      },
    }),
    async (c) => {
      const now = await guard(c);
      const found = await lookUp(c.req.valid('json').token);
      const state = stateOf(found, now);
      if (state !== 'valid' || found.kind !== 'person' || !found.link || !found.person) throw unusable(refusalOf(state === 'valid' ? 'invalid' : state));
      const second = await twoFactor.stateOf(store, found.person.id);
      if (!second) throw new ApiError('CONFLICT', 'This link needs no second step', { reason: 'TWO_FACTOR_OFF' });
      const issued = await twoFactor.challenge(c, store, found.person, second, { purpose: 'reset', linkId: found.link.id });
      return c.json(issued.details, 201);
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
        409: errorResponse('TERMS_VERSION_STALE — acceptedTermsVersion is missing or not the current terms; details.current names it'),
        403: errorResponse('CROSS_SITE_REQUEST; CLAIM_CODE_WRONG or CLAIM_CODE_LOCKED (MUT-765: a link whose check answered `claim` needs `claimCode`); TWO_FACTOR_REQUIRED (MUT-710 D11: the person has two-step sign-in on and sent no challenge; details carry a new one), TWO_FACTOR_CODE_WRONG, TWO_FACTOR_TOO_MANY_TRIES or TWO_FACTOR_CHALLENGE_EXPIRED'),
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

  /** MUT-765: a lock is logged (an alert source: brute force or a confused customer); the code is never logged. */
  async function verifyClaimWithLog(person: UserRecord, claim: Awaited<ReturnType<typeof claimOfLink>> & object, typed: string): Promise<void> {
    try {
      await verifyClaimCode(store, settings.pepper, claim, person.email, typed);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CLAIM_CODE_LOCKED') logger.warn({ userId: person.id, event: 'claim_code_locked' }, 'claim code locked');
      throw err;
    }
  }

  /**
   * MUT-766 (R5): an accountant's activation made the customer's Stripe customer with no email; the claim proves the
   * address, so it goes there now (receipts start). After the commit and never able to change the answer; a failure is
   * logged with the person's id (TD-361: no retry yet).
   */
  async function verifiedAddressToStripe(userId: string, email: string): Promise<void> {
    const checkout = options.checkout;
    if (!checkout) return;
    try {
      const customer = (await store.billing.summaryOf(userId)).account?.stripeCustomerId ?? (await checkout.customerIdOf(userId));
      if (customer) await checkout.setCustomerEmail(customer, email);
    } catch (err) {
      logger.error({ err, userId, event: 'claim_stripe_email_failed' }, 'verified address not set on the Stripe customer');
    }
  }

  /** MUT-765: `accountant.customer_claimed` on the business profile his grant reads, in the redeem's transaction. */
  async function claimedAudit(c: Context<AppEnv>, person: UserRecord): Promise<AuditEventInput[]> {
    const { accountantUserId, business } = await claimContextOf(store, person);
    const grant = accountantUserId && business ? await store.accountantGrants.findActive(accountantUserId, business.id) : null;
    return grant ? [grantAudit(grant, 'accountant.customer_claimed', person.id, c.get('requestId'))] : [];
  }

  type RedeemBody = { token: string; password: string; claimCode?: string | undefined; challengeToken?: string | undefined; code?: string | undefined; recoveryCode?: string | undefined; termsLocale?: 'en' | 'ar' | undefined; clientRelease?: string | undefined; displayName?: string | undefined; defaultCurrency?: string | undefined; timezone?: string | undefined };
  /** MUT-367 (D22): the account's status after the redeem; PENDING_REVIEW signs in to 403 ACCOUNT_UNDER_REVIEW. */
  type Redeemed = { email: string; status: 'ACTIVE' | 'PENDING_REVIEW' };
  const redeemedStatus = (status: UserRecord['status']): Redeemed['status'] => (status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'ACTIVE');

  async function redeemPersonLink(c: Context<AppEnv>, link: PersonSetupLinkRecord, person: UserRecord, body: RedeemBody): Promise<Redeemed> {
    // MUT-765: the claim code first (a provisioned link only), before the second step and the slow hash.
    const claim = await claimOfLink(store, link);
    if (claim) {
      if (!body.claimCode) throw new ApiError('VALIDATION_FAILED', 'This link needs the code your accountant gave you', { fields: ['claimCode'] });
      await verifyClaimWithLog(person, claim, body.claimCode);
    }
    await secondStepFor(c, link, person, body);
    const tokenDigest = sessionDigest(settings.pepper, body.token);
    // Hash before claiming, so the slow part never runs inside the transaction.
    const passwordHash = await passwordHasher.hash(body.password);
    const audit = [...(await passwordSetAudit(c, person, link)), ...(claim ? await claimedAudit(c, person) : [])];
    // The setup page is the portal: a cookie surface.
    const acceptance = termsAcceptanceOf(terms, body.termsLocale ?? person.locale, 'cookie', body.clientRelease);
    const termsAudit = await termsAcceptedAudit(store, person, acceptance, c.get('requestId'));
    // A fresh instant after the slow hash: the expiry check and passwordChangedAt must not predate a sign-in that ran meanwhile.
    const at = c.get('now')();
    const redeemed = await store.accountSetup.redeem({ tokenDigest, passwordHash, at, audit, terms: acceptance, termsAudit });
    if (!redeemed) throw unusable(await stateAfterLosing(body.token, at));
    twoFactor.log(c, 'password.reset', person.id, { outcome: link.purpose });
    if (claim) await verifiedAddressToStripe(person.id, redeemed.email);
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
   * MUT-710 (ADR-274 D11, review 4): every person link (setup, reset, an operator's, --lock included) asks for the
   * second step when the person has it on, whatever its purpose: after an operator --lock nulls the password the next
   * link is SETUP, and it must not skip the step. The challenge is bound to this link and person, and is consumed here
   * (single use, by the store's conditional update) before the slow hash; a redeem that then loses its race leaves it
   * spent, and the person starts the step again.
   */
  async function secondStepFor(c: Context<AppEnv>, link: PersonSetupLinkRecord, person: UserRecord, body: RedeemBody): Promise<void> {
    const second = await twoFactor.stateOf(store, person.id);
    if (!second) return;
    if (!body.challengeToken) throw twoFactorRequired(await twoFactor.challenge(c, store, person, second, { purpose: 'reset', linkId: link.id }));
    await twoFactor.verify(c, store, { challengeToken: body.challengeToken, code: body.code, recoveryCode: body.recoveryCode }, { purpose: 'reset', linkId: link.id, userId: person.id });
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
    const outcome = signupAccountOutcome(link, at, { starter: store.billing.starterPlan, openSignup });
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
        { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'user.signed_up', entityType: 'user', entityId: userId, metadata: { linkId: link.id, locale: link.locale, status: outcome.status, ...signupRiskOf(link) }, requestId },
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

/**
 * MUT-737 (ADR-289, AC3): the domain screen's verdict, kept on `user.signed_up` as a risk signal only (the operator's
 * account page shows it); never a gate. A link issued before the screen existed has no class.
 */
export function signupRiskOf(link: Pick<SignupLinkRecord, 'domainClass' | 'domainReasons'>): { domainClass: string | null; reasons: string[] } {
  return { domainClass: link.domainClass, reasons: [...link.domainReasons] };
}

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
