import { z } from '@hono/zod-openapi';
import { SCOPES } from './auth/scopes.js';
import { ERROR_CODES } from './errors.js';
import { IMPORT_MAX_ROWS } from './import/plan.js';
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

// ---- Milestone 2: customers, projects, import --------------------------------

export const ProviderSchema = z.enum(['MALAFAT']).openapi('Provider');
export const EntityStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']).openapi('EntityStatus');

export const ExternalReferenceSchema = z
  .object({
    provider: ProviderSchema,
    /** The external system's own id for this entity (Malafat: the client or matter uuid). */
    externalId: z.string().min(1).max(128),
  })
  .openapi('ExternalReference');

const name = z.string().min(1).max(200);
const email = z.string().email().max(254);
const phone = z.string().min(1).max(64);
const notes = z.string().max(4000);
const uuid = z.string().uuid();

export const CustomerSchema = z
  .object({
    id: uuid,
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable(),
    status: EntityStatusSchema,
    archivedAt: z.string().datetime().nullable(),
    externalReference: ExternalReferenceSchema.nullable(),
    /** Send back as `If-Match` on PATCH. */
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Customer');

export const CreateCustomerRequestSchema = z
  .object({
    name,
    email: email.optional(),
    phone: phone.optional(),
    notes: notes.optional(),
    /** When present and already known, the existing customer is returned (200) instead of a duplicate. */
    externalReference: ExternalReferenceSchema.optional(),
  })
  .openapi('CreateCustomerRequest');

export const UpdateCustomerRequestSchema = z
  .object({
    name: name.optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    notes: notes.nullable().optional(),
  })
  .strict()
  .openapi('UpdateCustomerRequest');

export const ProjectSchema = z
  .object({
    id: uuid,
    customerId: uuid,
    name: z.string(),
    currency: CurrencySchema,
    status: EntityStatusSchema,
    archivedAt: z.string().datetime().nullable(),
    externalReference: ExternalReferenceSchema.nullable(),
    version: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Project');

export const CreateProjectRequestSchema = z
  .object({
    customerId: uuid,
    name,
    currency: CurrencySchema,
    externalReference: ExternalReferenceSchema.optional(),
  })
  .openapi('CreateProjectRequest');

export const UpdateProjectRequestSchema = z
  .object({
    name: name.optional(),
    /** Accepted only while nothing is posted against the project (409 CURRENCY_LOCKED otherwise). */
    currency: CurrencySchema.optional(),
  })
  .strict()
  .openapi('UpdateProjectRequest');

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ description: 'Page size, 1–200.' }),
  cursor: z.string().optional().openapi({ description: 'Opaque `nextCursor` from the previous page.' }),
};

export const ListCustomersQuerySchema = z.object({
  ...pageQuery,
  status: EntityStatusSchema.optional(),
  provider: ProviderSchema.default('MALAFAT'),
  externalId: z.string().min(1).max(128).optional(),
});

export const ListProjectsQuerySchema = z.object({
  ...pageQuery,
  status: EntityStatusSchema.optional(),
  customerId: uuid.optional(),
  currency: CurrencySchema.optional(),
  provider: ProviderSchema.default('MALAFAT'),
  externalId: z.string().min(1).max(128).optional(),
});

export const CustomerPageSchema = z.object({ items: z.array(CustomerSchema), nextCursor: z.string().nullable() }).openapi('CustomerPage');
export const ProjectPageSchema = z.object({ items: z.array(ProjectSchema), nextCursor: z.string().nullable() }).openapi('ProjectPage');

export const CustomerIdParamSchema = z.object({ customerId: uuid });
export const ProjectIdParamSchema = z.object({ projectId: uuid });

export const IfMatchHeaderSchema = z.object({
  'if-match': z.string().openapi({ description: 'The `version` you read. A stale version is refused with 409 CONFLICT / VERSION_MISMATCH.' }),
});

const ImportCustomerRowSchema = z.object({
  entityType: z.literal('CUSTOMER'),
  externalId: z.string().min(1).max(128),
  /** Validated per row (empty or over 200 chars → row conflict VALIDATION), never as a whole-request error. */
  name: z.string().max(1000),
  email: email.optional(),
  phone: phone.optional(),
});

const ImportProjectRowSchema = z.object({
  entityType: z.literal('PROJECT'),
  externalId: z.string().min(1).max(128),
  name: z.string().max(1000),
  /** Validated per row against the supported currencies. */
  currency: z.string().min(1).max(8),
  customerExternalId: z.string().min(1).max(128),
});

export const ImportRowSchema = z.discriminatedUnion('entityType', [ImportCustomerRowSchema, ImportProjectRowSchema]).openapi('ImportRow');

export const ImportPreviewRequestSchema = z
  .object({ provider: ProviderSchema, rows: z.array(ImportRowSchema).max(IMPORT_MAX_ROWS) })
  .openapi('ImportPreviewRequest');

export const ImportPlanRowSchema = z
  .object({
    index: z.number().int(),
    entityType: z.enum(['CUSTOMER', 'PROJECT']),
    externalId: z.string(),
    action: z.enum(['create', 'link', 'conflict']),
    existingId: uuid.optional(),
    reason: z.enum(['UNKNOWN_CUSTOMER', 'CUSTOMER_MISMATCH', 'CURRENCY_DIFFERS', 'VALIDATION']).optional(),
    detail: z.enum(['EMPTY_NAME', 'NAME_TOO_LONG', 'UNSUPPORTED_CURRENCY', 'DUPLICATE_IN_BATCH']).optional(),
    warnings: z.array(z.enum(['NAME_DIFFERS', 'ARCHIVED'])),
  })
  .openapi('ImportPlanRow');

export const ImportPreviewResponseSchema = z
  .object({
    rows: z.array(ImportPlanRowSchema),
    totals: z.object({ create: z.number().int(), link: z.number().int(), conflict: z.number().int() }),
    /** Required by commit; proves the caller previewed exactly these rows. */
    previewToken: z.string().length(64),
  })
  .openapi('ImportPreviewResponse');

export const ImportCommitRequestSchema = ImportPreviewRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('ImportCommitRequest');

export const ImportCommitRowSchema = z
  .object({
    index: z.number().int(),
    entityType: z.enum(['CUSTOMER', 'PROJECT']),
    externalId: z.string(),
    outcome: z.enum(['created', 'linked', 'failed']),
    id: uuid.optional(),
    reason: z.string().optional(),
    warnings: z.array(z.enum(['NAME_DIFFERS', 'ARCHIVED'])),
  })
  .openapi('ImportCommitRow');

export const ImportCommitResponseSchema = z
  .object({
    rows: z.array(ImportCommitRowSchema),
    totals: z.object({ created: z.number().int(), linked: z.number().int(), failed: z.number().int() }),
  })
  .openapi('ImportCommitResponse');

/** Published `details.reason` values for 409 CONFLICT responses (brief §2.2). */
export const CONFLICT_REASONS = [
  'VERSION_MISMATCH',
  'CURRENCY_LOCKED',
  'CUSTOMER_MISMATCH',
  'HAS_ACTIVE_PROJECTS',
  'PREVIEW_STALE',
  'INTEGRATION_NOT_CONNECTED',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];
