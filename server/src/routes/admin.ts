import { timingSafeEqual } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { generateApiKey, type ApiKeyEnvironment } from '../auth/api-key.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError, ownedProfileConflict } from '../errors.js';
import { profileOwnerOf } from '../personal-profile.js';
import { UniqueViolation } from '../repositories/memory.js';
import { decodeCursor, encodeCursor, parseLimit } from '../pagination.js';
import type { LedgerStore, Organization, SetFirmResult } from '../repositories/ports.js';
import {
  AuditListSchema,
  FirmRequestListSchema,
  OrganizationResponseSchema,
  UpdateOrganizationRequestSchema,
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  CreateOrganizationRequestSchema,
  ErrorEnvelopeSchema,
  OrganizationDetailSchema,
  AdminOrganizationSchema,
  RevokeApiKeyRequestSchema,
  ApiKeySummarySchema,
  ReceiptEditRatesQuerySchema,
  ReceiptEditRatesSchema,
} from '../schemas.js';
import { serializeAdminOrganization, serializeApiKey, serializeAuditEvent, serializeIntegration } from '../serializers.js';

/**
 * Operator provisioning (plan §3.1 "organization identification, scoped API
 * credentials, credential rotation and revocation").
 *
 * Milestone 1 has no self-serve Mutaba3a account system — the desktop app
 * deliberately has none (ADR-023) — so organizations and keys are created by
 * an operator holding MUTABA3A_ADMIN_TOKEN. Every call is audited with
 * actorType ADMIN. Self-serve provisioning is a product decision recorded as
 * an open question in the M1 proposal.
 */
export interface AdminOptions {
  store: LedgerStore;
  adminToken: string;
  keyEnvironment: ApiKeyEnvironment;
}

/**
 * MUT-360 D2: the token the nightly Cloud Scheduler job presents on /jobs/*. It opens nothing else, and the admin
 * token doesn't open /jobs. Optional, unlike the admin token: unset, every /jobs request is refused before any
 * compare (two empty buffers would pass timingSafeEqual).
 */
export function jobAuth(jobToken: string | null): MiddlewareHandler<AppEnv> {
  const expected = jobToken ? Buffer.from(jobToken, 'utf8') : null;
  return async (c, next) => {
    if (!expected) throw new ApiError('JOBS_NOT_CONFIGURED', 'No job token is configured on this server');
    const given = Buffer.from(c.req.header('x-job-token') ?? '', 'utf8');
    if (!(given.length === expected.length && timingSafeEqual(given, expected))) throw new ApiError('JOB_UNAUTHORIZED', 'Missing or invalid X-Job-Token');
    await next();
  };
}

export function adminAuth(adminToken: string): MiddlewareHandler<AppEnv> {
  const expected = Buffer.from(adminToken, 'utf8');
  return async (c, next) => {
    const presented = c.req.header('x-admin-token') ?? '';
    const given = Buffer.from(presented, 'utf8');
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) throw new ApiError('ADMIN_UNAUTHORIZED', 'Missing or invalid X-Admin-Token');
    await next();
  };
}

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

const OrganizationIdParam = z.object({ organizationId: z.string().uuid().openapi({ param: { name: 'organizationId', in: 'path' } }) });
const ApiKeyIdParam = z.object({ apiKeyId: z.string().uuid().openapi({ param: { name: 'apiKeyId', in: 'path' } }) });

export function adminRoutes(options: AdminOptions): OpenAPIHono<AppEnv> {
  const { store } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/organizations',
      tags: ['Admin'],
      summary: 'Create an organization',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: CreateOrganizationRequestSchema } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: AdminOrganizationSchema } } },
        409: { description: 'Slug already in use', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const slug = body.slug ?? slugify(body.name);
      try {
        const org = await store.organizations.create({ name: body.name, slug, defaultCurrency: body.defaultCurrency, timezone: body.timezone });
        await store.audit.append({
          organizationId: org.id,
          actorType: 'ADMIN',
          actorId: null,
          action: 'organization.created',
          entityType: 'organization',
          entityId: org.id,
          requestId: c.get('requestId'),
        });
        return c.json(serializeAdminOrganization(org), 201);
      } catch (err) {
        if (err instanceof UniqueViolation) throw new ApiError('CONFLICT', `Slug "${slug}" is already in use`);
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/organizations/{organizationId}',
      tags: ['Admin'],
      summary: 'Inspect an organization, its keys (masked) and integrations',
      security: [{ adminToken: [] }],
      request: { params: OrganizationIdParam },
      responses: {
        200: { description: 'Organization detail', content: { 'application/json': { schema: OrganizationDetailSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const org = await store.organizations.getById(organizationId);
      if (!org) throw new ApiError('NOT_FOUND', 'Organization not found');
      const [keys, integrations, memberships] = await Promise.all([
        store.apiKeys.listByOrganization(org.id),
        store.integrations.listByOrganization(org.id),
        store.memberships.listByOrganization(org.id),
      ]);
      // MUT-300: who the operator is naming owners from. Organizations have a handful of members; one read each.
      const members = await Promise.all(
        memberships.map(async (m) => ({ userId: m.userId, email: (await store.users.getById(m.userId))?.email ?? '', role: m.role })),
      );
      return c.json(
        { organization: serializeAdminOrganization(org), apiKeys: keys.map(serializeApiKey), integrations: integrations.map(serializeIntegration), members },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/organizations/{organizationId}/api-keys',
      tags: ['Admin'],
      summary: 'Issue an API key (secret returned once)',
      security: [{ adminToken: [] }],
      request: {
        params: OrganizationIdParam,
        body: { required: true, content: { 'application/json': { schema: CreateApiKeyRequestSchema } } },
      },
      responses: {
        201: { description: 'Issued', content: { 'application/json': { schema: CreateApiKeyResponseSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        409: { description: 'A profile a person owns cannot hold an API key (CONFLICT, details.reason PERSONAL_PROFILE on the built-in personal profile, OWNED_PROFILE on one they created)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const body = c.req.valid('json');
      const org = await store.organizations.getById(organizationId);
      if (!org) throw new ApiError('NOT_FOUND', 'Organization not found');
      if (profileOwnerOf(org)) throw ownedProfileConflict(org, 'A profile a person owns cannot hold an API key');
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= c.get('now')().getTime()) {
        throw new ApiError('VALIDATION_FAILED', 'expiresAt must be in the future');
      }

      const generated = generateApiKey(options.keyEnvironment);
      const record = await store.apiKeys.create({
        organizationId: org.id,
        name: body.name,
        environment: generated.environment,
        prefix: generated.prefix,
        keyHash: generated.keyHash,
        scopes: body.scopes,
        expiresAt,
      });
      await store.audit.append({
        organizationId: org.id,
        actorType: 'ADMIN',
        actorId: null,
        action: 'api_key.issued',
        entityType: 'api_key',
        entityId: record.id,
        metadata: { scopes: body.scopes, prefix: record.prefix },
        requestId: c.get('requestId'),
      });
      return c.json({ apiKey: serializeApiKey(record), secret: generated.secret }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/api-keys/{apiKeyId}/revoke',
      tags: ['Admin'],
      summary: 'Revoke an API key (idempotent)',
      security: [{ adminToken: [] }],
      request: {
        params: ApiKeyIdParam,
        body: { required: true, content: { 'application/json': { schema: RevokeApiKeyRequestSchema } } },
      },
      responses: {
        200: { description: 'Revoked (or already revoked)', content: { 'application/json': { schema: ApiKeySummarySchema } } },
        404: { description: 'Unknown key', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { apiKeyId } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      const record = await store.apiKeys.revoke(apiKeyId, reason, c.get('now')());
      if (!record) throw new ApiError('NOT_FOUND', 'API key not found');
      await store.audit.append({
        organizationId: record.organizationId,
        actorType: 'ADMIN',
        actorId: null,
        action: 'api_key.revoked',
        entityType: 'api_key',
        entityId: record.id,
        metadata: { reason },
        requestId: c.get('requestId'),
      });
      return c.json(serializeApiKey(record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/organizations/{organizationId}/audit',
      tags: ['Admin'],
      summary: 'Read the organization’s audit trail (newest first)',
      security: [{ adminToken: [] }],
      request: { params: OrganizationIdParam, query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) },
      responses: {
        200: { description: 'Audit events', content: { 'application/json': { schema: AuditListSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const org = await store.organizations.getById(organizationId);
      if (!org) throw new ApiError('NOT_FOUND', 'Organization not found');
      const events = await store.audit.listByOrganization(org.id, limit);
      return c.json({ events: events.map(serializeAuditEvent) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/admin/v1/organizations/{organizationId}',
      tags: ['Admin'],
      summary: 'Turn firm features on or off (MUT-300)',
      description:
        'Enabling works in place (ADR-099, MUT-300 eng review D4): an owned Business profile stays owned and its owner becomes OWNER; an operator firm needs `ownerUserIds` (422 without), each already a member (409 CONFLICT, details.reason NOT_A_MEMBER). Every other member becomes BOOKKEEPER, and a pending request is cleared. Disabling keeps roles. The same state again changes nothing. Refused on the built-in personal profile (409 PERSONAL_PROFILE) and on an owned Personal profile (409 NOT_BUSINESS).',
      security: [{ adminToken: [] }],
      request: { params: OrganizationIdParam, body: { required: true, content: { 'application/json': { schema: UpdateOrganizationRequestSchema } } } },
      responses: {
        200: { description: 'Updated, or already in that state', content: { 'application/json': { schema: OrganizationResponseSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        409: { description: 'CONFLICT with details.reason PERSONAL_PROFILE, NOT_BUSINESS or NOT_A_MEMBER', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed, or an operator firm enabled with no owner named', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const body = c.req.valid('json');
      const input = body.firmEnabled ? { enabled: true as const, ownerUserIds: body.ownerUserIds ?? [] } : { enabled: false as const };
      // Audited inside the write's transaction, so a failed audit can't leave an unrecorded change.
      const result = await store.organizations.setFirm(organizationId, input, c.get('now')(), { actorId: null, requestId: c.get('requestId') });
      return c.json({ organization: serializeAdminOrganization(firmUpdated(result)) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/admin/v1/organizations/{organizationId}/firm-request',
      tags: ['Admin'],
      summary: 'Decline a pending request for firm features (MUT-300)',
      description: 'Clears the request (eng review D6), audited firm.request_declined. The owner sees the offer again and may ask again. 404 when nothing is pending.',
      security: [{ adminToken: [] }],
      request: { params: OrganizationIdParam },
      responses: {
        200: { description: 'Declined', content: { 'application/json': { schema: OrganizationResponseSchema } } },
        404: { description: 'Unknown organization, or no pending request', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const result = await store.organizations.declineFirmRequest(c.req.valid('param').organizationId, c.get('now')(), { actorId: null, requestId: c.get('requestId') });
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No pending firm request for this organization');
      return c.json({ organization: serializeAdminOrganization(result.organization) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/receipts/edit-rates',
      tags: ['Admin'],
      summary: 'How often people change what the receipt reader suggested (MUT-255, the MUT-252 success measure)',
      description: 'Receipts approved between from and to (inclusive UTC days), across every profile. Counts only: never a value, a profile or a person.',
      security: [{ adminToken: [] }],
      request: { query: ReceiptEditRatesQuerySchema },
      responses: {
        200: { description: 'Edit rates', content: { 'application/json': { schema: ReceiptEditRatesSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { from, to } = c.req.valid('query');
      if (from > to) throw new ApiError('VALIDATION_FAILED', '`to` is before `from`', { field: 'to', reason: 'END_BEFORE_START' });
      const end = new Date(`${to}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const rates = await store.expenseReceipts.editRates({ from: new Date(`${from}T00:00:00.000Z`), to: end });
      return c.json({ from, to, ...rates }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/firm-requests',
      tags: ['Admin'],
      summary: 'List pending requests for firm features, oldest first (MUT-300)',
      security: [{ adminToken: [] }],
      request: { query: z.object({ limit: z.coerce.number().int().optional(), cursor: z.string().optional() }) },
      responses: {
        200: { description: 'Pending requests', content: { 'application/json': { schema: FirmRequestListSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const page = await store.organizations.listFirmRequests({ limit: parseLimit(query.limit), cursor: query.cursor ? decodeCursor(query.cursor) : null });
      const data = await Promise.all(
        page.items.map(async (o) => ({
          organizationId: o.id,
          name: o.name,
          requestedAt: o.firmRequestedAt!.toISOString(),
          requestedByUserId: o.firmRequestedByUserId!,
          requestedByEmail: (await store.users.getById(o.firmRequestedByUserId!))?.email ?? null,
          owned: profileOwnerOf(o) !== null,
        })),
      );
      return c.json({ data, nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null }, 200);
    },
  );

  return app;
}

/** The organization a firm-switch write left, or the refusal as the operator should read it. */
function firmUpdated(result: SetFirmResult): Organization {
  switch (result.kind) {
    case 'updated':
      return result.organization;
    case 'not_found':
      throw new ApiError('NOT_FOUND', 'Organization not found');
    case 'personal_profile':
      throw new ApiError('CONFLICT', 'A built-in personal profile never gets firm features', { reason: 'PERSONAL_PROFILE' });
    case 'not_business':
      throw new ApiError('CONFLICT', 'Firm features are for Business profiles; this one is typed Personal', { reason: 'NOT_BUSINESS' });
    case 'owners_required':
      throw new ApiError('VALIDATION_FAILED', 'Name at least one owner (ownerUserIds) when enabling firm features on an operator firm', { field: 'ownerUserIds' });
    case 'not_a_member':
      throw new ApiError('CONFLICT', 'Every owner must already be a member of the organization', { reason: 'NOT_A_MEMBER', userIds: result.userIds });
  }
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length >= 2 ? base : `org-${Date.now().toString(36)}`;
}
