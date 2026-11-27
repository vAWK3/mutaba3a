import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { grantAudit } from '../accountants/grants.js';
import { personalOrganizationIdOf } from '../accountants/provision.js';
import { generateSetupToken, setupLinkOrigin, setupUrl } from '../auth/account-setup.js';
import { claimCodeDigest, generateClaimCode } from '../auth/claim-code.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { sessionDigest } from '../auth/sessions.js';
import { normalizeEmail } from '../auth/users.js';
import { domainOf } from '../email/domains/screen.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import { IDEMPOTENCY_HEADER, requestFingerprint, requireKey, runIdempotent, type IdempotentOutcome } from '../idempotency.js';
import type { Logger } from '../logger.js';
import { personalProfileFor } from '../personal-profile.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, ProvisionCustomerRequestSchema, ProvisionedCustomerSchema, ProvisionExistingAddressSchema } from '../schemas.js';
import { isRefusedInviteDomain } from './accountants.js';
import { PERSON } from './security.js';

/**
 * MUT-764 (accountant channel, epic MUT-762; eng T3, CEO ACCT-2 and ACCT-7, R2 and R3): an operator-approved
 * accountant creates a customer's account, business profile and read grant in one call (`store.provision.create`),
 * behind the ACCOUNTANT_PROVISIONING dark flag.
 *
 *   POST /v1/accountant/customers   session: Idempotency-Key required
 *
 * The setup link goes to the customer's inbox and appears in no response (ADR-088 section 1). The 6-digit claim code
 * is in the first answer only: the stored outcome, which a replay returns, never holds it. Two limits per approved
 * accountant per UTC day (the operator can change both): accounts created, and attempts that found an address with an
 * account already (R2: the accountant is told, no second account is made, and the attempt is audited and counted).
 */

/** These act on the person, like GET /v1/me: no X-Mutaba3a-Profile. */
export const ACCOUNTANT_CUSTOMER_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['POST /v1/accountant/customers']);

/** Every endpoint this file adds: the dark-launch switch (ACCOUNTANT_PROVISIONING off) answers 404 for each. */
export const ACCOUNTANT_CUSTOMER_ENDPOINTS: ReadonlySet<string> = ACCOUNTANT_CUSTOMER_ORGANIZATION_INDEPENDENT_ROUTES;

/** ACCT-3 / R3 defaults when the operator set no limit for an accountant. */
export const PROVISION_DEFAULT_CREATE_LIMIT_PER_DAY = 50;
export const PROVISION_DEFAULT_LOOKUP_LIMIT_PER_DAY = 100;
/** The mailed setup link lives 14 days (ACCT-6), not the operator's 72 hours. */
export const PROVISION_LINK_TTL_MS = 14 * 24 * 3_600_000;
const SETUP_LINK_VALID_HOURS = PROVISION_LINK_TTL_MS / 3_600_000;
const DAY_MS = 86_400_000;
const OPERATION = 'accountant.customers.create';

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

        const mailSent = await mailSetupLink(result.user.id, email, locale, setupUrl(setupLinkOrigin(settings.portalOrigin, c.req.url), token));
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

      /** Never throws and never changes the answer: a failed send leaves the account created (MUT-765 resends). */
      async function mailSetupLink(customerId: string, to: string, locale: typeof user.locale, link: string): Promise<boolean> {
        try {
          const sent = await mailer.send({ to, template: 'finish-setup', locale, vars: { link, validHours: SETUP_LINK_VALID_HOURS }, idempotencyKey: `provision-setup:${customerId}` });
          if (sent.status !== 'sent') logger.info({ template: 'finish-setup', outcome: sent.status }, 'provisioned setup link not sent');
          return sent.status === 'sent';
        } catch (err) {
          logger.error({ err, template: 'finish-setup' }, 'provisioned setup link failed');
          return false;
        }
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

  return app;
}
