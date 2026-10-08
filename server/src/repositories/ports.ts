import type { ApiKeyEnvironment } from '../auth/api-key.js';
import type { Scope } from '../auth/scopes.js';
import type { IsoDate, IsoMonth, PaymentTerms } from '../dates.js';
import type { PricingBasis, VatTreatment } from '../vat.js';

/**
 * Storage ports for the Milestone 1 control tables.
 *
 * Mutaba3a's desktop has a repository layer that is typed as storage-agnostic
 * but implemented straight against Dexie (ADR-002, audit §2.2). The service
 * keeps the port honest from day one: every route depends on `LedgerStore`,
 * and there are two implementations — Prisma for production and an in-memory
 * one for tests — both run against the same contract test suite.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  createdAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
}

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  environment: ApiKeyEnvironment;
  prefix: string;
  keyHash: string;
  scopes: Scope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  environment: ApiKeyEnvironment;
  prefix: string;
  keyHash: string;
  scopes: Scope[];
  expiresAt: Date | null;
}

export type IntegrationProvider = 'MALAFAT';
export type IntegrationStatus = 'CONNECTED' | 'DISCONNECTED';

export interface IntegrationRecord {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  externalTenantId: string;
  displayName: string;
  status: IntegrationStatus;
  connectedByApiKeyId: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
}

export interface ConnectIntegrationInput {
  organizationId: string;
  provider: IntegrationProvider;
  externalTenantId: string;
  displayName: string;
  connectedByApiKeyId: string;
  at: Date;
}

export type AuditActorType = 'API_KEY' | 'ADMIN' | 'SYSTEM';

export interface AuditEventInput {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  requestId: string | null;
}

export interface AuditEventRecord extends AuditEventInput {
  id: string;
  createdAt: Date;
}

export type IdempotencyStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  organizationId: string;
  key: string;
  operation: string;
  fingerprint: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

/**
 * Outcome of claiming an idempotency key.
 *  - new:         the caller owns the key and must run the operation
 *  - replay:      same key, same fingerprint, finished — return the stored outcome
 *  - in_progress: same key, same fingerprint, not finished — another request is running it
 *  - mismatch:    same key, different fingerprint — reject (plan §14.2)
 */
export type IdempotencyClaim =
  | { kind: 'new' }
  | { kind: 'replay'; record: IdempotencyRecord }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

export interface OrganizationRepository {
  create(input: CreateOrganizationInput): Promise<Organization>;
  getById(id: string): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
}

export interface ApiKeyRepository {
  create(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  findByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  getById(id: string): Promise<ApiKeyRecord | null>;
  listByOrganization(organizationId: string): Promise<ApiKeyRecord[]>;
  touchLastUsed(id: string, at: Date): Promise<void>;
  revoke(id: string, reason: string, at: Date): Promise<ApiKeyRecord | null>;
}

export interface IntegrationRepository {
  findByOrganizationAndProvider(organizationId: string, provider: IntegrationProvider): Promise<IntegrationRecord | null>;
  findByProviderAndTenant(provider: IntegrationProvider, externalTenantId: string): Promise<IntegrationRecord | null>;
  listByOrganization(organizationId: string): Promise<IntegrationRecord[]>;
  /** Creates, or re-connects a DISCONNECTED row for the same (organization, provider) keeping its id. */
  connect(input: ConnectIntegrationInput): Promise<IntegrationRecord>;
  disconnect(id: string, at: Date): Promise<IntegrationRecord | null>;
}

export interface AuditRepository {
  append(event: AuditEventInput): Promise<AuditEventRecord>;
  listByOrganization(organizationId: string, limit: number): Promise<AuditEventRecord[]>;
}

export interface IdempotencyRepository {
  claim(input: { organizationId: string; key: string; operation: string; fingerprint: string; at: Date }): Promise<IdempotencyClaim>;
  complete(input: { organizationId: string; key: string; responseStatus: number; responseBody: unknown; at: Date }): Promise<void>;
  /** Releases the key so a retry can run the operation again (used after a 5xx). */
  fail(input: { organizationId: string; key: string; at: Date }): Promise<void>;
}

// ---- Milestone 2: customers, projects, external references ----------------

export type EntityStatus = 'ACTIVE' | 'ARCHIVED';
export type ExternalEntityType = 'CUSTOMER' | 'PROJECT';

/** How an external system (Malafat) names one of our entities. */
export interface ExternalReferenceInput {
  provider: IntegrationProvider;
  externalId: string;
}

export interface ExternalReferenceRecord extends ExternalReferenceInput {
  id: string;
  organizationId: string;
  entityType: ExternalEntityType;
  entityId: string;
  createdAt: Date;
}

export interface LinkExternalReferenceInput extends ExternalReferenceInput {
  organizationId: string;
  entityType: ExternalEntityType;
  entityId: string;
}

export interface CustomerRecord {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Default VAT treatment for this customer's items (M3; e.g. OUT_OF_SCOPE for a foreign client). Null = inherit STANDARD_RATED. */
  vatTreatment: VatTreatment | null;
  status: EntityStatus;
  archivedAt: Date | null;
  /** Optimistic-concurrency version; starts at 1, +1 per write. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  organizationId: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  vatTreatment?: VatTreatment | null;
}

/** Absent key = unchanged; null = cleared. */
export interface UpdateCustomerPatch {
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  vatTreatment?: VatTreatment | null;
}

export interface ProjectRecord {
  id: string;
  organizationId: string;
  customerId: string;
  name: string;
  /** ISO 4217; one currency per project (plan §3.3, ADR-004). */
  currency: string;
  /** Default VAT treatment for this project's items (M3). Null = inherit the customer's. */
  vatTreatment: VatTreatment | null;
  status: EntityStatus;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  organizationId: string;
  customerId: string;
  name: string;
  currency: string;
  vatTreatment?: VatTreatment | null;
}

export interface UpdateProjectPatch {
  name?: string;
  currency?: string;
  vatTreatment?: VatTreatment | null;
}

/** Keyset cursor: rows are ordered by (createdAt, id) ascending. */
export interface PageCursor {
  createdAt: Date;
  id: string;
}

export interface PageRequest {
  limit: number;
  cursor: PageCursor | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: PageCursor | null;
}

export interface CustomerFilter {
  status?: EntityStatus;
  provider?: IntegrationProvider;
  externalId?: string;
}

export interface ProjectFilter extends CustomerFilter {
  customerId?: string;
  currency?: string;
}

export type UpdateResult<T> = { kind: 'updated'; record: T } | { kind: 'stale'; record: T } | { kind: 'not_found' };

export interface CustomerRepository {
  /** With `reference`, the customer and its external reference are written atomically. */
  create(input: CreateCustomerInput, at: Date, reference?: ExternalReferenceInput): Promise<CustomerRecord>;
  getById(organizationId: string, id: string): Promise<CustomerRecord | null>;
  list(organizationId: string, filter: CustomerFilter, page: PageRequest): Promise<Page<CustomerRecord>>;
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateCustomerPatch, at: Date): Promise<UpdateResult<CustomerRecord>>;
  /** Idempotent: an archived customer is returned unchanged. */
  archive(organizationId: string, id: string, at: Date): Promise<CustomerRecord | null>;
}

export interface ProjectRepository {
  create(input: CreateProjectInput, at: Date, reference?: ExternalReferenceInput): Promise<ProjectRecord>;
  getById(organizationId: string, id: string): Promise<ProjectRecord | null>;
  list(organizationId: string, filter: ProjectFilter, page: PageRequest): Promise<Page<ProjectRecord>>;
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateProjectPatch, at: Date): Promise<UpdateResult<ProjectRecord>>;
  archive(organizationId: string, id: string, at: Date): Promise<ProjectRecord | null>;
  countActiveByCustomer(organizationId: string, customerId: string): Promise<number>;
  /** True once the project has an agreement (M3 brief, decision 3): the currency is then locked. */
  hasPostedActivity(organizationId: string, id: string): Promise<boolean>;
}

// ---- Milestone 3: VAT rates, agreements, installments, retainer charges, receivables ----

export interface VatRateRecord {
  id: string;
  organizationId: string;
  rateBasisPoints: number;
  effectiveFrom: IsoDate;
  createdAt: Date;
}

export type VatRateUpsert = { outcome: 'created' | 'unchanged'; record: VatRateRecord } | { outcome: 'conflict'; record: VatRateRecord };

export interface VatRateRepository {
  /** Append-only by effective date: same date + same rate = unchanged; same date + other rate = conflict. */
  upsert(organizationId: string, rateBasisPoints: number, effectiveFrom: IsoDate, at: Date): Promise<VatRateUpsert>;
  /** Newest effective date first. */
  list(organizationId: string): Promise<VatRateRecord[]>;
  /** The rate in force on `date` (latest effectiveFrom ≤ date), or null. */
  effectiveOn(organizationId: string, date: IsoDate): Promise<VatRateRecord | null>;
}

export type AgreementType = 'FIXED' | 'RECURRING';
export type AgreementStatus = 'ACTIVE' | 'CANCELLED';
export type TriggerType = 'IMMEDIATE' | 'DATE' | 'MANUAL';
export type ReceivableOrigin = 'INSTALLMENT' | 'RETAINER_CHARGE' | 'ADJUSTMENT';
export type ReceivableStatus = 'OPEN' | 'SETTLED';
export type FinalMonth = 'FULL' | 'WAIVE';
export type SupplementDistribution = 'LAST_UNPOSTED' | 'PRORATE_UNPOSTED' | 'NEW_INSTALLMENT';

export interface AgreementRecord {
  id: string;
  organizationId: string;
  projectId: string;
  customerId: string;
  type: AgreementType;
  status: AgreementStatus;
  currency: string;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  /** Frozen at creation; supplements reuse it (decision 4). 0 for non-standard treatments. */
  vatRateBasisPoints: number;
  /** FIXED: contractual total in the pricing basis. RECURRING: the monthly amount. */
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  agreementDate: IsoDate;
  description: string | null;
  paymentTerms: PaymentTerms;
  // RECURRING only
  startMonth: IsoMonth | null;
  billingDay: number | null;
  endMonth: IsoMonth | null;
  cancelEffectiveMonth: IsoMonth | null;
  finalMonth: FinalMonth | null;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInstallmentInput {
  position: number;
  label: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  triggerType: TriggerType;
  triggerDate: IsoDate | null;
  paymentTerms: PaymentTerms | null;
  dueDateOverride: IsoDate | null;
}

export interface CreateAgreementInput {
  organizationId: string;
  projectId: string;
  customerId: string;
  type: AgreementType;
  currency: string;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  vatRateBasisPoints: number;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  agreementDate: IsoDate;
  description: string | null;
  paymentTerms: PaymentTerms;
  startMonth: IsoMonth | null;
  billingDay: number | null;
  endMonth: IsoMonth | null;
  installments: CreateInstallmentInput[];
}

export interface InstallmentRecord extends CreateInstallmentInput {
  id: string;
  organizationId: string;
  agreementId: string;
  postedAt: Date | null;
  postingDate: IsoDate | null;
  receivableId: string | null;
  voidedAt: Date | null;
  version: number;
}

export interface RetainerChargeRecord {
  id: string;
  organizationId: string;
  agreementId: string;
  serviceMonth: IsoMonth;
  chargeDate: IsoDate;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  postedAt: Date;
  receivableId: string;
  createdAt: Date;
}

export interface ReceivableRecord {
  id: string;
  organizationId: string;
  customerId: string;
  projectId: string;
  agreementId: string | null;
  origin: ReceivableOrigin;
  /** Installment id or charge id. */
  originId: string | null;
  currency: string;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  vatRateBasisPoints: number;
  /** Written by M4 payments; 0 until then. */
  paidMinor: bigint;
  dueDate: IsoDate;
  postingDate: IsoDate;
  postedAt: Date;
  status: ReceivableStatus;
  version: number;
  createdAt: Date;
}

export interface PostingInput {
  postingDate: IsoDate;
  dueDate: IsoDate;
  at: Date;
}

export interface SupplementInput {
  amountMinor: bigint;
  description: string | null;
  effectiveDate: IsoDate;
  distribution: SupplementDistribution;
  requestId: string | null;
}

export interface SupplementRecord extends SupplementInput {
  id: string;
  organizationId: string;
  agreementId: string;
  resultingAmountMinor: bigint;
  createdAt: Date;
}

export interface InstallmentAmountUpdate {
  id: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
}

export interface ApplySupplementInput {
  supplement: SupplementInput;
  installmentUpdates: InstallmentAmountUpdate[];
  newInstallments: CreateInstallmentInput[];
  totals: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint; grossMinor: bigint };
  expectedVersion: number;
}

export interface AgreementFilter {
  projectId?: string;
  customerId?: string;
  status?: AgreementStatus;
  type?: AgreementType;
}

export interface CreateChargeInput {
  organizationId: string;
  agreementId: string;
  customerId: string;
  projectId: string;
  currency: string;
  serviceMonth: IsoMonth;
  chargeDate: IsoDate;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  dueDate: IsoDate;
}

export interface AgreementRepository {
  /** Agreement + installments atomically. */
  create(input: CreateAgreementInput, at: Date): Promise<{ agreement: AgreementRecord; installments: InstallmentRecord[] }>;
  getById(organizationId: string, id: string): Promise<AgreementRecord | null>;
  list(organizationId: string, filter: AgreementFilter, page: PageRequest): Promise<Page<AgreementRecord>>;
  listInstallments(organizationId: string, agreementId: string): Promise<InstallmentRecord[]>;
  getInstallment(organizationId: string, id: string): Promise<InstallmentRecord | null>;
  /** Creates the receivable and marks the installment, atomically; a second call returns the first receivable with created=false. */
  postInstallment(organizationId: string, installmentId: string, input: PostingInput): Promise<{ installment: InstallmentRecord; receivable: ReceivableRecord; created: boolean } | null>;
  /** DATE installments whose trigger date ≤ today, not posted, not voided, on ACTIVE agreements. */
  listUnpostedDue(organizationId: string, today: IsoDate): Promise<InstallmentRecord[]>;
  applySupplement(organizationId: string, agreementId: string, input: ApplySupplementInput, at: Date): Promise<UpdateResult<{ agreement: AgreementRecord; supplement: SupplementRecord; installments: InstallmentRecord[] }>>;
  listSupplements(organizationId: string, agreementId: string): Promise<SupplementRecord[]>;
  /** FIXED: status CANCELLED, unposted installments voided. RECURRING: cancel month + final month recorded, status CANCELLED. Idempotent. */
  cancel(organizationId: string, agreementId: string, input: { cancelEffectiveMonth: IsoMonth | null; finalMonth: FinalMonth | null }, at: Date): Promise<AgreementRecord | null>;
  /** RECURRING agreements that may still generate charges (ACTIVE, or CANCELLED with a cancel month). */
  listRetainers(organizationId: string): Promise<AgreementRecord[]>;
  listCharges(organizationId: string, agreementId: string): Promise<RetainerChargeRecord[]>;
  /** Charge + its receivable atomically; unique per (agreement, month) — a repeat returns the existing charge with created=false. */
  createPostedCharge(input: CreateChargeInput, at: Date): Promise<{ charge: RetainerChargeRecord; receivable: ReceivableRecord; created: boolean }>;
}

export interface ReceivableFilter {
  customerId?: string;
  projectId?: string;
  currency?: string;
  dueBefore?: IsoDate;
  dueAfter?: IsoDate;
  status?: ReceivableStatus;
}

export interface ReceivableRepository {
  getById(organizationId: string, id: string): Promise<ReceivableRecord | null>;
  list(organizationId: string, filter: ReceivableFilter, page: PageRequest): Promise<Page<ReceivableRecord>>;
  /** OPEN receivables with outstanding > 0 on the project (archive guard). */
  countOutstandingByProject(organizationId: string, projectId: string): Promise<number>;
}

export interface ExternalReferenceRepository {
  link(input: LinkExternalReferenceInput, at: Date): Promise<ExternalReferenceRecord>;
  findByExternalId(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalId: string): Promise<ExternalReferenceRecord | null>;
  findByExternalIds(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalIds: string[]): Promise<ExternalReferenceRecord[]>;
  findByEntities(organizationId: string, entityType: ExternalEntityType, entityIds: string[]): Promise<ExternalReferenceRecord[]>;
}

export interface LedgerStore {
  organizations: OrganizationRepository;
  apiKeys: ApiKeyRepository;
  integrations: IntegrationRepository;
  audit: AuditRepository;
  idempotency: IdempotencyRepository;
  customers: CustomerRepository;
  projects: ProjectRepository;
  externalReferences: ExternalReferenceRepository;
  vatRates: VatRateRepository;
  agreements: AgreementRepository;
  receivables: ReceivableRepository;
  /** Liveness of the backing store, for /ready. */
  ping(): Promise<void>;
}
