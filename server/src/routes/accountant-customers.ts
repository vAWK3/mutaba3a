import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { grantAudit } from '../accountants/grants.js';
import { personalOrganizationIdOf } from '../accountants/provision.js';
import { generateSetupToken, setupLinkOrigin, setupUrl } from '../auth/account-setup.js';
import { CLAIM_REISSUES_PER_DAY, claimCodeDigest, generateClaimCode } from '../auth/claim-code.js';
import { isClaimCodeLocked } from '../accountants/claim.js';
import { COVERING_STATUSES, profilePlanSubscriptions } from '../billing/entitlement.js';
import type { Context } from 'hono';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { sessionDigest } from '../auth/sessions.js';
import { normalizeEmail } from '../auth/users.js';
import { domainOf } from '../email/domains/screen.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import { IDEMPOTENCY_HEADER, requestFingerprint, requireKey, runIdempotent, type IdempotentOutcome } from '../idempotency.js';
import type { Logger } from '../logger.js';
import { personalProfileFor } from '../personal-profile.js';
import type { LedgerStore, ProvisionedCustomerRow, UserLocale, UserRecord } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  ProvisionChangeEmailRequestSchema,
  ProvisionCustomerParamSchema,
  ProvisionCustomerRequestSchema,
  ProvisionedCustomerSchema,
  ProvisionedCustomersQuerySchema,
  ProvisionedCustomersSchema,
  ProvisionedLinkSchema,
  ProvisionExistingAddressSchema,
} from '../schemas.js';
import { isRefusedInviteDomain } from './accountants.js';
import { PERSON } from './security.js';

/**
 * MUT-764 (accountant channel, epic MUT-762; eng T3, CEO ACCT-2 and ACCT-7, R2 and R3): an operator-approved
 * accountant creates a customer's account, business profile and read grant in one call (`store.provision.create`),
 * behind the ACCOUNTANT_PROVISIONING dark flag.
 *
 *   POST /v1/accountant/customers                    session: Idempotency-Key required
 *   GET  /v1/accountant/customers                    MUT-765: the accountant's customers and their claim state
 *   POST /v1/accountant/customers/{userId}/link      MUT-765: a fresh link and code (resend, new code), Idempotency-Key
 *   PUT  /v1/accountant/customers/{userId}/email     MUT-765: change the address (old link dead, old address told), Idempotency-Key
 *
 * MUT-765 (ACCT-10): the setup actions work only while the customer has not claimed (403 CUSTOMER_CLAIMED after);
 * another accountant's customer, or an account nobody provisioned, is 404. At most five fresh links a day per customer.
 *
 * The setup link goes to the customer's inbox and appears in no response (ADR-088 section 1). The 6-digit claim code
 * is in the first answer only: the stored outcome, which a replay returns, never holds it. Two limits per approved
 * accountant per UTC day (the operator can change both): accounts created, and attempts that found an address with an
 * account already (R2: the accountant is told, no second account is made, and the attempt is audited and counted).
 */

/** These act on the person, like GET /v1/me: no X-Mutaba3a-Profile. */
export const ACCOUNTANT_CUSTOMER_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/accountant/customers',
  'GET /v1/accountant/customers',
  'POST /v1/accountant/customers/:userId/link',
  'PUT /v1/accountant/customers/:userId/email',
  // MUT-766: the activation Checkout (its handler lives with billing, routes/billing.ts).
  'POST /v1/accountant/customers/:userId/checkout-session',
]);

/** Every endpoint this file adds: the dark-launch switch (ACCOUNTANT_PROVISIONING off) answers 404 for each. */
export const ACCOUNTANT_CUSTOMER_ENDPOINTS: ReadonlySet<string> = ACCOUNTANT_CUSTOMER_ORGANIZATION_INDEPENDENT_ROUTES;

/** ACCT-3 / R3 defaults when the operator set no limit for an accountant. */
export const PROVISION_DEFAULT_CREATE_LIMIT_PER_DAY = 50;
export const PROVISION_DEFAULT_LOOKUP_LIMIT_PER_DAY = 100;
/** The mailed setup link lives 14 days (ACCT-6), not the operator's 72 hours. */
export const PROVISION_LINK_TTL_MS = 14 * 24 * 3_600_000;

const DAY_MS = 86_400_000;
const SETUP_LINK_VALID_DAYS = PROVISION_LINK_TTL_MS / DAY_MS;

const OPERATION = 'accountant.customers.create';
const REISSUE_OPERATION = 'accountant.customers.link';
const EMAIL_OPERATION = 'accountant.customers.email';
const DEFAULT_PAGE = 100;

export interface AccountantCustomerRouteOptions {
  store: LedgerStore;
  settings: SessionSettings;
  mailer: Mailer;
  logger: Logger;
}

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const utcDayStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export function accountantCustomerRoutes(options: AccountantCustomerRouteOptions): OpenAPIHono<AppEnv> {
  const { store, settings, mailer, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  /** The operator's approval, needed by every call here (withdrawn means no setup action either). */
  async function approvedAccountant(c: Context<AppEnv>): Promise<UserRecord> {
    const { user } = c.get('identity');
    const approval = await store.provision.approvalOf(user.id);
    if (!approval?.enabled) throw new ApiError('ACCOUNTANT_NOT_APPROVED', 'The operator has not approved you to create customers');
    return user;
  }

  /**
   * Mails a provisioned link (`customer-setup`, naming the accountant and the business) and records whether it went.
   * Never throws and never changes the answer: a failed send leaves the link valid and FAILED (the desk offers Resend).
   */
  async function mailSetupLink(c: Context<AppEnv>, input: { customerId: string; to: string; locale: UserLocale; businessName: string; tokenDigest: string; token: string }): Promise<boolean> {
    const { user } = c.get('identity');
    const link = setupUrl(setupLinkOrigin(settings.portalOrigin, c.req.url), input.token);
    let sent = false;
    try {
      const outcome = await mailer.send({
        to: input.to,
        template: 'customer-setup',
        locale: input.locale,
        vars: { accountantName: user.displayName, businessName: input.businessName, link, validDays: SETUP_LINK_VALID_DAYS },
        idempotencyKey: `provision-setup:${input.customerId}:${input.tokenDigest.slice(0, 16)}`,
      });
      if (outcome.status !== 'sent') logger.info({ template: 'customer-setup', outcome: outcome.status }, 'provisioned setup link not sent');
      sent = outcome.status === 'sent';
    } catch (err) {
      logger.error({ err, template: 'customer-setup' }, 'provisioned setup link failed');
    }
    try {
      await store.provision.setMailStatus(input.tokenDigest, sent ? 'SENT' : 'FAILED');
    } catch (err) {
      logger.error({ err }, 'provisioned link mail status not saved');
    }
    return sent;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant/customers',
      tags: ['Accountants'],
      summary: 'Create a customer’s account and business profile (an approved accountant)',
      description: `MUT-764 (accountant channel). One call makes the customer's passwordless account, their business profile and your read-only grant (ADR-245: you view issued invoices and scanned receipts and act on nothing). The customer is mailed a setup link, valid 14 days; no response ever carries the link or its token. The 201 carries the 6-digit claim code once: tell it to the customer, who types it on the setup page; a repeat of the same ${IDEMPOTENCY_HEADER} returns the same account without the code. An address that already has an account makes none: you get \`{ status: "exists" }\` (ask the customer to share their books with you). Per UTC day an approved accountant makes at most 50 accounts and at most 100 attempts on addresses that already have one (the operator can change both): beyond that 429 RATE_LIMITED, details.limit CREATE_PER_DAY or LOOKUP_PER_DAY. 403 ACCOUNTANT_NOT_APPROVED until the operator approves you. 404 while the feature is off.`,
      security: PERSON,
      request: { body: jsonBody(ProvisionCustomerRequestSchema) },
      responses: {
        201: { description: 'Created; the claim code is in this answer only', content: { 'application/json': { schema: ProvisionedCustomerSchema } } },
        200: { description: 'The address already has an account; nothing was created', content: { 'application/json': { schema: ProvisionExistingAddressSchema } } },
        403: errorResponse('ACCOUNTANT_NOT_APPROVED: the operator has not approved this person to create customers, or withdrew it'),
        404: errorResponse('The feature is off on this server'),
        422: errorResponse(`IDEMPOTENCY_KEY_REQUIRED (send an ${IDEMPOTENCY_HEADER} header), IDEMPOTENCY_KEY_REUSED (the key was used with a different body), or VALIDATION_FAILED: a malformed request, or details.reason ADDRESS_REFUSED (a disposable or relay address)`),
        429: errorResponse('RATE_LIMITED: the daily limit, details.limit CREATE_PER_DAY or LOOKUP_PER_DAY, with details.max and Retry-After'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      // Approval first: it needs no key and changes nothing, and the store re-checks it inside the transaction.
      const approval = await store.provision.approvalOf(user.id);
      if (!approval?.enabled) throw new ApiError('ACCOUNTANT_NOT_APPROVED', 'The operator has not approved you to create customers');
      const key = requireKey(c, OPERATION);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const requestId = c.get('requestId');
      const email = normalizeEmail(body.email);
      const dayStart = utcDayStart(now);
      const retryAfterSeconds = Math.max(1, Math.ceil((dayStart.getTime() + DAY_MS - now.getTime()) / 1000));

      const refuseAtLimit = (limit: 'CREATE_PER_DAY' | 'LOOKUP_PER_DAY', max: number): never => {
        c.header('Retry-After', String(retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Daily limit reached; try again tomorrow', { limit, max, retryAfterSeconds });
      };

      /** R2: the address has an account. Counted against the lookup limit and audited (never with the address). */
      async function existing(): Promise<IdempotentOutcome> {
        const max = approval!.lookupLimitPerDay ?? PROVISION_DEFAULT_LOOKUP_LIMIT_PER_DAY;
        if ((await store.provision.countLookupsSince(user.id, dayStart)) >= max) return refuseAtLimit('LOOKUP_PER_DAY', max);
        await store.audit.append({
          organizationId: await personalOrganizationIdOf(store, user.id),
          actorType: 'USER',
          actorId: user.id,
          action: 'accountant.customer_lookup_existing',
          entityType: 'user',
          entityId: user.id,
          metadata: {},
          requestId,
        });
        return { status: 200, body: { status: 'exists' } };
      }

      let claimCode: string | undefined;
      async function createOnce(): Promise<IdempotentOutcome> {
        if (isRefusedInviteDomain(domainOf(email))) throw new ApiError('VALIDATION_FAILED', 'Use the customer’s own address, not a throwaway or forwarding one', { reason: 'ADDRESS_REFUSED' });
        if (await store.users.findByEmail(email)) return existing();
        const max = approval!.createLimitPerDay ?? PROVISION_DEFAULT_CREATE_LIMIT_PER_DAY;
        if ((await store.provision.countCreatedSince(user.id, dayStart)) >= max) return refuseAtLimit('CREATE_PER_DAY', max);

        const locale = body.locale ?? user.locale;
        const token = generateSetupToken();
        const code = generateClaimCode();
        const expiresAt = new Date(now.getTime() + PROVISION_LINK_TTL_MS);
        const result = await store.provision.create({
          accountantUserId: user.id,
          email,
          displayName: body.displayName,
          locale,
          personal: personalProfileFor(locale, { defaultCurrency: body.defaultCurrency, timezone: body.timezone }),
          profile: { name: body.profileName, slug: `p-${randomUUID()}`, defaultCurrency: body.defaultCurrency, timezone: body.timezone },
          setupLink: { tokenDigest: sessionDigest(settings.pepper, token), expiresAt },
          claimCodeDigest: claimCodeDigest(settings.pepper, email, code),
          at: now,
          auditFor: ({ grant }) => [grantAudit(grant, 'accountant.customer_created', user.id, requestId)],
        });
        if (result.kind === 'not_approved') throw new ApiError('ACCOUNTANT_NOT_APPROVED', 'The operator has not approved you to create customers');
        if (result.kind === 'account_exists') return existing();

        const mailSent = await mailSetupLink(c, { customerId: result.user.id, to: email, locale, businessName: result.organization.name, tokenDigest: sessionDigest(settings.pepper, token), token });
        claimCode = code;
        return {
          status: 201,
          body: {
            status: 'created',
            customer: { userId: result.user.id, email, displayName: result.user.displayName },
            profile: { id: result.organization.id, name: result.organization.name },
            linkExpiresAt: expiresAt.toISOString(),
            mailSent,
          },
        };
      }

      const outcome = await runIdempotent(
        {
          claim: (args) => store.userIdempotency.claim({ userId: user.id, ...args }),
          complete: (args) => store.userIdempotency.complete({ userId: user.id, ...args }),
          fail: (args) => store.userIdempotency.fail({ userId: user.id, ...args }),
        },
        { key, operation: OPERATION, fingerprints: [requestFingerprint('POST', c.req.path, JSON.stringify(body))], now },
        createOnce,
      );
      if (outcome.replayed) c.header('Idempotent-Replayed', 'true');
      // The stored outcome never holds the code; only this first answer adds it.
      const answer = !outcome.replayed && claimCode ? { ...(outcome.body as object), claimCode } : outcome.body;
      return c.json(answer as never, outcome.status as 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/accountant/customers',
      tags: ['Accountants'],
      summary: 'The customers you created and where each one is in claiming their account (MUT-765)',
      description:
        'Newest first; `limit` up to 500 (default 100), then `before` = the previous `nextBefore`. `state`: awaiting_claim, link_expired, code_locked (five wrong codes; issue a new link), or claimed (only the read access remains). 403 ACCOUNTANT_NOT_APPROVED; 404 while the feature is off. Additive since 1.160.0-mut765.',
      security: PERSON,
      request: { query: ProvisionedCustomersQuerySchema },
      responses: {
        200: { description: 'The customers', content: { 'application/json': { schema: ProvisionedCustomersSchema } } },
        403: errorResponse('ACCOUNTANT_NOT_APPROVED'),
        404: errorResponse('The feature is off on this server'),
      },
    }),
    async (c) => {
      const user = await approvedAccountant(c);
      const query = c.req.valid('query');
      const limit = query.limit ?? DEFAULT_PAGE;
      const rows = await store.provision.customersOf(user.id, { limit, before: query.before ? new Date(query.before) : undefined });
      const now = c.get('now')();
      const paid = await Promise.all(rows.map(async (row) => profilePlanSubscriptions((await store.billing.summaryOf(row.userId)).subscriptions).some((s) => COVERING_STATUSES.has(s.status))));
      return c.json({ items: rows.map((row, i) => customerView(row, now, paid[i] ?? false)), nextBefore: rows.length === limit ? rows[rows.length - 1]!.provisionedAt.toISOString() : null }, 200);
    },
  );

  const setupActionResponses = {
    200: { description: 'A fresh link was mailed; the claim code is in this answer only', content: { 'application/json': { schema: ProvisionedLinkSchema } } },
    403: errorResponse('ACCOUNTANT_NOT_APPROVED, or CUSTOMER_CLAIMED: the customer has claimed the account, so only your read access remains'),
    404: errorResponse('No customer you created by this id, or the feature is off'),
    409: errorResponse('CONFLICT reason EMAIL_TAKEN: another account has that address'),
    422: errorResponse('IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED, or VALIDATION_FAILED (details.reason ADDRESS_REFUSED for a throwaway or relay address)'),
    429: errorResponse(`RATE_LIMITED details.limit REISSUE_PER_DAY: ${CLAIM_REISSUES_PER_DAY} fresh links a day per customer, with Retry-After`),
  } as const;

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant/customers/{userId}/link',
      tags: ['Accountants'],
      summary: 'Send the customer a fresh setup link with a new claim code (MUT-765)',
      description:
        'Resend and New code are this one action: the old link and code stop working, a fresh 14-day link is mailed and the new code is in this answer only (a replay of the same Idempotency-Key returns the rest without it). Only while the customer has not claimed. Additive since 1.160.0-mut765.',
      security: PERSON,
      request: { params: ProvisionCustomerParamSchema },
      responses: setupActionResponses,
    }),
    async (c) => c.json((await setupAction(c, REISSUE_OPERATION, c.req.valid('param').userId, undefined)) as never, 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/accountant/customers/{userId}/email',
      tags: ['Accountants'],
      summary: 'Change the customer’s address: the old link and code die, the old address is told (MUT-765)',
      description:
        'The account moves to the new address; a fresh link goes there with a new code (in this answer only), and the old address gets a short notice that its link no longer works. Only while the customer has not claimed. Additive since 1.160.0-mut765.',
      security: PERSON,
      request: { params: ProvisionCustomerParamSchema, body: jsonBody(ProvisionChangeEmailRequestSchema) },
      responses: setupActionResponses,
    }),
    async (c) => c.json((await setupAction(c, EMAIL_OPERATION, c.req.valid('param').userId, normalizeEmail(c.req.valid('json').email))) as never, 200),
  );

  /** MUT-765: reissue or change of address, idempotent, capped, only while unclaimed. */
  async function setupAction(c: Context<AppEnv>, operation: string, customerUserId: string, newEmail: string | undefined): Promise<object> {
    const user = await approvedAccountant(c);
    const key = requireKey(c, operation);
    const now = c.get('now')();
    const requestId = c.get('requestId');
    if (newEmail !== undefined && isRefusedInviteDomain(domainOf(newEmail))) {
      throw new ApiError('VALIDATION_FAILED', 'Use the customer’s own address, not a throwaway or forwarding one', { reason: 'ADDRESS_REFUSED' });
    }
    let claimCode: string | undefined;
    const outcome = await runIdempotent(
      {
        claim: (args) => store.userIdempotency.claim({ userId: user.id, ...args }),
        complete: (args) => store.userIdempotency.complete({ userId: user.id, ...args }),
        fail: (args) => store.userIdempotency.fail({ userId: user.id, ...args }),
      },
      { key, operation, fingerprints: [requestFingerprint(c.req.method, c.req.path, JSON.stringify({ customerUserId, newEmail: newEmail ?? null }))], now },
      async (): Promise<IdempotentOutcome> => {
        const dayStart = utcDayStart(now);
        if ((await store.provision.countReissuesSince(customerUserId, dayStart)) >= CLAIM_REISSUES_PER_DAY) {
          const retryAfterSeconds = Math.max(1, Math.ceil((dayStart.getTime() + DAY_MS - now.getTime()) / 1000));
          c.header('Retry-After', String(retryAfterSeconds));
          throw new ApiError('RATE_LIMITED', 'Too many new links for this customer today; try again tomorrow', { limit: 'REISSUE_PER_DAY', max: CLAIM_REISSUES_PER_DAY, retryAfterSeconds });
        }
        const token = generateSetupToken();
        const code = generateClaimCode();
        const tokenDigest = sessionDigest(settings.pepper, token);
        const expiresAt = new Date(now.getTime() + PROVISION_LINK_TTL_MS);
        const result = await store.provision.reissue({
          accountantUserId: user.id,
          customerUserId,
          email: newEmail,
          setupLink: { tokenDigest, expiresAt },
          // Bound to the address the link goes to: a change of address rotates the code.
          claimCodeDigestFor: (email) => claimCodeDigest(settings.pepper, email, code),
          at: now,
          auditFor: ({ grant }) => [grantAudit(grant, newEmail === undefined ? 'accountant.customer_link_reissued' : 'accountant.customer_email_changed', user.id, requestId)],
        });
        if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'Customer not found');
        if (result.kind === 'claimed') throw new ApiError('CUSTOMER_CLAIMED', 'The customer has claimed the account');
        if (result.kind === 'email_taken') throw new ApiError('CONFLICT', 'Another account has that address', { reason: 'EMAIL_TAKEN' });
        const mailSent = await mailSetupLink(c, { customerId: customerUserId, to: result.email, locale: result.locale, businessName: result.organization.name, tokenDigest, token });
        if (newEmail !== undefined && result.previousEmail !== result.email) await tellOldAddress(result.previousEmail, result.locale, user.displayName, result.organization.name, customerUserId, tokenDigest);
        claimCode = code;
        return { status: 200, body: { email: result.email, linkExpiresAt: expiresAt.toISOString(), mailSent } };
      },
    );
    if (outcome.replayed) c.header('Idempotent-Replayed', 'true');
    return !outcome.replayed && claimCode ? { ...(outcome.body as object), claimCode } : (outcome.body as object);
  }

  /** ACCT-6: the old address learns its link is dead. Never throws, never changes the answer. */
  async function tellOldAddress(to: string, locale: UserLocale, accountantName: string, businessName: string, customerId: string, tokenDigest: string): Promise<void> {
    try {
      const sent = await mailer.send({ to, template: 'customer-setup-cancelled', locale, vars: { accountantName, businessName }, idempotencyKey: `provision-cancelled:${customerId}:${tokenDigest.slice(0, 16)}` });
      if (sent.status !== 'sent') logger.info({ template: 'customer-setup-cancelled', outcome: sent.status }, 'old-address notice not sent');
    } catch (err) {
      logger.error({ err, template: 'customer-setup-cancelled' }, 'old-address notice failed');
    }
  }

  return app;
}

/** The desk's row. A claimed customer shows no link (no setup action remains). */
export function customerView(row: ProvisionedCustomerRow, now: Date, paid: boolean) {
  const link = row.claimed ? null : row.link;
  const live = link && link.usedAt === null && link.cancelledAt === null && link.expiresAt.getTime() > now.getTime();
  const state = row.claimed ? 'claimed' : !live ? 'link_expired' : isClaimCodeLocked(link) ? 'code_locked' : 'awaiting_claim';
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    profile: row.profile,
    provisionedAt: row.provisionedAt.toISOString(),
    state,
    link: link ? { expiresAt: link.expiresAt.toISOString(), mailStatus: link.mailStatus } : null,
    paid,
  } as const;
}
