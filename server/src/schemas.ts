import { z } from '@hono/zod-openapi';
import { SCOPES } from './auth/scopes.js';
import { ERROR_CODES } from './errors.js';
import { MAX_INSTALLMENTS } from './agreements/schedule.js';
import { PAYMENT_TERMS } from './dates.js';
import { IMPORT_MAX_ROWS } from './import/plan.js';
import { SUPPORTED_CURRENCIES } from './money.js';
import { ITEM_STATUSES } from './agreements/status.js';
import { MAX_BILLING_DAY } from './retainers/schedule.js';
import { PRICING_BASES, VAT_TREATMENTS } from './vat.js';

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

// ---- Admin: operator-provisioned users (MUT-37, ADR-033) --------------------

export const UserLocaleSchema = z.enum(['en', 'ar']).openapi('UserLocale');

/** Never includes the password hash. */
export const UserSummarySchema = z
  .object({
    id: z.string().uuid(),
    /** Normalised: trimmed, NFKC, lower-cased. */
    email: z.string(),
    displayName: z.string(),
    locale: UserLocaleSchema,
    status: z.enum(['ACTIVE', 'DISABLED']),
    passwordChangedAt: z.string().datetime(),
    lastSignInAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('UserSummary');

export const MembershipSchema = z
  .object({ organizationId: z.string().uuid(), createdAt: z.string().datetime() })
  .openapi('Membership');

export const CreateUserRequestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(1).max(200),
    locale: UserLocaleSchema.default('en'),
    /** The user's first membership. More are granted with POST /admin/v1/users/{userId}/memberships. */
    organizationId: z.string().uuid(),
  })
  .openapi('CreateUserRequest');

export const CreateUserResponseSchema = z
  .object({
    user: UserSummarySchema,
    memberships: z.array(MembershipSchema),
    /** Shown exactly once; the service stores only its argon2id hash. Deliver it to the person over a secure channel. */
    initialPassword: z.string(),
  })
  .openapi('CreateUserResponse');

export const UserDetailSchema = z
  .object({ user: UserSummarySchema, memberships: z.array(MembershipSchema) })
  .openapi('UserDetail');

export const UserListSchema = z.object({ users: z.array(UserSummarySchema) }).openapi('UserList');

export const GrantMembershipRequestSchema = z
  .object({ organizationId: z.string().uuid() })
  .openapi('GrantMembershipRequest');

export const GrantMembershipResponseSchema = z
  .object({
    membership: MembershipSchema,
    /** false when the user already had this membership (idempotent grant). */
    created: z.boolean(),
  })
  .openapi('GrantMembershipResponse');

export const RemoveMembershipResponseSchema = z
  .object({ removed: z.boolean() })
  .openapi('RemoveMembershipResponse');

export const UserStatusResponseSchema = z.object({ user: UserSummarySchema }).openapi('UserStatusResponse');

export const PasswordResetResponseSchema = z
  .object({
    user: UserSummarySchema,
    /** The new one-time password, shown exactly once. */
    password: z.string(),
  })
  .openapi('PasswordResetResponse');

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

export const VatTreatmentSchema = z.enum(VAT_TREATMENTS).openapi('VatTreatment');
export const PricingBasisSchema = z.enum(PRICING_BASES).openapi('PricingBasis');
export const PaymentTermsSchema = z.enum(PAYMENT_TERMS).openapi('PaymentTerms');
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').openapi({ description: 'Calendar date in the organization timezone, YYYY-MM-DD' });
export const IsoMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').openapi({ description: 'Calendar month, YYYY-MM' });
/** Canonical decimal amount in the project currency, e.g. "10000.00". Validated against the currency exponent server-side. */
export const AmountSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'canonical decimal').openapi({ description: 'Canonical decimal string; exactly the currency\'s fractional digits' });

export const CustomerSchema = z
  .object({
    id: uuid,
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable(),
    /** Default VAT treatment for this customer's items (e.g. OUT_OF_SCOPE for a foreign client). */
    vatTreatment: VatTreatmentSchema.nullable(),
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
    vatTreatment: VatTreatmentSchema.optional(),
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
    vatTreatment: VatTreatmentSchema.nullable().optional(),
  })
  .strict()
  .openapi('UpdateCustomerRequest');

export const ProjectSchema = z
  .object({
    id: uuid,
    customerId: uuid,
    name: z.string(),
    currency: CurrencySchema,
    /** Default VAT treatment for this project's items; null inherits the customer's. */
    vatTreatment: VatTreatmentSchema.nullable(),
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
    vatTreatment: VatTreatmentSchema.optional(),
    externalReference: ExternalReferenceSchema.optional(),
  })
  .openapi('CreateProjectRequest');

export const UpdateProjectRequestSchema = z
  .object({
    name: name.optional(),
    /** Accepted only while the project has no agreement (409 CURRENCY_LOCKED otherwise). */
    currency: CurrencySchema.optional(),
    vatTreatment: VatTreatmentSchema.nullable().optional(),
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
  // M3
  'RATE_ALREADY_SET',
  'AGREEMENT_HAS_POSTED_RECEIVABLES',
  'AGREEMENT_CANCELLED',
  'PROJECT_HAS_OUTSTANDING',
  // M4
  'ALREADY_REVERSED',
  // M7
  'PROPOSAL_OPEN',
  'PROPOSAL_NOT_OPEN',
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

/** Published `details.reason` values for 422 VALIDATION_FAILED responses raised by business rules (M3). */
export const VALIDATION_REASONS = [
  'AMOUNT_INVALID',
  'VAT_RATE_MISSING',
  'INSTALLMENTS_DO_NOT_SUM',
  'PERCENTS_DO_NOT_SUM',
  'MIXED_INSTALLMENT_BASIS',
  'NO_INSTALLMENTS',
  'TOO_MANY_INSTALLMENTS',
  'NON_POSITIVE_INSTALLMENT',
  'CURRENCY_MISMATCH',
  'PROJECT_ARCHIVED',
  'CUSTOMER_ARCHIVED',
  'NOT_MANUAL',
  'NOT_FIXED',
  'NOT_RECURRING',
  'SUPPLEMENT_EXCEEDS_UNPOSTED',
  'NEW_INSTALLMENT_REQUIRED',
  'NEGATIVE_NEW_INSTALLMENT',
  'BILLING_DAY_INVALID',
  'START_MONTH_INVALID',
  'END_MONTH_INVALID',
  'END_BEFORE_START',
  'DATE_INVALID',
  'TRIGGER_DATE_REQUIRED',
  // M4
  'ALLOCATION_EXCEEDS_PAYMENT',
  'ALLOCATION_EXCEEDS_OUTSTANDING',
  'ALLOCATION_DUPLICATE',
  'RECEIVABLE_NOT_FOUND',
  'RECEIVABLE_NOT_OPEN',
  'RECEIVABLE_CUSTOMER_MISMATCH',
  'PAYMENT_NOT_POSTED',
  'NO_UNALLOCATED_FUNDS',
  'CREDIT_EXCEEDS_OUTSTANDING',
  'REPLACES_NOT_REVERSED',
  'REPLACES_CUSTOMER_MISMATCH',
  'NO_ELIGIBLE_RECEIVABLES',
  'CUSTOMER_NOT_FOUND',
  // M5
  'CHANGE_EFFECTIVE_INVALID',
  'CHANGE_NOTHING_CHANGED',
  'FINAL_MONTH_INVALID',
  'PREVIEW_TOKEN_REQUIRED',
  // M6
  'UPLOAD_INCOMPLETE',
  'UPLOAD_MISMATCH',
  'ATTACHMENT_TARGET_REQUIRED',
  'ATTACHMENT_TARGET_AMBIGUOUS',
  'MIME_TYPE_UNSUPPORTED',
  'FILE_TOO_LARGE',
  'FILENAME_INVALID',
  'ATTACHMENT_NOT_READY',
  // M7
  'PROJECT_NOT_FOUND',
] as const;

// ---- Milestone 3: VAT rates, agreements, installments, retainers, receivables ----

export const ItemStatusSchema = z.enum(ITEM_STATUSES).openapi('ItemStatus');
export const FinalMonthSchema = z.enum(['FULL', 'PRORATE', 'WAIVE']).openapi('FinalMonth');
export const TriggerTypeSchema = z.enum(['IMMEDIATE', 'DATE', 'MANUAL']).openapi('TriggerType');

export const VatRateSchema = z
  .object({ id: uuid, rateBasisPoints: z.number().int().min(0).max(10000), effectiveFrom: IsoDateSchema, createdAt: z.string().datetime() })
  .openapi('VatRate');
export const VatRatesResponseSchema = z.object({ rates: z.array(VatRateSchema), current: VatRateSchema.nullable() }).openapi('VatRatesResponse');
export const SetVatRateRequestSchema = z
  .object({ rateBasisPoints: z.number().int().min(0).max(10000).openapi({ description: '1800 = 18 %' }), effectiveFrom: IsoDateSchema })
  .openapi('SetVatRateRequest');

export const InstallmentTriggerSchema = z
  .object({ type: TriggerTypeSchema, date: IsoDateSchema.optional() })
  .openapi('InstallmentTrigger');

export const InstallmentSpecSchema = z
  .object({
    label: z.string().min(1).max(80),
    /** Exactly one of amount / percentBasisPoints, the same choice for every installment. */
    amount: AmountSchema.optional(),
    percentBasisPoints: z.number().int().min(0).max(10000).optional(),
    vatTreatment: VatTreatmentSchema.optional(),
    trigger: InstallmentTriggerSchema,
    paymentTerms: PaymentTermsSchema.optional(),
    dueDate: IsoDateSchema.optional(),
  })
  .openapi('InstallmentSpec');

export const AgreementPreviewRequestSchema = z
  .object({
    projectId: uuid,
    /** Contractual amount in the pricing basis, project currency. */
    amount: AmountSchema,
    currency: CurrencySchema.optional(),
    pricingBasis: PricingBasisSchema,
    /** Default for the installments; absent = project → customer → STANDARD_RATED. */
    vatTreatment: VatTreatmentSchema.optional(),
    agreementDate: IsoDateSchema,
    description: z.string().max(500).optional(),
    paymentTerms: PaymentTermsSchema.default('EOM'),
    installments: z.array(InstallmentSpecSchema).min(1).max(MAX_INSTALLMENTS),
  })
  .openapi('AgreementPreviewRequest');

export const AgreementCreateRequestSchema = AgreementPreviewRequestSchema.extend({
  previewToken: z.string().length(64),
}).openapi('AgreementCreateRequest');

export const InstallmentSchema = z
  .object({
    id: uuid,
    position: z.number().int(),
    label: z.string(),
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    trigger: InstallmentTriggerSchema,
    paymentTerms: PaymentTermsSchema.nullable(),
    /** Due date once posted; before posting, the date it would get if posted today. */
    dueDate: IsoDateSchema,
    status: ItemStatusSchema,
    postedAt: z.string().datetime().nullable(),
    receivableId: uuid.nullable(),
    version: z.number().int(),
  })
  .openapi('Installment');

export const SupplementSchema = z
  .object({
    id: uuid,
    amount: AmountSchema,
    description: z.string().nullable(),
    effectiveDate: IsoDateSchema,
    distribution: z.enum(['LAST_UNPOSTED', 'PRORATE_UNPOSTED', 'NEW_INSTALLMENT']),
    resultingAmount: AmountSchema,
    createdAt: z.string().datetime(),
  })
  .openapi('Supplement');

export const AgreementSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    customerId: uuid,
    type: z.enum(['FIXED', 'RECURRING']),
    status: z.enum(['ACTIVE', 'CANCELLED']),
    currency: CurrencySchema,
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema,
    vatRateBasisPoints: z.number().int(),
    /** FIXED: contractual total. RECURRING: monthly amount. Pricing basis as given. */
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    agreementDate: IsoDateSchema,
    description: z.string().nullable(),
    paymentTerms: PaymentTermsSchema,
    retainer: z
      .object({ startMonth: IsoMonthSchema, billingDay: z.number().int(), endMonth: IsoMonthSchema.nullable(), cancelEffectiveMonth: IsoMonthSchema.nullable(), cancelEffectiveDate: IsoDateSchema.nullable(), finalMonth: z.enum(['FULL', 'PRORATE', 'WAIVE']).nullable() })
      .nullable(),
    cancelledAt: z.string().datetime().nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Agreement');

export const AgreementDetailSchema = z
  .object({ agreement: AgreementSchema, installments: z.array(InstallmentSchema), supplements: z.array(SupplementSchema) })
  .openapi('AgreementDetail');

export const AgreementPreviewResponseSchema = z
  .object({
    totals: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema }),
    vatRateBasisPoints: z.number().int(),
    vatTreatment: VatTreatmentSchema,
    currency: CurrencySchema,
    installments: z.array(InstallmentSchema.omit({ id: true, postedAt: true, receivableId: true, version: true })),
    previewToken: z.string().length(64),
  })
  .openapi('AgreementPreviewResponse');

export const AgreementPageSchema = z.object({ items: z.array(AgreementSchema), nextCursor: z.string().nullable() }).openapi('AgreementPage');

export const ListAgreementsQuerySchema = z.object({
  ...pageQuery,
  projectId: uuid.optional(),
  customerId: uuid.optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
  type: z.enum(['FIXED', 'RECURRING']).optional(),
});

export const AgreementIdParamSchema = z.object({ agreementId: uuid });
export const InstallmentIdParamSchema = z.object({ installmentId: uuid });
export const ReceivableIdParamSchema = z.object({ receivableId: uuid });

export const SupplementRequestSchema = z
  .object({
    /** Signed, in the agreement's pricing basis and currency. */
    amount: AmountSchema,
    description: z.string().max(500).optional(),
    effectiveDate: IsoDateSchema,
    distribution: z.enum(['LAST_UNPOSTED', 'PRORATE_UNPOSTED', 'NEW_INSTALLMENT']),
    newInstallment: z
      .object({ label: z.string().min(1).max(80), vatTreatment: VatTreatmentSchema.optional(), trigger: InstallmentTriggerSchema, paymentTerms: PaymentTermsSchema.optional(), dueDate: IsoDateSchema.optional() })
      .optional(),
  })
  .openapi('SupplementRequest');

export const SupplementResponseSchema = z
  .object({
    agreement: AgreementSchema,
    supplement: SupplementSchema,
    installments: z.array(InstallmentSchema),
    effect: z.object({ contractualDelta: AmountSchema, installmentsChanged: z.array(uuid), installmentsCreated: z.array(uuid) }),
  })
  .openapi('SupplementResponse');

export const TriggerInstallmentRequestSchema = z.object({ dueDate: IsoDateSchema.optional() }).openapi('TriggerInstallmentRequest');
export const TriggerInstallmentResponseSchema = z.object({ installment: InstallmentSchema, receivable: z.lazy(() => ReceivableSchema), created: z.boolean() }).openapi('TriggerInstallmentResponse');

export const CancelAgreementRequestSchema = z.object({}).openapi('CancelAgreementRequest');

export const ReceivableSchema = z
  .object({
    id: uuid,
    customerId: uuid,
    projectId: uuid,
    agreementId: uuid.nullable(),
    origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']),
    originId: uuid.nullable(),
    currency: CurrencySchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    paid: AmountSchema,
    /** Σ credits (M4). outstanding = gross − paid − credited. */
    credited: AmountSchema,
    outstanding: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    vatRateBasisPoints: z.number().int(),
    dueDate: IsoDateSchema,
    postingDate: IsoDateSchema,
    postedAt: z.string().datetime(),
    status: ItemStatusSchema,
    version: z.number().int(),
  })
  .openapi('Receivable');

export const ReceivablePageSchema = z.object({ items: z.array(ReceivableSchema), nextCursor: z.string().nullable() }).openapi('ReceivablePage');

export const ListReceivablesQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  projectId: uuid.optional(),
  currency: CurrencySchema.optional(),
  status: z.enum(['OPEN', 'SETTLED']).optional(),
  dueBefore: IsoDateSchema.optional(),
  dueAfter: IsoDateSchema.optional(),
});

export const RetainerPreviewRequestSchema = z
  .object({
    projectId: uuid,
    monthlyAmount: AmountSchema,
    currency: CurrencySchema.optional(),
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema.optional(),
    startMonth: IsoMonthSchema,
    billingDay: z.number().int().min(1).max(MAX_BILLING_DAY).default(1),
    paymentTerms: PaymentTermsSchema.default('EOM'),
    endMonth: IsoMonthSchema.optional(),
    /** Defaults to today in the organization timezone; the VAT rate is resolved on it. */
    agreementDate: IsoDateSchema.optional(),
    description: z.string().max(500).optional(),
  })
  .openapi('RetainerPreviewRequest');

export const RetainerCreateRequestSchema = RetainerPreviewRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('RetainerCreateRequest');

export const RetainerPreviewResponseSchema = z
  .object({
    monthly: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema }),
    vatRateBasisPoints: z.number().int(),
    vatTreatment: VatTreatmentSchema,
    currency: CurrencySchema,
    /** Service months whose charge would post immediately on create (charge date ≤ today). */
    chargesDueNow: z.array(z.object({ serviceMonth: IsoMonthSchema, chargeDate: IsoDateSchema, dueDate: IsoDateSchema })),
    nextChargeDate: IsoDateSchema.nullable(),
    previewToken: z.string().length(64),
  })
  .openapi('RetainerPreviewResponse');

export const RetainerChargeSchema = z
  .object({
    id: uuid,
    /** The terms version the charge carries (M5); 1 = the original terms. */
    version: z.number().int(),
    serviceMonth: IsoMonthSchema,
    chargeDate: IsoDateSchema,
    amount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    receivableId: uuid,
    status: ItemStatusSchema,
    dueDate: IsoDateSchema,
    postedAt: z.string().datetime(),
  })
  .openapi('RetainerCharge');

export const RetainerTermsSchema = z
  .object({
    version: z.number().int(),
    effectiveMonth: IsoMonthSchema,
    monthlyAmount: AmountSchema,
    net: AmountSchema,
    vat: AmountSchema,
    gross: AmountSchema,
    pricingBasis: PricingBasisSchema,
    vatTreatment: VatTreatmentSchema,
    rateBasisPoints: z.number().int(),
    billingDay: z.number().int(),
    paymentTerms: PaymentTermsSchema,
    endMonth: IsoMonthSchema.nullable(),
    reason: z.string().nullable(),
  })
  .openapi('RetainerTerms');

export const RetainerChargesResponseSchema = z
  .object({
    agreement: AgreementSchema,
    /** Every version of the terms in order; version 1 is the agreement's own terms (M5). */
    versions: z.array(RetainerTermsSchema),
    charges: z.array(RetainerChargeSchema),
  })
  .openapi('RetainerChargesResponse');

export const RetainerChangeRequestSchema = z
  .object({
    effectiveMonth: IsoMonthSchema,
    monthlyAmount: AmountSchema.optional(),
    pricingBasis: PricingBasisSchema.optional(),
    vatTreatment: VatTreatmentSchema.optional(),
    billingDay: z.number().int().min(1).max(MAX_BILLING_DAY).optional(),
    paymentTerms: PaymentTermsSchema.optional(),
    /** null clears the end month. */
    endMonth: IsoMonthSchema.nullable().optional(),
    reason: z.string().min(1).max(500),
  })
  .openapi('RetainerChangeRequest');

export const RetainerChangeApplyRequestSchema = RetainerChangeRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('RetainerChangeApplyRequest');

export const RetainerChangePreviewResponseSchema = z
  .object({
    previous: RetainerTermsSchema,
    next: RetainerTermsSchema,
    effectiveMonth: IsoMonthSchema,
    changed: z.array(z.string()),
    /** The first service month that will be charged at the new terms, or null when every month from the effective month is already charged or the retainer ends before. */
    firstChargedMonth: IsoMonthSchema.nullable(),
    /** Generated months on or after the effective month: they keep their terms. */
    chargesKept: z.array(IsoMonthSchema),
    previewToken: z.string().length(64),
  })
  .openapi('RetainerChangePreviewResponse');

export const RetainerCancelRequestSchema = z
  .object({ effectiveDate: IsoDateSchema, finalMonth: FinalMonthSchema })
  .openapi('RetainerCancelRequest');

export const RetainerCancelApplyRequestSchema = RetainerCancelRequestSchema.extend({
  /** Required when the cancellation creates a credit (PRORATE, or WAIVE on an already-posted final month). */
  previewToken: z.string().length(64).optional(),
}).openapi('RetainerCancelApplyRequest');

export const RetainerCancelPreviewResponseSchema = z
  .object({
    effectiveMonth: IsoMonthSchema,
    finalMonth: FinalMonthSchema,
    finalCharge: z
      .object({ serviceMonth: IsoMonthSchema, days: z.number().int(), daysInMonth: z.number().int(), amount: AmountSchema, net: AmountSchema, vat: AmountSchema, gross: AmountSchema, posted: z.boolean() })
      .nullable(),
    postedCharge: z.object({ chargeId: uuid, receivableId: uuid, gross: AmountSchema, paid: AmountSchema, credited: AmountSchema, outstanding: AmountSchema }).nullable(),
    /** The credit the cancellation creates on the posted final month, or null. */
    adjustment: z.object({ amount: AmountSchema, net: AmountSchema, vat: AmountSchema, limitedByPayments: z.boolean() }).nullable(),
    /** The first month no longer charged, or null when nothing was still to come. */
    stoppedFrom: IsoMonthSchema.nullable(),
    /** The retainer's receivables still outstanding after the adjustment (sum within the retainer). */
    outstandingAfter: AmountSchema,
    previewToken: z.string().length(64),
  })
  .openapi('RetainerCancelPreviewResponse');

export const ReconcileResponseSchema = z
  .object({ installmentsPosted: z.number().int(), chargesCreated: z.number().int(), today: IsoDateSchema })
  .openapi('ReconcileResponse');


// ---- Milestone 4: payments, allocations, reversals, credits, operations ----

export const PaymentMethodSchema = z.enum(['CASH', 'BANK']).openapi('PaymentMethod');
export const PaymentStatusSchema = z.enum(['POSTED', 'REVERSED']).openapi('PaymentStatus');
export const AllocationStrategySchema = z.enum(['OLDEST_FIRST', 'SETTLE_MATTERS']).openapi('AllocationStrategy');

export const AllocationRequestSchema = z.object({ receivableId: uuid, amount: AmountSchema }).openapi('AllocationRequest');

const previewSource = {
  /** A new payment: who, which currency, how much. */
  customerId: uuid.optional(),
  currency: CurrencySchema.optional(),
  amount: AmountSchema.optional(),
  /** Or a posted payment whose unallocated funds are being allocated. */
  paymentId: uuid.optional(),
};

export const AllocationPreviewRequestSchema = z
  .object({
    ...previewSource,
    strategy: AllocationStrategySchema.optional(),
    /** Explicit set; wins over strategy. Absent with no strategy = everything unallocated. */
    allocations: z.array(AllocationRequestSchema).max(200).optional(),
  })
  .openapi('AllocationPreviewRequest');

export const BalanceSchema = z.object({ outstanding: AmountSchema, overdue: AmountSchema }).openapi('Balance');

export const EligibleReceivableSchema = z
  .object({ receivableId: uuid, projectId: uuid, agreementId: uuid.nullable(), origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']), dueDate: IsoDateSchema, gross: AmountSchema, outstanding: AmountSchema, status: ItemStatusSchema })
  .openapi('EligibleReceivable');

export const AllocationPreviewResponseSchema = z
  .object({
    customerId: uuid,
    currency: CurrencySchema,
    /** The amount available: the new payment's amount or the payment's unallocated funds. */
    amount: AmountSchema,
    allocations: z.array(AllocationRequestSchema),
    allocated: AmountSchema,
    unallocated: AmountSchema,
    eligible: z.array(EligibleReceivableSchema),
    balances: z.object({
      receivables: z.array(z.object({ receivableId: uuid, projectId: uuid, outstandingBefore: AmountSchema, outstandingAfter: AmountSchema, statusBefore: ItemStatusSchema, statusAfter: ItemStatusSchema })),
      projects: z.array(z.object({ projectId: uuid, before: BalanceSchema, after: BalanceSchema })),
      customer: z.object({ before: BalanceSchema, after: BalanceSchema }),
    }),
    warnings: z.array(z.enum(['NO_ELIGIBLE_RECEIVABLES'])),
    previewToken: z.string().length(64),
  })
  .openapi('AllocationPreviewResponse');

export const CreatePaymentRequestSchema = z
  .object({
    customerId: uuid,
    currency: CurrencySchema,
    amount: AmountSchema,
    receivedOn: IsoDateSchema,
    method: PaymentMethodSchema,
    reference: z.string().max(120).optional(),
    notes: z.string().max(2000).optional(),
    /** A REVERSED payment of the same customer this one corrects. */
    replacesPaymentId: uuid.optional(),
    allocations: z.array(AllocationRequestSchema).max(200),
    previewToken: z.string().length(64),
  })
  .openapi('CreatePaymentRequest');

export const AllocationSchema = z
  .object({ id: uuid, receivableId: uuid, projectId: uuid, origin: z.enum(['INSTALLMENT', 'RETAINER_CHARGE', 'ADJUSTMENT']), amount: AmountSchema, receivableOutstanding: AmountSchema, receivableStatus: ItemStatusSchema, createdAt: z.string().datetime() })
  .openapi('Allocation');

export const PaymentSchema = z
  .object({
    id: uuid,
    number: z.string(),
    customerId: uuid,
    currency: CurrencySchema,
    amount: AmountSchema,
    allocated: AmountSchema,
    unallocated: AmountSchema,
    receivedOn: IsoDateSchema,
    method: PaymentMethodSchema,
    reference: z.string().nullable(),
    notes: z.string().nullable(),
    status: PaymentStatusSchema,
    reversedAt: z.string().datetime().nullable(),
    reversalReason: z.string().nullable(),
    replacesPaymentId: uuid.nullable(),
    replacedByPaymentId: uuid.nullable(),
    allocations: z.array(AllocationSchema),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Payment');

export const PaymentPageSchema = z.object({ items: z.array(PaymentSchema), nextCursor: z.string().nullable() }).openapi('PaymentPage');

export const ListPaymentsQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  /** Payments with at least one allocation on the project. */
  projectId: uuid.optional(),
  status: PaymentStatusSchema.optional(),
  receivedBefore: IsoDateSchema.optional(),
  receivedAfter: IsoDateSchema.optional(),
});

export const PaymentIdParamSchema = z.object({ paymentId: uuid });

export const AllocatePaymentRequestSchema = z
  .object({ allocations: z.array(AllocationRequestSchema).min(1).max(200), previewToken: z.string().length(64) })
  .openapi('AllocatePaymentRequest');

export const ReversePaymentRequestSchema = z.object({ reason: z.string().min(1).max(500) }).openapi('ReversePaymentRequest');

export const CreditRequestSchema = z
  .object({
    /** Positive magnitude in the receivable's currency (gross). */
    amount: AmountSchema,
    reason: z.string().min(1).max(500),
    /** Defaults to today in the organization timezone. */
    effectiveDate: IsoDateSchema.optional(),
  })
  .openapi('CreditRequest');

export const CreditSchema = z
  .object({ id: uuid, receivableId: uuid, amount: AmountSchema, net: AmountSchema, vat: AmountSchema, reason: z.string(), effectiveDate: IsoDateSchema, createdAt: z.string().datetime() })
  .openapi('Credit');

export const CreditResponseSchema = z.object({ receivable: ReceivableSchema, credit: CreditSchema }).openapi('CreditResponse');
export const CreditsResponseSchema = z.object({ receivable: ReceivableSchema, credits: z.array(CreditSchema) }).openapi('CreditsResponse');

export const OperationKeyParamSchema = z.object({ idempotencyKey: z.string().min(8).max(128) });
export const OperationSchema = z
  .object({
    key: z.string(),
    operation: z.string(),
    status: z.enum(['PENDING', 'COMPLETED']),
    responseStatus: z.number().int().nullable(),
    /** The stored response body, exactly as the original request received it. */
    response: z.unknown().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .openapi('Operation');

// ---- Milestone 6: summaries, audit listing, attachments --------------------------

export const CustomerSummaryStatusSchema = z.enum(['SETTLED', 'OVERDUE', 'OUTSTANDING', 'UP_TO_DATE']).openapi('CustomerSummaryStatus');
export const ProjectSummaryStatusSchema = z.enum(['NONE', 'PENDING', 'OUTSTANDING', 'PARTIALLY_PAID', 'OVERDUE', 'PAID_IN_FULL', 'UP_TO_DATE', 'CANCELLED', 'SETTLED']).openapi('ProjectSummaryStatus');

const bucketFields = { outstanding: AmountSchema, overdue: AmountSchema, dueToday: AmountSchema, notYetDue: AmountSchema };

/** M8 (D17): a customer's open (PROPOSED) fee proposal as the overview lists it, in the block's currency. */
export const CustomerSummaryProposalSchema = z
  .object({ proposalId: uuid, projectId: uuid, amount: AmountSchema, proposedOn: IsoDateSchema })
  .openapi('CustomerSummaryProposal');

export const CustomerSummaryRowSchema = z
  .object({ customerId: uuid, ...bucketFields, unallocated: AmountSchema, lastPaymentOn: IsoDateSchema.nullable(), status: CustomerSummaryStatusSchema, proposals: z.array(CustomerSummaryProposalSchema) })
  .openapi('CustomerSummaryRow');

export const CurrencySummarySchema = z
  .object({
    currency: CurrencySchema,
    ...bucketFields,
    unallocated: AmountSchema,
    /** M8: the sum of the block's open (PROPOSED) fee proposals, in the pricing basis. */
    proposed: AmountSchema,
    counts: z.object({ customers: z.number().int(), overdueCustomers: z.number().int(), unallocatedPayments: z.number().int(), openProposals: z.number().int() }),
    customers: z.array(CustomerSummaryRowSchema),
  })
  .openapi('CurrencySummary');

export const OrganizationSummarySchema = z.object({ asOf: IsoDateSchema, currencies: z.array(CurrencySummarySchema) }).openapi('OrganizationSummary');

// ---- Milestone 7: fee proposals ---------------------------------------------

export const FEE_PROPOSAL_STATUSES = ['PROPOSED', 'APPROVED', 'WITHDRAWN'] as const;
export const FeeProposalStatusSchema = z.enum(FEE_PROPOSAL_STATUSES).openapi('FeeProposalStatus');

const proposalNote = z.string().max(2000);

export const FeeProposalSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    customerId: uuid,
    currency: CurrencySchema,
    status: FeeProposalStatusSchema,
    pricingBasis: PricingBasisSchema,
    /** The amount proposed to the client, in the pricing basis. */
    proposedAmount: AmountSchema,
    proposedOn: IsoDateSchema,
    note: z.string().nullable(),
    /** The approval date; the agreement is dated the same. */
    clientApprovedOn: IsoDateSchema.nullable(),
    clientApprovalNote: z.string().nullable(),
    /** Null while PROPOSED or WITHDRAWN; the final amount once APPROVED. */
    agreedAmount: AmountSchema.nullable(),
    withdrawnAt: z.string().datetime().nullable(),
    withdrawnReason: z.string().nullable(),
    /** The agreement the approval created (APPROVED). */
    agreementId: uuid.nullable(),
    version: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FeeProposal');

/** The proposal block on a project summary: the open one, else the latest approved one. */
export const FeeProposalSummarySchema = z
  .object({ id: uuid, status: FeeProposalStatusSchema, pricingBasis: PricingBasisSchema, proposedAmount: AmountSchema, agreedAmount: AmountSchema.nullable(), proposedOn: IsoDateSchema, agreementId: uuid.nullable() })
  .openapi('FeeProposalSummary');

export const CreateFeeProposalRequestSchema = z
  .object({
    projectId: uuid,
    /** In the pricing basis, project currency. */
    amount: AmountSchema,
    pricingBasis: PricingBasisSchema,
    /** Defaults to today in the organization timezone. */
    proposedOn: IsoDateSchema.optional(),
    note: proposalNote.optional(),
  })
  .openapi('CreateFeeProposalRequest');

/** M8 (D5, D15 B): how the approved fee is to be paid. ONCE → one installment posted at once, due on `dueOn`; INSTALLMENTS → equal monthly shares (remainder on the first), the first posted at once and due on `firstDueOn`, the rest posted on their dates. */
export const ApproveScheduleSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('ONCE'), dueOn: IsoDateSchema }),
    z.object({ kind: z.literal('INSTALLMENTS'), count: z.number().int().min(2).max(MAX_INSTALLMENTS), firstDueOn: IsoDateSchema }),
  ])
  .openapi('ApproveSchedule');

export const ApproveFeeProposalRequestSchema = z
  .object({
    /** The final amount, in the pricing basis and project currency; prefilled with the proposed one by clients. */
    amount: AmountSchema,
    /** Defaults to today in the organization timezone; the agreement is dated the same, so the VAT rate in force on it applies (D18). */
    approvedOn: IsoDateSchema.optional(),
    schedule: ApproveScheduleSchema,
    note: proposalNote.optional(),
  })
  .openapi('ApproveFeeProposalRequest');
export const WithdrawFeeProposalRequestSchema = z.object({ reason: proposalNote.optional() }).openapi('WithdrawFeeProposalRequest');

export const ListFeeProposalsQuerySchema = z.object({
  ...pageQuery,
  projectId: uuid.optional(),
  customerId: uuid.optional(),
  status: FeeProposalStatusSchema.optional(),
  open: z.enum(['true', 'false']).optional().openapi({ description: '`true` narrows to PROPOSED; `false` to APPROVED | WITHDRAWN.' }),
});
export const FeeProposalPageSchema = z.object({ items: z.array(FeeProposalSchema), nextCursor: z.string().nullable() }).openapi('FeeProposalPage');
/** M8: approving returns the proposal and the agreement it created, with its installments (the first already posted). */
export const ApproveFeeProposalResponseSchema = z.object({ proposal: FeeProposalSchema, agreement: AgreementDetailSchema }).openapi('ApproveFeeProposalResponse');
export const FeeProposalIdParamSchema = z.object({ proposalId: uuid });

export const ProjectSummarySchema = z
  .object({
    projectId: uuid,
    currency: CurrencySchema,
    kind: z.enum(['FIXED', 'RETAINER', 'NONE']),
    /** Fixed: the active agreement's gross total. */
    agreed: AmountSchema.nullable(),
    /** Retainer: the monthly gross of the terms in force. */
    monthly: AmountSchema.nullable(),
    posted: AmountSchema,
    paid: AmountSchema,
    credited: AmountSchema,
    ...bucketFields,
    pending: z.object({ count: z.number().int(), amount: AmountSchema }),
    status: ProjectSummaryStatusSchema,
    /** M7: the open fee proposal, else the latest approved one, else null. */
    proposal: FeeProposalSummarySchema.nullable(),
  })
  .openapi('ProjectSummary');

export const CustomerCurrencySummarySchema = z
  .object({ currency: CurrencySchema, ...bucketFields, unallocated: AmountSchema, status: CustomerSummaryStatusSchema, projects: z.array(ProjectSummarySchema) })
  .openapi('CustomerCurrencySummary');

export const CustomerSummarySchema = z
  .object({ customerId: uuid, asOf: IsoDateSchema, lastPaymentOn: IsoDateSchema.nullable(), currencies: z.array(CustomerCurrencySummarySchema) })
  .openapi('CustomerSummary');

export const ProjectSummaryResponseSchema = ProjectSummarySchema.extend({ asOf: IsoDateSchema }).openapi('ProjectSummaryResponse');

export const SummaryCurrencyQuerySchema = z.object({ currency: CurrencySchema.optional() });

export const ListAuditQuerySchema = z.object({
  ...pageQuery,
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().min(1).max(128).optional(),
  action: z.string().min(1).max(64).optional(),
});
export const AuditPageSchema = z.object({ items: z.array(AuditEventSchema), nextCursor: z.string().nullable() }).openapi('AuditPage');

export const AttachmentKindSchema = z.enum(['INVOICE', 'RECEIPT', 'OTHER']).openapi('AttachmentKind');
export const AttachmentStatusSchema = z.enum(['PENDING_UPLOAD', 'READY']).openapi('AttachmentStatus');
export const AttachmentMimeTypeSchema = z.enum(['application/pdf', 'image/jpeg', 'image/png']).openapi('AttachmentMimeType');

export const AttachmentSchema = z
  .object({
    id: uuid,
    kind: AttachmentKindSchema,
    filename: z.string(),
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: z.number().int(),
    status: AttachmentStatusSchema,
    customerId: uuid.nullable(),
    projectId: uuid.nullable(),
    paymentId: uuid.nullable(),
    invoiceNumber: z.string().nullable(),
    invoiceDate: IsoDateSchema.nullable(),
    uploadedByKeyId: z.string().nullable(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .openapi('Attachment');

export const CreateUploadRequestSchema = z
  .object({
    kind: AttachmentKindSchema,
    filename: z.string().min(1).max(200),
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
    customerId: uuid.optional(),
    projectId: uuid.optional(),
    paymentId: uuid.optional(),
    invoiceNumber: z.string().max(80).optional(),
    invoiceDate: IsoDateSchema.optional(),
  })
  .openapi('CreateUploadRequest');

export const CreateUploadResponseSchema = z
  .object({
    attachment: AttachmentSchema,
    upload: z.object({ url: z.string().url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime() }),
  })
  .openapi('CreateUploadResponse');

export const AttachmentDownloadSchema = z.object({ url: z.string().url(), expiresAt: z.string().datetime(), filename: z.string(), mimeType: AttachmentMimeTypeSchema }).openapi('AttachmentDownload');

export const ListAttachmentsQuerySchema = z.object({
  ...pageQuery,
  customerId: uuid.optional(),
  projectId: uuid.optional(),
  paymentId: uuid.optional(),
  kind: AttachmentKindSchema.optional(),
});
export const AttachmentPageSchema = z.object({ items: z.array(AttachmentSchema), nextCursor: z.string().nullable() }).openapi('AttachmentPage');
export const AttachmentIdParamSchema = z.object({ attachmentId: uuid.openapi({ param: { name: 'attachmentId', in: 'path' } }) });
