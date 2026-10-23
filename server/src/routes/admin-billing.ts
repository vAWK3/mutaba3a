import { randomUUID } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { normalizeEmail } from '../auth/users.js';
import { ApiError } from '../errors.js';
import { billingStatusOf, serializeEntitlement } from '../billing/coverage.js';
import { consumerCountryCheck, type BillingCountries } from '../billing/checkout.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import { StripeGatewayError } from '../billing/stripe/gateway.js';
import { ownedProfilesOf } from '../personal-profile.js';
import { ForeignKeyViolation, StateConflict } from '../repositories/memory.js';
import type { AuditEventInput, JsonObject, LedgerStore } from '../repositories/ports.js';
import {
  BillingAccountListSchema,
  BillingStatusSchema,
  CreateEntitlementGrantRequestSchema,
  EntitlementGrantListSchema,
  EntitlementGrantSchema,
  ErrorEnvelopeSchema,
  LinkBillingAccountRequestSchema,
  LinkBillingAccountResponseSchema,
  RevokeEntitlementGrantResponseSchema,
} from '../schemas.js';
import { serializeBillingAccount, serializeGrant } from '../serializers.js';

/**
 * MUT-358 (ADR-160, brief §2.6): the operator's billing levers. Grants cover a person's own profiles or one profile
 * (pilot comps, the pre-billing backfill's revocation); links tie a Stripe customer to a person until MUT-360's
 * webhook and checkout do it themselves. Every change is audited, on each profile it reaches. Behind /admin/*'s token.
 */
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const adminErrors = { 401: errorResponse('Missing or invalid admin token') } as const;
const GRANTED_BY = 'admin';

const GrantIdParam = z.object({ grantId: z.string().uuid().openapi({ param: { name: 'grantId', in: 'path' } }) });

export interface AdminBillingOptions {
  /** MUT-362 (eng review D9): asked for each linked customer's tax IDs in the status check; null = not configured. */
  checkout: CheckoutGateway | null;
  countries: BillingCountries;
}

export function adminBillingRoutes(store: LedgerStore, options: AdminBillingOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** A customer's tax IDs plus a Checkout tax number on its invoices (review D3), or null when Stripe can't be asked. */
  async function taxIdsOf(customer: string): Promise<number | null> {
    if (!options.checkout) return null;
    try {
      return await options.checkout.businessTaxIdCount(customer);
    } catch (err) {
      if (err instanceof StripeGatewayError) return null;
      throw err;
    }
  }

  /** The person named by id or email; NOT_FOUND if there is no such person. */
  async function personId(body: { userId?: string | undefined; userEmail?: string | undefined }): Promise<string> {
    const user = body.userId !== undefined ? await store.users.getById(body.userId) : await store.users.findByEmail(normalizeEmail(body.userEmail ?? ''));
    if (!user) throw new ApiError('NOT_FOUND', 'User not found');
    return user.id;
  }

  /** One audit row per profile the change reaches: the person's own profiles, or the one profile. */
  async function auditOn(target: { userId: string | null; organizationId: string | null }, row: Omit<AuditEventInput, 'organizationId'>): Promise<AuditEventInput[]> {
    const organizationIds = target.organizationId ? [target.organizationId] : (await ownedProfilesOf(store, target.userId!)).map((o) => o.id);
    return organizationIds.map((organizationId) => ({ ...row, organizationId }));
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/grants',
      tags: ['Admin'],
      summary: 'Grant billing coverage to a person (their own profiles) or to one profile',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: CreateEntitlementGrantRequestSchema } } } },
      responses: {
        201: { description: 'Granted', content: { 'application/json': { schema: EntitlementGrantSchema } } },
        404: errorResponse('No such user or organization'),
        422: errorResponse('Validation failed'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const now = c.get('now')();
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt <= now) throw new ApiError('VALIDATION_FAILED', 'expiresAt must be in the future', { field: 'expiresAt' });
      const target = body.organizationId !== undefined ? { userId: null, organizationId: body.organizationId } : { userId: await personId(body), organizationId: null };
      if (target.organizationId && !(await store.organizations.getById(target.organizationId))) throw new ApiError('NOT_FOUND', 'Organization not found');
      const id = randomUUID();
      const metadata: JsonObject = { ...target, tier: body.tier, reason: body.reason, expiresAt: expiresAt?.toISOString() ?? null };
      const audit = await auditOn(target, grantAudit('billing.grant_created', id, metadata, c.get('requestId')));
      try {
        const grant = await store.billing.createGrant({ id, ...target, tier: body.tier, reason: body.reason, expiresAt, grantedBy: GRANTED_BY, at: now, audit });
        return c.json(serializeGrant(grant), 201);
      } catch (err) {
        if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'User or organization not found');
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/admin/v1/billing/grants/{grantId}',
      tags: ['Admin'],
      summary: 'Revoke a grant (it is kept, with revokedAt set); revoking twice changes nothing',
      security: [{ adminToken: [] }],
      request: { params: GrantIdParam },
      responses: {
        200: { description: 'Revoked, or already revoked', content: { 'application/json': { schema: RevokeEntitlementGrantResponseSchema } } },
        404: errorResponse('No such grant'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const { grantId } = c.req.valid('param');
      const existing = await store.billing.getGrant(grantId);
      if (!existing) throw new ApiError('NOT_FOUND', 'Grant not found');
      const metadata: JsonObject = { userId: existing.userId, organizationId: existing.organizationId, tier: existing.tier, reason: existing.reason };
      const audit = await auditOn(existing, grantAudit('billing.grant_revoked', grantId, metadata, c.get('requestId')));
      const result = await store.billing.revokeGrant(grantId, c.get('now')(), audit);
      if (!result) throw new ApiError('NOT_FOUND', 'Grant not found');
      return c.json({ grant: serializeGrant(result.grant), revoked: result.revoked }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/billing/grants',
      tags: ['Admin'],
      summary: 'List grants, newest first; active=true keeps only those in force now',
      security: [{ adminToken: [] }],
      request: {
        query: z.object({
          userId: z.string().uuid().optional(),
          organizationId: z.string().uuid().optional(),
          active: z.enum(['true', 'false']).optional(),
        }),
      },
      responses: {
        200: { description: 'Grants', content: { 'application/json': { schema: EntitlementGrantListSchema } } },
        422: errorResponse('Validation failed'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const { userId, organizationId, active } = c.req.valid('query');
      const grants = await store.billing.listGrants({ userId, organizationId, activeAt: active === 'true' ? c.get('now')() : undefined });
      return c.json({ grants: grants.map(serializeGrant) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/accounts/link',
      tags: ['Admin'],
      summary: 'Link a Stripe customer to a person (a pilot subscription made by hand in the dashboard)',
      description: 'Creates the billing account when the customer is new here; `currency` is then required. Linking the same pair again changes nothing.',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: LinkBillingAccountRequestSchema } } } },
      responses: {
        200: { description: 'Linked, or already linked to this person', content: { 'application/json': { schema: LinkBillingAccountResponseSchema } } },
        404: errorResponse('No such user'),
        409: errorResponse('CONFLICT: the customer is linked to someone else, or the person already has another customer'),
        422: errorResponse('Validation failed, or currency missing for a new customer'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const userId = await personId(body);
      const metadata: JsonObject = { stripeCustomerId: body.stripeCustomerId, userId };
      const audit = await auditOn({ userId, organizationId: null }, { actorType: 'ADMIN', actorId: null, action: 'billing.account_linked', entityType: 'user', entityId: userId, metadata, requestId: c.get('requestId') });
      try {
        const { account, linked } = await store.billing.linkAccount({ stripeCustomerId: body.stripeCustomerId, userId, currency: body.currency ?? null, at: c.get('now')(), audit });
        return c.json({ account: serializeBillingAccount(account), linked }, 200);
      } catch (err) {
        if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'User not found');
        if (err instanceof StateConflict && err.reason === 'CURRENCY_REQUIRED') {
          throw new ApiError('VALIDATION_FAILED', 'This customer is new here: give its currency (ILS or USD)', { field: 'currency' });
        }
        if (err instanceof StateConflict) throw new ApiError('CONFLICT', linkConflictMessage(err.reason), { reason: err.reason });
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/billing/accounts',
      tags: ['Admin'],
      summary: 'List Stripe customers, oldest first; linked=false lists those still to be matched to a person',
      security: [{ adminToken: [] }],
      request: { query: z.object({ linked: z.enum(['true', 'false']).optional() }) },
      responses: {
        200: { description: 'Billing accounts', content: { 'application/json': { schema: BillingAccountListSchema } } },
        422: errorResponse('Validation failed'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const { linked } = c.req.valid('query');
      const accounts = await store.billing.listAccounts({ linked: linked === undefined ? undefined : linked === 'true' });
      return c.json({ accounts: accounts.map(serializeBillingAccount) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/billing/status',
      tags: ['Admin'],
      summary: 'One person’s Stripe mirror and entitlement, with and without operator grants (MUT-360)',
      description:
        'The pilot cutover check: revoke a person’s grant only once `billingWithoutGrants` shows ACTIVE / STRIPE. MUT-362: `countryCheck` flags a ' +
        'linked payer billed outside the consumer countries with no tax ID (asks Stripe for the customer’s tax IDs). Exactly one of userId and email.',
      security: [{ adminToken: [] }],
      request: { query: z.object({ userId: z.string().uuid().optional(), email: z.string().min(3).max(320).optional() }) },
      responses: {
        200: { description: 'Billing status', content: { 'application/json': { schema: BillingStatusSchema } } },
        404: errorResponse('No such person'),
        422: errorResponse('Validation failed'),
        ...adminErrors,
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      if ((query.userId === undefined) === (query.email === undefined)) throw new ApiError('VALIDATION_FAILED', 'Give exactly one of userId and email');
      const userId = await personId({ userId: query.userId, userEmail: query.email });
      const user = (await store.users.getById(userId))!;
      const owned = await ownedProfilesOf(store, userId);
      const profiles = await Promise.all(
        owned.map(async (organization) => ({
          organization,
          malafatConnected: (await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT'))?.status === 'CONNECTED',
        })),
      );
      const { subscriptions, entitlements } = await billingStatusOf(store, profiles, c.get('now')());
      const accounts = (await store.billing.listAccounts({ linked: true })).filter((a) => a.userId === userId);
      const countryCheck = await Promise.all(
        accounts.map(async (a) => {
          const taxIds = await taxIdsOf(a.stripeCustomerId);
          return { stripeCustomerId: a.stripeCustomerId, country: a.country, taxIds, ...consumerCountryCheck(a.country, taxIds, options.countries) };
        }),
      );
      return c.json(
        {
          user: { id: user.id, email: user.email },
          accounts: accounts.map(serializeBillingAccount),
          subscriptions: subscriptions.map((s) => ({
            stripeSubscriptionId: s.stripeSubscriptionId,
            tier: s.tier,
            status: s.status,
            currentPeriodEnd: s.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: s.cancelAtPeriodEnd,
            organizationId: s.organizationId,
            priceLookupKey: s.priceLookupKey,
            payerUserId: s.userId,
          })),
          profiles: owned.map((o) => {
            const e = entitlements.get(o.id)!;
            return { id: o.id, name: o.name, billing: serializeEntitlement(e.current), billingWithoutGrants: serializeEntitlement(e.withoutGrants) };
          }),
          countryCheck,
        },
        200,
      );
    },
  );

  return app;
}

function grantAudit(action: string, grantId: string, metadata: JsonObject, requestId: string): Omit<AuditEventInput, 'organizationId'> {
  return { actorType: 'ADMIN', actorId: null, action, entityType: 'entitlement_grant', entityId: grantId, metadata, requestId };
}

function linkConflictMessage(reason: string): string {
  return reason === 'CUSTOMER_LINKED_ELSEWHERE' ? 'This Stripe customer is already linked to someone else' : 'This person is already linked to another Stripe customer';
}
