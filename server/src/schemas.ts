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
] as const;

// ---- Milestone 3: VAT rates, agreements, installments, retainers, receivables ----

export const ItemStatusSchema = z.enum(ITEM_STATUSES).openapi('ItemStatus');
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

export const AgreementCreateRequestSchema = AgreementPreviewRequestSchema.extend({ previewToken: z.string().length(64) }).openapi('AgreementCreateRequest');

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
      .object({ startMonth: IsoMonthSchema, billingDay: z.number().int(), endMonth: IsoMonthSchema.nullable(), cancelEffectiveMonth: IsoMonthSchema.nullable(), finalMonth: z.enum(['FULL', 'WAIVE']).nullable() })
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

export const RetainerChargesResponseSchema = z.object({ agreement: AgreementSchema, charges: z.array(RetainerChargeSchema) }).openapi('RetainerChargesResponse');

export const RetainerCancelRequestSchema = z
  .object({ effectiveDate: IsoDateSchema, finalMonth: z.enum(['FULL', 'WAIVE']) })
  .openapi('RetainerCancelRequest');

export const ReconcileResponseSchema = z
  .object({ installmentsPosted: z.number().int(), chargesCreated: z.number().int(), today: IsoDateSchema })
  .openapi('ReconcileResponse');

