import type { ApiKeyEnvironment } from '../auth/api-key.js';
import type { KeyScope } from '../auth/scopes.js';
import type { SessionKind } from '../auth/sessions.js';
import type { IsoDate, IsoMonth, PaymentTerms } from '../dates.js';
import type { ContingencyOutcome, UpfrontTreatment } from '../agreements/contingency.js';
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

/** MUT-182: an owned profile's kind. It only selects the expense-category preset; BUSINESS is not a firm or a Malafat tenant. */
export type ProfileType = 'PERSONAL' | 'BUSINESS';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  /** MUT-120: the owner of a user's one personal organization; null on every firm. */
  personalOwnerUserId: string | null;
  /** MUT-182: the user who owns and controls this profile (theirs to rename and retype); null on every operator firm. Not unique. */
  ownerUserId: string | null;
  /** MUT-182: set exactly when ownerUserId is; always PERSONAL on the MUT-120 profile. */
  profileType: ProfileType | null;
  /** MUT-182: If-Match for PATCH /v1/profiles/{id}. */
  version: number;
  createdAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  /** MUT-120: UniqueViolation when the user already has a personal organization. */
  personalOwnerUserId?: string | null;
}

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  environment: ApiKeyEnvironment;
  prefix: string;
  keyHash: string;
  scopes: KeyScope[];
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
  scopes: KeyScope[];
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

/** USER (MUT-38): a signed-in person acting through a session; actorId is the user id. */
export type AuditActorType = 'API_KEY' | 'ADMIN' | 'SYSTEM' | 'USER';

/**
 * A value Postgres' `jsonb` stores as given (MUT-100, eng re-review R9). Audit
 * metadata is typed with it so a `bigint` or a `Date` — which the memory store
 * keeps and Prisma cannot serialize — is a compile error in every caller,
 * not a production 500 after the write it describes. Money goes in as
 * `formatMoney` strings, as every audit payload already does.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface AuditEventInput {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: JsonObject;
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

/** MUT-182: a profile a signed-in user creates for themselves (POST /v1/profiles). Standalone: never keyed, bound or shared. */
export interface CreateOwnedOrganizationInput {
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  profileType: ProfileType;
  at: Date;
}

/**
 * MUT-182 (qa-reconcile D3): who is acting, for the audit rows createOwned and
 * updateOwned write inside their own transaction — so a profile, or a type
 * change, never commits without its record, and a failed audit can never
 * turn a client's retry into a second profile.
 */
export interface OwnedProfileAudit {
  actorId: string;
  requestId: string | null;
}

export interface UpdateOwnedProfileAudit extends OwnedProfileAudit {
  /** The request body's keys, for `organization.updated`. */
  fields: string[];
  /** The preset a type change seeds, for `organization.type_changed` and `expense_category.seeded`; null without a type change. */
  preset: { name: string; locale: string } | null;
}

export type CreateOwnedOrganizationResult =
  | { kind: 'created'; organization: Organization; membership: MembershipRecord }
  /** The user already owns `count` profiles, the cap or more; nothing was written. */
  | { kind: 'limit'; count: number };

/** Absent key = unchanged. A `profileType` equal to the current one changes nothing about the categories. */
export interface UpdateOwnedOrganizationPatch {
  name?: string;
  defaultCurrency?: string;
  profileType?: ProfileType;
}

/** What a type change does to a profile's expenses and categories (MUT-182: it replaces the categories). */
export interface ProfileTypeChange {
  /** Live (not deleted) expenses that had a category and are left uncategorized. */
  uncategorizedExpenses: number;
  /** Every category the profile had, custom and archived ones included. */
  deletedCategories: number;
}

export type UpdateOwnedOrganizationResult =
  | { kind: 'updated'; record: Organization; typeChange: ProfileTypeChange | null }
  | { kind: 'stale'; record: Organization }
  /** No such profile, or not owned by this user (an operator firm included). */
  | { kind: 'not_found' };

export interface OrganizationRepository {
  create(input: CreateOrganizationInput): Promise<Organization>;
  getById(id: string): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
  /** Every organization, oldest first (M5 reconcile script). */
  list(): Promise<Organization[]>;
  /**
   * MUT-182: the profile and its owner's membership, in one transaction that
   * counts the user's owned profiles (MUT-120's included) under a lock on the
   * user's row, so two concurrent creates can never both pass `cap`. The cap
   * guards creation only: post-roll's personal-profile backfill for a legacy
   * user with none (MUT-120) does not consult it, so such a user can end one
   * over (accepted; the backfill is a one-time repair).
   */
  createOwned(ownerUserId: string, input: CreateOwnedOrganizationInput, cap: number, audit: OwnedProfileAudit): Promise<CreateOwnedOrganizationResult>;
  /** Profiles the user owns: `ownerUserId`, or a MUT-120 profile the old revision wrote before post-roll stamped it (qa-reconcile D1). */
  countOwnedBy(userId: string): Promise<number>;
  /**
   * MUT-182 (eng review D4): the one versioned write behind PATCH
   * /v1/profiles/{id}. In one transaction, holding the organization's row
   * (D3): the version check, the field changes, and — when `profileType`
   * changes — every expense's category cleared, every category deleted and
   * `preset` inserted. One version bump. Throws when asked to make the
   * MUT-120 profile anything but PERSONAL (a CHECK constraint in Postgres).
   * A MUT-120 profile the old revision wrote without an owner (qa-reconcile
   * D1) is owned through `personalOwnerUserId` and gets stamped on its first
   * update. Audit rows go in the same transaction (D3); a type change's row
   * lists the removed categories and each expense's lost category (D4).
   */
  updateOwned(
    id: string,
    ownerUserId: string,
    expectedVersion: number,
    patch: UpdateOwnedOrganizationPatch,
    preset: readonly ExpenseCategoryInput[] | null,
    at: Date,
    audit: UpdateOwnedProfileAudit,
  ): Promise<UpdateOwnedOrganizationResult>;
  /** What a type change would do right now (the preview). */
  typeChangeImpact(id: string): Promise<ProfileTypeChange>;
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

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  action?: string;
  /** Entity types left out of the listing (MUT-42: expense activity never reaches Malafat's key). */
  excludeEntityTypes?: readonly string[];
  /** MUT-223: actions to leave out — a session's own edits on an entity type Malafat otherwise reads (receivable, payment). */
  excludeActions?: readonly string[];
}

export interface AuditRepository {
  append(event: AuditEventInput): Promise<AuditEventRecord>;
  listByOrganization(organizationId: string, limit: number): Promise<AuditEventRecord[]>;
  /** M6: the organization's history filtered by entity / action, oldest first, keyset-paginated. */
  list(organizationId: string, filter: AuditFilter, page: PageRequest): Promise<Page<AuditEventRecord>>;
}

// ---- Milestone 6: attachments ----------------------------------------------------

export type AttachmentKind = 'INVOICE' | 'RECEIPT' | 'OTHER';
export type AttachmentStatus = 'PENDING_UPLOAD' | 'READY';

export interface CreateAttachmentInput {
  organizationId: string;
  kind: AttachmentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  customerId: string | null;
  projectId: string | null;
  paymentId: string | null;
  invoiceNumber: string | null;
  invoiceDate: IsoDate | null;
  uploadedByKeyId: string | null;
  requestId: string | null;
}

export interface AttachmentRecord extends CreateAttachmentInput {
  id: string;
  status: AttachmentStatus;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

export interface AttachmentFilter {
  customerId?: string;
  projectId?: string;
  paymentId?: string;
  kind?: AttachmentKind;
}

export interface AttachmentRepository {
  /** The row is created with a placeholder key; the caller derives the real key from the id and `setKey`s it (one round trip, no id guessing). */
  create(input: Omit<CreateAttachmentInput, 'storageKey'>, at: Date): Promise<AttachmentRecord>;
  setKey(organizationId: string, id: string, storageKey: string): Promise<AttachmentRecord | null>;
  getById(organizationId: string, id: string): Promise<AttachmentRecord | null>;
  /** READY attachments that are not deleted, oldest first. */
  list(organizationId: string, filter: AttachmentFilter, page: PageRequest): Promise<Page<AttachmentRecord>>;
  complete(organizationId: string, id: string, at: Date): Promise<AttachmentRecord | null>;
  softDelete(organizationId: string, id: string, at: Date): Promise<AttachmentRecord | null>;
}

export interface IdempotencyRepository {
  claim(input: { organizationId: string; key: string; operation: string; fingerprint: string; at: Date }): Promise<IdempotencyClaim>;
  /** The stored claim for GET /v1/operations/{key}; null when never claimed or released after a 5xx (M4). */
  get(organizationId: string, key: string): Promise<IdempotencyRecord | null>;
  complete(input: { organizationId: string; key: string; responseStatus: number; responseBody: unknown; at: Date }): Promise<void>;
  /** Releases the key so a retry can run the operation again (used after a 5xx). */
  fail(input: { organizationId: string; key: string; at: Date }): Promise<void>;
}

/**
 * MUT-131: the same contract as IdempotencyRecord/IdempotencyClaim, keyed by
 * user instead of organization — for routes with no organization at all
 * (POST /v1/inbox, MUT-66). A separate type/table rather than a polymorphic
 * owner on the org-scoped one: every other idempotent() caller is
 * organization-scoped, and this is the first of its kind.
 */
export interface UserIdempotencyRecord {
  userId: string;
  key: string;
  operation: string;
  fingerprint: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

export type UserIdempotencyClaim =
  | { kind: 'new' }
  | { kind: 'replay'; record: UserIdempotencyRecord }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' };

export interface UserIdempotencyRepository {
  claim(input: { userId: string; key: string; operation: string; fingerprint: string; at: Date }): Promise<UserIdempotencyClaim>;
  get(userId: string, key: string): Promise<UserIdempotencyRecord | null>;
  complete(input: { userId: string; key: string; responseStatus: number; responseBody: unknown; at: Date }): Promise<void>;
  /** Releases the key so a retry can run the operation again (used after a 5xx). */
  fail(input: { userId: string; key: string; at: Date }): Promise<void>;
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

export type AgreementType = 'FIXED' | 'RECURRING' | 'CONTINGENCY';
export type AgreementStatus = 'ACTIVE' | 'CANCELLED';
export type TriggerType = 'IMMEDIATE' | 'DATE' | 'MANUAL';
export type ReceivableOrigin = 'INSTALLMENT' | 'RETAINER_CHARGE' | 'ADJUSTMENT';
export type ReceivableStatus = 'OPEN' | 'SETTLED';
export type FinalMonth = 'FULL' | 'PRORATE' | 'WAIVE';
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
  /** The day the retainer stopped (M5); the month above is derived from it. */
  cancelEffectiveDate: IsoDate | null;
  finalMonth: FinalMonth | null;
  cancelledAt: Date | null;
  // CONTINGENCY only (MUT-100): the terms, then the outcome once recorded; null on every other type.
  commissionRateBasisPoints: number | null;
  upfrontTreatment: UpfrontTreatment | null;
  outcome: ContingencyOutcome | null;
  outcomeDate: IsoDate | null;
  /** AWARDED: the award in the pricing basis' minor units; null otherwise. */
  awardedAmountMinor: bigint | null;
  outcomeNote: string | null;
  /** When the latest outcome (or correction) was written. */
  outcomeRecordedAt: Date | null;
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
  /** MUT-100: the commission line a contingency outcome posts. Absent = false. */
  isCommission?: boolean;
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
  /** CONTINGENCY only (MUT-100): both set on a contingency agreement, absent on every other type. */
  commissionRateBasisPoints?: number;
  upfrontTreatment?: UpfrontTreatment;
  installments: CreateInstallmentInput[];
  /** M8: the PROPOSED proposal this agreement approves; moved to APPROVED with these figures in the same transaction, or the whole create is refused (StateConflict). */
  approveProposal?: ApproveProposalInput | null;
}

export interface ApproveProposalInput {
  id: string;
  agreedAmountMinor: bigint;
  approvedOn: IsoDate;
  note: string | null;
}

export interface InstallmentRecord extends CreateInstallmentInput {
  isCommission: boolean;
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
  /** The retainer terms version the charge carries (M5); 1 for the original terms. */
  version: number;
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
  /** Null for an ADJUSTMENT receivable captured with no matter (MUT-65); always set for an INSTALLMENT/RETAINER_CHARGE one. */
  projectId: string | null;
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
  /** Sum of allocations from POSTED payments (M4). */
  paidMinor: bigint;
  /** Sum of credits (M4). Outstanding = gross − paid − credited. */
  creditedMinor: bigint;
  dueDate: IsoDate;
  postingDate: IsoDate;
  postedAt: Date;
  status: ReceivableStatus;
  /** "What you did" (MUT-65, ADJUSTMENT origin only); null for INSTALLMENT/RETAINER_CHARGE receivables. */
  title: string | null;
  /** Who captured it (MUT-65); null for INSTALLMENT/RETAINER_CHARGE receivables, which have no session actor. */
  createdByUserId: string | null;
  /** Soft-delete for the undo path (MUT-65); mirrors Expense.deletedAt. Null for every receivable this ticket does not create. */
  deletedAt: Date | null;
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

// ---- MUT-100: contingency terms and outcomes ----------------------------------

export interface ContingencyTermsPatch {
  commissionRateBasisPoints?: number;
  upfrontTreatment?: UpfrontTreatment;
}

export interface OutcomeWriteInput {
  outcome: ContingencyOutcome;
  outcomeDate: IsoDate;
  awardedAmountMinor: bigint | null;
  outcomeNote: string | null;
  /** The terms the outcome was computed with: the current ones, or a correction's fix (R3/D5). */
  commissionRateBasisPoints: number;
  upfrontTreatment: UpfrontTreatment;
  /** Null when the outcome bills nothing (NO_RECOVERY, or CREDITED covered by the upfront). */
  commissionInstallment: CreateInstallmentInput | null;
  /** The agreement's totals after the write: every live installment, the new commission line included. */
  totals: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint; grossMinor: bigint };
  /**
   * The posted upfront receivables the counted upfront was read from, at the versions read (review D2). Re-checked
   * under their row locks inside the write: a credit (or payment) since then answers `stale`, so the bill written is
   * never computed from an upfront that has since moved.
   */
  upfrontReceivables: ReadonlyArray<{ id: string; version: number }>;
  expectedVersion: number;
}

export interface CorrectOutcomeInput extends OutcomeWriteInput {
  /** The commission installment the correction replaces; null when the old outcome billed nothing. */
  replaceInstallmentId: string | null;
  /** The receivable that line had when the bill was composed (null = unposted); a line that posted since is `stale`. */
  replaceReceivableId: string | null;
  /** The full credit of the replaced commission's receivable, when it posted. */
  credit: { reason: string; effectiveDate: IsoDate; requestId: string | null };
}

export type OutcomeWriteResult = UpdateResult<{ agreement: AgreementRecord; installments: InstallmentRecord[] }>;

/** `has_payments`: the replaced commission's receivable was paid or credited before the write; nothing was written. */
export type CorrectOutcomeResult = UpdateResult<{ agreement: AgreementRecord; installments: InstallmentRecord[]; credit: CreditRecord | null }> | { kind: 'has_payments'; receivableId: string };

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
  /** Terms version (M5); defaults to 1. */
  version?: number;
}

// ---- Milestone 5: retainer versions -------------------------------------------

export interface AppendVersionInput {
  organizationId: string;
  agreementId: string;
  version: number;
  effectiveMonth: IsoMonth;
  monthlyAmountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  rateBasisPoints: number;
  billingDay: number;
  paymentTerms: PaymentTerms;
  endMonth: IsoMonth | null;
  reason: string;
  requestId: string | null;
  /** Optimistic check on the agreement row, which gets its version bumped. */
  expectedAgreementVersion: number;
}

export interface RetainerVersionRecord extends Omit<AppendVersionInput, 'expectedAgreementVersion'> {
  id: string;
  createdAt: Date;
}

export interface AgreementRepository {
  /** Agreement + installments atomically. */
  create(input: CreateAgreementInput, at: Date): Promise<{ agreement: AgreementRecord; installments: InstallmentRecord[] }>;
  getById(organizationId: string, id: string): Promise<AgreementRecord | null>;
  list(organizationId: string, filter: AgreementFilter, page: PageRequest): Promise<Page<AgreementRecord>>;
  listInstallments(organizationId: string, agreementId: string): Promise<InstallmentRecord[]>;
  getInstallment(organizationId: string, id: string): Promise<InstallmentRecord | null>;
  /** Creates the receivable and marks the installment, atomically; a second call returns the first receivable with created=false. Null for a voided, unposted line (a correction or cancel got there first). */
  postInstallment(organizationId: string, installmentId: string, input: PostingInput): Promise<{ installment: InstallmentRecord; receivable: ReceivableRecord; created: boolean } | null>;
  /** Unposted, non-voided installments on ACTIVE agreements that should have a receivable by `today`: DATE ones whose trigger date has arrived, and IMMEDIATE ones left unposted by a crash between create and post (M8, D16). Never MANUAL. */
  listUnpostedDue(organizationId: string, today: IsoDate): Promise<InstallmentRecord[]>;
  applySupplement(organizationId: string, agreementId: string, input: ApplySupplementInput, at: Date): Promise<UpdateResult<{ agreement: AgreementRecord; supplement: SupplementRecord; installments: InstallmentRecord[] }>>;
  listSupplements(organizationId: string, agreementId: string): Promise<SupplementRecord[]>;
  /** FIXED / CONTINGENCY: status CANCELLED, unposted installments voided — never once a contingency outcome is recorded (returned unchanged). RECURRING: cancel month + final month recorded, status CANCELLED. Idempotent. */
  cancel(organizationId: string, agreementId: string, input: { cancelEffectiveMonth: IsoMonth | null; cancelEffectiveDate?: IsoDate | null; finalMonth: FinalMonth | null }, at: Date): Promise<AgreementRecord | null>;
  /** M5: appends a terms version (unique per agreement + version) and bumps the agreement version atomically; `conflict` when the agreement moved. */
  appendVersion(input: AppendVersionInput, at: Date): Promise<UpdateResult<{ agreement: AgreementRecord; version: RetainerVersionRecord }>>;
  /** MUT-100: the commission rate and/or upfront treatment, under the version; `stale` also once an outcome exists. */
  updateContingencyTerms(organizationId: string, agreementId: string, expectedVersion: number, patch: ContingencyTermsPatch, at: Date): Promise<UpdateResult<AgreementRecord>>;
  /** MUT-100: outcome + terms + commission installment + totals + version, atomically; `stale` on a wrong version or once an outcome exists. */
  recordOutcome(organizationId: string, agreementId: string, input: OutcomeWriteInput, at: Date): Promise<OutcomeWriteResult>;
  /**
   * MUT-100: replaces a recorded outcome atomically — a full credit on the replaced commission's receivable, its
   * installment voided, the new outcome, terms, line and totals. Refuses with `has_payments` (writing nothing) when
   * that receivable was paid or credited, re-checked under its row lock; `stale` on a wrong version or no outcome.
   */
  correctOutcome(organizationId: string, agreementId: string, input: CorrectOutcomeInput, at: Date): Promise<CorrectOutcomeResult>;
  /** Stored versions (≥ 2) in version order; version 1 is synthesized from the agreement by the domain. */
  listVersions(organizationId: string, agreementId: string): Promise<RetainerVersionRecord[]>;
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

/** MUT-65: a bare "Owed" receivable, written directly (not through an Agreement/Installment). */
export interface CreateAdjustmentReceivableInput {
  organizationId: string;
  customerId: string;
  /** Null when captured with no matter. */
  projectId: string | null;
  currency: string;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  vatRateBasisPoints: number;
  title: string | null;
  dueDate: IsoDate;
  postingDate: IsoDate;
  postedAt: Date;
  createdByUserId: string;
  requestId: string | null;
}

export interface ReceivableRepository {
  getById(organizationId: string, id: string): Promise<ReceivableRecord | null>;
  /** In the order of `ids`; unknown or foreign ids are skipped. */
  getByIds(organizationId: string, ids: readonly string[]): Promise<ReceivableRecord[]>;
  /**
   * Like `getById`, but a soft-deleted row is still returned (MUT-65). Exists
   * solely so `DELETE /v1/income/{id}` can re-check its ownership/origin
   * guard on a repeat call against an already-voided row and answer 204
   * again, rather than 404 — every other reader keeps using `getById`/`list`,
   * which rightly hide a deleted row.
   */
  getByIdIncludingDeleted(organizationId: string, id: string): Promise<ReceivableRecord | null>;
  list(organizationId: string, filter: ReceivableFilter, page: PageRequest): Promise<Page<ReceivableRecord>>;
  /** OPEN receivables of the customer in the currency with outstanding > 0 — what a payment may be allocated to (M4). */
  listEligible(organizationId: string, customerId: string, currency: string): Promise<ReceivableRecord[]>;
  /** OPEN receivables with outstanding > 0 on the project (archive guard). */
  countOutstandingByProject(organizationId: string, projectId: string): Promise<number>;
  /** Appends a credit and moves credited_minor / status atomically; throws InsufficientCapacity if it exceeds the outstanding (M4). */
  credit(organizationId: string, receivableId: string, input: CreditInput, at: Date): Promise<{ receivable: ReceivableRecord; credit: CreditRecord } | null>;
  listCredits(organizationId: string, receivableId: string): Promise<CreditRecord[]>;
  /** MUT-65: "Owed", written directly as origin ADJUSTMENT, agreementId null. */
  createAdjustment(input: CreateAdjustmentReceivableInput, at: Date): Promise<ReceivableRecord>;
  /**
   * MUT-65 undo: a soft-delete that refuses a receivable money has landed on.
   * The caller (routes/income.ts) checks `origin === 'ADJUSTMENT'` and the
   * ownership rule; the `paidMinor === 0n && creditedMinor === 0n` part is
   * re-asserted here, atomically, so a settle landing between that check and
   * this write cannot hide a row a POSTED payment is allocated to.
   *
   * Null for an id the organization never had. Otherwise the record as it now
   * stands: `deletedAt` set means it was voided (or already was); `deletedAt`
   * still null means the money guard refused, and the caller answers 409
   * ALREADY_SETTLED.
   */
  softDeleteAdjustment(organizationId: string, id: string, at: Date): Promise<ReceivableRecord | null>;
  /**
   * MUT-223: moves an Owed entry's `postingDate`, keeping `dueDate`, and bumps `version`. One conditional write: only a
   * live ADJUSTMENT row this user created, at `expectedVersion`. `not_found` covers every other row, so a stale
   * answer never reveals a row the user may not touch.
   */
  redateAdjustment(organizationId: string, id: string, userId: string, expectedVersion: number, postingDate: IsoDate): Promise<UpdateResult<ReceivableRecord>>;
}

// ---- Milestone 4: payments, allocations, credits ----------------------------

export type PaymentMethod = 'CASH' | 'BANK';
export type PaymentStatus = 'POSTED' | 'REVERSED';
/** MUT-61: who put a payment on the ledger. */
export type PaymentOrigin = 'INTEGRATION' | 'CAPTURE';

export interface PaymentRecord {
  id: string;
  organizationId: string;
  /** Null for "Received" with no client (MUT-65); always set for a Malafat-fed payment. */
  customerId: string | null;
  /** Optional matter the money is for (MUT-65). Never set by a Malafat-fed payment, which carries the link through its allocations instead. */
  projectId: string | null;
  /** PAY-YYYY-NNNN, gap-free per organization and year. */
  number: string;
  currency: string;
  amountMinor: bigint;
  /** Σ allocations; unallocated = amount − allocated. 0 once reversed. */
  allocatedMinor: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  reversedAt: Date | null;
  reversalReason: string | null;
  replacesPaymentId: string | null;
  requestId: string | null;
  /** Who captured it (MUT-65); null for a Malafat-fed payment, which has no session actor. */
  createdByUserId: string | null;
  /** MUT-61: INTEGRATION when Malafat's key recorded it, CAPTURE when a person did. */
  origin: PaymentOrigin;
  /** MUT-61: the capture surface (CaptureSourceSchema), or null — always null for INTEGRATION. */
  captureSource: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AllocationRecord {
  id: string;
  organizationId: string;
  paymentId: string;
  receivableId: string;
  amountMinor: bigint;
  createdAt: Date;
}

export interface AllocationInput {
  receivableId: string;
  amountMinor: bigint;
}

export interface CreatePaymentInput {
  organizationId: string;
  customerId: string | null;
  projectId: string | null;
  currency: string;
  amountMinor: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  replacesPaymentId: string | null;
  requestId: string | null;
  createdByUserId: string | null;
  /** MUT-61: required, so every writer says which it is. */
  origin: PaymentOrigin;
  captureSource: string | null;
  allocations: AllocationInput[];
}

/**
 * MUT-61: a person's own "Received" — what `payments.capture` accepts. No
 * allocations, no replacement, no bank reference: by type, not by convention,
 * so the store-guard row that admits it (`capture`) can never write anything
 * Malafat would have to untangle.
 */
export interface CaptureReceivedInput {
  organizationId: string;
  customerId: string | null;
  projectId: string | null;
  currency: string;
  amountMinor: bigint;
  receivedOn: IsoDate;
  method: PaymentMethod;
  notes: string | null;
  requestId: string | null;
  createdByUserId: string;
  captureSource: string | null;
}

/** The reversal reason `payments.undoCapture` records (and the route audits). */
export const CAPTURE_UNDO_REASON = 'capture_undo';

/**
 * MUT-61: what `payments.undoCapture` did. `not-found` covers every payment that
 * is not this person's own capture in this organization, so a caller cannot
 * probe for other people's payments. `already-reversed` is only this person's own earlier undo; a capture the
 * integration reversed (any other reason) is `reversed-elsewhere`, so the person is never told they undid it.
 */
export type UndoCaptureResult = 'reversed' | 'already-reversed' | 'reversed-elsewhere' | 'allocated' | 'not-found';

export interface CreditInput {
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  reason: string;
  effectiveDate: IsoDate;
  requestId: string | null;
}

export interface CreditRecord extends CreditInput {
  id: string;
  organizationId: string;
  receivableId: string;
  createdAt: Date;
}

/**
 * MUT-61: how much of a payment is applied — `allocationStateOf` (payments/allocation-state.ts). A REVERSED payment
 * reads `unallocated` (reverse() zeroes allocatedMinor); the `allocationState` list filter matches POSTED payments only.
 */
export type AllocationState = 'unallocated' | 'partial' | 'allocated';

export interface PaymentFilter {
  customerId?: string;
  /**
   * A payment with at least one allocation on this project, OR (MUT-65) one whose own `projectId` names it — the
   * latter only while it has no allocations at all (MUT-61 D2): a captured matter is a hint until Malafat allocates.
   */
  projectId?: string;
  /** MUT-61. */
  origin?: PaymentOrigin;
  /** MUT-61: implies status POSTED. */
  allocationState?: AllocationState;
  status?: PaymentStatus;
  receivedBefore?: IsoDate;
  receivedAfter?: IsoDate;
}

export interface PaymentRepository {
  /**
   * Payment + allocations + receivable sums/status + number, one transaction.
   * Throws InsufficientCapacity when a receivable can no longer absorb its allocation (a race the preview token did not catch).
   */
  create(input: CreatePaymentInput, at: Date): Promise<{ payment: PaymentRecord; allocations: AllocationRecord[] }>;
  getById(organizationId: string, id: string): Promise<PaymentRecord | null>;
  list(organizationId: string, filter: PaymentFilter, page: PageRequest): Promise<Page<PaymentRecord>>;
  listAllocations(organizationId: string, paymentId: string): Promise<AllocationRecord[]>;
  /** Appends allocations to a POSTED payment within its unallocated funds; same guarantees as create. Null when no such payment. */
  allocate(organizationId: string, paymentId: string, allocations: AllocationInput[], at: Date): Promise<{ payment: PaymentRecord; allocations: AllocationRecord[] } | null>;
  /** Undoes every allocation, zeroes allocated_minor, marks REVERSED. `changed` is false when it already was. */
  reverse(organizationId: string, paymentId: string, reason: string, at: Date): Promise<{ payment: PaymentRecord; changed: boolean } | null>;
  /** The POSTED payment that names this one as replacesPaymentId, if any. */
  findReplacedBy(organizationId: string, paymentId: string): Promise<PaymentRecord | null>;
  /** MUT-61: a person's own Received — POSTED, origin CAPTURE, no allocations. Same numbering as create. */
  capture(input: CaptureReceivedInput, at: Date): Promise<PaymentRecord>;
  /**
   * MUT-61: reverse this person's own capture, only while nothing is allocated — one conditional write, so an
   * allocation that lands at the same moment either wins (→ `allocated`) or finds the payment reversed. Never
   * unwinds an allocation, unlike `reverse`.
   */
  undoCapture(organizationId: string, paymentId: string, userId: string, at: Date): Promise<{ result: UndoCaptureResult; payment: PaymentRecord | null }>;
  /**
   * MUT-223: moves a POSTED CAPTURE payment's `receivedOn` (allocations untouched) and bumps `version`; same
   * conditional-write and `not_found` rules as `receivables.redateAdjustment`. The number keeps its year.
   */
  redateCapture(organizationId: string, paymentId: string, userId: string, expectedVersion: number, receivedOn: IsoDate, at: Date): Promise<UpdateResult<PaymentRecord>>;
}

export interface ExternalReferenceRepository {
  link(input: LinkExternalReferenceInput, at: Date): Promise<ExternalReferenceRecord>;
  findByExternalId(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalId: string): Promise<ExternalReferenceRecord | null>;
  findByExternalIds(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalIds: string[]): Promise<ExternalReferenceRecord[]>;
  findByEntities(organizationId: string, entityType: ExternalEntityType, entityIds: string[]): Promise<ExternalReferenceRecord[]>;
}

// ---- MUT-37: operator-provisioned users and memberships (ADR-037) -----------

export type UserStatus = 'ACTIVE' | 'DISABLED';
export type UserLocale = 'en' | 'ar';

/**
 * A person who may sign in to the hosted portal. Not organization-scoped: one
 * person can belong to several firms through memberships. `email` is stored
 * normalised (auth/users.ts `normalizeEmail`); callers normalise before lookup.
 * `failedSignIns` / `lockedUntil` / `lastSignInAt` are written by sign-in (MUT-38).
 */
export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  /** MUT-235: null until the person sets one through their setup link, and after an operator reset with `lock`. */
  passwordHash: string | null;
  locale: UserLocale;
  status: UserStatus;
  failedSignIns: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
  lastSignInAt: Date | null;
  /** MUT-191: the Malafat suggestion preferences; null until the person first changes them (= on, nothing dismissed). */
  malafatSuggestions: MalafatSuggestionsRecord | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A contextual Malafat suggestion a person can retire (MUT-189). */
export type MalafatMoment = 'business-profile' | 'client-threshold' | 'second-business';

export interface MalafatSuggestionsRecord {
  off: boolean;
  /** Retired for good; only ever grows. Stored in the moments' fixed order. */
  dismissed: MalafatMoment[];
}

/** One change: switch on/off, and/or retire moments (added to what is stored, never replacing it). */
export interface MalafatSuggestionsChange {
  off?: boolean;
  dismiss?: MalafatMoment[];
}

/**
 * A user is always created with their personal organization (MUT-120) and its
 * membership, plus a firm membership when `organizationId` is given, in one
 * transaction. The caller names the personal organization; the store marks it.
 */
export interface CreateUserInput {
  email: string;
  displayName: string;
  /** MUT-235: the operator surface always passes null; the person sets a password through their setup link. */
  passwordHash: string | null;
  locale: UserLocale;
  /** The firm this user belongs to, if any. */
  organizationId?: string;
  personal: { name: string; slug: string; defaultCurrency: string; timezone: string };
  /**
   * MUT-235 (review fix): the person's first setup link, written in the same transaction as the user, so a
   * create never leaves an account with neither a password nor a link. UniqueViolation on a duplicate digest.
   */
  setupLink?: { tokenDigest: string; purpose: SetupLinkPurpose; expiresAt: Date };
  at: Date;
}

/** The access join: a user may see an organization's hosted profile. Access/no-access only. */
export interface MembershipRecord {
  userId: string;
  organizationId: string;
  createdAt: Date;
}

export interface UserRepository {
  /**
   * UniqueViolation on email; ForeignKeyViolation on an unknown organization. Either way
   * nothing is left behind. `memberships` is the personal one first, then the firm's.
   */
  create(input: CreateUserInput): Promise<{ user: UserRecord; memberships: MembershipRecord[]; personalOrganization: Organization }>;
  getById(id: string): Promise<UserRecord | null>;
  findByEmail(normalizedEmail: string): Promise<UserRecord | null>;
  /** Replaces the hash, stamps passwordChangedAt and clears failedSignIns / lockedUntil. */
  setPassword(id: string, passwordHash: string, at: Date): Promise<UserRecord | null>;
  setStatus(id: string, status: UserStatus, at: Date): Promise<UserRecord | null>;
  /** MUT-38: one more failed sign-in; `lockUntil` persists a lock when the throttle just imposed one. */
  recordFailedSignIn(id: string, at: Date, lockUntil: Date | null): Promise<UserRecord | null>;
  /** MUT-38: stamps lastSignInAt and clears failedSignIns / lockedUntil. */
  recordSignIn(id: string, at: Date): Promise<UserRecord | null>;
  /**
   * MUT-191: applies one change atomically: `off` replaces, `dismiss` is unioned into what is stored, so two
   * devices or tabs never undo each other's dismissals. Null for an unknown user.
   */
  updateMalafatSuggestions(id: string, change: MalafatSuggestionsChange, at: Date): Promise<UserRecord | null>;
  /**
   * MUT-237: a signed-in person changes their own password. One transaction under the same row-lock
   * discipline ADR-088 §7a added for `--lock`/redeem: sets the password (clearing any lockout), revokes
   * every other session for this user — web and device, `exceptSessionId` stays live — and appends `audit`.
   * Null for an unknown user. StateConflict('user', 'CREDENTIAL_CHANGED') and nothing written when, under the
   * lock, the stored hash is no longer `verifiedPasswordHash` or `exceptSessionId` is not this person's live
   * session: another change (or an operator lock) committed first (MUT-238 review).
   */
  changePassword(input: ChangePasswordInput): Promise<UserRecord | null>;
}

export interface ChangePasswordInput {
  userId: string;
  passwordHash: string;
  /** The hash the caller's current password was verified against; the change is refused if it moved since. */
  verifiedPasswordHash: string;
  /** This session keeps working; every other session for this user is revoked. Must be the caller's own live session. */
  exceptSessionId: string;
  at: Date;
  /** Written in the same transaction. */
  audit: AuditEventInput[];
}

export interface MembershipRepository {
  /** Idempotent: an existing membership is returned unchanged with `created: false`. ForeignKeyViolation on an unknown user or organization. */
  grant(userId: string, organizationId: string, at: Date): Promise<{ membership: MembershipRecord; created: boolean }>;
  /** True when a membership was removed. */
  revoke(userId: string, organizationId: string): Promise<boolean>;
  find(userId: string, organizationId: string): Promise<MembershipRecord | null>;
  /** Oldest first. */
  listByUser(userId: string): Promise<MembershipRecord[]>;
  /** Oldest first. */
  listByOrganization(organizationId: string): Promise<MembershipRecord[]>;
}

// ---- MUT-38: browser sessions (ADR-037 decision 3) -------------------------

/** A server-side session. Only the HMAC digest of the cookie token is stored. */
export interface SessionRecord {
  id: string;
  userId: string;
  tokenDigest: string;
  /** cookie: the browser portal session; device: a native app's bearer token (MUT-64). */
  kind: SessionKind;
  createdAt: Date;
  /**
   * MUT-237: when this session last proved the person's current password, `createdAt` at sign-in. The session
   * middleware refuses one older than the person's `passwordChangedAt`; changing your own password re-stamps the
   * kept session, so it survives the change while every other one fails. Never moves either deadline.
   */
  credentialsVerifiedAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  userAgent: string | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenDigest: string;
  kind: SessionKind;
  at: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
  /**
   * MUT-235 review: the hash sign-in just verified. When given, the session is created only while the person is
   * ACTIVE and still has exactly this hash, checked under a shared lock on their row, so it waits for a concurrent
   * lock or redeem to commit. Otherwise StateConflict('user', 'CREDENTIAL_CHANGED') and nothing is written.
   */
  verifiedPasswordHash?: string;
}

export interface SessionRepository {
  /** UniqueViolation on a duplicate digest; ForeignKeyViolation on an unknown user. */
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findByDigest(tokenDigest: string): Promise<SessionRecord | null>;
  touch(id: string, at: Date, idleExpiresAt: Date): Promise<void>;
  /** The first revocation wins (time and reason are kept). Null for an unknown id. */
  revoke(id: string, reason: string, at: Date): Promise<SessionRecord | null>;
  /** Revokes the user's live sessions; returns how many. */
  revokeAllForUser(userId: string, reason: string, at: Date): Promise<number>;
}

// ---- MUT-235: one-time setup links (ADR-088) --------------------------------

/** SETUP: a person's first password. RESET: an operator reset of an existing one. */
export type SetupLinkPurpose = 'SETUP' | 'RESET';

/** A setup link. Only the HMAC digest of its token is stored; at most one of `usedAt` / `cancelledAt` is ever set. */
export interface AccountSetupTokenRecord {
  id: string;
  userId: string;
  tokenDigest: string;
  purpose: SetupLinkPurpose;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  /** Set when a newer link for the same person replaced this one. */
  cancelledAt: Date | null;
}

export interface IssueSetupLinkInput {
  userId: string;
  tokenDigest: string;
  purpose: SetupLinkPurpose;
  at: Date;
  expiresAt: Date;
  /** D2: a suspected takeover — clear the password and revoke every session in the same transaction. */
  lock: boolean;
  /** Written in the same transaction. */
  audit: AuditEventInput[];
}

export interface RedeemSetupLinkInput {
  tokenDigest: string;
  passwordHash: string;
  at: Date;
  /** Written in the same transaction, only when the claim wins. */
  audit: AuditEventInput[];
}

export interface AccountSetupRepository {
  /**
   * One transaction under a lock on the user's row: cancels the user's open links,
   * then creates this one, so a person never has two open links. ForeignKeyViolation on an unknown user.
   */
  issue(input: IssueSetupLinkInput): Promise<AccountSetupTokenRecord>;
  findByDigest(tokenDigest: string): Promise<AccountSetupTokenRecord | null>;
  /**
   * One transaction: claims the link only if it is unused, not cancelled, not expired at `at`, and its
   * user is ACTIVE; then sets the password (clearing any lockout), revokes every session ('password_set')
   * and appends `audit`. Null when the claim loses — nothing is written; the caller reads the link again
   * to say why. Of two concurrent redeems of one link, exactly one wins.
   */
  redeem(input: RedeemSetupLinkInput): Promise<UserRecord | null>;
}

export interface LedgerStore {
  organizations: OrganizationRepository;
  apiKeys: ApiKeyRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  sessions: SessionRepository;
  /** MUT-235: one-time setup links. Operator-only below the routes; the two public setup routes run unguarded, like sign-in. */
  accountSetup: AccountSetupRepository;
  integrations: IntegrationRepository;
  audit: AuditRepository;
  idempotency: IdempotencyRepository;
  customers: CustomerRepository;
  projects: ProjectRepository;
  externalReferences: ExternalReferenceRepository;
  vatRates: VatRateRepository;
  agreements: AgreementRepository;
  receivables: ReceivableRepository;
  payments: PaymentRepository;
  /** Liveness of the backing store, for /ready. */
  ping(): Promise<void>;
  attachments: AttachmentRepository;
  feeProposals: FeeProposalRepository;
  /** MUT-42: expenses on hosted profiles; session-only, invisible to API keys (store guard `{ read: 'expenses' }`). */
  expenses: ExpenseRepository;
  expenseCategories: ExpenseCategoryRepository;
  expenseReceipts: ExpenseReceiptRepository;
  /** MUT-66: the unsorted inbox — the one repository scoped by user, not by organization. */
  inboxEntries: InboxEntryRepository;
  /** MUT-131: idempotency for organization-independent writes (POST /v1/inbox's create). */
  userIdempotency: UserIdempotencyRepository;
  /** MUT-161: conversions on hosted profiles; session-only, invisible to API keys (store guard `conversions`). MUT-194: optimistic update and soft delete, like expenses. */
  conversions: ConversionRepository;
  /** MUT-270: one newest-first feed across a person's profiles; session-only (store guard `sessionOnly`). */
  entries: EntriesRepository;
}

// ---- Milestone 7: fee proposals (negotiations before an agreement) ----------

export type FeeProposalStatus = 'PROPOSED' | 'APPROVED' | 'WITHDRAWN';

/**
 * One proposed fee on a project, taken by hand through the client's approval
 * or an explicitly agreed figure, and converted into a fixed-fee agreement by
 * the wizard (M7 brief §3). Amounts are minor units in the project currency.
 */
export interface FeeProposalRecord {
  id: string;
  organizationId: string;
  projectId: string;
  customerId: string;
  currency: string;
  status: FeeProposalStatus;
  pricingBasis: PricingBasis;
  proposedAmountMinor: bigint;
  proposedOn: IsoDate;
  note: string | null;
  /** The approval date; the agreement is dated the same (M8, D18). */
  clientApprovedOn: IsoDate | null;
  clientApprovalNote: string | null;
  /** Null while PROPOSED or WITHDRAWN; the final amount once APPROVED (the proposed one, or the figure typed at approval). */
  agreedAmountMinor: bigint | null;
  withdrawnAt: Date | null;
  withdrawnReason: string | null;
  /** The agreement the approval created (APPROVED). */
  agreementId: string | null;
  /** MUT-107: both set on a contingency proposal, both null on a FIXED one. */
  commissionRateBasisPoints: number | null;
  upfrontTreatment: UpfrontTreatment | null;
  requestId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFeeProposalInput {
  organizationId: string;
  projectId: string;
  customerId: string;
  currency: string;
  pricingBasis: PricingBasis;
  proposedAmountMinor: bigint;
  proposedOn: IsoDate;
  note: string | null;
  /** MUT-107: present together = a contingency proposal (the upfront is proposedAmountMinor); absent = FIXED. */
  commissionRateBasisPoints?: number;
  upfrontTreatment?: UpfrontTreatment;
  requestId: string | null;
}

export interface FeeProposalFilter {
  projectId?: string;
  customerId?: string;
  status?: FeeProposalStatus;
  /** PROPOSED. */
  open?: boolean;
}

/** What a transition writes; `status` is the target state. */
export interface FeeProposalTransitionPatch {
  status: FeeProposalStatus;
  clientApprovedOn?: IsoDate | null;
  clientApprovalNote?: string | null;
  agreedAmountMinor?: bigint | null;
  withdrawnAt?: Date | null;
  withdrawnReason?: string | null;
  agreementId?: string | null;
}

export type TransitionResult<T> = { kind: 'updated'; record: T } | { kind: 'wrong_status'; record: T } | { kind: 'not_found' };

export interface FeeProposalRepository {
  /** Refuses a second open proposal on the project with UniqueViolation('fee_proposals.open_per_project'). */
  create(input: CreateFeeProposalInput, at: Date): Promise<FeeProposalRecord>;
  getById(organizationId: string, id: string): Promise<FeeProposalRecord | null>;
  list(organizationId: string, filter: FeeProposalFilter, page: PageRequest): Promise<Page<FeeProposalRecord>>;
  findOpenByProject(organizationId: string, projectId: string): Promise<FeeProposalRecord | null>;
  /** Conditional on the current status being one of `from`; bumps the version. */
  transition(organizationId: string, id: string, from: readonly FeeProposalStatus[], patch: FeeProposalTransitionPatch, at: Date): Promise<TransitionResult<FeeProposalRecord>>;
}

// ---- MUT-42: expenses on hosted profiles ------------------------------------

/**
 * One expense, in its original amount and currency (never converted). Mirrors
 * the offline `Expense`: `customerId` is the offline `clientId`, `occurredOn`
 * the offline `occurredAt` used as a date. Personal versus firm-associated is
 * the profile it belongs to, optionally narrowed by customer/project — there is
 * no classification field.
 */
export interface ExpenseRecord {
  id: string;
  organizationId: string;
  occurredOn: IsoDate;
  amountMinor: bigint;
  currency: string;
  title: string | null;
  vendor: string | null;
  categoryId: string | null;
  customerId: string | null;
  projectId: string | null;
  notes: string | null;
  createdByUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateExpenseInput {
  organizationId: string;
  occurredOn: IsoDate;
  amountMinor: bigint;
  currency: string;
  title: string | null;
  vendor: string | null;
  categoryId: string | null;
  customerId: string | null;
  projectId: string | null;
  notes: string | null;
  createdByUserId: string;
}

/** Absent key = unchanged; null = cleared. The currency never changes after create. */
export type UpdateExpensePatch = Partial<Pick<CreateExpenseInput, 'occurredOn' | 'amountMinor' | 'title' | 'vendor' | 'categoryId' | 'customerId' | 'projectId' | 'notes'>>;

export interface ExpenseFilter {
  /** Inclusive. */
  from?: IsoDate;
  /** Inclusive. */
  to?: IsoDate;
  currency?: string;
  categoryId?: string;
  customerId?: string;
  projectId?: string;
  /** Only expenses linked to no customer (the firm's own or personal spending). */
  unlinked?: boolean;
}

/** Expenses page newest first: (occurredOn, id) descending. */
export interface ExpenseCursor {
  occurredOn: IsoDate;
  id: string;
  /** Include the cursor's own row: the page starts AT it (MUT-91 `anchor`). Absent = strictly after, as every issued cursor is. */
  inclusive?: boolean;
}

export interface ExpensePage {
  items: ExpenseRecord[];
  nextCursor: ExpenseCursor | null;
}

export interface ExpenseRepository {
  create(input: CreateExpenseInput, at: Date): Promise<ExpenseRecord>;
  /** Live expenses only; a deleted one reads null. */
  getById(organizationId: string, id: string): Promise<ExpenseRecord | null>;
  list(organizationId: string, filter: ExpenseFilter, page: { limit: number; cursor: ExpenseCursor | null }): Promise<ExpensePage>;
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateExpensePatch, at: Date): Promise<UpdateResult<ExpenseRecord>>;
  /** Null for an id the organization never had; `changed: false` when it was already deleted. */
  softDelete(organizationId: string, id: string, at: Date): Promise<{ record: ExpenseRecord; changed: boolean } | null>;
}

/** MUT-161: a logged currency conversion. MUT-194 (ADR-075): versioned and soft-deleted, like Expense. */
export interface ConversionRecord {
  id: string;
  organizationId: string;
  occurredOn: IsoDate;
  /** The source leg. */
  amountMinor: bigint;
  currency: string;
  /** The destination leg. Never equal to `currency`. */
  toAmountMinor: bigint;
  toCurrency: string;
  notes: string | null;
  createdByUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateConversionInput {
  organizationId: string;
  occurredOn: IsoDate;
  amountMinor: bigint;
  currency: string;
  toAmountMinor: bigint;
  toCurrency: string;
  notes: string | null;
  createdByUserId: string;
}

/**
 * MUT-194: absent key = unchanged; null clears `notes`. A currency never travels without its
 * amount (the route's conversionPatch refuses that), so a leg's minor units always match its currency.
 */
export type UpdateConversionPatch = Partial<Pick<CreateConversionInput, 'occurredOn' | 'amountMinor' | 'currency' | 'toAmountMinor' | 'toCurrency' | 'notes'>>;

export interface ConversionFilter {
  /** Inclusive. */
  from?: IsoDate;
  /** Inclusive. */
  to?: IsoDate;
  /** Matches either leg's currency. */
  currency?: string;
}

/** Conversions page newest first: (occurredOn, id) descending. */
export interface ConversionCursor {
  occurredOn: IsoDate;
  id: string;
  /** Include the cursor's own row: the page starts AT it (MUT-91 `anchor`). Absent = strictly after, as every issued cursor is. */
  inclusive?: boolean;
}

export interface ConversionPage {
  items: ConversionRecord[];
  nextCursor: ConversionCursor | null;
}

export interface ConversionRepository {
  create(input: CreateConversionInput, at: Date): Promise<ConversionRecord>;
  /** Live conversions only; a deleted one reads null. */
  getById(organizationId: string, id: string): Promise<ConversionRecord | null>;
  list(organizationId: string, filter: ConversionFilter, page: { limit: number; cursor: ConversionCursor | null }): Promise<ConversionPage>;
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateConversionPatch, at: Date): Promise<UpdateResult<ConversionRecord>>;
  /** Null for an id the organization never had; `changed: false` when it was already deleted. */
  softDelete(organizationId: string, id: string, at: Date): Promise<{ record: ConversionRecord; changed: boolean } | null>;
}

export interface ExpenseCategoryRecord {
  id: string;
  organizationId: string;
  name: string;
  /** `#rrggbb`, as offline. */
  color: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseCategoryInput {
  name: string;
  color: string | null;
}

export interface UpdateExpenseCategoryPatch {
  name?: string;
  color?: string | null;
  archived?: boolean;
}

export interface ExpenseCategoryRepository {
  /** UniqueViolation('expense_categories.name') when the name is taken in the organization, case-insensitively. */
  create(organizationId: string, input: ExpenseCategoryInput, at: Date): Promise<ExpenseCategoryRecord>;
  getById(organizationId: string, id: string): Promise<ExpenseCategoryRecord | null>;
  /** Creation order. */
  list(organizationId: string, options: { includeArchived: boolean }): Promise<ExpenseCategoryRecord[]>;
  /**
   * Inserts the preset only into an organization with no categories at all; true when it did. Concurrent seeds insert it once.
   * Holds the organization's row (MUT-182 D3), so a seed and a type change (`organizations.updateOwned`) never interleave.
   */
  seed(organizationId: string, preset: readonly ExpenseCategoryInput[], at: Date): Promise<boolean>;
  /** UniqueViolation on a rename onto a taken name. */
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateExpenseCategoryPatch, at: Date): Promise<UpdateResult<ExpenseCategoryRecord>>;
}

/** A receipt file behind the M6 signed-URL pipeline, in its own table so Malafat's attachment routes can never reach it (MUT-42 D1). */
export interface ExpenseReceiptRecord {
  id: string;
  organizationId: string;
  expenseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  storageKey: string;
  uploadedByUserId: string;
  requestId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateExpenseReceiptInput {
  organizationId: string;
  expenseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  requestId: string | null;
}

export interface ExpenseReceiptRepository {
  /** Created with a placeholder key; the caller derives the real key from the id and `setKey`s it (as M6). */
  create(input: CreateExpenseReceiptInput, at: Date): Promise<ExpenseReceiptRecord>;
  setKey(organizationId: string, id: string, storageKey: string): Promise<ExpenseReceiptRecord | null>;
  /** Live receipts only. */
  getById(organizationId: string, id: string): Promise<ExpenseReceiptRecord | null>;
  /** READY, live receipts of one expense, oldest first. */
  listByExpense(organizationId: string, expenseId: string): Promise<ExpenseReceiptRecord[]>;
  complete(organizationId: string, id: string, at: Date): Promise<ExpenseReceiptRecord | null>;
  softDelete(organizationId: string, id: string, at: Date): Promise<ExpenseReceiptRecord | null>;
  /** Every live receipt of the expense, pending ones included; returns those it deleted (their objects are removed by the caller). */
  softDeleteByExpense(organizationId: string, expenseId: string, at: Date): Promise<ExpenseReceiptRecord[]>;
  /**
   * MUT-270: READY, live receipts per expense, the same rule as `listByExpense`. Expenses with none are absent from
   * the map. The caller passes organizations the person belongs to; the expense ids come from those organizations.
   */
  countReadyByExpenseIds(organizationIds: readonly string[], expenseIds: readonly string[]): Promise<Map<string, number>>;
}

// ---- MUT-270: the entries feed ----------------------------------------------

/**
 * One row of the feed, before serialization. Receivables are ADJUSTMENT ("Owed" a person recorded) only; payments
 * leave out capture undos. Ordered by (createdAt, id) descending across kinds.
 */
export type EntryRow =
  | { kind: 'expense'; record: ExpenseRecord }
  | { kind: 'payment'; record: PaymentRecord }
  | { kind: 'receivable'; record: ReceivableRecord }
  | { kind: 'conversion'; record: ConversionRecord };

export interface EntriesRepository {
  /**
   * Newest first, (createdAt, id) descending, strictly after `page.cursor`. Trusts `organizationIds`: the route
   * resolves them from the person's memberships. Never lazy-posts (MUT-270 D2): a read here never writes.
   */
  list(organizationIds: readonly string[], page: PageRequest): Promise<Page<EntryRow>>;
}

// ---- MUT-66: the unsorted inbox ---------------------------------------------

/**
 * Which of the two filing routes an entry is destined for. Coarser than
 * MUT-65's `received | owed`: that finer choice needs a client (or its
 * deliberate absence) in the picture, and an unsorted entry never carries one,
 * so it is made at filing time, not at capture.
 */
export type InboxEntryKind = 'INCOME' | 'EXPENSE';

/**
 * One unsorted capture: an amount the person knows happened, before they have
 * decided which profile it belongs to. The only user-owned row in the ledger —
 * there is no `organizationId` here, and that absence is load-bearing (see
 * `InboxEntryRepository`).
 */
export interface InboxEntryRecord {
  id: string;
  userId: string;
  kind: InboxEntryKind;
  amountMinor: bigint;
  currency: string;
  /** As the capturing device understood it; validated against a profile's timezone only at filing time. */
  occurredOn: IsoDate;
  note: string | null;
  /** Persisted, not just audit metadata: an entry can sit unfiled, and the UI keeps showing how it arrived. */
  captureSource: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInboxEntryInput {
  userId: string;
  kind: InboxEntryKind;
  amountMinor: bigint;
  currency: string;
  occurredOn: IsoDate;
  note: string | null;
  captureSource: string | null;
}

/**
 * Absent key = unchanged; null clears an optional field. `kind` is deliberately
 * absent: it is fixed at create, the same convention `Expense.currency` uses —
 * an entry captured as money-out does not become money-in by an edit.
 */
export type UpdateInboxEntryPatch = Partial<Pick<CreateInboxEntryInput, 'amountMinor' | 'currency' | 'occurredOn' | 'note' | 'captureSource'>>;

/** Inbox page newest first: (createdAt, id) descending. */
export interface InboxEntryCursor {
  createdAt: Date;
  id: string;
}

export interface InboxEntryPage {
  items: InboxEntryRecord[];
  nextCursor: InboxEntryCursor | null;
}

/** The financial row a filing creates: MUT-65's two income shapes, already validated by the route. */
export type IncomeWriteInput = { kind: 'received'; payment: CreatePaymentInput } | { kind: 'owed'; receivable: CreateAdjustmentReceivableInput };

export type IncomeWriteResult = { kind: 'received'; payment: PaymentRecord; allocations: AllocationRecord[] } | { kind: 'owed'; receivable: ReceivableRecord };

/**
 * The unsorted inbox (MUT-66). Every method is scoped by `userId` — never by
 * `organizationId` — so a cross-user read is impossible by construction, the
 * same guarantee ADR-025 point 2 gives the organization-scoped ledger, one
 * ownership axis over.
 *
 * The two `file*` methods are the only cross-repository transactions in this
 * store: they create the real record and delete the entry together, so the
 * ticket's "on success the entry is gone; on failure it stays untouched" holds
 * at the data layer, not merely by the order the route does things. All
 * destination-side validation (writability, link resolution, future dates)
 * happens in the route, before either is ever called.
 */
export interface InboxEntryRepository {
  create(input: CreateInboxEntryInput, at: Date): Promise<InboxEntryRecord>;
  getById(userId: string, id: string): Promise<InboxEntryRecord | null>;
  list(userId: string, page: { limit: number; cursor: InboxEntryCursor | null }): Promise<InboxEntryPage>;
  update(userId: string, id: string, expectedVersion: number, patch: UpdateInboxEntryPatch, at: Date): Promise<UpdateResult<InboxEntryRecord>>;
  /** Hard delete. False for an id this user never had, or already deleted — the two are never distinguished. */
  delete(userId: string, id: string): Promise<boolean>;
  /** One indexed COUNT(*), for the operator's per-user support figure. Never a list. */
  countByUser(userId: string): Promise<number>;
  /**
   * Atomic: creates the expense and deletes this entry in one transaction.
   * `not_found` covers an unknown id, another user's, the wrong kind, or one
   * already filed — never distinguished, the same non-leaking convention the
   * rest of the API uses.
   */
  fileAsExpense(params: { userId: string; inboxEntryId: string; kind: InboxEntryKind; expense: CreateExpenseInput }, at: Date): Promise<{ kind: 'filed'; expense: ExpenseRecord } | { kind: 'not_found' }>;
  /** The same shape for the Payment (received) or adjustment Receivable (owed) write. */
  fileAsIncome(params: { userId: string; inboxEntryId: string; kind: InboxEntryKind; write: IncomeWriteInput }, at: Date): Promise<{ kind: 'filed'; result: IncomeWriteResult } | { kind: 'not_found' }>;
}
