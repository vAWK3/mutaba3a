import { timingSafeEqual } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { generateApiKey, type ApiKeyEnvironment } from '../auth/api-key.js';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';
import {
  AuditListSchema,
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  CreateOrganizationRequestSchema,
  ErrorEnvelopeSchema,
  OrganizationDetailSchema,
  OrganizationSchema,
  RevokeApiKeyRequestSchema,
  ApiKeySummarySchema,
} from '../schemas.js';
import { serializeApiKey, serializeAuditEvent, serializeIntegration, serializeOrganization } from '../serializers.js';

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
        201: { description: 'Created', content: { 'application/json': { schema: OrganizationSchema } } },
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
        return c.json(serializeOrganization(org), 201);
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
      const [keys, integrations] = await Promise.all([
        store.apiKeys.listByOrganization(org.id),
        store.integrations.listByOrganization(org.id),
      ]);
      return c.json(
        { organization: serializeOrganization(org), apiKeys: keys.map(serializeApiKey), integrations: integrations.map(serializeIntegration) },
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
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { organizationId } = c.req.valid('param');
      const body = c.req.valid('json');
      const org = await store.organizations.getById(organizationId);
      if (!org) throw new ApiError('NOT_FOUND', 'Organization not found');
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

  return app;
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
