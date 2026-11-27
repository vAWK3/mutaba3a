import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { personalOrganizationIdOf } from '../accountants/provision.js';
import { UNCLAIMED_POLICY } from '../accountants/unclaimed-sweep.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import type { AuditEventInput, LedgerStore, ProvisionApproval } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  OperatorProvisionedAccountsQuerySchema,
  OperatorProvisionedAccountsSchema,
  OperatorProvisioningApprovalSchema,
  OperatorProvisioningRequestSchema,
} from '../schemas.js';
import { PROVISION_DEFAULT_CREATE_LIMIT_PER_DAY, PROVISION_DEFAULT_LOOKUP_LIMIT_PER_DAY } from './accountant-customers.js';

/**
 * MUT-764 (accountant channel, epic MUT-762; eng T7, CEO ACCT-7): the operator console's side of provisioning.
 * Mounted behind the /v1 authenticate() and the operator gate (a non-operator gets 404; every write needs the
 * passkey step-up, the gate's rule for any non-GET), on the unguarded base store like the rest of the console.
 *
 *   GET    /v1/operator/accounts/{userId}/accountant-provisioning   the approval, the limits and today's counts
 *   PUT    /v1/operator/accounts/{userId}/accountant-provisioning   approve, with the two daily limits (a full replace)
 *   DELETE /v1/operator/accounts/{userId}/accountant-provisioning   withdraw (the limits are kept)
 *   GET    /v1/operator/provisioned-accounts?limit=                 created for customers and not yet claimed
 */
export const OPERATOR_PROVISIONING_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/operator/accounts/:userId/accountant-provisioning',
  'PUT /v1/operator/accounts/:userId/accountant-provisioning',
  'DELETE /v1/operator/accounts/:userId/accountant-provisioning',
  'GET /v1/operator/provisioned-accounts',
]);

const SESSION = [{ session: [] }];
const DEFAULT_LIST_LIMIT = 50;
const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const operatorErrors = {
  401: errorResponse('Not signed in'),
  403: errorResponse('CROSS_SITE_REQUEST, or RECENT_SIGN_IN_REQUIRED on a write (the passkey step-up)'),
  404: errorResponse('Not an operator, or no such person'),
  422: errorResponse('Validation failed (a limit that is not a whole number from 1 to 1000)'),
} as const;

const utcDayStart = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export function operatorProvisioningRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  async function view(userId: string, approval: ProvisionApproval, now: Date) {
    const since = utcDayStart(now);
    return {
      userId,
      enabled: approval.enabled,
      createLimitPerDay: approval.createLimitPerDay,
      lookupLimitPerDay: approval.lookupLimitPerDay,
      defaults: { createLimitPerDay: PROVISION_DEFAULT_CREATE_LIMIT_PER_DAY, lookupLimitPerDay: PROVISION_DEFAULT_LOOKUP_LIMIT_PER_DAY },
      createdToday: await store.provision.countCreatedSince(userId, since),
      lookupsToday: await store.provision.countLookupsSince(userId, since),
    };
  }

  const mustApprovalOf = async (userId: string): Promise<ProvisionApproval> => {
    const approval = await store.provision.approvalOf(userId);
    if (!approval) throw new ApiError('NOT_FOUND', 'User not found');
    return approval;
  };

  /** One audit row on the accountant's own profile; the limits are metadata, never an address. */
  async function auditRow(c: Context<AppEnv>, userId: string, action: 'accountant.provisioning_approved' | 'accountant.provisioning_withdrawn', approval: Pick<ProvisionApproval, 'createLimitPerDay' | 'lookupLimitPerDay'>): Promise<AuditEventInput> {
    return {
      organizationId: await personalOrganizationIdOf(store, userId),
      actorType: 'USER',
      actorId: c.get('identity').user.id,
      action,
      entityType: 'user',
      entityId: userId,
      metadata: { createLimitPerDay: approval.createLimitPerDay, lookupLimitPerDay: approval.lookupLimitPerDay },
      requestId: c.get('requestId'),
    };
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/accounts/{userId}/accountant-provisioning',
      tags: ['Operator'],
      summary: 'Whether the person may create customers, their two daily limits and what they did today (MUT-764)',
      security: SESSION,
      request: { params: UserIdParam },
      responses: { 200: { description: 'The approval', content: { 'application/json': { schema: OperatorProvisioningApprovalSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      return c.json(await view(userId, await mustApprovalOf(userId), c.get('now')()), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/operator/accounts/{userId}/accountant-provisioning',
      tags: ['Operator'],
      summary: 'Approve the person to create customers, with their two daily limits (idempotent; a null or omitted limit is the default) (MUT-764)',
      security: SESSION,
      request: { params: UserIdParam, body: { required: true, content: { 'application/json': { schema: OperatorProvisioningRequestSchema } } } },
      responses: { 200: { description: 'Approved', content: { 'application/json': { schema: OperatorProvisioningApprovalSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const body = c.req.valid('json');
      await mustApprovalOf(userId);
      const next = { enabled: true, createLimitPerDay: body.createLimitPerDay ?? null, lookupLimitPerDay: body.lookupLimitPerDay ?? null };
      const at = c.get('now')();
      const saved = await store.provision.setApproval({ userId, ...next, at, audit: [await auditRow(c, userId, 'accountant.provisioning_approved', next)] });
      if (!saved) throw new ApiError('NOT_FOUND', 'User not found');
      return c.json(await view(userId, saved, at), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/operator/accounts/{userId}/accountant-provisioning',
      tags: ['Operator'],
      summary: 'Withdraw the approval to create customers; the limits are kept for a later approval (idempotent) (MUT-764)',
      security: SESSION,
      request: { params: UserIdParam },
      responses: { 200: { description: 'Withdrawn', content: { 'application/json': { schema: OperatorProvisioningApprovalSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      const current = await mustApprovalOf(userId);
      const at = c.get('now')();
      const saved = await store.provision.setApproval({
        userId,
        enabled: false,
        createLimitPerDay: current.createLimitPerDay,
        lookupLimitPerDay: current.lookupLimitPerDay,
        at,
        audit: [await auditRow(c, userId, 'accountant.provisioning_withdrawn', current)],
      });
      if (!saved) throw new ApiError('NOT_FOUND', 'User not found');
      return c.json(await view(userId, saved, at), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/provisioned-accounts',
      tags: ['Operator'],
      summary: 'Accounts an accountant created that have no password yet, newest first, with whether they already paid (MUT-764)',
      security: SESSION,
      request: { query: OperatorProvisionedAccountsQuerySchema },
      responses: { 200: { description: 'The unclaimed accounts', content: { 'application/json': { schema: OperatorProvisionedAccountsSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const { limit } = c.req.valid('query');
      const rows = await store.provision.listUnclaimed({ limit: limit ?? DEFAULT_LIST_LIMIT });
      const overdueBefore = c.get('now')().getTime() - UNCLAIMED_POLICY.removeAfterDays * 86_400_000;
      const items = await Promise.all(
        rows.map(async (row) => {
          const accountant = row.accountantUserId ? await store.users.getById(row.accountantUserId) : null;
          const { subscriptions } = await store.billing.summaryOf(row.userId);
          const paid = subscriptions.some((s) => s.status === 'active');
          return {
            userId: row.userId,
            email: row.email,
            displayName: row.displayName,
            provisionedAt: row.provisionedAt.toISOString(),
            accountant: accountant ? { userId: accountant.id, email: accountant.email } : null,
            paid,
            flagged: paid && row.provisionedAt.getTime() <= overdueBefore,
          };
        }),
      );
      return c.json({ items }, 200);
    },
  );

  return app;
}
