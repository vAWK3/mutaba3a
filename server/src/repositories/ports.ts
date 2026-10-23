import type { ApiKeyEnvironment } from '../auth/api-key.js';
import type { KeyScope } from '../auth/scopes.js';
import type { SessionKind } from '../auth/sessions.js';
import type { TermsLocale, TermsSurface } from '../legal.js';
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

/** MUT-300 (ADR-099): a member's role in a firm. Read only while the organization's firm features are on; inert elsewhere. */
export type MembershipRole = 'OWNER' | 'BOOKKEEPER' | 'SUBMITTER';

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
  /** MUT-300: firm features are on from this instant; null = off. Never set on the built-in personal profile. */
  firmEnabledAt: Date | null;
  /** MUT-300: an owner's pending request for firm features; cleared when an operator enables or declines it. */
  firmRequestedAt: Date | null;
  /** MUT-300: set exactly when firmRequestedAt is. */
  firmRequestedByUserId: string | null;
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

/** MUT-300: who a firm-switch write is attributed to. The owner's request is a USER row; an operator's change is ADMIN with no actor id. */
export interface FirmAudit {
  actorId: string | null;
  requestId: string | null;
}

export type RequestFirmResult =
  /** `created: false` when a request was already pending: it comes back unchanged, with no new audit row. */
  | { kind: 'requested'; organization: Organization; created: boolean }
  | { kind: 'already_firm' }
  | { kind: 'not_found' };

/** Enable names the owners of an operator firm; on an owned profile they're ignored and its owner is the OWNER (eng review D4). */
export type SetFirmInput = { enabled: true; ownerUserIds: string[] } | { enabled: false };

export type SetFirmResult =
  /** `changed: false` when the organization was already in the asked state: nothing written, no audit row. */
  | { kind: 'updated'; organization: Organization; changed: boolean }
  | { kind: 'not_found' }
  /** The built-in personal profile never gets firm features (CHECK organizations_firm_not_personal_check). */
  | { kind: 'personal_profile' }
  /** An owned profile typed PERSONAL: firm features are for Business profiles. */
  | { kind: 'not_business' }
  /** An operator firm with no owner named. */
  | { kind: 'owners_required' }
  /** Named owners who aren't members of the organization. */
  | { kind: 'not_a_member'; userIds: string[] };

export type DeclineFirmRequestResult = { kind: 'declined'; organization: Organization } | { kind: 'not_found' };

export type UpdateOwnedOrganizationResult =
  | { kind: 'updated'; record: Organization; typeChange: ProfileTypeChange | null }
  | { kind: 'stale'; record: Organization }
  /** MUT-373: a profile with more than one owner stays BUSINESS (checked under the row lock, outside voice OV3). */
  | { kind: 'co_owned' }
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
    /** MUT-373: the profile's creator or one of its co-owners (ownsProfile, in the query). */
    ownerUserId: string,
    expectedVersion: number,
    patch: UpdateOwnedOrganizationPatch,
    preset: readonly ExpenseCategoryInput[] | null,
    at: Date,
    audit: UpdateOwnedProfileAudit,
  ): Promise<UpdateOwnedOrganizationResult>;
  /** What a type change would do right now (the preview). */
  typeChangeImpact(id: string): Promise<ProfileTypeChange>;
  /**
   * MUT-300: records an owner's request for firm features, under the
   * organization's row lock, audited `firm.requested` in the same
   * transaction. Idempotent: a pending request comes back unchanged with no
   * new audit row. Doesn't bump `version` (eng review O3): it isn't a field
   * edit, so the owner's open edit form keeps its If-Match. Ownership and
   * profile kind are the route's checks.
   */
  requestFirm(id: string, userId: string, at: Date, audit: FirmAudit): Promise<RequestFirmResult>;
  /**
   * MUT-300 (operator): turns firm features on in place or off, under the
   * row lock, audited `firm.enabled` / `firm.disabled` in the same
   * transaction. Enabling clears a pending request and rewrites every
   * member's role: the owner of an owned profile and its co-owners (MUT-373),
   * or the named owners of an operator firm, OWNER; everyone else BOOKKEEPER. Disabling leaves roles as
   * they are (inert). One version bump per change.
   */
  setFirm(id: string, input: SetFirmInput, at: Date, audit: FirmAudit): Promise<SetFirmResult>;
  /** MUT-300 (operator, eng review D6): clears a pending request, audited `firm.request_declined`; not_found when nothing is pending. */
  declineFirmRequest(id: string, at: Date, audit: FirmAudit): Promise<DeclineFirmRequestResult>;
  /** MUT-300 (operator): pending requests (firm features still off), oldest request first; the cursor's createdAt is `firmRequestedAt`. */
  listFirmRequests(page: PageRequest): Promise<Page<Organization>>;
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
   * answer never reveals a row the user may not touch. MUT-392 (D3): a `dueDate`, when given, moves in the same write.
   */
  redateAdjustment(organizationId: string, id: string, userId: string, expectedVersion: number, postingDate: IsoDate, dueDate?: IsoDate): Promise<UpdateResult<ReceivableRecord>>;
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
  /**
   * MUT-300: OWNER by default, BOOKKEEPER for a new member of an organization whose firm features are on (eng review D3).
   * MUT-373: on an owned Business profile an OWNER member is a co-owner — read only through `ownsProfile`.
   */
  role: MembershipRole;
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
  /** MUT-324: the person's acceptance of the highest terms version they accepted; null if they never accepted any. */
  latestTermsAcceptance(userId: string): Promise<TermsAcceptanceRecord | null>;
  /**
   * MUT-324: idempotent on (userId, version): an existing acceptance is kept unchanged (`created: false`) and
   * `audit` is not written; otherwise the row and `audit` are written in one transaction. It answers only whether
   * the row is new: nobody reads the row back (review pass 2; `latestTermsAcceptance` reads it).
   * ForeignKeyViolation on an unknown user.
   */
  acceptTerms(input: AcceptTermsInput): Promise<{ created: boolean }>;
  /**
   * MUT-324 T1 (operator only): every user, ordered by email, with the highest terms version they accepted (null if
   * none) and, MUT-354, the client release recorded with that acceptance (null if none).
   */
  listLatestTermsVersions(): Promise<Array<{ userId: string; email: string; status: UserStatus; latestVersion: string | null; latestClientRelease: string | null }>>;
}

/** MUT-324 (ADR-102): one person's acceptance of one terms version, tied to the exact text by its sha256. */
export interface TermsAcceptanceRecord {
  userId: string;
  /** An ISO date: the version's name and its release order. */
  version: string;
  /** The language of the text the person read. */
  locale: TermsLocale;
  /** sha256 of that language's frozen content file (server/src/legal.ts). */
  textSha256: string;
  surface: TermsSurface;
  /** MUT-354: the client release that showed the terms, as the client sent it; null from a client that sent none. */
  clientRelease: string | null;
  acceptedAt: Date;
}

export interface TermsAcceptanceInput {
  version: string;
  locale: TermsLocale;
  textSha256: string;
  surface: TermsSurface;
  clientRelease: string | null;
}

export interface AcceptTermsInput extends TermsAcceptanceInput {
  userId: string;
  at: Date;
  /** Written in the same transaction, only when the acceptance is new. */
  audit: AuditEventInput[];
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

/** MUT-373: one owner of a profile, for /v1/me and the profile responses. */
export interface ProfileOwnerEntry {
  organizationId: string;
  userId: string;
  displayName: string;
  email: string;
  /** When their membership began, so owners list in the order they joined. */
  createdAt: Date;
}

export type GrantOwnerResult =
  | { kind: 'granted'; membership: MembershipRecord; created: boolean }
  | { kind: 'not_found' }
  /** The built-in personal profile: never anyone else's. */
  | { kind: 'personal_profile' }
  /** An owned profile typed PERSONAL. */
  | { kind: 'not_business' }
  /** Not an owned profile (an operator firm or a Malafat-fed one): roles on firms are MUT-305's. */
  | { kind: 'not_co_ownable' }
  /** The profile already has `max` owners, the creator included. */
  | { kind: 'limit'; count: number }
  /** Already a member with another role (eng review D7: role changes are MUT-305's). */
  | { kind: 'role_conflict'; role: MembershipRole };

export interface RemoveOwnerInput {
  organizationId: string;
  /** The owner leaving or being removed. */
  userId: string;
  /** Who asks: the same person (leave) or the profile's creator (remove). */
  actorId: string;
  at: Date;
  requestId: string | null;
}

export type RemoveOwnerResult =
  | { kind: 'removed'; reason: 'left' | 'removed' }
  /** The caller can't see the profile, or the person named isn't a co-owner of it. */
  | { kind: 'not_found' }
  /** The caller is a member but not an owner. */
  | { kind: 'not_owner' }
  /** The creator stays: there is no ownership transfer in v1 (eng review D3). */
  | { kind: 'creator_cannot_leave' }
  /** Only the creator removes someone else. */
  | { kind: 'not_creator' };

export interface MembershipRepository {
  /**
   * Idempotent: an existing membership is returned unchanged with `created: false`. ForeignKeyViolation on an unknown user or organization.
   * MUT-300: a new membership is BOOKKEEPER when the organization's firm features are on, OWNER otherwise (inert).
   */
  grant(userId: string, organizationId: string, at: Date): Promise<{ membership: MembershipRecord; created: boolean }>;
  /** True when a membership was removed. */
  revoke(userId: string, organizationId: string): Promise<boolean>;
  /**
   * MUT-373 (operator): makes `userId` a co-owner — an OWNER member — of an owned BUSINESS profile, in one
   * transaction holding the organization's row, so two grants can never pass `maxOwners` and a retype can't slip
   * in between (outside voice OV3). Idempotent for an existing OWNER. `audit` (`membership.granted`, role OWNER)
   * commits in the same transaction when the membership is created, and on a confirm when the person holds no such
   * row yet: pre-roll recognizes a co-owner only by it, so confirming a flagged membership must leave one.
   */
  grantOwner(userId: string, organizationId: string, at: Date, maxOwners: number, audit: AuditEventInput): Promise<GrantOwnerResult>;
  /**
   * MUT-373: a co-owner leaves, or the creator removes one, under the organization's row lock. Deletes the
   * membership only (their records stay, attributed to them) and writes `membership.revoked` (actor USER,
   * metadata.reason left|removed) in the same transaction (eng review A6).
   */
  removeOwner(input: RemoveOwnerInput): Promise<RemoveOwnerResult>;
  /** MUT-373: the OWNER members of these organizations, with their names, in one read; oldest membership first. */
  listOwnersOf(organizationIds: readonly string[]): Promise<ProfileOwnerEntry[]>;
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
  /**
   * MUT-324: the terms the person accepted on the setup page, recorded in the same transaction as the password.
   * Idempotent like `users.acceptTerms` (a reset link after acceptance must still work); `termsAudit` is written
   * only when the acceptance is new.
   */
  terms: TermsAcceptanceInput;
  termsAudit: AuditEventInput[];
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

// ---- MUT-358 (ADR-160): billing core ---------------------------------------

export type BillingTierRecord = 'FREELANCER' | 'FIRM';

/** One Stripe customer; `userId` is null until the operator (or MUT-360's checkout) links it to a person. */
export interface BillingAccountRecord {
  id: string;
  userId: string | null;
  stripeCustomerId: string;
  country: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A mirror of one Stripe subscription; `status` is Stripe's own string. */
export interface BillingSubscriptionRecord {
  id: string;
  billingAccountId: string;
  stripeSubscriptionId: string;
  tier: BillingTierRecord;
  organizationId: string | null;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceLookupKey: string | null;
  founderUntil: Date | null;
  stripeUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** An operator grant: exactly one of `userId` (the person's own profiles) and `organizationId` (that profile). */
export interface EntitlementGrantRecord {
  id: string;
  userId: string | null;
  organizationId: string | null;
  tier: BillingTierRecord;
  reason: string;
  expiresAt: Date | null;
  grantedBy: string;
  createdAt: Date;
  revokedAt: Date | null;
}

/** A subscription as coverage sees it: with the paying person (null while the customer is unlinked). */
export interface CoveringSubscriptionRecord extends BillingSubscriptionRecord {
  userId: string | null;
}

/** Everything that can cover a set of profiles, for `entitlementsFor` (billing/coverage.ts). */
export interface BillingFactsRecord {
  subscriptions: CoveringSubscriptionRecord[];
  grants: EntitlementGrantRecord[];
  /** Owner id → trialStartedAt (null: never trialled), for every owner asked about that exists. */
  trialStarts: Map<string, Date | null>;
}

export interface CreateGrantInput {
  /** Chosen by the caller, so the audit rows written with it can name the grant. */
  id: string;
  userId: string | null;
  organizationId: string | null;
  tier: BillingTierRecord;
  reason: string;
  expiresAt: Date | null;
  grantedBy: string;
  at: Date;
  /** Written in the same transaction (MUT-358 §2.6: one row per profile the grant reaches). */
  audit: AuditEventInput[];
}

export interface LinkBillingAccountInput {
  stripeCustomerId: string;
  userId: string;
  /** Used only when the customer is not known yet and the account is created here. */
  currency: string | null;
  at: Date;
  audit: AuditEventInput[];
}

export interface SaveBillingAccountInput {
  stripeCustomerId: string;
  /** Fills an empty link only (MUT-360 D5): null keeps the existing link, and a different person is a conflict, never a relink. */
  userId: string | null;
  /** Null keeps the country already stored. */
  country: string | null;
  /** Null keeps the stored currency; a new account needs one (StateConflict CURRENCY_REQUIRED). */
  currency: string | null;
  at: Date;
  /** Written in the same transaction, and only when this call links the customer (one row per profile the person owns). */
  linkAudit: AuditEventInput[];
}

/** Why a requested link was not made; the account is still saved, unlinked or with its existing link. */
export type SaveBillingAccountConflict = 'CUSTOMER_LINKED_ELSEWHERE' | 'USER_HAS_ANOTHER_ACCOUNT' | 'UNKNOWN_USER';

export interface SaveBillingAccountResult {
  account: BillingAccountRecord;
  linked: boolean;
  conflict: SaveBillingAccountConflict | null;
}

export type BillingSyncSource = 'webhook' | 'reconcile';

/** What `billing.subscription_changed` needs; the repository builds the rows after its compare, inside the transaction. */
export interface SubscriptionAuditContext {
  /** The profiles the subscription reaches (the payer's owned profiles and its organization). Empty: no audit. */
  profileIds: string[];
  source: BillingSyncSource;
  eventId: string | null;
  requestId: string | null;
}

export interface SaveBillingSubscriptionInput {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  tier: BillingTierRecord;
  organizationId: string | null;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  priceLookupKey: string | null;
  founderUntil: Date | null;
  /** When we asked Stripe (MUT-360): a stored row with a later value is newer and is kept. */
  stripeUpdatedAt: Date;
  at: Date;
  audit: SubscriptionAuditContext;
}

/** `stripe_events.error` keeps at most this much (codes are short; a joined list is capped, never a write failure). */
export const STRIPE_EVENT_ERROR_MAX = 500;

/** `stale`: the stored mirror was read from Stripe later than this one, so nothing was written. */
export type SaveBillingSubscriptionOutcome = 'created' | 'changed' | 'unchanged' | 'stale';

/**
 * MUT-358: billing state. Reads are a signed-in person's (`/v1/me`, store guard `sessionOnly`); writes are the
 * operator's and, from MUT-360, the Stripe webhook's (both on the unguarded store).
 */
export interface BillingRepository {
  /** Subscriptions paid by `ownerUserIds` or tied to `organizationIds`, grants on either, and the owners' trial starts. */
  factsFor(input: { ownerUserIds: readonly string[]; organizationIds: readonly string[] }): Promise<BillingFactsRecord>;
  /** MUT-331's signup sets it at email verification. Null for an unknown user. */
  setTrialStart(userId: string, at: Date): Promise<{ trialStartedAt: Date } | null>;
  /** ForeignKeyViolation on an unknown user or organization. */
  createGrant(input: CreateGrantInput): Promise<EntitlementGrantRecord>;
  /** Sets revokedAt (never deletes); an already-revoked grant comes back unchanged and `audit` is not written. Null if unknown. */
  revokeGrant(id: string, at: Date, audit: AuditEventInput[]): Promise<{ grant: EntitlementGrantRecord; revoked: boolean } | null>;
  getGrant(id: string): Promise<EntitlementGrantRecord | null>;
  /** Newest first; `activeAt` keeps only unrevoked grants that have not expired at that time. */
  listGrants(filter: { userId?: string | undefined; organizationId?: string | undefined; activeAt?: Date | undefined }): Promise<EntitlementGrantRecord[]>;
  /**
   * Links a Stripe customer to a person, creating the account if the customer is unknown (then `currency` is needed:
   * StateConflict('billing_account', 'CURRENCY_REQUIRED')). Idempotent for the same pair (`linked: false`, no audit).
   * StateConflict('billing_account', 'CUSTOMER_LINKED_ELSEWHERE' | 'USER_HAS_ANOTHER_ACCOUNT'); ForeignKeyViolation on an unknown user.
   */
  linkAccount(input: LinkBillingAccountInput): Promise<{ account: BillingAccountRecord; linked: boolean }>;
  /** MUT-360: the mirrored subscription, if the sync ever stored it. */
  getSubscription(stripeSubscriptionId: string): Promise<BillingSubscriptionRecord | null>;
  /** MUT-360: the account a Stripe customer has, if the sync ever stored one. */
  getAccount(stripeCustomerId: string): Promise<BillingAccountRecord | null>;
  /** Oldest first; `linked: false` lists the unlinked customers the operator still has to match. */
  listAccounts(filter: { linked?: boolean | undefined }): Promise<BillingAccountRecord[]>;
  /**
   * MUT-362: the signed-in person's own billing: the customer linked to them (never an unlinked one), its subscriptions
   * latest period end first, and their trial start. Nothing linked: `account: null, subscriptions: []`.
   */
  summaryOf(userId: string): Promise<{ account: BillingAccountRecord | null; subscriptions: BillingSubscriptionRecord[]; trialStartedAt: Date | null }>;
  /** MUT-360's Stripe sync: upsert by stripeCustomerId; a link conflict is reported, never thrown and never overwritten. */
  saveAccount(input: SaveBillingAccountInput): Promise<SaveBillingAccountResult>;
  /**
   * MUT-360's Stripe sync: upsert by stripeSubscriptionId when this read is not older than the stored one, auditing
   * `billing.subscription_changed` only when a mirrored field changed. The account must exist (ForeignKeyViolation).
   */
  saveSubscription(input: SaveBillingSubscriptionInput): Promise<{ subscription: BillingSubscriptionRecord; outcome: SaveBillingSubscriptionOutcome }>;
  /** MUT-360: records a webhook event; `alreadyProcessed` only once `finishStripeEvent` stored a processedAt. */
  beginStripeEvent(input: { id: string; type: string; at: Date }): Promise<{ alreadyProcessed: boolean }>;
  /** An error leaves processedAt null, so a redelivery is handled again. */
  finishStripeEvent(id: string, outcome: { processedAt: Date } | { error: string }): Promise<void>;
  /** Deletes events received before `before`; returns how many. */
  pruneStripeEvents(before: Date): Promise<number>;
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
  /** MUT-267: expense groups (trips); same domain and guard as expenses. */
  expenseGroups: ExpenseGroupRepository;
  /** MUT-270: one newest-first feed across a person's profiles; session-only (store guard `sessionOnly`). */
  entries: EntriesRepository;
  /** MUT-325: one profile's rows for its records file; session-only (store guard `sessionOnly`). */
  recordsExport: RecordsExportRepository;
  /** MUT-358: billing state; `/v1/me` reads it (`sessionOnly`), the operator and Stripe write it. */
  billing: BillingRepository;
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

/** Absent key = unchanged; null = cleared. MUT-272: `currency` only ever arrives with `amountMinor` (`expensePatch`'s pair rule, ADR-096). */
export type UpdateExpensePatch = Partial<Pick<CreateExpenseInput, 'occurredOn' | 'amountMinor' | 'currency' | 'title' | 'vendor' | 'categoryId' | 'customerId' | 'projectId' | 'notes'>>;

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
  /** MUT-267: a group's members, or its left-out expenses dated inside its window. */
  group?: ExpenseGroupFilter;
}

/**
 * MUT-267: membership as a ledger filter. The caller resolves the group and its
 * window (groups.ts `windowEnd`); the store applies D4 — in the window and not
 * left out, or kept — or, for `excluded`, left out and in the window (22A).
 */
export interface ExpenseGroupFilter {
  groupId: string;
  startOn: IsoDate;
  /** Inclusive: endOn, or startOn + 365 days for a group still going (R6). */
  windowEnd: IsoDate;
  membership: 'member' | 'excluded';
}

/** MUT-267 (re-review D1): per-currency sum and count of the expenses a filter matches. */
export interface ExpenseCurrencyTotal {
  currency: string;
  totalMinor: bigint;
  count: number;
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
  /**
   * Null for an id the organization never had; `changed: false` when it was already deleted.
   * In the same transaction, the expense's receipts (MUT-255): with `'unlink'` (where the receipts library is on:
   * hosted with RECEIPTS_LIBRARY, MUT-389) READY ones go back to the library as To review, keeping `approved` for
   * the edit-rate figure, and unfinished uploads are soft-deleted; with `'remove'` (where it is off: hosted by
   * default, and signed-out local mode) every one is soft-deleted, as before MUT-255. `removedReceipts` are the soft-deleted ones, whose objects the caller
   * removes; empty when `changed` is false.
   */
  softDelete(organizationId: string, id: string, at: Date, receipts: 'unlink' | 'remove'): Promise<{ record: ExpenseRecord; changed: boolean; removedReceipts: ExpenseReceiptRecord[] } | null>;
  /** MUT-267: live expenses matching `filter`, summed per currency (sorted by code). One aggregate query, no rows returned. */
  totalsByCurrency(organizationId: string, filter: ExpenseFilter): Promise<ExpenseCurrencyTotal[]>;
}

// ---- MUT-267: expense groups (ADR-094) --------------------------------------

/** A named date range on one profile; membership is computed when read (D4). */
export interface ExpenseGroupRecord {
  id: string;
  organizationId: string;
  name: string;
  startOn: IsoDate;
  /** Null = still going: the window then ends a year after startOn (R6). */
  endOn: IsoDate | null;
  notes: string | null;
  createdByUserId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateExpenseGroupInput {
  organizationId: string;
  name: string;
  startOn: IsoDate;
  endOn: IsoDate | null;
  notes: string | null;
  createdByUserId: string;
}

/** Absent key = unchanged; null clears endOn (still going) or notes. */
export type UpdateExpenseGroupPatch = Partial<Pick<CreateExpenseGroupInput, 'name' | 'startOn' | 'endOn' | 'notes'>>;

export type ExpenseGroupOverrideMode = 'excluded' | 'included';

/** One keep/leave-out mark per (group, expense); last write wins (eng review D6). */
export interface ExpenseGroupOverrideRecord {
  groupId: string;
  expenseId: string;
  organizationId: string;
  mode: ExpenseGroupOverrideMode;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExpenseGroupRepository {
  /** With `maxLive`, throws InsufficientCapacity when the organization already holds that many live groups; counted and inserted atomically (review: GROUP_LIMIT race). */
  create(input: CreateExpenseGroupInput, at: Date, maxLive?: number): Promise<ExpenseGroupRecord>;
  /** Live groups only; a deleted one reads null. */
  getById(organizationId: string, id: string): Promise<ExpenseGroupRecord | null>;
  /** Live groups, newest startOn first (ties by id descending). Unpaged: the create route caps a profile at MAX_GROUPS_PER_PROFILE (expenses/groups.ts). */
  list(organizationId: string): Promise<ExpenseGroupRecord[]>;
  update(organizationId: string, id: string, expectedVersion: number, patch: UpdateExpenseGroupPatch, at: Date): Promise<UpdateResult<ExpenseGroupRecord>>;
  /** Null for an id the organization never had; `changed: false` when already deleted. Its expenses are untouched. */
  softDelete(organizationId: string, id: string, at: Date): Promise<{ record: ExpenseGroupRecord; changed: boolean } | null>;
  /** Upsert the mark (the caller has checked the group and expense are this organization's). `changed` is false when the same mark was already there. */
  setOverride(organizationId: string, groupId: string, expenseId: string, mode: ExpenseGroupOverrideMode, at: Date): Promise<{ record: ExpenseGroupOverrideRecord; changed: boolean }>;
  /** True when a mark was removed. */
  clearOverride(organizationId: string, groupId: string, expenseId: string): Promise<boolean>;
  /** Every mark on one expense, across this organization's groups (GET /v1/expense-groups?expenseId=). */
  overridesForExpense(organizationId: string, expenseId: string): Promise<ExpenseGroupOverrideRecord[]>;
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

/** MUT-255: where a receipt stands in its profile's library. FILED exactly when it has an expense (DB CHECK). */
export type ReceiptFilingStatus = 'TO_REVIEW' | 'FILED';

/** Firm-books brief §6.1: one field a device's reader suggests, with where it came from and how sure it is. */
export type SuggestionSource = 'qr' | 'pdf-text' | 'ocr' | 'vendor';
export interface SuggestedField<T> {
  value: T;
  source: SuggestionSource;
  /** 0..1 */
  confidence: number;
}

/**
 * Firm-books brief §6.1 `ReceiptSuggestion`, shared by the phone and the portal. A field under the reader's
 * confidence threshold is omitted, never sent wrong. Money is minor units as a decimal string.
 */
export interface ReceiptSuggestion {
  readerVersion: string;
  date?: SuggestedField<string> | undefined;
  totalMinor?: SuggestedField<string> | undefined;
  currency?: SuggestedField<string> | undefined;
  vatMinor?: SuggestedField<string> | undefined;
  vatRateBasisPoints?: SuggestedField<number> | undefined;
  vendorName?: SuggestedField<string> | undefined;
  registrationNo?: SuggestedField<string> | undefined;
  phone?: SuggestedField<string> | undefined;
  email?: SuggestedField<string> | undefined;
}

/** MUT-255: what approval wrote into the expense, kept on the receipt for the edit-rate figure. Money as minor units in a decimal string. */
export interface ApprovedReceiptFields {
  occurredOn: string;
  amountMinor: string;
  currency: string;
  vendor: string | null;
  categoryId: string | null;
}

/** A receipt file behind the M6 signed-URL pipeline, in its own table so Malafat's attachment routes can never reach it (MUT-42 D1). */
export interface ExpenseReceiptRecord {
  id: string;
  organizationId: string;
  /** MUT-255: null while the receipt waits in the library as To review. */
  expenseId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  filingStatus: ReceiptFilingStatus;
  /** The upload day in the profile's timezone. */
  receivedOn: string;
  storageKey: string;
  uploadedByUserId: string;
  suggested: ReceiptSuggestion | null;
  approved: ApprovedReceiptFields | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  version: number;
  requestId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateExpenseReceiptInput {
  organizationId: string;
  /** Set: a MUT-44 receipt, FILED from the start. Null: a library receipt, TO_REVIEW (MUT-255). */
  expenseId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  receivedOn: string;
  suggested?: ReceiptSuggestion | null;
  uploadedByUserId: string;
  requestId: string | null;
}

export interface ReceiptLibraryFilter {
  filingStatus?: ReceiptFilingStatus;
  /** Inclusive, on `receivedOn`. */
  from?: string;
  to?: string;
}

/** Newest first: `(createdAt desc, id desc)`. */
export interface ReceiptCursor {
  createdAt: Date;
  id: string;
}

export interface ReceiptPage {
  items: ExpenseReceiptRecord[];
  nextCursor: ReceiptCursor | null;
}

/** Per field, among approved receipts whose suggestion carried that field: how many there were, and how many the person changed. */
export interface FieldEditRate {
  suggested: number;
  edited: number;
}

/** MUT-255: the epic's success measure, counts only — never a value. */
export interface ReceiptEditRates {
  approved: number;
  fields: { date: FieldEditRate; amount: FieldEditRate; currency: FieldEditRate; vendor: FieldEditRate };
  /** Approved receipts whose suggestion had both an amount and a date, and how many kept both unedited (the epic's 70% bar). */
  amountAndDate: { suggested: number; unedited: number };
}

export type FileReceiptResult =
  | { kind: 'filed'; expense: ExpenseRecord; receipt: ExpenseReceiptRecord }
  | { kind: 'not_found' }
  | { kind: 'not_ready' }
  | { kind: 'already_filed' };

/** MUT-389: `fileAsExpense`'s refusals, plus the existing expense's own. */
export type FileOntoExpenseResult = FileReceiptResult | { kind: 'expense_not_found' } | { kind: 'too_many_receipts' };

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
  /**
   * MUT-270: READY, live receipts per expense, the same rule as `listByExpense`. Expenses with none are absent from
   * the map. The caller passes organizations the person belongs to; the expense ids come from those organizations.
   */
  countReadyByExpenseIds(organizationIds: readonly string[], expenseIds: readonly string[]): Promise<Map<string, number>>;
  /** MUT-255: READY, live receipts of the profile's library, newest upload first. */
  list(organizationId: string, filter: ReceiptLibraryFilter, page: { limit: number; cursor: ReceiptCursor | null }): Promise<ReceiptPage>;
  /** MUT-255: READY, live receipts per filing status (one grouped count). */
  countByFilingStatus(organizationId: string): Promise<{ toReview: number; filed: number }>;
  /** MUT-255: live PENDING_UPLOAD receipts created at or after `since` (the per-profile upload cap). */
  countPendingSince(organizationId: string, since: Date): Promise<number>;
  /**
   * MUT-255: replace a To-review receipt's suggestion, optimistically. `not_found` also covers a filed receipt's
   * id being absent; a FILED receipt answers `filed`.
   */
  setSuggested(organizationId: string, id: string, expectedVersion: number, suggested: ReceiptSuggestion): Promise<UpdateResult<ExpenseReceiptRecord> | { kind: 'filed' }>;
  /**
   * MUT-255 approve, one transaction: lock the receipt; refuse unless it is READY, live and To review; create the
   * expense; then move the receipt to FILED with what was approved (and the request's suggestion, when it carries
   * one). If that last update matches no row the transaction throws, so no expense is left behind. MUT-307's
   * approval and MUT-312's closed-month check plug in between the lock and the insert.
   */
  fileAsExpense(params: { organizationId: string; receiptId: string; userId: string; expense: CreateExpenseInput; approved: ApprovedReceiptFields; suggested?: ReceiptSuggestion }, at: Date): Promise<FileReceiptResult>;
  /**
   * MUT-389, one transaction: the same receipt lock and refusals as `fileAsExpense`; then lock the expense (live, on
   * this profile) and refuse it once it holds `maxReceipts` READY receipts; then move the receipt to FILED on it. No
   * expense field changes and nothing is approved: `approved` keeps whatever an earlier approval left. A sent
   * suggestion replaces the stored one, except on a receipt that keeps an earlier approval: that pair stays as approved.
   */
  fileOntoExpense(params: { organizationId: string; receiptId: string; expenseId: string; maxReceipts: number; suggested?: ReceiptSuggestion }): Promise<FileOntoExpenseResult>;
  /** MUT-255 operator figure, across every profile: receipts approved in `[from, to)`. Counts only. */
  editRates(range: { from: Date; to: Date }): Promise<ReceiptEditRates>;
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

/**
 * MUT-390: the feed's two orders. `createdAt` (the default) is newest logged first, (createdAt, id) descending.
 * `occurredOn` is newest money day first (each kind's own money date, `moneyDateOf`), then (createdAt, id) descending.
 */
export type FeedOrder = 'createdAt' | 'occurredOn';

/** Keyset cursor of the `occurredOn` order. */
export interface MoneyDateCursor extends PageCursor {
  occurredOn: IsoDate;
}

/**
 * One feed page to read. The route allows each filter only with the order whose index bounds it (MUT-390 D5):
 * `occurredFrom` with `occurredOn`; `loggedSince` with `createdAt`; `occurredBefore` with `occurredOn`, or with
 * `createdAt` together with `loggedSince`. A `MoneyDateCursor` goes with `occurredOn` only.
 */
export interface FeedPageRequest {
  limit: number;
  order?: FeedOrder;
  cursor: PageCursor | MoneyDateCursor | null;
  /** Money date on or after. */
  occurredFrom?: IsoDate;
  /** Money date before. */
  occurredBefore?: IsoDate;
  /** Logged at or after. */
  loggedSince?: Date;
}

export interface FeedPage<T> {
  items: T[];
  nextCursor: PageCursor | MoneyDateCursor | null;
}

export interface EntriesRepository {
  /**
   * In `page.order` (createdAt when absent), strictly after `page.cursor`, within its filters. Trusts
   * `organizationIds`: the route resolves them from the person's memberships. Never lazy-posts (MUT-270 D2): a read
   * here never writes.
   */
  list(organizationIds: readonly string[], page: FeedPageRequest): Promise<FeedPage<EntryRow>>;
  /**
   * MUT-270 review (D2): for each payment with exactly one allocation, to an Owed (ADJUSTMENT) receivable, that
   * receivable's id: the Owed it paid toward, which a settle (full or partial) is. Judged by shape, not by which route
   * made it. Other payments are absent. Same trust in `organizationIds` as `list`.
   */
  settledOwedIds(organizationIds: readonly string[], paymentIds: readonly string[]): Promise<Map<string, string>>;
}

// ---- MUT-325: the records-file export ---------------------------------------

/**
 * Each profile-owned snapshot field (`LocalSnapshotMaps`, memory.ts) and the record it holds. The person-level
 * fields (`orgs`, `ints`, `people`, `members`, `inbox`) are not here: the export builds or omits those itself. Nor
 * is `files`: Malafat's documents stay with Malafat (ADR-097 §7: local profiles have none; ADR-156).
 */
export interface ProfileExportRecords {
  custs: CustomerRecord;
  projs: ProjectRecord;
  refs: ExternalReferenceRecord;
  rates: VatRateRecord;
  agrs: AgreementRecord;
  insts: InstallmentRecord;
  charges: RetainerChargeRecord;
  recs: ReceivableRecord;
  supps: SupplementRecord;
  versions: RetainerVersionRecord;
  pays: PaymentRecord;
  allocs: AllocationRecord;
  credits: CreditRecord;
  /** The last payment number used in a year; keyed `${organizationId}:${year}`. */
  counters: number;
  props: FeeProposalRecord;
  exps: ExpenseRecord;
  expCats: ExpenseCategoryRecord;
  expReceipts: ExpenseReceiptRecord;
  convs: ConversionRecord;
  expGroups: ExpenseGroupRecord;
  /** Keyed `${groupId}:${expenseId}`. */
  groupMarks: ExpenseGroupOverrideRecord;
}

export type ProfileExportField = keyof ProfileExportRecords;

/** One page of a field: `[key, record]` exactly as `MemoryLedgerStore` keys that map, ascending by key. */
export interface ExportPage<T> {
  entries: Array<[string, T]>;
  /** Pass back as `afterKey` for the next page; null on the last one. */
  nextKey: string | null;
}

/**
 * MUT-325: a profile's rows for "Download my records", read in key order a page at a time so an export never holds
 * a whole profile. Every row, soft-deleted ones included, exactly as stored: the file is the store, not a view of it.
 * Trusts its ids: the route resolves the profile from the session's membership.
 */
export interface RecordsExportRepository {
  profilePage<F extends ProfileExportField>(organizationId: string, field: F, afterKey: string | null, limit: number): Promise<ExportPage<ProfileExportRecords[F]>>;
  /** The person's unsorted inbox (MUT-66), which belongs to no profile. */
  inboxPage(userId: string, afterKey: string | null, limit: number): Promise<ExportPage<InboxEntryRecord>>;
  /** A READY, undeleted receipt of this profile: the only files the export hands out bytes for. */
  findExportableReceipt(organizationId: string, id: string): Promise<{ storageKey: string; mimeType: string; sizeBytes: number } | null>;
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
