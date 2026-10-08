import { z } from '@hono/zod-openapi';
import { SCOPES } from './auth/scopes.js';
import { ERROR_CODES } from './errors.js';
import { SUPPORTED_CURRENCIES } from './money.js';

/**
 * Wire schemas. These are the OpenAPI components; every route references
 * them so the committed openapi.yaml is generated, never hand-edited.
 */

export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(Object.keys(ERROR_CODES) as [string, ...string[]]),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string(),
    }),
  })
  .openapi('ErrorEnvelope');

export const ScopeSchema = z.enum(SCOPES).openapi('Scope');
export const CurrencySchema = z.enum(SUPPORTED_CURRENCIES).openapi('Currency');

export const OrganizationSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    defaultCurrency: CurrencySchema,
    timezone: z.string(),
    createdAt: z.string().datetime(),
  })
  .openapi('Organization');

/** Never includes the secret or its hash. */
export const ApiKeySummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    environment: z.enum(['live', 'test']),
    /** `mut_live_a9f3…c41d` — safe to display. */
    masked: z.string(),
    scopes: z.array(ScopeSchema),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .openapi('ApiKeySummary');

export const IntegrationSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['MALAFAT']),
    externalTenantId: z.string(),
    displayName: z.string(),
    status: z.enum(['CONNECTED', 'DISCONNECTED']),
    connectedAt: z.string().datetime(),
    disconnectedAt: z.string().datetime().nullable(),
  })
  .openapi('Integration');

export const IntegrationStatusResponseSchema = z
  .object({
    organization: OrganizationSchema,
    apiKey: ApiKeySummarySchema,
    /** Scopes Malafat needs for the full Money experience, and which of them this key lacks. */
    requiredScopes: z.array(ScopeSchema),
    missingScopes: z.array(ScopeSchema),
    integration: IntegrationSchema.nullable(),
    server: z.object({ version: z.string(), apiVersion: z.literal('v1'), time: z.string().datetime() }),
  })
  .openapi('IntegrationStatusResponse');

export const BindIntegrationRequestSchema = z
  .object({
    provider: z.enum(['MALAFAT']),
    /** The calling system's own tenant identifier. Stable; never a hostname. */
    externalTenantId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(200),
  })
  .openapi('BindIntegrationRequest');

export const BindIntegrationResponseSchema = z
  .object({
    integration: IntegrationSchema,
    /** false when the same tenant was already connected (idempotent re-bind). */
    created: z.boolean(),
  })
  .openapi('BindIntegrationResponse');

export const DisconnectIntegrationResponseSchema = z
  .object({
    integration: IntegrationSchema,
    /** The calling key is revoked as part of disconnecting (plan §10.4). */
    apiKeyRevoked: z.literal(true),
  })
  .openapi('DisconnectIntegrationResponse');

export const HealthSchema = z
  .object({ status: z.literal('ok'), version: z.string(), time: z.string().datetime() })
  .openapi('Health');

export const ReadySchema = z
  .object({ status: z.enum(['ready', 'not_ready']), checks: z.object({ database: z.enum(['ok', 'failed']) }) })
  .openapi('Ready');

// ---- Admin (operator) -------------------------------------------------------

export const CreateOrganizationRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/, 'lowercase letters, digits and hyphens')
      .optional(),
    defaultCurrency: CurrencySchema,
    timezone: z.string().min(1),
  })
  .openapi('CreateOrganizationRequest');

export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    scopes: z.array(ScopeSchema).min(1),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .openapi('CreateApiKeyRequest');

export const CreateApiKeyResponseSchema = z
  .object({
    apiKey: ApiKeySummarySchema,
    /** Shown exactly once. The service cannot reproduce it. */
    secret: z.string(),
  })
  .openapi('CreateApiKeyResponse');

export const RevokeApiKeyRequestSchema = z
  .object({ reason: z.string().min(1).max(500) })
  .openapi('RevokeApiKeyRequest');

export const OrganizationDetailSchema = z
  .object({
    organization: OrganizationSchema,
    apiKeys: z.array(ApiKeySummarySchema),
    integrations: z.array(IntegrationSchema),
  })
  .openapi('OrganizationDetail');

export const AuditEventSchema = z
  .object({
    id: z.string().uuid(),
    actorType: z.enum(['API_KEY', 'ADMIN', 'SYSTEM']),
    actorId: z.string().nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('AuditEvent');

export const AuditListSchema = z.object({ events: z.array(AuditEventSchema) }).openapi('AuditList');
