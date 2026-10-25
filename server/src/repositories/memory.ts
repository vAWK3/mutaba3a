import { randomUUID } from 'node:crypto';
import { editRatesOf } from '../receipts/edit-rates.js';
import { applyMalafatChange } from '../malafat-suggestions.js';
import { applyTrialPromptAction } from '../billing/trial-prompt.js';
import { applyPasskeyNotNow, resolvePasskeyPrompt } from '../auth/passkey-prompt.js';
import { categoryNameKey } from '../expenses/names.js';
import { compareByCreatedAtThenId, isAfterCursor } from '../pagination.js';
import { subscriptionChangeAudit, subscriptionChanged } from './billing-audit.js';
import { isDueForPurge } from '../accounts/closure.js';
import { decidePurge, purgeAuditRows, type PurgeCandidate } from '../accounts/purge-plan.js';
import type {
  AccountClosureRecord,
  AccountPurgeRepository,
  BillingAccountRecord,
  BillingRepository,
  EmailRepository,
  BillingSubscriptionRecord,
  SaveBillingAccountConflict,
  EntitlementGrantRecord,
  AccountSetupRepository,
  AccountSetupTokenRecord,
  TermsAcceptanceInput,
  TermsAcceptanceRecord,
  AttachmentFilter,
  AttachmentRecord,
  AttachmentRepository,
  AuditFilter,
  CreateAttachmentInput,
  AppendVersionInput,
  RetainerVersionRecord,
  AgreementFilter,
  AgreementRecord,
  AgreementRepository,
  CorrectOutcomeInput,
  OutcomeWriteInput,
  AllocationInput,
  AllocationRecord,
  CreateAdjustmentReceivableInput,
  CreatePaymentInput,
  CreditInput,
  CreditRecord,
  PaymentFilter,
  PaymentRecord,
  PaymentRepository,
  ApiKeyRecord,
  ApiKeyRepository,
  ApplySupplementInput,
  CreateAgreementInput,
  CreateChargeInput,
  InstallmentRecord,
  PostingInput,
  ReceivableFilter,
  ReceivableRecord,
  ReceivableRepository,
  RetainerChargeRecord,
  SupplementRecord,
  VatRateRecord,
  VatRateRepository,
  AuditEventInput,
  AuditEventRecord,
  AuditRepository,
  ConnectIntegrationInput,
  CreateApiKeyInput,
  CreateCustomerInput,
  CreateOrganizationInput,
  CreateOwnedOrganizationInput,
  ProfileTypeChange,
  UpdateOwnedOrganizationPatch,
  CreateProjectInput,
  CreateUserInput,
  CreateSessionInput,
  MembershipRecord,
  MembershipRepository,
  SessionRecord,
  PersonSetupLinkPurpose,
  PersonSetupLinkRecord,
  SignupLinkRecord,
  UserStatus,
  SessionRepository,
  PasskeyPromptState,
  PasskeyRecord,
  PasskeyRepository,
  FeaturesRepository,
  OAuthAuthorizationRequestRecord,
  OAuthClientRecord,
  OAuthCodeRecord,
  OAuthGrantRecord,
  OAuthGrantRevokedReason,
  OAuthRepository,
  OAuthTokenInput,
  OAuthTokenRecord,
  UserFeatureRecord,
  WebauthnChallengePurpose,
  UserRecord,
  UserRepository,
  CreateFeeProposalInput,
  FeeProposalFilter,
  FeeProposalRecord,
  FeeProposalRepository,
  FeeProposalTransitionPatch,
  ConversionCursor,
  ConversionFilter,
  ConversionRecord,
  ConversionRepository,
  CreateConversionInput,
  CreateExpenseInput,
  CreateExpenseReceiptInput,
  ExpenseCategoryInput,
  ExpenseCategoryRecord,
  ExpenseCategoryRepository,
  ExpenseCursor,
  ExpenseFilter,
  ExpenseReceiptRecord,
  ExpenseReceiptRepository,
  ExpenseRecord,
  VendorRecord,
  VendorNameRecord,
  VendorRepository,
  ResolveVendorInput,
  VendorSuggestion,
  ExpenseRepository,
  UpdateExpenseCategoryPatch,
  UpdateConversionPatch,
  UpdateExpensePatch,
  CreateInboxEntryInput,
  IncomeWriteResult,
  InboxEntryCursor,
  InboxEntryKind,
  InboxEntryRecord,
  InboxEntryRepository,
  UpdateInboxEntryPatch,
  CustomerFilter,
  CustomerRecord,
  CustomerRepository,
  ExternalEntityType,
  ExternalReferenceInput,
  ExternalReferenceRecord,
  ExternalReferenceRepository,
  IdempotencyClaim,
  IdempotencyRecord,
  IdempotencyRepository,
  UserIdempotencyClaim,
  UserIdempotencyRecord,
  UserIdempotencyRepository,
  IntegrationProvider,
  IntegrationRecord,
  IntegrationRepository,
  LedgerStore,
  Organization,
  OrganizationRepository,
  Page,
  PageRequest,
  ProjectFilter,
  ProjectRecord,
  ProjectRepository,
  UpdateCustomerPatch,
  UpdateProjectPatch,
  CreateExpenseGroupInput,
  ExpenseCurrencyTotal,
  ExpenseGroupFilter,
  ExpenseGroupOverrideRecord,
  ExpenseGroupRecord,
  ExpenseGroupRepository,
  UpdateExpenseGroupPatch,
  EntriesRepository,
  EntryRow,
  ExportPage,
  ProfileExportField,
  ProfileExportRecords,
  RecordsExportRepository,
  SignupReviewRecord,
  SignupReviewRepository,
} from './ports.js';
import { isGroupMember } from '../expenses/groups.js';
import { CAPTURE_UNDO_REASON, SETUP_LINK_STATUSES, STRIPE_EVENT_ERROR_MAX } from './ports.js';
import { isFeature } from '../features.js';
import { isAutomaticOtherCategory, registrationKey, scoreVendorName, vendorNameKey } from '../vendors/keys.js';
import { todayIn } from '../dates.js';
import { createdAtCursorOf, isBeforeCursor, isBeforeMoneyDateCursor, mergeByMoneyDate, mergeNewestFirst, moneyDateCursorOf, moneyDateKeyOf, moneyDateOf } from '../entries/merge.js';
import { allocationStateOf } from '../payments/allocation-state.js';
import { ownedProfileCreatedAudit, ownedProfileUpdatedAudit, ownsProfile, profileOwnerOf, profileTypeOf, type TypeChangeDetail } from '../personal-profile.js';
import { grantOwnerRefusal, ownerIdsOf, ownerRemovedAudit, removeOwnerDecision } from '../co-owners.js';
import { firmAuditRow, firmEnableRefusal, firmOwnersOf, firmUnchanged, roleForNewMembership } from '../firm.js';
import { resolveClaim } from './idempotency-claim.js';
import { OPEN_PROPOSAL_STATUSES } from '../proposals/transitions.js';

/**
 * Bumped whenever a field below changes shape; the portal's local-mode migrations (Phase B) key off it.
 * 2 (MUT-300): `orgs` gained `firmEnabledAt`, `firmRequestedAt` and `firmRequestedByUserId`; `members` gained `role`.
 * 3 (MUT-255): `expReceipts` gained `filingStatus`, `receivedOn`, `suggested`, `approved`, `approvedAt`,
 *   `approvedByUserId` and `version`, and `expenseId` may be null (a To-review receipt).
 * 4 (MUT-366): `people` gained `emailVerifiedAt`.
 * 5 (MUT-418): `people` gained `trialPrompt`.
 * 6 (MUT-254): new `vendors` and `vendorNames` maps; `exps` gained `vendorId`.
 * 7 (MUT-333): `people` gained `closure`.
 */
export const CURRENT_STORE_SNAPSHOT_VERSION = 7;

/**
 * The business-data half of a `MemoryLedgerStore`'s fields (MUT-286) — every
 * `private readonly` Map except the six ephemeral ones (`idem`, `userIdem`,
 * `sessionsById`, `setupLinks`, `events`, `keys`): idempotency keys, sessions
 * and setup links are a server-identity concern that never survives a
 * restore, and the audit log and API keys are not portal-local-mode concerns
 * either. `counters` is included (payment/charge numbering must resume where
 * it left off).
 */
export interface LocalSnapshotMaps {
  orgs: Map<string, Organization>;
  ints: Map<string, IntegrationRecord>;
  custs: Map<string, CustomerRecord>;
  projs: Map<string, ProjectRecord>;
  refs: Map<string, ExternalReferenceRecord>;
  rates: Map<string, VatRateRecord>;
  agrs: Map<string, AgreementRecord>;
  insts: Map<string, InstallmentRecord>;
  charges: Map<string, RetainerChargeRecord>;
  recs: Map<string, ReceivableRecord>;
  supps: Map<string, SupplementRecord>;
  versions: Map<string, RetainerVersionRecord>;
  files: Map<string, AttachmentRecord>;
  pays: Map<string, PaymentRecord>;
  allocs: Map<string, AllocationRecord>;
  credits: Map<string, CreditRecord>;
  counters: Map<string, number>;
  props: Map<string, FeeProposalRecord>;
  people: Map<string, UserRecord>;
  members: Map<string, MembershipRecord>;
  exps: Map<string, ExpenseRecord>;
  expCats: Map<string, ExpenseCategoryRecord>;
  expReceipts: Map<string, ExpenseReceiptRecord>;
  convs: Map<string, ConversionRecord>;
  expGroups: Map<string, ExpenseGroupRecord>;
  groupMarks: Map<string, ExpenseGroupOverrideRecord>;
  inbox: Map<string, InboxEntryRecord>;
  vendors: Map<string, VendorRecord>;
  vendorNames: Map<string, VendorNameRecord>;
}

export interface LocalSnapshot {
  formatVersion: number;
  maps: LocalSnapshotMaps;
}

/**
 * In-memory LedgerStore for tests and the portal's local mode. Mirrors every
 * uniqueness constraint the Prisma schema declares so a route test fails
 * here for the same reasons it would fail in Postgres.
 */
export class MemoryLedgerStore implements LedgerStore {
  private readonly orgs = new Map<string, Organization>();
  private readonly keys = new Map<string, ApiKeyRecord>();
  private readonly ints = new Map<string, IntegrationRecord>();
  private readonly events: AuditEventRecord[] = [];
  /** Guarantees append() order == createdAt order even when two events land in the same clock millisecond. */
  private lastAuditAtMs = 0;
  private readonly idem = new Map<string, IdempotencyRecord>();
  private readonly userIdem = new Map<string, UserIdempotencyRecord>();
  private readonly custs = new Map<string, CustomerRecord>();
  private readonly projs = new Map<string, ProjectRecord>();
  private readonly refs = new Map<string, ExternalReferenceRecord>();
  private readonly rates = new Map<string, VatRateRecord>();
  private readonly agrs = new Map<string, AgreementRecord>();
  private readonly insts = new Map<string, InstallmentRecord>();
  private readonly charges = new Map<string, RetainerChargeRecord>();
  private readonly recs = new Map<string, ReceivableRecord>();
  private readonly supps = new Map<string, SupplementRecord>();
  private readonly versions = new Map<string, RetainerVersionRecord>();
  private readonly files = new Map<string, AttachmentRecord>();
  private readonly pays = new Map<string, PaymentRecord>();
  private readonly allocs = new Map<string, AllocationRecord>();
  private readonly credits = new Map<string, CreditRecord>();
  private readonly counters = new Map<string, number>();
  private readonly props = new Map<string, FeeProposalRecord>();
  private readonly people = new Map<string, UserRecord>();
  private readonly members = new Map<string, MembershipRecord>();
  private readonly sessionsById = new Map<string, SessionRecord>();
  private readonly setupLinks = new Map<string, AccountSetupTokenRecord>();
  /**
   * MUT-324, keyed `${userId}:${version}`. Deliberately not in snapshot()/restore(): the portal's signed-out mode
   * has no terms (its /v1/me says `terms: null`), and a new snapshot map would change the shipped local format.
   */
  private readonly termsAcceptances = new Map<string, TermsAcceptanceRecord>();
  private readonly exps = new Map<string, ExpenseRecord>();
  private readonly expCats = new Map<string, ExpenseCategoryRecord>();
  private readonly expReceipts = new Map<string, ExpenseReceiptRecord>();
  private readonly convs = new Map<string, ConversionRecord>();
  private readonly expGroups = new Map<string, ExpenseGroupRecord>();
  /** Keyed `${groupId}:${expenseId}` — the Postgres primary key. */
  private readonly groupMarks = new Map<string, ExpenseGroupOverrideRecord>();
  private readonly inbox = new Map<string, InboxEntryRecord>();
  /** MUT-254: vendors by id, and their names (canonical + aliases) by id; one name key per organization. */
  private readonly vendorMap = new Map<string, VendorRecord>();
  private readonly vendorNames = new Map<string, VendorNameRecord>();
  /**
   * MUT-358 billing state. Deliberately not in snapshot()/restore(), like the terms acceptances: the portal's
   * signed-out mode has no billing (its /v1/me says `billing: null`), and new maps would change the local format.
   */
  private readonly billingAccounts = new Map<string, BillingAccountRecord>();
  private readonly billingSubs = new Map<string, BillingSubscriptionRecord>();
  private readonly grants = new Map<string, EntitlementGrantRecord>();
  /**
   * MUT-433, keyed `${userId}:${feature}`. Deliberately not in snapshot()/restore() (eng review C5): the portal's
   * local mode has no operator and no flags (its /v1/me says `features: []`), and a new snapshot map would change the
   * shipped local format.
   */
  private readonly featureGrants = new Map<string, UserFeatureRecord>();
  /** MUT-434: the OAuth server's rows, outside the snapshot too (local mode has no agents). Codes and tokens by digest. */
  private readonly oauthClients = new Map<string, OAuthClientRecord>();
  private readonly oauthRequests = new Map<string, OAuthAuthorizationRequestRecord>();
  private readonly oauthGrants = new Map<string, OAuthGrantRecord>();
  private readonly oauthCodes = new Map<string, OAuthCodeRecord>();
  private readonly oauthTokens = new Map<string, OAuthTokenRecord & { digest: string }>();
  private readonly trialStarts = new Map<string, Date>();
  /** MUT-359: the mail send log by key digest, and the suppression list by address; outside the snapshot too. */
  private readonly emailDeliveries = new Map<string, { id: string; recipientDigest: string; status: 'PENDING' | 'SENT' | 'FAILED' | 'UNCERTAIN'; createdAt: Date }>();
  private readonly emailSuppressions = new Map<string, { reason: string; eventId: string; createdAt: Date }>();
  /** MUT-367: signup reviews by id; outside the snapshot (local mode has no signups). */
  private readonly reviews = new Map<string, SignupReviewRecord>();
  /** MUT-360: Stripe webhook events by id (processedAt null until handled), also outside the snapshot. */
  private readonly stripeEvents = new Map<string, { type: string; receivedAt: Date; processedAt: Date | null; error: string | null }>();
  /** MUT-115: passkeys and their challenges, outside the snapshot too (local mode has no sign-in). */
  private readonly passkeyMap = new Map<string, PasskeyRecord>();
  private readonly challenges = new Map<string, { challenge: string; purpose: WebauthnChallengePurpose; userId: string | null; expiresAt: Date; consumedAt: Date | null }>();
  /** MUT-370: the "Add a passkey" suggestion's state by person (`users.passkeyPrompt`), outside the snapshot like passkeys. */
  private readonly passkeyPrompts = new Map<string, unknown>();

  readonly organizations: OrganizationRepository = {
    create: async (input: CreateOrganizationInput) => {
      for (const o of this.orgs.values()) {
        if (o.slug === input.slug) throw new UniqueViolation('organizations.slug');
        if (input.personalOwnerUserId && o.personalOwnerUserId === input.personalOwnerUserId) {
          throw new UniqueViolation('organizations.personalOwnerUserId');
        }
      }
      if (input.personalOwnerUserId && !this.people.has(input.personalOwnerUserId)) {
        throw new ForeignKeyViolation('organizations.personalOwnerUserId');
      }
      const org: Organization = { id: randomUUID(), ...input, personalOwnerUserId: input.personalOwnerUserId ?? null, ownerUserId: null, profileType: null, version: 1, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null, createdAt: new Date() };
      this.orgs.set(org.id, org);
      return { ...org };
    },
    getById: async (id) => clone(this.orgs.get(id)),
    getBySlug: async (slug) => clone([...this.orgs.values()].find((o) => o.slug === slug)),
    list: async () => [...this.orgs.values()].map((o) => ({ ...o })), // insertion order = creation order
    createOwned: async (ownerUserId, input: CreateOwnedOrganizationInput, cap, audit) => {
      if (!this.people.has(ownerUserId)) throw new ForeignKeyViolation('organizations.ownerUserId');
      if ([...this.orgs.values()].some((o) => o.slug === input.slug)) throw new UniqueViolation('organizations.slug');
      const count = this.ownedCount(ownerUserId);
      if (count >= cap) return { kind: 'limit', count };
      const { at, ...fields } = input;
      const organization: Organization = { id: randomUUID(), ...fields, personalOwnerUserId: null, ownerUserId, version: 1, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null, createdAt: at };
      const membership: MembershipRecord = { userId: ownerUserId, organizationId: organization.id, role: 'OWNER', createdAt: at };
      this.orgs.set(organization.id, organization);
      this.members.set(membershipKey(ownerUserId, organization.id), membership);
      for (const event of ownedProfileCreatedAudit(organization, audit)) await this.audit.append(event);
      return { kind: 'created', organization: { ...organization }, membership: { ...membership } };
    },
    countOwnedBy: async (userId) => this.ownedCount(userId),
    updateOwned: async (id, ownerUserId, expectedVersion, patch: UpdateOwnedOrganizationPatch, preset, at, audit) => {
      const org = this.orgs.get(id);
      // MUT-373 (OV2): the creator, or a co-owner — ownsProfile, the same rule the Postgres query spells out.
      if (!org || !ownsProfile(org, ownerUserId, this.members.get(membershipKey(ownerUserId, id))?.role ?? null)) return { kind: 'not_found' };
      if (org.version !== expectedVersion) return { kind: 'stale', record: { ...org } };
      // Postgres' organizations_personal_owned_check (eng review D2), checked before any write.
      if (org.personalOwnerUserId && patch.profileType && patch.profileType !== 'PERSONAL') {
        throw new StateConflict('organizations', 'the built-in personal profile is always PERSONAL');
      }
      const from = profileTypeOf(org);
      const retype = patch.profileType !== undefined && patch.profileType !== from;
      // MUT-373 (OV3): a shared profile stays BUSINESS.
      if (retype && patch.profileType === 'PERSONAL' && [...this.members.values()].filter((m) => m.organizationId === id && m.role === 'OWNER').length > 1) {
        return { kind: 'co_owned' };
      }
      const typeChange = retype ? this.replaceCategories(id, preset ?? [], at) : null;
      // qa-reconcile D1: a MUT-120 profile the old revision wrote without an owner gets stamped on its first update.
      if (org.ownerUserId === null) Object.assign(org, { ownerUserId, profileType: from });
      if (patch.name !== undefined) org.name = patch.name;
      if (patch.defaultCurrency !== undefined) org.defaultCurrency = patch.defaultCurrency;
      if (patch.profileType !== undefined) org.profileType = patch.profileType;
      org.version += 1;
      const events = ownedProfileUpdatedAudit(id, { from, to: org.profileType }, audit, typeChange && { ...typeChange, seeded: preset?.length ?? 0 });
      for (const event of events) await this.audit.append(event);
      return { kind: 'updated', record: { ...org }, typeChange: typeChange?.impact ?? null };
    },
    typeChangeImpact: async (id) => this.typeChangeImpactOf(id),
    requestFirm: async (id, userId, at, audit) => {
      const org = this.orgs.get(id);
      if (!org) return { kind: 'not_found' };
      if (org.firmEnabledAt) return { kind: 'already_firm' };
      if (org.firmRequestedAt) return { kind: 'requested', organization: { ...org }, created: false };
      if (!this.people.has(userId)) throw new ForeignKeyViolation('organizations.firmRequestedByUserId');
      Object.assign(org, { firmRequestedAt: at, firmRequestedByUserId: userId });
      await this.audit.append(firmAuditRow(id, 'firm.requested', audit));
      return { kind: 'requested', organization: { ...org }, created: true };
    },
    setFirm: async (id, input, at, audit) => {
      const org = this.orgs.get(id);
      if (!org) return { kind: 'not_found' };
      if (firmUnchanged(org, input)) return { kind: 'updated', organization: { ...org }, changed: false };
      if (!input.enabled) {
        Object.assign(org, { firmEnabledAt: null, version: org.version + 1 });
        await this.audit.append(firmAuditRow(id, 'firm.disabled', audit));
        return { kind: 'updated', organization: { ...org }, changed: true };
      }
      const members = [...this.members.values()].filter((m) => m.organizationId === id);
      const refusal = firmEnableRefusal(org, input.ownerUserIds, new Set(members.map((m) => m.userId)));
      if (refusal) return refusal;
      // MUT-373: an owned profile's co-owners stay OWNER.
      const owners = firmOwnersOf(org, input.ownerUserIds, members.filter((m) => m.role === 'OWNER').map((m) => m.userId));
      for (const m of members) m.role = owners.includes(m.userId) ? 'OWNER' : 'BOOKKEEPER';
      Object.assign(org, { firmEnabledAt: at, firmRequestedAt: null, firmRequestedByUserId: null, version: org.version + 1 });
      await this.audit.append(firmAuditRow(id, 'firm.enabled', audit, { ownerUserIds: owners }));
      return { kind: 'updated', organization: { ...org }, changed: true };
    },
    declineFirmRequest: async (id, _at, audit) => {
      const org = this.orgs.get(id);
      if (!org?.firmRequestedAt) return { kind: 'not_found' };
      Object.assign(org, { firmRequestedAt: null, firmRequestedByUserId: null });
      await this.audit.append(firmAuditRow(id, 'firm.request_declined', audit));
      return { kind: 'declined', organization: { ...org } };
    },
    listFirmRequests: async (page) => {
      // The keyset runs on (firmRequestedAt, id): `paginate` reads it as createdAt, then the rows go back as they are.
      const pending = [...this.orgs.values()].filter((o) => o.firmRequestedAt && !o.firmEnabledAt);
      const keyed = paginate(pending.map((o) => ({ id: o.id, createdAt: o.firmRequestedAt! })), page);
      return { items: keyed.items.map((k) => ({ ...this.orgs.get(k.id)! })), nextCursor: keyed.nextCursor };
    },
  };

  private ownedCount(userId: string): number {
    return [...this.orgs.values()].filter((o) => profileOwnerOf(o) === userId).length;
  }

  private typeChangeImpactOf(organizationId: string): ProfileTypeChange {
    return {
      uncategorizedExpenses: [...this.exps.values()].filter((e) => e.organizationId === organizationId && !e.deletedAt && e.categoryId !== null).length,
      deletedCategories: [...this.expCats.values()].filter((c) => c.organizationId === organizationId).length,
    };
  }

  /** MUT-182: a type change — every expense uncategorized (deleted ones too, so none points at a removed row), every category gone, `preset` in. */
  private replaceCategories(organizationId: string, preset: readonly ExpenseCategoryInput[], at: Date): { impact: ProfileTypeChange; detail: TypeChangeDetail } {
    const impact = this.typeChangeImpactOf(organizationId);
    const detail: TypeChangeDetail = {
      removedCategories: [...this.expCats.values()]
        .filter((c) => c.organizationId === organizationId)
        .sort(compareByCreatedAtThenId)
        .map((c) => ({ id: c.id, name: c.name, color: c.color, archived: c.archivedAt !== null })),
      uncategorized: [],
    };
    for (const e of this.exps.values()) {
      if (e.organizationId !== organizationId || e.categoryId === null) continue;
      detail.uncategorized.push({ expenseId: e.id, categoryId: e.categoryId });
      Object.assign(e, { categoryId: null, version: e.version + 1, updatedAt: at });
    }
    // MUT-254: ON DELETE SET NULL on vendors.lastCategoryId.
    for (const v of this.vendorMap.values()) if (v.organizationId === organizationId && v.lastCategoryId !== null) v.lastCategoryId = null;
    for (const [key, c] of this.expCats) if (c.organizationId === organizationId) this.expCats.delete(key);
    this.insertPreset(organizationId, preset, at);
    return { impact, detail };
  }

  private insertPreset(organizationId: string, preset: readonly ExpenseCategoryInput[], at: Date): void {
    // Same instant for the whole preset; the 1 ms steps keep creation order equal to preset order.
    preset.forEach((p, i) => {
      const record: ExpenseCategoryRecord = { id: randomUUID(), organizationId, name: p.name, color: p.color, archivedAt: null, version: 1, createdAt: new Date(at.getTime() + i), updatedAt: at };
      this.expCats.set(record.id, record);
    });
  }

  readonly apiKeys: ApiKeyRepository = {
    create: async (input: CreateApiKeyInput) => {
      for (const k of this.keys.values()) {
        if (k.prefix === input.prefix) throw new UniqueViolation('api_keys.prefix');
        if (k.keyHash === input.keyHash) throw new UniqueViolation('api_keys.keyHash');
      }
      if (!this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('api_keys.organizationId');
      const record: ApiKeyRecord = {
        id: randomUUID(),
        ...input,
        scopes: [...input.scopes],
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
        revokedReason: null,
      };
      this.keys.set(record.id, record);
      return { ...record, scopes: [...record.scopes] };
    },
    findByPrefix: async (prefix) => clone([...this.keys.values()].find((k) => k.prefix === prefix)),
    getById: async (id) => clone(this.keys.get(id)),
    listByOrganization: async (organizationId) =>
      [...this.keys.values()].filter((k) => k.organizationId === organizationId).map((k) => ({ ...k, scopes: [...k.scopes] })),
    touchLastUsed: async (id, at) => {
      const k = this.keys.get(id);
      if (k) k.lastUsedAt = at;
    },
    revoke: async (id, reason, at) => {
      const k = this.keys.get(id);
      if (!k) return null;
      if (!k.revokedAt) {
        k.revokedAt = at;
        k.revokedReason = reason;
      }
      return { ...k, scopes: [...k.scopes] };
    },
  };

  readonly users: UserRepository = {
    create: async (input: CreateUserInput) => {
      if (input.setupLink) this.assertSetupDigestFree(input.setupLink.tokenDigest);
      const created = this.insertPerson({ ...input, status: 'ACTIVE', emailVerifiedAt: null });
      if (input.setupLink) this.storeSetupLink(created.user.id, input.setupLink, input.at);
      return created;
    },
    getById: async (id) => clone(this.people.get(id)),
    findByEmail: async (email) => clone([...this.people.values()].find((u) => u.email === email)),
    setPassword: async (id, passwordHash, at) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { passwordHash, passwordChangedAt: at, failedSignIns: 0, lockedUntil: null, updatedAt: at });
      return { ...u };
    },
    setStatus: async (id, status, at) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { status, updatedAt: at });
      // MUT-235 review fix: a disable kills open setup links, so re-enabling never revives one.
      if (status === 'DISABLED') this.cancelOpenSetupLinks(id, at);
      return { ...u };
    },
    recordFailedSignIn: async (id, at, lockUntil) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { failedSignIns: u.failedSignIns + 1, updatedAt: at, ...(lockUntil ? { lockedUntil: lockUntil } : {}) });
      return { ...u };
    },
    recordSignIn: async (id, at) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { lastSignInAt: at, failedSignIns: 0, lockedUntil: null, updatedAt: at });
      return { ...u };
    },
    updateMalafatSuggestions: async (id, change, at) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { malafatSuggestions: applyMalafatChange(u.malafatSuggestions, change), updatedAt: at });
      return { ...u, malafatSuggestions: u.malafatSuggestions && { ...u.malafatSuggestions, dismissed: [...u.malafatSuggestions.dismissed] } };
    },
    updateTrialPrompt: async (id, action, at) => {
      const u = this.people.get(id);
      if (!u) return null;
      Object.assign(u, { trialPrompt: applyTrialPromptAction(u.trialPrompt, action, at), updatedAt: at });
      return { ...u, trialPrompt: u.trialPrompt && { ...u.trialPrompt } };
    },
    latestTermsAcceptance: async (userId) => {
      let latest: TermsAcceptanceRecord | undefined;
      for (const a of this.termsAcceptances.values()) if (a.userId === userId && (!latest || a.version > latest.version)) latest = a;
      return latest ? { ...latest } : null;
    },
    listLatestTermsVersions: async () =>
      [...this.people.values()]
        .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
        .map((u) => {
          let latest: TermsAcceptanceRecord | undefined;
          for (const a of this.termsAcceptances.values()) if (a.userId === u.id && (!latest || a.version > latest.version)) latest = a;
          return { userId: u.id, email: u.email, status: u.status, latestVersion: latest?.version ?? null, latestClientRelease: latest?.clientRelease ?? null };
        }),
    acceptTerms: async (input) => {
      if (!this.people.has(input.userId)) throw new ForeignKeyViolation('terms_acceptances.userId');
      const { created } = this.recordTermsAcceptance(input.userId, input, input.at);
      if (created) for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { created };
    },
    changePassword: async (input) => {
      const u = this.people.get(input.userId);
      if (!u) return null;
      const kept = this.sessionsById.get(input.exceptSessionId);
      if (u.passwordHash !== input.verifiedPasswordHash || !kept || kept.userId !== u.id || kept.revokedAt) {
        throw new StateConflict('user', 'CREDENTIAL_CHANGED');
      }
      // MUT-262: built and checked before anything changes, so a duplicate digest leaves the store untouched (AC5).
      const rotated = input.rotation ? rotatedSession(kept, input.rotation, input.at) : null;
      if (rotated && [...this.sessionsById.values()].some((s) => s.tokenDigest === rotated.tokenDigest)) throw new UniqueViolation('sessions.tokenDigest');
      Object.assign(u, { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at });
      this.revokeSessionsOf(u.id, 'password_changed', input.at, input.exceptSessionId);
      if (rotated) {
        Object.assign(kept, { revokedAt: input.at, revokedReason: 'password_rotated' });
        this.sessionsById.set(rotated.id, rotated);
      } else {
        // The kept session is verified as of the change, so the middleware's passwordChangedAt check lets it through.
        kept.credentialsVerifiedAt = input.at;
      }
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      // MUT-434 (D11): a password change disconnects every agent too.
      if (this.revokeOAuthGrantsOf(u.id, 'password_changed', input.at) > 0) this.pushEvents(input.agentGrantAudit ?? [], input.at);
      return { ...u };
    },
    requestClosure: async (input) => {
      const u = this.people.get(input.userId);
      if (!u) return null;
      if (u.closure) throw new StateConflict('user', 'ALREADY_CLOSING');
      const kept = this.sessionsById.get(input.exceptSessionId);
      if (!kept || kept.userId !== u.id || kept.revokedAt) throw new StateConflict('user', 'CREDENTIAL_CHANGED');
      const closure: AccountClosureRecord = { requestedAt: input.at, deleteAfter: input.deleteAfter, endedSubscriptionIds: [...input.endedSubscriptionIds], purgeStartedAt: null, purgeLastTriedAt: null };
      Object.assign(u, { closure, updatedAt: input.at });
      this.revokeSessionsOf(u.id, 'account_closing', input.at, input.exceptSessionId);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { ...u };
    },
    cancelClosure: async ({ userId, at, audit }) => {
      const u = this.people.get(userId);
      const ended = u?.closure;
      if (!u || !ended || ended.purgeStartedAt || ended.deleteAfter.getTime() <= at.getTime()) return null;
      Object.assign(u, { closure: null, updatedAt: at });
      for (const event of audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { user: { ...u }, ended };
    },
  };

  readonly sessions: SessionRepository = {
    create: async (input: CreateSessionInput) => {
      for (const s of this.sessionsById.values()) {
        if (s.tokenDigest === input.tokenDigest) throw new UniqueViolation('sessions.tokenDigest');
      }
      const owner = this.people.get(input.userId);
      if (!owner) throw new ForeignKeyViolation('sessions.userId');
      // MUT-235 review: a session for a credential that changed (or a person disabled) since sign-in checked it is refused.
      if (input.verifiedPasswordHash !== undefined && (owner.passwordHash !== input.verifiedPasswordHash || owner.status !== 'ACTIVE')) {
        throw new StateConflict('user', 'CREDENTIAL_CHANGED');
      }
      const record: SessionRecord = {
        id: randomUUID(),
        userId: input.userId,
        tokenDigest: input.tokenDigest,
        kind: input.kind,
        createdAt: input.at,
        credentialsVerifiedAt: input.at,
        lastSeenAt: input.at,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        revokedAt: null,
        revokedReason: null,
        userAgent: input.userAgent,
        passkeyId: input.passkeyId ?? null,
      };
      this.sessionsById.set(record.id, record);
      return { ...record };
    },
    findByDigest: async (tokenDigest) => clone([...this.sessionsById.values()].find((s) => s.tokenDigest === tokenDigest)),
    touch: async (id, at, idleExpiresAt) => {
      const s = this.sessionsById.get(id);
      if (s) Object.assign(s, { lastSeenAt: at, idleExpiresAt });
    },
    revoke: async (id, reason, at) => {
      const s = this.sessionsById.get(id);
      if (!s) return null;
      if (!s.revokedAt) Object.assign(s, { revokedAt: at, revokedReason: reason });
      return { ...s };
    },
    revokeAllForUser: async (userId, reason, at) => this.revokeSessionsOf(userId, reason, at),
  };

  readonly features: FeaturesRepository = {
    // Review D2: only names the code knows; a retired name is simply off.
    activeFor: async (userId) =>
      [...this.featureGrants.values()]
        .filter((g) => g.userId === userId && g.revokedAt === null && isFeature(g.feature))
        .map((g) => g.feature)
        .sort(),
    grant: async ({ userId, feature, grantedBy, at, audit }) => {
      if (!this.people.has(userId)) throw new ForeignKeyViolation('user_feature_grants.userId');
      const key = `${userId}:${feature}`;
      const existing = this.featureGrants.get(key);
      if (existing && existing.revokedAt === null) return { grant: { ...existing }, granted: false };
      const grant: UserFeatureRecord = { userId, feature, grantedBy, grantedAt: at, revokedAt: null };
      this.featureGrants.set(key, grant);
      for (const event of audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { grant: { ...grant }, granted: true };
    },
    revoke: async ({ userId, feature, at, audit, agentGrants }) => {
      const grant = this.featureGrants.get(`${userId}:${feature}`);
      const revoked = grant !== undefined && grant.revokedAt === null;
      if (grant && revoked) {
        grant.revokedAt = at;
        this.pushEvents(audit, at);
      }
      // MUT-434 AC7 (OV10): the grants go in the same step, even if the flag was already off.
      const agentGrantsRevoked = agentGrants ? this.revokeOAuthGrantsOf(userId, 'feature_revoked', at) : 0;
      if (agentGrantsRevoked > 0) this.pushEvents(agentGrants?.audit ?? [], at);
      return { revoked, agentGrantsRevoked };
    },
    // Rows whose person is gone stay listed (email ''), so a purge that forgot them shows here (C1).
    holders: async (feature) =>
      [...this.featureGrants.values()]
        .filter((g) => g.feature === feature && g.revokedAt === null && isFeature(g.feature))
        .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime() || a.userId.localeCompare(b.userId))
        .map((g) => ({ userId: g.userId, email: this.people.get(g.userId)?.email ?? '', grantedAt: g.grantedAt })),
  };

  readonly passkeys: PasskeyRepository = {
    listByUser: async (userId) =>
      [...this.passkeyMap.values()]
        .filter((p) => p.userId === userId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map(clonePasskey),
    findByCredentialId: async (credentialId) => {
      const found = [...this.passkeyMap.values()].find((p) => p.credentialId === credentialId);
      return found ? clonePasskey(found) : null;
    },
    create: async (input) => {
      if (!this.people.has(input.userId)) throw new ForeignKeyViolation('passkeys.userId');
      for (const p of this.passkeyMap.values()) if (p.credentialId === input.credentialId) throw new UniqueViolation('passkeys.credentialId');
      if ([...this.passkeyMap.values()].filter((p) => p.userId === input.userId).length >= input.limit) throw new StateConflict('passkey', 'PASSKEY_LIMIT');
      const record: PasskeyRecord = {
        id: randomUUID(),
        userId: input.userId,
        credentialId: input.credentialId,
        publicKey: Uint8Array.from(input.publicKey),
        signCount: input.signCount,
        transports: [...input.transports],
        deviceType: input.deviceType,
        backedUp: input.backedUp,
        aaguid: input.aaguid,
        name: input.name,
        createdAt: input.at,
        lastUsedAt: null,
      };
      this.passkeyMap.set(record.id, record);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return clonePasskey(record);
    },
    rename: async (userId, id, name) => {
      const p = this.passkeyMap.get(id);
      if (!p || p.userId !== userId) return null;
      p.name = name;
      return clonePasskey(p);
    },
    remove: async ({ userId, id, exceptSessionId, at, audit }) => {
      const p = this.passkeyMap.get(id);
      if (!p || p.userId !== userId) return null;
      let revokedSessions = 0;
      for (const s of this.sessionsById.values()) {
        if (s.passkeyId !== id) continue;
        if (!s.revokedAt && s.id !== exceptSessionId) {
          Object.assign(s, { revokedAt: at, revokedReason: 'passkey_removed' });
          revokedSessions++;
        }
        s.passkeyId = null; // ON DELETE SET NULL
      }
      this.passkeyMap.delete(id);
      for (const event of audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { passkey: clonePasskey(p), revokedSessions };
    },
    recordUse: async (id, signCount, at) => {
      const p = this.passkeyMap.get(id);
      if (p) Object.assign(p, { signCount, lastUsedAt: at });
    },
    createChallenge: async (input) => {
      if (input.userId !== null && !this.people.has(input.userId)) throw new ForeignKeyViolation('webauthn_challenges.userId');
      if ((input.purpose === 'creation') !== (input.userId !== null)) throw new Error('A creation challenge names its person; a sign-in challenge names no one');
      const id = randomUUID();
      this.challenges.set(id, { challenge: input.challenge, purpose: input.purpose, userId: input.userId, expiresAt: input.expiresAt, consumedAt: null });
      return { id };
    },
    consumeChallenge: async (id, purpose, userId, now) => {
      const c = this.challenges.get(id);
      if (!c || c.consumedAt || c.purpose !== purpose || c.expiresAt.getTime() <= now.getTime() || c.userId !== userId) return null;
      c.consumedAt = now;
      return { challenge: c.challenge };
    },
    pruneChallenges: async (before) => {
      let count = 0;
      for (const [id, c] of this.challenges) {
        if (c.expiresAt.getTime() < before.getTime()) {
          this.challenges.delete(id);
          count++;
        }
      }
      return count;
    },
    promptOf: async (userId) => (this.people.has(userId) ? this.passkeyPromptState(userId) : null),
    answerPrompt: async (userId, _action, at) => {
      if (!this.people.has(userId)) return null;
      const { passkeys } = this.passkeyPromptState(userId);
      this.passkeyPrompts.set(userId, applyPasskeyNotNow(this.passkeyPrompts.get(userId), at, passkeys));
      return this.passkeyPromptState(userId);
    },
  };

  private passkeyPromptState(userId: string): PasskeyPromptState {
    let passkeys = 0;
    for (const p of this.passkeyMap.values()) if (p.userId === userId) passkeys++;
    return { prompt: resolvePasskeyPrompt(this.passkeyPrompts.get(userId)), passkeys };
  }

  private pushEvents(audit: readonly AuditEventInput[], at: Date): void {
    for (const event of audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
  }

  /** MUT-434: every live grant of the person, in one step (the Prisma store's single UPDATE). */
  private revokeOAuthGrantsOf(userId: string, reason: OAuthGrantRevokedReason, at: Date): number {
    let count = 0;
    for (const g of this.oauthGrants.values()) {
      if (g.userId === userId && g.revokedAt === null) {
        Object.assign(g, { revokedAt: at, revokedReason: reason });
        count++;
      }
    }
    return count;
  }

  private storeOAuthTokens(grantId: string, tokens: readonly OAuthTokenInput[], at: Date): void {
    for (const t of tokens) {
      if (this.oauthTokens.has(t.digest)) throw new UniqueViolation('oauth_tokens.tokenDigest');
    }
    for (const t of tokens) this.oauthTokens.set(t.digest, { id: t.id, digest: t.digest, grantId, kind: t.kind, createdAt: at, expiresAt: t.expiresAt, rotatedAt: null, successorId: null });
  }

  readonly oauth: OAuthRepository = {
    createClient: async ({ id, clientName, redirectUris, at }) => {
      if (this.oauthClients.has(id)) throw new UniqueViolation('oauth_clients.id');
      const client: OAuthClientRecord = { id, kind: 'DCR', clientName, redirectUris: [...redirectUris], createdAt: at, lastUsedAt: null, metadataExpiresAt: null };
      this.oauthClients.set(id, client);
      return { ...client, redirectUris: [...client.redirectUris] };
    },
    upsertCimdClient: async ({ id, clientName, redirectUris, at, metadataExpiresAt }) => {
      const existing = this.oauthClients.get(id);
      const client: OAuthClientRecord = existing
        ? { ...existing, clientName, redirectUris: [...redirectUris], metadataExpiresAt }
        : { id, kind: 'CIMD', clientName, redirectUris: [...redirectUris], createdAt: at, lastUsedAt: null, metadataExpiresAt };
      this.oauthClients.set(id, client);
      return { ...client, redirectUris: [...client.redirectUris] };
    },
    findClient: async (id) => {
      const c = this.oauthClients.get(id);
      return c ? { ...c, redirectUris: [...c.redirectUris] } : null;
    },
    createAuthorizationRequest: async (input) => {
      if (!this.oauthClients.has(input.clientId)) throw new ForeignKeyViolation('oauth_authorization_requests.clientId');
      const request: OAuthAuthorizationRequestRecord = { ...input, scopes: [...input.scopes], id: randomUUID(), decidedAt: null, userId: null };
      this.oauthRequests.set(request.id, request);
      return { ...request, scopes: [...request.scopes] };
    },
    findAuthorizationRequest: async (id) => {
      const r = this.oauthRequests.get(id);
      return r ? { ...r, scopes: [...r.scopes] } : null;
    },
    decide: async ({ requestId, userId, at, approve, audit }) => {
      const r = this.oauthRequests.get(requestId);
      if (!r || r.decidedAt !== null || r.expiresAt.getTime() <= at.getTime()) return { decided: false };
      if (!this.people.has(userId)) throw new ForeignKeyViolation('oauth_authorization_requests.userId');
      if (approve && this.oauthCodes.has(approve.code.digest)) throw new UniqueViolation('oauth_codes.codeDigest');
      Object.assign(r, { decidedAt: at, userId });
      let grant: OAuthGrantRecord | null = null;
      if (approve) {
        grant = { id: randomUUID(), userId, clientId: r.clientId, redirectUri: r.redirectUri, scopes: [...r.scopes], resource: r.resource, createdAt: at, expiresAt: approve.grantExpiresAt, lastUsedAt: null, revokedAt: null, revokedReason: null };
        this.oauthGrants.set(grant.id, grant);
        this.oauthCodes.set(approve.code.digest, { id: randomUUID(), grantId: grant.id, codeChallenge: r.codeChallenge, redirectUri: r.redirectUri, resource: r.resource, expiresAt: approve.code.expiresAt, consumedAt: null });
        const client = this.oauthClients.get(r.clientId);
        if (client) client.lastUsedAt = at;
      }
      this.pushEvents(audit, at);
      return { decided: true, request: { ...r, scopes: [...r.scopes] }, grant: grant ? { ...grant, scopes: [...grant.scopes] } : null };
    },
    findCode: async (digest) => {
      const code = this.oauthCodes.get(digest);
      return code ? { ...code } : null;
    },
    findGrant: async (grantId) => {
      const g = this.oauthGrants.get(grantId);
      return g ? { ...g, scopes: [...g.scopes] } : null;
    },
    exchangeCode: async ({ digest, at, tokens }) => {
      const code = this.oauthCodes.get(digest);
      if (!code) return { status: 'invalid' };
      if (code.consumedAt !== null) return { status: 'reused', grantId: code.grantId };
      const grant = this.oauthGrants.get(code.grantId);
      if (code.expiresAt.getTime() <= at.getTime() || !grant) return { status: 'invalid' };
      this.storeOAuthTokens(grant.id, tokens, at);
      code.consumedAt = at;
      grant.lastUsedAt = at;
      return { status: 'exchanged', code: { ...code }, grant: { ...grant, scopes: [...grant.scopes] } };
    },
    findToken: async (digest) => {
      const stored = this.oauthTokens.get(digest);
      const grant = stored ? this.oauthGrants.get(stored.grantId) : undefined;
      if (!stored || !grant) return null;
      return { token: oauthTokenRecordOf(stored), grant: { ...grant, scopes: [...grant.scopes] } };
    },
    findTokenById: async (id) => {
      const stored = [...this.oauthTokens.values()].find((t) => t.id === id);
      return stored ? oauthTokenRecordOf(stored) : null;
    },
    rotateRefresh: async ({ tokenId, successorId, at, tokens }) => {
      const stored = [...this.oauthTokens.values()].find((t) => t.id === tokenId);
      if (!stored || stored.kind !== 'REFRESH' || stored.rotatedAt !== null) return false;
      this.storeOAuthTokens(stored.grantId, tokens, at);
      Object.assign(stored, { rotatedAt: at, successorId });
      const grant = this.oauthGrants.get(stored.grantId);
      if (grant) grant.lastUsedAt = at;
      return true;
    },
    revokeGrant: async ({ grantId, userId, reason, at, audit }) => {
      const g = this.oauthGrants.get(grantId);
      if (!g || g.revokedAt !== null || (userId !== undefined && g.userId !== userId)) return false;
      Object.assign(g, { revokedAt: at, revokedReason: reason });
      this.pushEvents(audit, at);
      return true;
    },
    revokeAllForUser: async ({ userId, reason, at, audit }) => {
      const count = this.revokeOAuthGrantsOf(userId, reason, at);
      if (count > 0) this.pushEvents(audit, at);
      return count;
    },
    listLiveGrants: async (userId, at) =>
      [...this.oauthGrants.values()]
        .filter((g) => g.userId === userId && g.revokedAt === null && g.expiresAt.getTime() > at.getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((g) => {
          const client = this.oauthClients.get(g.clientId);
          return { ...g, scopes: [...g.scopes], clientName: client?.clientName ?? '', clientKind: client?.kind ?? 'DCR' };
        }),
    touchGrant: async (grantId, at) => {
      const g = this.oauthGrants.get(grantId);
      if (g) g.lastUsedAt = at;
    },
    cleanup: async ({ at, before, clientsBefore }) => {
      let requests = 0;
      let codes = 0;
      let tokens = 0;
      let clients = 0;
      for (const [id, r] of this.oauthRequests) {
        if (r.expiresAt.getTime() > at.getTime()) continue;
        this.oauthRequests.delete(id);
        requests++;
      }
      for (const [digest, c] of this.oauthCodes) {
        if (c.expiresAt.getTime() > at.getTime()) continue;
        this.oauthCodes.delete(digest);
        codes++;
      }
      // A grant ended at its revoke, or else at its absolute expiry.
      const deadGrants = new Set([...this.oauthGrants.values()].filter((g) => (g.revokedAt ?? g.expiresAt).getTime() <= before.getTime()).map((g) => g.id));
      for (const [digest, t] of this.oauthTokens) {
        if (!deadGrants.has(t.grantId) && t.expiresAt.getTime() > before.getTime()) continue;
        this.oauthTokens.delete(digest);
        tokens++;
      }
      const granted = new Set([...this.oauthGrants.values()].map((g) => g.clientId));
      for (const [id, c] of this.oauthClients) {
        if (granted.has(id) || c.createdAt.getTime() > clientsBefore.getTime()) continue;
        for (const [rid, r] of this.oauthRequests) if (r.clientId === id) this.oauthRequests.delete(rid);
        this.oauthClients.delete(id);
        clients++;
      }
      return { requests, codes, tokens, clients };
    },
  };

  /** `exceptSessionId` (MUT-237): a person's own session stays live while every other one is revoked. */
  private revokeSessionsOf(userId: string, reason: string, at: Date, exceptSessionId?: string): number {
    let count = 0;
    for (const s of this.sessionsById.values()) {
      if (s.userId === userId && !s.revokedAt && s.id !== exceptSessionId) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        count++;
      }
    }
    return count;
  }

  /**
   * A user, their personal organization and its membership (plus a firm's), as `users.create` and MUT-366's
   * `redeemSignup` write them. Every check runs before the first write, so a refusal leaves nothing behind (the
   * Prisma transaction's guarantee).
   */
  private insertPerson(input: Omit<CreateUserInput, 'setupLink'> & { status: UserStatus; emailVerifiedAt: Date | null }) {
    for (const u of this.people.values()) {
      if (u.email === input.email) throw new UniqueViolation('users.email');
    }
    if (input.organizationId && !this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('memberships.organizationId');
    for (const o of this.orgs.values()) {
      if (o.slug === input.personal.slug) throw new UniqueViolation('organizations.slug');
    }
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      locale: input.locale,
      status: input.status,
      failedSignIns: 0,
      lockedUntil: null,
      passwordChangedAt: input.at,
      lastSignInAt: null,
      emailVerifiedAt: input.emailVerifiedAt,
      malafatSuggestions: null,
      trialPrompt: null,
      closure: null,
      createdAt: input.at,
      updatedAt: input.at,
    };
    const personalOrganization: Organization = { id: randomUUID(), ...input.personal, personalOwnerUserId: user.id, ownerUserId: user.id, profileType: 'PERSONAL', version: 1, firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null, createdAt: new Date() };
    const memberships: MembershipRecord[] = [personalOrganization.id, ...(input.organizationId ? [input.organizationId] : [])].map((organizationId) => ({
      userId: user.id,
      organizationId,
      role: roleForNewMembership(this.orgs.get(organizationId) ?? personalOrganization),
      createdAt: input.at,
    }));
    this.people.set(user.id, user);
    this.orgs.set(personalOrganization.id, personalOrganization);
    for (const m of memberships) this.members.set(membershipKey(user.id, m.organizationId), m);
    return { user: { ...user }, memberships: memberships.map((m) => ({ ...m })), personalOrganization: { ...personalOrganization } };
  }

  private cancelOpenSetupLinks(userId: string, at: Date, options: { mailedOnly?: boolean; except?: string } = {}): void {
    for (const link of this.setupLinks.values()) {
      if (link.userId !== userId || link.usedAt !== null || link.cancelledAt !== null || link.id === options.except) continue;
      if (options.mailedOnly && !link.mailed) continue;
      link.cancelledAt = at;
    }
  }

  private assertSetupDigestFree(tokenDigest: string): void {
    for (const link of this.setupLinks.values()) {
      if (link.tokenDigest === tokenDigest) throw new UniqueViolation('account_setup_tokens.tokenDigest');
    }
  }

  private storeSetupLink(userId: string, input: { tokenDigest: string; purpose: PersonSetupLinkPurpose; expiresAt: Date }, at: Date, mailed = false): PersonSetupLinkRecord {
    const record: PersonSetupLinkRecord = { id: randomUUID(), userId, email: null, locale: null, ...input, mailed, createdAt: at, usedAt: null, cancelledAt: null };
    this.setupLinks.set(record.id, record);
    return record;
  }

  // Each method runs to completion without an await, which is the in-memory stand-in for the Prisma transaction and row lock.
  readonly accountSetup: AccountSetupRepository = {
    issue: async (input) => {
      const person = this.people.get(input.userId);
      if (!person) throw new ForeignKeyViolation('account_setup_tokens.userId');
      // Re-checked here, not only in the route, so a disable that lands first can never be followed by a fresh link.
      if (!SETUP_LINK_STATUSES.has(person.status)) throw new StateConflict('user', 'USER_DISABLED');
      this.assertSetupDigestFree(input.tokenDigest);
      if (input.lock) {
        // Stamping passwordChangedAt makes the session check refuse a session a racing sign-in inserts after the lock.
        Object.assign(person, { passwordHash: null, passwordChangedAt: input.at, updatedAt: input.at });
        this.revokeSessionsOf(person.id, 'setup_link_lock', input.at);
      }
      // MUT-366 (review #2): a mailed (recovery) link replaces only earlier mailed links; an operator link replaces all.
      this.cancelOpenSetupLinks(input.userId, input.at, input.mailed ? { mailedOnly: true } : {});
      const record = this.storeSetupLink(input.userId, { tokenDigest: input.tokenDigest, purpose: input.purpose, expiresAt: input.expiresAt }, input.at, input.mailed ?? false);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { ...record };
    },
    findByDigest: async (tokenDigest) => clone([...this.setupLinks.values()].find((l) => l.tokenDigest === tokenDigest)),
    redeem: async (input) => {
      const link = [...this.setupLinks.values()].find((l) => l.tokenDigest === input.tokenDigest);
      const person = link?.userId ? this.people.get(link.userId) : undefined;
      const claimable = link && person && link.usedAt === null && link.cancelledAt === null && input.at < link.expiresAt && SETUP_LINK_STATUSES.has(person.status);
      if (!claimable) return null;
      link.usedAt = input.at;
      // MUT-366 (review #2): the password is set; any other open link (operator or mailed) is spent with it.
      this.cancelOpenSetupLinks(person.id, input.at, { except: link.id });
      Object.assign(person, { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at });
      // MUT-366 (D18): a mailed link reached the person through their mailbox.
      if (link.mailed && person.emailVerifiedAt === null) person.emailVerifiedAt = input.at;
      this.revokeSessionsOf(person.id, 'password_set', input.at);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      if (this.recordTermsAcceptance(person.id, input.terms, input.at).created) {
        for (const event of input.termsAudit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      }
      return { ...person };
    },
    issueSignup: async (input) => {
      this.assertSetupDigestFree(input.tokenDigest);
      for (const link of this.setupLinks.values()) {
        if (link.purpose === 'SIGNUP' && link.email === input.email && link.usedAt === null && link.cancelledAt === null) link.cancelledAt = input.at;
      }
      const record: SignupLinkRecord = {
        id: randomUUID(),
        purpose: 'SIGNUP',
        userId: null,
        email: input.email,
        locale: input.locale,
        tokenDigest: input.tokenDigest,
        mailed: true,
        createdAt: input.at,
        expiresAt: input.expiresAt,
        usedAt: null,
        cancelledAt: null,
        domainClass: input.domainClass,
        domainReasons: [...input.domainReasons],
      };
      this.setupLinks.set(record.id, record);
      return { ...record };
    },
    redeemSignup: async (input) => {
      const link = [...this.setupLinks.values()].find((l) => l.tokenDigest === input.tokenDigest);
      if (!link || link.purpose !== 'SIGNUP' || link.usedAt !== null || link.cancelledAt !== null || input.at >= link.expiresAt) return null;
      const email = link.email;
      if ([...this.people.values()].some((u) => u.email === email)) return null;
      const { user, personalOrganization } = this.insertPerson({
        email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        locale: link.locale,
        personal: input.personal,
        at: input.at,
        status: input.status,
        emailVerifiedAt: input.at,
      });
      link.usedAt = input.at;
      if (input.trialStartsAt) this.trialStarts.set(user.id, input.trialStartsAt);
      // MUT-367: a PENDING_REVIEW account waits on its review row, written with it.
      if (input.review) {
        const review: SignupReviewRecord = { id: randomUUID(), userId: user.id, ...input.review, reasons: [...input.review.reasons], createdAt: input.at, notifiedAt: null, decidedAt: null, decision: null, decidedBy: null };
        this.reviews.set(review.id, review);
      }
      this.recordTermsAcceptance(user.id, input.terms, input.at);
      for (const event of input.auditFor({ userId: user.id, personalOrganizationId: personalOrganization.id })) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { user, personalOrganization };
    },
    pruneSignupLinks: async (expiredBefore) => {
      let count = 0;
      for (const [id, link] of this.setupLinks) {
        if (link.purpose === 'SIGNUP' && link.usedAt === null && link.expiresAt < expiredBefore) {
          this.setupLinks.delete(id);
          count++;
        }
      }
      return count;
    },
  };

  readonly memberships: MembershipRepository = {
    grant: async (userId, organizationId, at) => {
      if (!this.people.has(userId)) throw new ForeignKeyViolation('memberships.userId');
      if (!this.orgs.has(organizationId)) throw new ForeignKeyViolation('memberships.organizationId');
      const key = membershipKey(userId, organizationId);
      const existing = this.members.get(key);
      if (existing) return { membership: { ...existing }, created: false };
      const membership: MembershipRecord = { userId, organizationId, role: roleForNewMembership(this.orgs.get(organizationId)!), createdAt: at };
      this.members.set(key, membership);
      return { membership: { ...membership }, created: true };
    },
    revoke: async (userId, organizationId) => this.members.delete(membershipKey(userId, organizationId)),
    grantOwner: async (userId, organizationId, at, maxOwners, audit) => {
      const organization = this.orgs.get(organizationId);
      if (!organization) return { kind: 'not_found' };
      if (!this.people.has(userId)) throw new ForeignKeyViolation('memberships.userId');
      const members = [...this.members.values()].filter((m) => m.organizationId === organizationId);
      const existing = this.members.get(membershipKey(userId, organizationId)) ?? null;
      const refusal = grantOwnerRefusal(organization, existing?.role ?? null, ownerIdsOf(organization, members).length, maxOwners);
      if (refusal) return refusal;
      const record = () => this.events.push({ id: randomUUID(), createdAt: at, ...audit });
      if (existing) {
        const granted = this.events.some(
          (e) => e.organizationId === organizationId && e.entityType === 'user' && e.entityId === userId && e.action === 'membership.granted' && e.metadata?.role === 'OWNER',
        );
        if (!granted) record();
        return { kind: 'granted', membership: { ...existing }, created: false };
      }
      const membership: MembershipRecord = { userId, organizationId, role: 'OWNER', createdAt: at };
      this.members.set(membershipKey(userId, organizationId), membership);
      record();
      return { kind: 'granted', membership: { ...membership }, created: true };
    },
    removeOwner: async (input) => {
      const organization = this.orgs.get(input.organizationId);
      if (!organization) return { kind: 'not_found' };
      const roleOf = (userId: string) => this.members.get(membershipKey(userId, input.organizationId))?.role ?? null;
      const decision = removeOwnerDecision(organization, input, roleOf(input.actorId), roleOf(input.userId));
      if (decision.kind !== 'removed') return decision;
      this.members.delete(membershipKey(input.userId, input.organizationId));
      await this.audit.append(ownerRemovedAudit(input, decision.reason));
      return decision;
    },
    listOwnersOf: async (organizationIds) => {
      const wanted = new Set(organizationIds);
      return [...this.members.values()]
        .filter((m) => wanted.has(m.organizationId) && m.role === 'OWNER')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.userId.localeCompare(b.userId))
        .flatMap((m) => {
          const person = this.people.get(m.userId);
          return person ? [{ organizationId: m.organizationId, userId: m.userId, displayName: person.displayName, email: person.email, createdAt: m.createdAt }] : [];
        });
    },
    find: async (userId, organizationId) => clone(this.members.get(membershipKey(userId, organizationId))),
    listByUser: async (userId) => [...this.members.values()].filter((m) => m.userId === userId).map((m) => ({ ...m })),
    listByOrganization: async (organizationId) =>
      [...this.members.values()].filter((m) => m.organizationId === organizationId).map((m) => ({ ...m })),
  };

  readonly integrations: IntegrationRepository = {
    findByOrganizationAndProvider: async (organizationId, provider) =>
      clone([...this.ints.values()].find((i) => i.organizationId === organizationId && i.provider === provider)),
    findByProviderAndTenant: async (provider, externalTenantId) =>
      clone([...this.ints.values()].find((i) => i.provider === provider && i.externalTenantId === externalTenantId)),
    listByOrganization: async (organizationId) =>
      [...this.ints.values()].filter((i) => i.organizationId === organizationId).map((i) => ({ ...i })),
    connect: async (input: ConnectIntegrationInput) => {
      const existing = [...this.ints.values()].find(
        (i) => i.organizationId === input.organizationId && i.provider === input.provider,
      );
      const tenantTaken = [...this.ints.values()].find(
        (i) => i.provider === input.provider && i.externalTenantId === input.externalTenantId && i.id !== existing?.id,
      );
      if (tenantTaken) throw new UniqueViolation('integrations.provider_externalTenantId');
      if (existing) {
        existing.externalTenantId = input.externalTenantId;
        existing.displayName = input.displayName;
        existing.status = 'CONNECTED';
        existing.connectedByApiKeyId = input.connectedByApiKeyId;
        existing.connectedAt = input.at;
        existing.disconnectedAt = null;
        return { ...existing };
      }
      const record: IntegrationRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        provider: input.provider,
        externalTenantId: input.externalTenantId,
        displayName: input.displayName,
        status: 'CONNECTED',
        connectedByApiKeyId: input.connectedByApiKeyId,
        connectedAt: input.at,
        disconnectedAt: null,
      };
      this.ints.set(record.id, record);
      return { ...record };
    },
    disconnect: async (id, at) => {
      const i = this.ints.get(id);
      if (!i) return null;
      i.status = 'DISCONNECTED';
      i.disconnectedAt = at;
      return { ...i };
    },
  };

  readonly audit: AuditRepository = {
    append: async (event: AuditEventInput) => {
      this.lastAuditAtMs = Math.max(Date.now(), this.lastAuditAtMs + 1);
      const record: AuditEventRecord = { id: randomUUID(), createdAt: new Date(this.lastAuditAtMs), ...event };
      this.events.push(record);
      return { ...record };
    },
    listByOrganization: async (organizationId, limit) =>
      this.events
        .filter((e) => e.organizationId === organizationId)
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e })),
    list: async (organizationId, filter: AuditFilter, page) =>
      paginate(
        this.events.filter(
          (e) =>
            e.organizationId === organizationId &&
            (!filter.entityType || e.entityType === filter.entityType) &&
            (!filter.entityId || e.entityId === filter.entityId) &&
            (!filter.action || e.action === filter.action) &&
            !(filter.excludeEntityTypes ?? []).includes(e.entityType) &&
            !(filter.excludeActions ?? []).includes(e.action),
        ),
        page,
      ),
  };

  readonly attachments: AttachmentRepository = {
    create: async (input: Omit<CreateAttachmentInput, 'storageKey'>, at) => {
      const record: AttachmentRecord = { id: randomUUID(), ...input, storageKey: '', status: 'PENDING_UPLOAD', createdAt: at, completedAt: null, deletedAt: null };
      this.files.set(record.id, record);
      return { ...record };
    },
    setKey: async (organizationId, id, storageKey) => {
      const f = this.files.get(id);
      if (!f || f.organizationId !== organizationId) return null;
      f.storageKey = storageKey;
      return { ...f };
    },
    getById: async (organizationId, id) => {
      const f = this.files.get(id);
      return f && f.organizationId === organizationId && !f.deletedAt ? { ...f } : null;
    },
    list: async (organizationId, filter: AttachmentFilter, page) =>
      paginate(
        [...this.files.values()].filter(
          (f) =>
            f.organizationId === organizationId &&
            f.status === 'READY' &&
            !f.deletedAt &&
            (!filter.customerId || f.customerId === filter.customerId) &&
            (!filter.projectId || f.projectId === filter.projectId) &&
            (!filter.paymentId || f.paymentId === filter.paymentId) &&
            (!filter.kind || f.kind === filter.kind),
        ),
        page,
      ),
    complete: async (organizationId, id, at) => {
      const f = this.files.get(id);
      if (!f || f.organizationId !== organizationId || f.deletedAt) return null;
      if (f.status !== 'READY') {
        f.status = 'READY';
        f.completedAt = at;
      }
      return { ...f };
    },
    softDelete: async (organizationId, id, at) => {
      const f = this.files.get(id);
      if (!f || f.organizationId !== organizationId) return null;
      if (!f.deletedAt) f.deletedAt = at;
      return { ...f };
    },
  };

  readonly idempotency: IdempotencyRepository = {
    claim: async ({ organizationId, key, operation, fingerprint, at }): Promise<IdempotencyClaim> => {
      const id = `${organizationId}:${key}`;
      const existing = this.idem.get(id);
      const outcome = resolveClaim(existing, operation, fingerprint);
      if (outcome === 'new') {
        this.idem.set(id, { organizationId, key, operation, fingerprint, status: 'PENDING', responseStatus: null, responseBody: null, createdAt: at, completedAt: null });
        return { kind: 'new' };
      }
      if (outcome === 'replay') return { kind: 'replay', record: { ...existing! } };
      return { kind: outcome };
    },
    complete: async ({ organizationId, key, responseStatus, responseBody, at }) => {
      const r = this.idem.get(`${organizationId}:${key}`);
      if (!r) return;
      r.status = 'COMPLETED';
      r.responseStatus = responseStatus;
      r.responseBody = responseBody;
      r.completedAt = at;
    },
    fail: async ({ organizationId, key }) => {
      this.idem.delete(`${organizationId}:${key}`);
    },
    get: async (organizationId, key) => clone(this.idem.get(`${organizationId}:${key}`)),
  };

  /** MUT-131: same state machine as `idempotency`, keyed by user instead of organization. */
  readonly userIdempotency: UserIdempotencyRepository = {
    claim: async ({ userId, key, operation, fingerprint, at }): Promise<UserIdempotencyClaim> => {
      const id = `${userId}:${key}`;
      const existing = this.userIdem.get(id);
      const outcome = resolveClaim(existing, operation, fingerprint);
      if (outcome === 'new') {
        this.userIdem.set(id, { userId, key, operation, fingerprint, status: 'PENDING', responseStatus: null, responseBody: null, createdAt: at, completedAt: null });
        return { kind: 'new' };
      }
      if (outcome === 'replay') return { kind: 'replay', record: { ...existing! } };
      return { kind: outcome };
    },
    complete: async ({ userId, key, responseStatus, responseBody, at }) => {
      const r = this.userIdem.get(`${userId}:${key}`);
      if (!r) return;
      r.status = 'COMPLETED';
      r.responseStatus = responseStatus;
      r.responseBody = responseBody;
      r.completedAt = at;
    },
    fail: async ({ userId, key }) => {
      this.userIdem.delete(`${userId}:${key}`);
    },
    get: async (userId, key) => clone(this.userIdem.get(`${userId}:${key}`)),
  };

  readonly externalReferences: ExternalReferenceRepository = {
    link: async (input, at) => {
      for (const r of this.refs.values()) {
        if (r.organizationId === input.organizationId && r.provider === input.provider && r.entityType === input.entityType && r.externalId === input.externalId) {
          throw new UniqueViolation('external_references.organizationId_provider_entityType_externalId');
        }
        if (r.provider === input.provider && r.entityType === input.entityType && r.entityId === input.entityId) {
          throw new UniqueViolation('external_references.provider_entityType_entityId');
        }
      }
      const record: ExternalReferenceRecord = { id: randomUUID(), ...input, createdAt: at };
      this.refs.set(record.id, record);
      return { ...record };
    },
    findByExternalId: async (organizationId, provider, entityType, externalId) =>
      clone([...this.refs.values()].find((r) => r.organizationId === organizationId && r.provider === provider && r.entityType === entityType && r.externalId === externalId)),
    findByExternalIds: async (organizationId, provider, entityType, externalIds) => {
      const wanted = new Set(externalIds);
      return [...this.refs.values()]
        .filter((r) => r.organizationId === organizationId && r.provider === provider && r.entityType === entityType && wanted.has(r.externalId))
        .map((r) => ({ ...r }));
    },
    findByEntities: async (organizationId, entityType, entityIds) => {
      const wanted = new Set(entityIds);
      return [...this.refs.values()]
        .filter((r) => r.organizationId === organizationId && r.entityType === entityType && wanted.has(r.entityId))
        .map((r) => ({ ...r }));
    },
  };

  readonly customers: CustomerRepository = {
    create: async (input: CreateCustomerInput, at, reference?: ExternalReferenceInput) => {
      if (!this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('customers.organizationId');
      const record: CustomerRecord = { id: randomUUID(), ...input, vatTreatment: input.vatTreatment ?? null, status: 'ACTIVE', archivedAt: null, version: 1, createdAt: at, updatedAt: at };
      if (reference) {
        // "atomic": the reference is checked before the customer is stored
        await this.externalReferences.link({ organizationId: input.organizationId, entityType: 'CUSTOMER', entityId: record.id, ...reference }, at);
      }
      this.custs.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const c = this.custs.get(id);
      return c && c.organizationId === organizationId ? { ...c } : null;
    },
    list: async (organizationId, filter: CustomerFilter, page) => {
      const ids = await this.entityIdsForExternal(organizationId, 'CUSTOMER', filter);
      const rows = [...this.custs.values()].filter(
        (c) => c.organizationId === organizationId && (!filter.status || c.status === filter.status) && (ids === null || ids.has(c.id)),
      );
      return paginate(rows, page);
    },
    update: async (organizationId, id, expectedVersion, patch: UpdateCustomerPatch, at) => {
      const c = this.custs.get(id);
      if (!c || c.organizationId !== organizationId) return { kind: 'not_found' };
      if (c.version !== expectedVersion) return { kind: 'stale', record: { ...c } };
      if (patch.name !== undefined) c.name = patch.name;
      if (patch.email !== undefined) c.email = patch.email;
      if (patch.phone !== undefined) c.phone = patch.phone;
      if (patch.notes !== undefined) c.notes = patch.notes;
      if (patch.vatTreatment !== undefined) c.vatTreatment = patch.vatTreatment;
      c.version += 1;
      c.updatedAt = at;
      return { kind: 'updated', record: { ...c } };
    },
    archive: async (organizationId, id, at) => {
      const c = this.custs.get(id);
      if (!c || c.organizationId !== organizationId) return null;
      if (c.status === 'ACTIVE') {
        c.status = 'ARCHIVED';
        c.archivedAt = at;
        c.version += 1;
        c.updatedAt = at;
      }
      return { ...c };
    },
  };

  readonly projects: ProjectRepository = {
    create: async (input: CreateProjectInput, at, reference?: ExternalReferenceInput) => {
      const customer = this.custs.get(input.customerId);
      if (!customer || customer.organizationId !== input.organizationId) throw new ForeignKeyViolation('projects.customerId');
      const record: ProjectRecord = { id: randomUUID(), ...input, vatTreatment: input.vatTreatment ?? null, status: 'ACTIVE', archivedAt: null, version: 1, createdAt: at, updatedAt: at };
      if (reference) {
        await this.externalReferences.link({ organizationId: input.organizationId, entityType: 'PROJECT', entityId: record.id, ...reference }, at);
      }
      this.projs.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const p = this.projs.get(id);
      return p && p.organizationId === organizationId ? { ...p } : null;
    },
    list: async (organizationId, filter: ProjectFilter, page) => {
      const ids = await this.entityIdsForExternal(organizationId, 'PROJECT', filter);
      const rows = [...this.projs.values()].filter(
        (p) =>
          p.organizationId === organizationId &&
          (!filter.status || p.status === filter.status) &&
          (!filter.customerId || p.customerId === filter.customerId) &&
          (!filter.currency || p.currency === filter.currency) &&
          (ids === null || ids.has(p.id)),
      );
      return paginate(rows, page);
    },
    update: async (organizationId, id, expectedVersion, patch: UpdateProjectPatch, at) => {
      const p = this.projs.get(id);
      if (!p || p.organizationId !== organizationId) return { kind: 'not_found' };
      if (p.version !== expectedVersion) return { kind: 'stale', record: { ...p } };
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.currency !== undefined) p.currency = patch.currency;
      if (patch.vatTreatment !== undefined) p.vatTreatment = patch.vatTreatment;
      p.version += 1;
      p.updatedAt = at;
      return { kind: 'updated', record: { ...p } };
    },
    archive: async (organizationId, id, at) => {
      const p = this.projs.get(id);
      if (!p || p.organizationId !== organizationId) return null;
      if (p.status === 'ACTIVE') {
        p.status = 'ARCHIVED';
        p.archivedAt = at;
        p.version += 1;
        p.updatedAt = at;
      }
      return { ...p };
    },
    countActiveByCustomer: async (organizationId, customerId) =>
      [...this.projs.values()].filter((p) => p.organizationId === organizationId && p.customerId === customerId && p.status === 'ACTIVE').length,
    hasPostedActivity: async (organizationId, id) =>
      [...this.agrs.values()].some((a) => a.organizationId === organizationId && a.projectId === id),
  };

  readonly feeProposals: FeeProposalRepository = {
    create: async (input: CreateFeeProposalInput, at) => {
      const project = this.projs.get(input.projectId);
      if (!project || project.organizationId !== input.organizationId) throw new ForeignKeyViolation('fee_proposals.projectId');
      if (await this.feeProposals.findOpenByProject(input.organizationId, input.projectId)) throw new UniqueViolation('fee_proposals.open_per_project');
      const { commissionRateBasisPoints, upfrontTreatment, ...rest } = input;
      const record: FeeProposalRecord = {
        id: randomUUID(),
        ...rest,
        commissionRateBasisPoints: commissionRateBasisPoints ?? null,
        upfrontTreatment: upfrontTreatment ?? null,
        status: 'PROPOSED',
        clientApprovedOn: null,
        clientApprovalNote: null,
        agreedAmountMinor: null,
        withdrawnAt: null,
        withdrawnReason: null,
        agreementId: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      this.props.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const p = this.props.get(id);
      return p && p.organizationId === organizationId ? { ...p } : null;
    },
    list: async (organizationId, filter: FeeProposalFilter, page) =>
      paginate(
        [...this.props.values()].filter(
          (p) =>
            p.organizationId === organizationId &&
            (!filter.projectId || p.projectId === filter.projectId) &&
            (!filter.customerId || p.customerId === filter.customerId) &&
            (!filter.status || p.status === filter.status) &&
            (filter.open === undefined || OPEN_PROPOSAL_STATUSES.includes(p.status) === filter.open),
        ),
        page,
      ),
    findOpenByProject: async (organizationId, projectId) =>
      clone([...this.props.values()].find((p) => p.organizationId === organizationId && p.projectId === projectId && OPEN_PROPOSAL_STATUSES.includes(p.status))),
    transition: async (organizationId, id, from, patch: FeeProposalTransitionPatch, at) => {
      const p = this.props.get(id);
      if (!p || p.organizationId !== organizationId) return { kind: 'not_found' };
      if (!from.includes(p.status)) return { kind: 'wrong_status', record: { ...p } };
      const { status, ...rest } = patch;
      p.status = status;
      if (rest.clientApprovedOn !== undefined) p.clientApprovedOn = rest.clientApprovedOn;
      if (rest.clientApprovalNote !== undefined) p.clientApprovalNote = rest.clientApprovalNote;
      if (rest.agreedAmountMinor !== undefined) p.agreedAmountMinor = rest.agreedAmountMinor;
      if (rest.withdrawnAt !== undefined) p.withdrawnAt = rest.withdrawnAt;
      if (rest.withdrawnReason !== undefined) p.withdrawnReason = rest.withdrawnReason;
      if (rest.agreementId !== undefined) p.agreementId = rest.agreementId;
      p.version += 1;
      p.updatedAt = at;
      return { kind: 'updated', record: { ...p } };
    },
  };

  readonly vatRates: VatRateRepository = {
    upsert: async (organizationId, rateBasisPoints, effectiveFrom, at) => {
      const existing = [...this.rates.values()].find((r) => r.organizationId === organizationId && r.effectiveFrom === effectiveFrom);
      if (existing) return existing.rateBasisPoints === rateBasisPoints ? { outcome: 'unchanged', record: { ...existing } } : { outcome: 'conflict', record: { ...existing } };
      const record: VatRateRecord = { id: randomUUID(), organizationId, rateBasisPoints, effectiveFrom, createdAt: at };
      this.rates.set(record.id, record);
      return { outcome: 'created', record: { ...record } };
    },
    list: async (organizationId) =>
      [...this.rates.values()]
        .filter((r) => r.organizationId === organizationId)
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
        .map((r) => ({ ...r })),
    effectiveOn: async (organizationId, date) => {
      const candidates = [...this.rates.values()].filter((r) => r.organizationId === organizationId && r.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
      return clone(candidates[0]);
    },
  };

  readonly agreements: AgreementRepository = {
    create: async (input: CreateAgreementInput, at) => {
      const project = this.projs.get(input.projectId);
      if (!project || project.organizationId !== input.organizationId) throw new ForeignKeyViolation('agreements.projectId');
      const { installments: specs, approveProposal, commissionRateBasisPoints, upfrontTreatment, ...rest } = input;
      if (new Set(specs.map((x) => x.position)).size !== specs.length) throw new UniqueViolation('installments.agreementId_position');
      const agreement: AgreementRecord = {
        id: randomUUID(),
        ...rest,
        status: 'ACTIVE',
        cancelEffectiveMonth: null,
        cancelEffectiveDate: null,
        finalMonth: null,
        cancelledAt: null,
        commissionRateBasisPoints: commissionRateBasisPoints ?? null,
        upfrontTreatment: upfrontTreatment ?? null,
        outcome: null,
        outcomeDate: null,
        awardedAmountMinor: null,
        outcomeNote: null,
        outcomeRecordedAt: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      if (approveProposal) {
        // M8: the approval rides the creation; a proposal that moved since the route checked it refuses the whole create.
        const proposal = this.props.get(approveProposal.id);
        if (!proposal || proposal.organizationId !== input.organizationId || proposal.projectId !== input.projectId || proposal.status !== 'PROPOSED') {
          throw new StateConflict('fee_proposal', 'PROPOSAL_NOT_OPEN');
        }
        proposal.status = 'APPROVED';
        proposal.agreedAmountMinor = approveProposal.agreedAmountMinor;
        proposal.clientApprovedOn = approveProposal.approvedOn;
        proposal.clientApprovalNote = approveProposal.note;
        proposal.agreementId = agreement.id;
        proposal.version += 1;
        proposal.updatedAt = at;
      }
      this.agrs.set(agreement.id, agreement);
      const installments = specs.map((spec) => {
        const record: InstallmentRecord = { id: randomUUID(), organizationId: input.organizationId, agreementId: agreement.id, ...spec, isCommission: spec.isCommission ?? false, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, version: 1 };
        this.insts.set(record.id, record);
        return { ...record };
      });
      return { agreement: { ...agreement }, installments };
    },
    getById: async (organizationId, id) => {
      const a = this.agrs.get(id);
      return a && a.organizationId === organizationId ? { ...a } : null;
    },
    list: async (organizationId, filter: AgreementFilter, page) =>
      paginate(
        [...this.agrs.values()].filter(
          (a) =>
            a.organizationId === organizationId &&
            (!filter.projectId || a.projectId === filter.projectId) &&
            (!filter.customerId || a.customerId === filter.customerId) &&
            (!filter.status || a.status === filter.status) &&
            (!filter.type || a.type === filter.type),
        ),
        page,
      ),
    listInstallments: async (organizationId, agreementId) =>
      [...this.insts.values()].filter((i) => i.organizationId === organizationId && i.agreementId === agreementId).sort((a, b) => a.position - b.position).map((i) => ({ ...i })),
    getInstallment: async (organizationId, id) => {
      const i = this.insts.get(id);
      return i && i.organizationId === organizationId ? { ...i } : null;
    },
    postInstallment: async (organizationId, installmentId, input: PostingInput) => {
      const i = this.insts.get(installmentId);
      if (!i || i.organizationId !== organizationId) return null;
      if (i.receivableId) {
        const existing = this.recs.get(i.receivableId);
        if (!existing) return null;
        return { installment: { ...i }, receivable: { ...existing }, created: false };
      }
      if (i.voidedAt) return null;
      const a = this.agrs.get(i.agreementId);
      if (!a) return null;
      const receivable = this.newReceivable({ organizationId, customerId: a.customerId, projectId: a.projectId, agreementId: a.id, origin: 'INSTALLMENT', originId: i.id, currency: a.currency, netMinor: i.netMinor, vatMinor: i.vatMinor, grossMinor: i.grossMinor, vatTreatment: i.vatTreatment, vatRateBasisPoints: i.rateBasisPoints, dueDate: input.dueDate, postingDate: input.postingDate, postedAt: input.at });
      i.postedAt = input.at;
      i.postingDate = input.postingDate;
      i.receivableId = receivable.id;
      i.version += 1;
      return { installment: { ...i }, receivable: { ...receivable }, created: true };
    },
    listUnpostedDue: async (organizationId, today) =>
      [...this.insts.values()]
        .filter((i) => i.organizationId === organizationId && !i.receivableId && !i.voidedAt && this.agrs.get(i.agreementId)?.status === 'ACTIVE' && (i.triggerType === 'IMMEDIATE' || (i.triggerType === 'DATE' && (i.triggerDate ?? '9999') <= today)))
        .map((i) => ({ ...i })),
    applySupplement: async (organizationId, agreementId, input: ApplySupplementInput, at) => {
      const a = this.agrs.get(agreementId);
      if (!a || a.organizationId !== organizationId) return { kind: 'not_found' };
      if (a.version !== input.expectedVersion) return { kind: 'stale', record: { agreement: { ...a }, supplement: null as unknown as SupplementRecord, installments: [] } };
      for (const u of input.installmentUpdates) {
        const i = this.insts.get(u.id);
        if (!i) throw new ForeignKeyViolation('installments.id');
        Object.assign(i, { amountMinor: u.amountMinor, netMinor: u.netMinor, vatMinor: u.vatMinor, grossMinor: u.grossMinor, version: i.version + 1 });
      }
      for (const spec of input.newInstallments) {
        const record: InstallmentRecord = { id: randomUUID(), organizationId, agreementId, ...spec, isCommission: spec.isCommission ?? false, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, version: 1 };
        this.insts.set(record.id, record);
      }
      Object.assign(a, { ...input.totals, version: a.version + 1, updatedAt: at });
      const supplement: SupplementRecord = { id: randomUUID(), organizationId, agreementId, ...input.supplement, resultingAmountMinor: input.totals.amountMinor, createdAt: at };
      this.supps.set(supplement.id, supplement);
      return { kind: 'updated', record: { agreement: { ...a }, supplement: { ...supplement }, installments: await this.agreements.listInstallments(organizationId, agreementId) } };
    },
    listSupplements: async (organizationId, agreementId) =>
      [...this.supps.values()].filter((x) => x.organizationId === organizationId && x.agreementId === agreementId).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()).map((x) => ({ ...x })),
    cancel: async (organizationId, agreementId, input, at) => {
      const a = this.agrs.get(agreementId);
      if (!a || a.organizationId !== organizationId) return null;
      if (a.status === 'ACTIVE' && a.outcome === null) {
        a.status = 'CANCELLED';
        a.cancelledAt = at;
        a.cancelEffectiveMonth = input.cancelEffectiveMonth;
        a.cancelEffectiveDate = input.cancelEffectiveDate ?? null;
        a.finalMonth = input.finalMonth;
        a.version += 1;
        a.updatedAt = at;
        for (const i of this.insts.values()) if (i.agreementId === agreementId && !i.receivableId && !i.voidedAt) i.voidedAt = at;
      }
      return { ...a };
    },
    listRetainers: async (organizationId) =>
      [...this.agrs.values()].filter((a) => a.organizationId === organizationId && a.type === 'RECURRING' && (a.status === 'ACTIVE' || a.cancelEffectiveMonth !== null)).map((a) => ({ ...a })),
    listCharges: async (organizationId, agreementId) =>
      [...this.charges.values()].filter((c) => c.organizationId === organizationId && c.agreementId === agreementId).sort((x, y) => (x.serviceMonth < y.serviceMonth ? -1 : 1)).map((c) => ({ ...c })),
    createPostedCharge: async (input: CreateChargeInput, at) => {
      const existing = [...this.charges.values()].find((c) => c.agreementId === input.agreementId && c.serviceMonth === input.serviceMonth);
      if (existing) {
        const receivable = this.recs.get(existing.receivableId);
        if (!receivable) throw new ForeignKeyViolation('retainer_charges.receivableId');
        return { charge: { ...existing }, receivable: { ...receivable }, created: false };
      }
      const chargeId = randomUUID();
      const receivable = this.newReceivable({ organizationId: input.organizationId, customerId: input.customerId, projectId: input.projectId, agreementId: input.agreementId, origin: 'RETAINER_CHARGE', originId: chargeId, currency: input.currency, netMinor: input.netMinor, vatMinor: input.vatMinor, grossMinor: input.grossMinor, vatTreatment: input.vatTreatment, vatRateBasisPoints: input.rateBasisPoints, dueDate: input.dueDate, postingDate: input.chargeDate, postedAt: at });
      const charge: RetainerChargeRecord = { id: chargeId, organizationId: input.organizationId, agreementId: input.agreementId, version: input.version ?? 1, serviceMonth: input.serviceMonth, chargeDate: input.chargeDate, amountMinor: input.amountMinor, netMinor: input.netMinor, vatMinor: input.vatMinor, grossMinor: input.grossMinor, vatTreatment: input.vatTreatment, rateBasisPoints: input.rateBasisPoints, postedAt: at, receivableId: receivable.id, createdAt: at };
      this.charges.set(charge.id, charge);
      return { charge: { ...charge }, receivable: { ...receivable }, created: true };
    },
    appendVersion: async (input: AppendVersionInput, at) => {
      const a = this.agrs.get(input.agreementId);
      if (!a || a.organizationId !== input.organizationId) return { kind: 'not_found' };
      if (a.version !== input.expectedAgreementVersion) return { kind: 'stale', record: { agreement: { ...a }, version: null as unknown as RetainerVersionRecord } };
      if ([...this.versions.values()].some((v) => v.agreementId === input.agreementId && v.version === input.version)) throw new UniqueViolation('retainer_versions.agreementId_version');
      const { expectedAgreementVersion, ...rest } = input;
      void expectedAgreementVersion;
      const version: RetainerVersionRecord = { id: randomUUID(), ...rest, createdAt: at };
      this.versions.set(version.id, version);
      a.version += 1;
      a.updatedAt = at;
      return { kind: 'updated', record: { agreement: { ...a }, version: { ...version } } };
    },
    listVersions: async (organizationId, agreementId) =>
      [...this.versions.values()].filter((v) => v.organizationId === organizationId && v.agreementId === agreementId).sort((x, y) => x.version - y.version).map((v) => ({ ...v })),
    updateContingencyTerms: async (organizationId, agreementId, expectedVersion, patch, at) => {
      const a = this.agrs.get(agreementId);
      if (!a || a.organizationId !== organizationId) return { kind: 'not_found' };
      if (a.version !== expectedVersion || a.outcome !== null) return { kind: 'stale', record: { ...a } };
      if (patch.commissionRateBasisPoints !== undefined) a.commissionRateBasisPoints = patch.commissionRateBasisPoints;
      if (patch.upfrontTreatment !== undefined) a.upfrontTreatment = patch.upfrontTreatment;
      a.version += 1;
      a.updatedAt = at;
      return { kind: 'updated', record: { ...a } };
    },
    recordOutcome: async (organizationId, agreementId, input: OutcomeWriteInput, at) => {
      const a = this.agrs.get(agreementId);
      if (!a || a.organizationId !== organizationId) return { kind: 'not_found' };
      if (a.version !== input.expectedVersion || a.outcome !== null || this.upfrontMoved(organizationId, input.upfrontReceivables)) return { kind: 'stale', record: { agreement: { ...a }, installments: await this.agreements.listInstallments(organizationId, agreementId) } };
      this.writeOutcome(a, input, at);
      return { kind: 'updated', record: { agreement: { ...a }, installments: await this.agreements.listInstallments(organizationId, agreementId) } };
    },
    correctOutcome: async (organizationId, agreementId, input: CorrectOutcomeInput, at) => {
      const a = this.agrs.get(agreementId);
      if (!a || a.organizationId !== organizationId) return { kind: 'not_found' };
      const replaced = input.replaceInstallmentId ? this.insts.get(input.replaceInstallmentId) : undefined;
      const replacedGone = input.replaceInstallmentId !== null && (!replaced || replaced.agreementId !== agreementId || !replaced.isCommission || replaced.voidedAt !== null || replaced.receivableId !== input.replaceReceivableId);
      if (a.version !== input.expectedVersion || a.outcome === null || replacedGone || this.upfrontMoved(organizationId, input.upfrontReceivables)) {
        return { kind: 'stale', record: { agreement: { ...a }, installments: await this.agreements.listInstallments(organizationId, agreementId), credit: null } };
      }
      const receivable = replaced?.receivableId ? this.recs.get(replaced.receivableId) : undefined;
      // Nothing is written before this check, so a refusal leaves the ledger exactly as it was.
      if (receivable && (receivable.paidMinor > 0n || receivable.creditedMinor > 0n)) return { kind: 'has_payments', receivableId: receivable.id };
      let credit: CreditRecord | null = null;
      if (receivable) {
        credit = { id: randomUUID(), organizationId, receivableId: receivable.id, amountMinor: receivable.grossMinor, netMinor: receivable.netMinor, vatMinor: receivable.vatMinor, ...input.credit, createdAt: at };
        this.credits.set(credit.id, credit);
        receivable.creditedMinor += receivable.grossMinor;
        settle(receivable);
      }
      if (replaced) replaced.voidedAt = at;
      this.writeOutcome(a, input, at);
      return { kind: 'updated', record: { agreement: { ...a }, installments: await this.agreements.listInstallments(organizationId, agreementId), credit: credit ? { ...credit } : null } };
    },
  };

  /** True when any receivable the counted upfront was read from is gone or has moved since (MUT-100 review D2). */
  private upfrontMoved(organizationId: string, seen: ReadonlyArray<{ id: string; version: number }>): boolean {
    return seen.some((s) => {
      const r = this.recs.get(s.id);
      return !r || r.organizationId !== organizationId || r.version !== s.version;
    });
  }

  /** Outcome, terms, totals and version on the agreement, plus the commission line when there is one (MUT-100). */
  private writeOutcome(a: AgreementRecord, input: OutcomeWriteInput, at: Date): void {
    const line = input.commissionInstallment;
    if (line && [...this.insts.values()].some((i) => i.agreementId === a.id && i.position === line.position)) throw new UniqueViolation('installments.agreementId_position');
    Object.assign(a, {
      outcome: input.outcome,
      outcomeDate: input.outcomeDate,
      awardedAmountMinor: input.awardedAmountMinor,
      outcomeNote: input.outcomeNote,
      commissionRateBasisPoints: input.commissionRateBasisPoints,
      upfrontTreatment: input.upfrontTreatment,
      outcomeRecordedAt: at,
      ...input.totals,
      version: a.version + 1,
      updatedAt: at,
    });
    if (line) {
      const record: InstallmentRecord = { id: randomUUID(), organizationId: a.organizationId, agreementId: a.id, ...line, isCommission: true, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, version: 1 };
      this.insts.set(record.id, record);
    }
  }

  readonly receivables: ReceivableRepository = {
    getById: async (organizationId, id) => {
      const r = this.recs.get(id);
      return r && r.organizationId === organizationId && !r.deletedAt ? { ...r } : null;
    },
    getByIdIncludingDeleted: async (organizationId, id) => {
      const r = this.recs.get(id);
      return r && r.organizationId === organizationId ? { ...r } : null;
    },
    getByIds: async (organizationId, ids) =>
      ids.map((id) => this.recs.get(id)).filter((r): r is ReceivableRecord => !!r && r.organizationId === organizationId && !r.deletedAt).map((r) => ({ ...r })),
    listEligible: async (organizationId, customerId, currency) =>
      [...this.recs.values()]
        .filter((r) => r.organizationId === organizationId && r.customerId === customerId && r.currency === currency && r.status === 'OPEN' && !r.deletedAt && outstanding(r) > 0n)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.postingDate < b.postingDate ? -1 : a.postingDate > b.postingDate ? 1 : a.id < b.id ? -1 : 1))
        .map((r) => ({ ...r })),
    credit: async (organizationId, receivableId, input: CreditInput, at) => {
      const r = this.recs.get(receivableId);
      if (!r || r.organizationId !== organizationId || r.deletedAt) return null;
      if (r.status !== 'OPEN' || input.amountMinor > outstanding(r)) throw new InsufficientCapacity(receivableId);
      const credit: CreditRecord = { id: randomUUID(), organizationId, receivableId, ...input, createdAt: at };
      this.credits.set(credit.id, credit);
      r.creditedMinor += input.amountMinor;
      settle(r);
      return { receivable: { ...r }, credit: { ...credit } };
    },
    listCredits: async (organizationId, receivableId) =>
      [...this.credits.values()].filter((c) => c.organizationId === organizationId && c.receivableId === receivableId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).map((c) => ({ ...c })),
    list: async (organizationId, filter: ReceivableFilter, page) =>
      paginate(
        [...this.recs.values()].filter(
          (r) =>
            r.organizationId === organizationId &&
            !r.deletedAt &&
            (!filter.customerId || r.customerId === filter.customerId) &&
            (!filter.projectId || r.projectId === filter.projectId) &&
            (!filter.currency || r.currency === filter.currency) &&
            (!filter.status || r.status === filter.status) &&
            (!filter.dueBefore || r.dueDate <= filter.dueBefore) &&
            (!filter.dueAfter || r.dueDate >= filter.dueAfter),
        ),
        page,
      ),
    countOutstandingByProject: async (organizationId, projectId) =>
      [...this.recs.values()].filter((r) => r.organizationId === organizationId && r.projectId === projectId && r.status === 'OPEN' && !r.deletedAt && outstanding(r) > 0n).length,
    createAdjustment: async (input: CreateAdjustmentReceivableInput) => {
      if (!this.custs.has(input.customerId)) throw new ForeignKeyViolation('receivables.customerId');
      if (input.projectId && !this.projs.has(input.projectId)) throw new ForeignKeyViolation('receivables.projectId');
      return {
        ...this.newReceivable({
          organizationId: input.organizationId,
          customerId: input.customerId,
          projectId: input.projectId,
          agreementId: null,
          origin: 'ADJUSTMENT',
          originId: null,
          currency: input.currency,
          netMinor: input.netMinor,
          vatMinor: input.vatMinor,
          grossMinor: input.grossMinor,
          vatTreatment: input.vatTreatment,
          vatRateBasisPoints: input.vatRateBasisPoints,
          dueDate: input.dueDate,
          postingDate: input.postingDate,
          postedAt: input.postedAt,
          title: input.title,
          createdByUserId: input.createdByUserId,
        }),
      };
    },
    softDeleteAdjustment: async (organizationId, id, at) => {
      const r = this.recs.get(id);
      if (!r || r.organizationId !== organizationId) return null;
      // Mirrors the Prisma WHERE clause: money on the row refuses the void, and the undeleted record says so.
      if (!r.deletedAt && r.paidMinor === 0n && r.creditedMinor === 0n) r.deletedAt = at;
      return { ...r };
    },
    redateAdjustment: async (organizationId, id, userId, expectedVersion, postingDate, dueDate) => {
      const r = this.recs.get(id);
      if (!r || r.organizationId !== organizationId || r.origin !== 'ADJUSTMENT' || r.createdByUserId !== userId || r.deletedAt) return { kind: 'not_found' };
      if (r.version !== expectedVersion) return { kind: 'stale', record: { ...r } };
      Object.assign(r, { postingDate, ...(dueDate ? { dueDate } : {}), version: r.version + 1 });
      return { kind: 'updated', record: { ...r } };
    },
  };

  readonly payments: PaymentRepository = {
    create: async (input: CreatePaymentInput, at) => {
      if (input.customerId) {
        const customer = this.custs.get(input.customerId);
        if (!customer || customer.organizationId !== input.organizationId) throw new ForeignKeyViolation('payments.customerId');
      }
      if (input.projectId && !this.projs.has(input.projectId)) throw new ForeignKeyViolation('payments.projectId');
      // All-or-nothing: check every receivable before touching any.
      this.assertCapacity(input.organizationId, input.allocations);
      const year = Number(input.receivedOn.slice(0, 4));
      const counterKey = `${input.organizationId}:${year}`;
      const seq = (this.counters.get(counterKey) ?? 0) + 1;
      this.counters.set(counterKey, seq);
      const { allocations: requested, ...rest } = input;
      const payment: PaymentRecord = { id: randomUUID(), ...rest, number: `PAY-${year}-${String(seq).padStart(4, '0')}`, allocatedMinor: 0n, status: 'POSTED', reversedAt: null, reversalReason: null, version: 1, createdAt: at, updatedAt: at };
      this.pays.set(payment.id, payment);
      const allocations = this.applyAllocations(payment, requested, at);
      return { payment: { ...payment }, allocations };
    },
    getById: async (organizationId, id) => {
      const p = this.pays.get(id);
      return p && p.organizationId === organizationId ? { ...p } : null;
    },
    list: async (organizationId, filter: PaymentFilter, page) => {
      const onProject = filter.projectId ? new Set([...this.allocs.values()].filter((a) => this.recs.get(a.receivableId)?.projectId === filter.projectId).map((a) => a.paymentId)) : null;
      return paginate(
        [...this.pays.values()].filter(
          (p) =>
            p.organizationId === organizationId &&
            (!filter.customerId || p.customerId === filter.customerId) &&
            (!filter.status || p.status === filter.status) &&
            (!filter.receivedBefore || p.receivedOn <= filter.receivedBefore) &&
            (!filter.receivedAfter || p.receivedOn >= filter.receivedAfter) &&
            (!filter.projectId || (p.projectId === filter.projectId && !this.hasAllocations(p.id)) || (onProject?.has(p.id) ?? false)) &&
            (!filter.origin || p.origin === filter.origin) &&
            (!filter.allocationState || (p.status === 'POSTED' && allocationStateOf(p) === filter.allocationState)),
        ),
        page,
      );
    },
    listAllocations: async (organizationId, paymentId) =>
      [...this.allocs.values()].filter((a) => a.organizationId === organizationId && a.paymentId === paymentId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((a) => ({ ...a })),
    listAllocationsFor: async (organizationId, paymentIds) => {
      const wanted = new Set(paymentIds);
      return [...this.allocs.values()]
        .filter((a) => a.organizationId === organizationId && wanted.has(a.paymentId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
        .map((a) => ({ ...a }));
    },
    allocate: async (organizationId, paymentId, requested: AllocationInput[], at) => {
      const payment = this.pays.get(paymentId);
      if (!payment || payment.organizationId !== organizationId) return null;
      if (payment.status !== 'POSTED') throw new InsufficientCapacity(paymentId);
      const total = requested.reduce((s, a) => s + a.amountMinor, 0n);
      if (total > payment.amountMinor - payment.allocatedMinor) throw new InsufficientCapacity(paymentId);
      this.assertCapacity(organizationId, requested);
      const allocations = this.applyAllocations(payment, requested, at);
      return { payment: { ...payment }, allocations };
    },
    reverse: async (organizationId, paymentId, reason, at) => {
      const payment = this.pays.get(paymentId);
      if (!payment || payment.organizationId !== organizationId) return null;
      if (payment.status === 'REVERSED') return { payment: { ...payment }, changed: false };
      for (const a of this.allocs.values()) {
        if (a.paymentId !== paymentId) continue;
        const r = this.recs.get(a.receivableId);
        if (!r) continue;
        r.paidMinor -= a.amountMinor;
        settle(r);
      }
      payment.allocatedMinor = 0n;
      payment.status = 'REVERSED';
      payment.reversedAt = at;
      payment.reversalReason = reason;
      payment.version += 1;
      payment.updatedAt = at;
      return { payment: { ...payment }, changed: true };
    },
    findReplacedBy: async (organizationId, paymentId) => clone([...this.pays.values()].find((p) => p.organizationId === organizationId && p.replacesPaymentId === paymentId && p.status === 'POSTED')),
    capture: async (input, at) => {
      const { payment } = await this.payments.create({ ...input, reference: null, replacesPaymentId: null, origin: 'CAPTURE', allocations: [] }, at);
      // Counted up to this payment in insertion order, as Postgres's counter lock serializes it: captures in flight at
      // once each see only the ones before them.
      let postedCount = 0;
      for (const p of this.pays.values()) {
        if (p.organizationId === input.organizationId && p.status === 'POSTED') postedCount += 1;
        if (p.id === payment.id) break;
      }
      return { payment, postedCount };
    },
    undoCapture: async (organizationId, paymentId, userId, at) => {
      const p = this.pays.get(paymentId);
      if (!p || p.organizationId !== organizationId || p.origin !== 'CAPTURE' || p.createdByUserId !== userId) return { result: 'not-found', payment: null };
      if (p.status === 'REVERSED') return { result: p.reversalReason === CAPTURE_UNDO_REASON ? 'already-reversed' : 'reversed-elsewhere', payment: { ...p } };
      if (p.allocatedMinor > 0n) return { result: 'allocated', payment: { ...p } };
      Object.assign(p, { status: 'REVERSED', reversedAt: at, reversalReason: CAPTURE_UNDO_REASON, version: p.version + 1, updatedAt: at });
      return { result: 'reversed', payment: { ...p } };
    },
    redateCapture: async (organizationId, paymentId, userId, expectedVersion, receivedOn, at) => {
      const p = this.pays.get(paymentId);
      if (!p || p.organizationId !== organizationId || p.origin !== 'CAPTURE' || p.createdByUserId !== userId || p.status !== 'POSTED') return { kind: 'not_found' };
      if (p.version !== expectedVersion) return { kind: 'stale', record: { ...p } };
      Object.assign(p, { receivedOn, version: p.version + 1, updatedAt: at });
      return { kind: 'updated', record: { ...p } };
    },
  };

  private hasAllocations(paymentId: string): boolean {
    for (const a of this.allocs.values()) if (a.paymentId === paymentId) return true;
    return false;
  }

  private assertCapacity(organizationId: string, requested: readonly AllocationInput[]): void {
    for (const a of requested) {
      const r = this.recs.get(a.receivableId);
      if (!r || r.organizationId !== organizationId) throw new ForeignKeyViolation('payment_allocations.receivableId');
      if (r.status !== 'OPEN' || a.amountMinor <= 0n || a.amountMinor > outstanding(r)) throw new InsufficientCapacity(a.receivableId);
    }
  }

  private applyAllocations(payment: PaymentRecord, requested: readonly AllocationInput[], at: Date): AllocationRecord[] {
    const created: AllocationRecord[] = [];
    for (const a of requested) {
      const r = this.recs.get(a.receivableId)!;
      const record: AllocationRecord = { id: randomUUID(), organizationId: payment.organizationId, paymentId: payment.id, receivableId: a.receivableId, amountMinor: a.amountMinor, createdAt: at };
      this.allocs.set(record.id, record);
      r.paidMinor += a.amountMinor;
      settle(r);
      payment.allocatedMinor += a.amountMinor;
      created.push({ ...record });
    }
    if (created.length > 0) {
      payment.version += 1;
      payment.updatedAt = at;
    }
    return created;
  }

  private newReceivable(
    input: Omit<ReceivableRecord, 'id' | 'paidMinor' | 'creditedMinor' | 'status' | 'version' | 'createdAt' | 'deletedAt' | 'title' | 'createdByUserId'> & {
      title?: string | null;
      createdByUserId?: string | null;
    },
  ): ReceivableRecord {
    const receivable: ReceivableRecord = {
      id: randomUUID(),
      ...input,
      title: input.title ?? null,
      createdByUserId: input.createdByUserId ?? null,
      paidMinor: 0n,
      creditedMinor: 0n,
      status: 'OPEN',
      deletedAt: null,
      version: 1,
      createdAt: input.postedAt,
    };
    this.recs.set(receivable.id, receivable);
    return receivable;
  }

  private async entityIdsForExternal(organizationId: string, entityType: ExternalEntityType, filter: CustomerFilter): Promise<Set<string> | null> {
    if (filter.externalId === undefined) return null;
    const provider: IntegrationProvider = filter.provider ?? 'MALAFAT';
    const refs = await this.externalReferences.findByExternalIds(organizationId, provider, entityType, [filter.externalId]);
    return new Set(refs.map((r) => r.entityId));
  }

  // ---- MUT-42: expenses ----------------------------------------------------

  readonly expenses: ExpenseRepository = {
    create: async (input: CreateExpenseInput, at) => {
      if (!this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('expenses.organizationId');
      // The Postgres foreign key (MUT-182 R17: a type change can delete a category between a route's check and this insert).
      if (input.categoryId !== null && !this.expCats.has(input.categoryId)) throw new ForeignKeyViolation('expenses_categoryId_fkey');
      // Like Postgres' foreign key: existence only. The routes resolve or check the vendor inside the profile.
      if (input.vendorId && !this.vendorMap.has(input.vendorId)) throw new ForeignKeyViolation('expenses_vendorId_fkey');
      const record: ExpenseRecord = { id: randomUUID(), ...input, vendorId: input.vendorId ?? null, version: 1, createdAt: at, updatedAt: at, deletedAt: null };
      this.exps.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const e = this.exps.get(id);
      return e && e.organizationId === organizationId && !e.deletedAt ? { ...e } : null;
    },
    list: async (organizationId, filter: ExpenseFilter, page) => {
      const rows = [...this.exps.values()]
        .filter((e) => e.organizationId === organizationId && !e.deletedAt && matchesExpense(e, filter) && this.inGroupFilter(e, filter.group) && (!page.cursor || isBeforeExpenseCursor(e, page.cursor)))
        .sort(newestFirst)
        .slice(0, page.limit + 1);
      const items = rows.slice(0, page.limit).map((e) => ({ ...e }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },
    update: async (organizationId, id, expectedVersion, patch: UpdateExpensePatch, at) => {
      const e = this.exps.get(id);
      if (!e || e.organizationId !== organizationId || e.deletedAt) return { kind: 'not_found' };
      if (e.version !== expectedVersion) return { kind: 'stale', record: { ...e } };
      if (patch.categoryId && !this.expCats.has(patch.categoryId)) throw new ForeignKeyViolation('expenses_categoryId_fkey');
      if (patch.vendorId && !this.vendorMap.has(patch.vendorId)) throw new ForeignKeyViolation('expenses_vendorId_fkey');
      Object.assign(e, definedOnly(patch));
      e.version += 1;
      e.updatedAt = at;
      return { kind: 'updated', record: { ...e } };
    },
    softDelete: async (organizationId, id, at, receipts) => {
      const e = this.exps.get(id);
      if (!e || e.organizationId !== organizationId) return null;
      if (e.deletedAt) return { record: { ...e }, changed: false, removedReceipts: [] };
      e.deletedAt = at;
      // MUT-255: READY receipts go back to the library ('unlink'); everything left goes with the expense.
      const removedReceipts: ExpenseReceiptRecord[] = [];
      for (const r of this.expReceipts.values()) {
        if (r.organizationId !== organizationId || r.expenseId !== id || r.deletedAt) continue;
        if (receipts === 'unlink' && r.status === 'READY') {
          r.expenseId = null;
          r.filingStatus = 'TO_REVIEW';
          r.version += 1;
        } else {
          r.deletedAt = at;
          removedReceipts.push({ ...r });
        }
      }
      return { record: { ...e }, changed: true, removedReceipts };
    },
    totalsByCurrency: async (organizationId, filter: ExpenseFilter) => {
      const totals = new Map<string, ExpenseCurrencyTotal>();
      for (const e of this.exps.values()) {
        if (e.organizationId !== organizationId || e.deletedAt || !matchesExpense(e, filter) || !this.inGroupFilter(e, filter.group)) continue;
        const t = totals.get(e.currency) ?? { currency: e.currency, totalMinor: 0n, count: 0 };
        totals.set(e.currency, { ...t, totalMinor: t.totalMinor + e.amountMinor, count: t.count + 1 });
      }
      return [...totals.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1));
    },
  };

  /** MUT-267: the group filter through the one membership rule (groups.ts), as Postgres applies it in expenseWhere. */
  private inGroupFilter(e: ExpenseRecord, group: ExpenseGroupFilter | undefined): boolean {
    if (!group) return true;
    const mode = this.groupMarks.get(`${group.groupId}:${e.id}`)?.mode ?? null;
    const range = { startOn: group.startOn, endOn: group.windowEnd };
    if (group.membership === 'excluded') return mode === 'excluded' && isGroupMember(e, range, null);
    return isGroupMember(e, range, mode);
  }

  // ---- MUT-267: expense groups ----------------------------------------------

  readonly expenseGroups: ExpenseGroupRepository = {
    create: async (input: CreateExpenseGroupInput, at, maxLive) => {
      if (!this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('expense_groups.organizationId');
      // No await between the count and the insert, so concurrent creates serialize here as the Postgres org lock makes them.
      if (maxLive !== undefined && [...this.expGroups.values()].filter((g) => g.organizationId === input.organizationId && !g.deletedAt).length >= maxLive) throw new InsufficientCapacity(input.organizationId);
      const record: ExpenseGroupRecord = { id: randomUUID(), ...input, version: 1, createdAt: at, updatedAt: at, deletedAt: null };
      this.expGroups.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const g = this.expGroups.get(id);
      return g && g.organizationId === organizationId && !g.deletedAt ? { ...g } : null;
    },
    list: async (organizationId) =>
      [...this.expGroups.values()]
        .filter((g) => g.organizationId === organizationId && !g.deletedAt)
        .sort((a, b) => (a.startOn !== b.startOn ? (a.startOn < b.startOn ? 1 : -1) : a.id < b.id ? 1 : -1))
        .map((g) => ({ ...g })),
    update: async (organizationId, id, expectedVersion, patch: UpdateExpenseGroupPatch, at) => {
      const g = this.expGroups.get(id);
      if (!g || g.organizationId !== organizationId || g.deletedAt) return { kind: 'not_found' };
      if (g.version !== expectedVersion) return { kind: 'stale', record: { ...g } };
      Object.assign(g, definedOnly(patch));
      g.version += 1;
      g.updatedAt = at;
      return { kind: 'updated', record: { ...g } };
    },
    softDelete: async (organizationId, id, at) => {
      const g = this.expGroups.get(id);
      if (!g || g.organizationId !== organizationId) return null;
      const changed = !g.deletedAt;
      if (changed) g.deletedAt = at;
      return { record: { ...g }, changed };
    },
    setOverride: async (organizationId, groupId, expenseId, mode, at) => {
      if (!this.expGroups.has(groupId)) throw new ForeignKeyViolation('expense_group_overrides_groupId_fkey');
      if (!this.exps.has(expenseId)) throw new ForeignKeyViolation('expense_group_overrides_expenseId_fkey');
      const key = `${groupId}:${expenseId}`;
      const existing = this.groupMarks.get(key);
      if (existing?.mode === mode) return { record: { ...existing }, changed: false };
      const record: ExpenseGroupOverrideRecord = { groupId, expenseId, organizationId, mode, createdAt: existing?.createdAt ?? at, updatedAt: at };
      this.groupMarks.set(key, record);
      return { record: { ...record }, changed: true };
    },
    clearOverride: async (organizationId, groupId, expenseId) => {
      const key = `${groupId}:${expenseId}`;
      if (this.groupMarks.get(key)?.organizationId !== organizationId) return false;
      return this.groupMarks.delete(key);
    },
    overridesForExpense: async (organizationId, expenseId) =>
      [...this.groupMarks.values()].filter((m) => m.expenseId === expenseId && m.organizationId === organizationId).map((m) => ({ ...m })),
  };

  // ---- MUT-161: conversions; MUT-194: versioned update and soft delete ------

  readonly conversions: ConversionRepository = {
    create: async (input: CreateConversionInput, at) => {
      if (!this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('conversions.organizationId');
      const record: ConversionRecord = { id: randomUUID(), ...input, version: 1, createdAt: at, updatedAt: at, deletedAt: null };
      this.convs.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const c = this.convs.get(id);
      return c && c.organizationId === organizationId && !c.deletedAt ? { ...c } : null;
    },
    list: async (organizationId, filter: ConversionFilter, page) => {
      const rows = [...this.convs.values()]
        .filter((c) => c.organizationId === organizationId && !c.deletedAt && matchesConversion(c, filter) && (!page.cursor || isBeforeConversionCursor(c, page.cursor)))
        .sort(newestConversionFirst)
        .slice(0, page.limit + 1);
      const items = rows.slice(0, page.limit).map((c) => ({ ...c }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },
    update: async (organizationId, id, expectedVersion, patch: UpdateConversionPatch, at) => {
      const c = this.convs.get(id);
      if (!c || c.organizationId !== organizationId || c.deletedAt) return { kind: 'not_found' };
      if (c.version !== expectedVersion) return { kind: 'stale', record: { ...c } };
      Object.assign(c, definedOnly(patch));
      c.version += 1;
      c.updatedAt = at;
      return { kind: 'updated', record: { ...c } };
    },
    softDelete: async (organizationId, id, at) => {
      const c = this.convs.get(id);
      if (!c || c.organizationId !== organizationId) return null;
      const changed = !c.deletedAt;
      if (changed) c.deletedAt = at;
      return { record: { ...c }, changed };
    },
  };

  readonly expenseCategories: ExpenseCategoryRepository = {
    create: async (organizationId, input: ExpenseCategoryInput, at) => {
      if (!this.orgs.has(organizationId)) throw new ForeignKeyViolation('expense_categories.organizationId');
      if (this.categoryNamed(organizationId, input.name)) throw new UniqueViolation('expense_categories.name');
      const record: ExpenseCategoryRecord = { id: randomUUID(), organizationId, name: input.name, color: input.color, archivedAt: null, version: 1, createdAt: at, updatedAt: at };
      this.expCats.set(record.id, record);
      return { ...record };
    },
    getById: async (organizationId, id) => {
      const c = this.expCats.get(id);
      return c && c.organizationId === organizationId ? { ...c } : null;
    },
    list: async (organizationId, options) =>
      [...this.expCats.values()]
        .filter((c) => c.organizationId === organizationId && (options.includeArchived || !c.archivedAt))
        .sort(compareByCreatedAtThenId)
        .map((c) => ({ ...c })),
    seed: async (organizationId, preset, at) => {
      if ([...this.expCats.values()].some((c) => c.organizationId === organizationId)) return false;
      this.insertPreset(organizationId, preset, at);
      return true;
    },
    update: async (organizationId, id, expectedVersion, patch: UpdateExpenseCategoryPatch, at) => {
      const c = this.expCats.get(id);
      if (!c || c.organizationId !== organizationId) return { kind: 'not_found' };
      if (c.version !== expectedVersion) return { kind: 'stale', record: { ...c } };
      if (patch.name !== undefined) {
        const taken = this.categoryNamed(organizationId, patch.name);
        if (taken && taken.id !== id) throw new UniqueViolation('expense_categories.name');
        c.name = patch.name;
      }
      if (patch.color !== undefined) c.color = patch.color;
      if (patch.archived !== undefined) c.archivedAt = patch.archived ? (c.archivedAt ?? at) : null;
      c.version += 1;
      c.updatedAt = at;
      return { kind: 'updated', record: { ...c } };
    },
  };

  readonly vendors: VendorRepository = {
    // No await between the reads and the writes: two calls can't interleave (the memory store's stand-in for the
    // unique index and the retried transaction).
    resolve: async (input: ResolveVendorInput, at) => {
      const nameKey = vendorNameKey(input.name);
      if (!nameKey) return null;
      const regKey = registrationKey(input.registrationNo);
      const org = input.organizationId;
      // Same as Prisma: a filled detail stamps updatedAt, never the version.
      const fill = (v: VendorRecord) => {
        if (v.phone === null && input.phone?.trim()) Object.assign(v, { phone: input.phone.trim(), updatedAt: at });
        if (v.email === null && input.email?.trim()) Object.assign(v, { email: input.email.trim(), updatedAt: at });
      };
      const nameOwner = [...this.vendorNames.values()].find((n) => n.organizationId === org && n.nameKey === nameKey);
      const byReg = regKey ? [...this.vendorMap.values()].find((v) => v.organizationId === org && registrationKey(v.registrationNo) === regKey) : undefined;
      if (byReg) {
        if (!nameOwner) this.addVendorName(byReg, input.name.trim(), nameKey, at);
        fill(byReg);
        return { ...byReg };
      }
      if (nameOwner) {
        const v = this.vendorMap.get(nameOwner.vendorId)!;
        if (regKey && v.registrationNo === null) Object.assign(v, { registrationNo: input.registrationNo!.trim(), updatedAt: at });
        fill(v);
        return { ...v };
      }
      const v: VendorRecord = {
        id: randomUUID(),
        organizationId: org,
        canonicalName: input.name.trim(),
        registrationNo: regKey ? input.registrationNo!.trim() : null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        lastCategoryId: null,
        lastUsedAt: at,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      this.vendorMap.set(v.id, v);
      this.addVendorName(v, v.canonicalName, nameKey, at);
      return { ...v };
    },
    touch: async (organizationId, vendorId, change, at) => {
      const v = this.vendorMap.get(vendorId);
      if (!v || v.organizationId !== organizationId) return;
      const category = change.categoryId ? this.expCats.get(change.categoryId) : undefined;
      if (category && category.organizationId === organizationId && !isAutomaticOtherCategory(category.name)) v.lastCategoryId = category.id;
      v.lastUsedAt = at;
    },
    getById: async (organizationId, id) => {
      const v = this.vendorMap.get(id);
      return v && v.organizationId === organizationId ? { ...v } : null;
    },
    search: async (organizationId, query, limit) => {
      const queryKey = vendorNameKey(query);
      const own = [...this.vendorMap.values()].filter((v) => v.organizationId === organizationId);
      if (!queryKey) {
        return own
          .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime() || a.id.localeCompare(b.id))
          .slice(0, limit)
          .map((v): VendorSuggestion => ({ vendor: { ...v }, matchedName: v.canonicalName, score: 1, exact: false }));
      }
      // The Prisma store's one path (A16): names containing the query, plus every name of the 50 most recently used
      // vendors, so a near-miss is suggested in exactly the same cases here and in Postgres.
      const recent = new Set(
        own
          .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime() || a.id.localeCompare(b.id))
          .slice(0, RECENT_VENDORS_SCORED)
          .map((v) => v.id),
      );
      return bestVendorSuggestions(
        [...this.vendorNames.values()].filter((n) => n.organizationId === organizationId && (n.nameKey.includes(queryKey) || recent.has(n.vendorId))),
        (id) => this.vendorMap.get(id),
        queryKey,
        limit,
      );
    },
  };

  private addVendorName(v: VendorRecord, name: string, nameKey: string, at: Date): void {
    const row: VendorNameRecord = { id: randomUUID(), organizationId: v.organizationId, vendorId: v.id, name, nameKey, createdAt: at };
    this.vendorNames.set(row.id, row);
  }

  readonly expenseReceipts: ExpenseReceiptRepository = {
    create: async (input: CreateExpenseReceiptInput, at) => {
      if (input.expenseId !== null && !this.exps.has(input.expenseId)) throw new ForeignKeyViolation('expense_receipts.expenseId');
      const record: ExpenseReceiptRecord = {
        id: randomUUID(),
        organizationId: input.organizationId,
        expenseId: input.expenseId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        status: 'PENDING_UPLOAD',
        filingStatus: input.expenseId ? 'FILED' : 'TO_REVIEW',
        receivedOn: input.receivedOn,
        storageKey: '',
        uploadedByUserId: input.uploadedByUserId,
        suggested: input.suggested ?? null,
        approved: null,
        approvedAt: null,
        approvedByUserId: null,
        version: 1,
        requestId: input.requestId,
        createdAt: at,
        completedAt: null,
        deletedAt: null,
      };
      this.expReceipts.set(record.id, record);
      return { ...record };
    },
    setKey: async (organizationId, id, storageKey) => {
      const r = this.expReceipts.get(id);
      if (!r || r.organizationId !== organizationId) return null;
      r.storageKey = storageKey;
      return { ...r };
    },
    getById: async (organizationId, id) => {
      const r = this.expReceipts.get(id);
      return r && r.organizationId === organizationId && !r.deletedAt ? { ...r } : null;
    },
    listByExpense: async (organizationId, expenseId) =>
      [...this.expReceipts.values()]
        .filter((r) => r.organizationId === organizationId && r.expenseId === expenseId && r.status === 'READY' && !r.deletedAt)
        .sort(compareByCreatedAtThenId)
        .map((r) => ({ ...r })),
    complete: async (organizationId, id, at) => {
      const r = this.expReceipts.get(id);
      if (!r || r.organizationId !== organizationId || r.deletedAt) return null;
      if (r.status !== 'READY') {
        r.status = 'READY';
        r.completedAt = at;
      }
      return { ...r };
    },
    softDelete: async (organizationId, id, at) => {
      const r = this.expReceipts.get(id);
      if (!r || r.organizationId !== organizationId) return null;
      if (!r.deletedAt) r.deletedAt = at;
      return { ...r };
    },
    countReadyByExpenseIds: async (organizationIds, expenseIds) => {
      const counts = new Map<string, number>();
      for (const r of this.expReceipts.values()) {
        if (r.expenseId === null || !organizationIds.includes(r.organizationId) || !expenseIds.includes(r.expenseId) || r.status !== 'READY' || r.deletedAt) continue;
        counts.set(r.expenseId, (counts.get(r.expenseId) ?? 0) + 1);
      }
      return counts;
    },
    list: async (organizationId, filter, page) => {
      const rows = [...this.expReceipts.values()]
        .filter(
          (r) =>
            r.organizationId === organizationId &&
            r.status === 'READY' &&
            !r.deletedAt &&
            (!filter.filingStatus || r.filingStatus === filter.filingStatus) &&
            (!filter.from || r.receivedOn >= filter.from) &&
            (!filter.to || r.receivedOn <= filter.to) &&
            (!page.cursor || r.createdAt < page.cursor.createdAt || (r.createdAt.getTime() === page.cursor.createdAt.getTime() && r.id < page.cursor.id)),
        )
        .sort((a, b) => -compareByCreatedAtThenId(a, b));
      // MUT-258: a FILED row carries its live expense's summary, as Prisma's include does.
      const items = rows.slice(0, page.limit).map((r) => {
        const e = r.expenseId ? this.exps.get(r.expenseId) : undefined;
        const expense = e && !e.deletedAt && e.organizationId === organizationId ? { vendor: e.vendor, title: e.title, amountMinor: e.amountMinor, currency: e.currency, occurredOn: e.occurredOn, categoryId: e.categoryId } : null;
        return { ...r, expense };
      });
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    countByFilingStatus: async (organizationId) => {
      const counts = { toReview: 0, filed: 0 };
      for (const r of this.expReceipts.values()) {
        if (r.organizationId !== organizationId || r.status !== 'READY' || r.deletedAt) continue;
        if (r.filingStatus === 'TO_REVIEW') counts.toReview += 1;
        else counts.filed += 1;
      }
      return counts;
    },
    countPendingSince: async (organizationId, since) =>
      [...this.expReceipts.values()].filter((r) => r.organizationId === organizationId && r.status === 'PENDING_UPLOAD' && !r.deletedAt && r.createdAt >= since).length,
    setSuggested: async (organizationId, id, expectedVersion, suggested) => {
      const r = this.expReceipts.get(id);
      if (!r || r.organizationId !== organizationId || r.deletedAt) return { kind: 'not_found' };
      if (r.filingStatus === 'FILED') return { kind: 'filed' };
      if (r.version !== expectedVersion) return { kind: 'stale', record: { ...r } };
      r.suggested = suggested;
      r.version += 1;
      return { kind: 'updated', record: { ...r } };
    },
    fileAsExpense: async (params, at) => {
      const r = this.expReceipts.get(params.receiptId);
      const refused = toReviewRefusal(r, params.organizationId);
      if (refused || !r) return refused ?? { kind: 'not_found' };
      // A failed insert (e.g. a category deleted since the route checked) throws before the receipt is touched.
      const expense = await this.expenses.create(params.expense, at);
      r.expenseId = expense.id;
      r.filingStatus = 'FILED';
      r.approved = params.approved;
      r.approvedAt = at;
      r.approvedByUserId = params.userId;
      if (params.suggested) r.suggested = params.suggested;
      r.version += 1;
      return { kind: 'filed', expense, receipt: { ...r } };
    },
    fileOntoExpense: async (params) => {
      const r = this.expReceipts.get(params.receiptId);
      const refused = toReviewRefusal(r, params.organizationId);
      if (refused || !r) return refused ?? { kind: 'not_found' };
      const expense = await this.expenses.getById(params.organizationId, params.expenseId);
      if (!expense) return { kind: 'expense_not_found' };
      if ((await this.expenseReceipts.listByExpense(params.organizationId, expense.id)).length >= params.maxReceipts) return { kind: 'too_many_receipts' };
      r.expenseId = expense.id;
      r.filingStatus = 'FILED';
      // An earlier approval keeps the reading it was made against (the edit-rate pair).
      if (params.suggested && !r.approved) r.suggested = params.suggested;
      r.version += 1;
      return { kind: 'filed', expense, receipt: { ...r } };
    },
    completeOnExpense: async (params, at) => {
      // Same order as Prisma: the expense first, so a deleted expense answers expense_not_found even when the delete
      // removed its receipts too.
      const expense = await this.expenses.getById(params.organizationId, params.expenseId);
      if (!expense) return { kind: 'expense_not_found' };
      // From here to the flip there is no await, so two calls can't interleave between the count and the write
      // (the memory store's stand-in for the expense lock).
      const r = this.expReceipts.get(params.receiptId);
      if (!r || r.organizationId !== params.organizationId || r.expenseId !== expense.id || r.deletedAt) return { kind: 'receipt_not_found' };
      if (r.status === 'READY') return { kind: 'already_ready', receipt: { ...r } };
      let held = 0;
      for (const other of this.expReceipts.values()) {
        if (other.organizationId === params.organizationId && other.expenseId === expense.id && other.status === 'READY' && !other.deletedAt) held += 1;
      }
      if (held >= params.maxReceipts) return { kind: 'too_many_receipts' };
      r.status = 'READY';
      r.completedAt = at;
      return { kind: 'completed', receipt: { ...r } };
    },
    editRates: async (range) =>
      editRatesOf(
        [...this.expReceipts.values()].flatMap((r) => (r.approved && r.approvedAt && r.approvedAt >= range.from && r.approvedAt < range.to ? [{ suggested: r.suggested, approved: r.approved }] : [])),
      ),
  };


  // ---- MUT-270: the entries feed -------------------------------------------

  readonly recordsExport: RecordsExportRepository = {
    profilePage: async (organizationId, field, afterKey, limit) => {
      const map = this.exportMaps()[field] as Map<string, unknown>;
      const owned = field === 'counters'
        ? (key: string) => key.startsWith(`${organizationId}:`)
        : (_key: string, row: unknown) => (row as { organizationId: string }).organizationId === organizationId;
      return pageOfMap(map, (key, row) => owned(key, row), afterKey, limit) as never;
    },
    inboxPage: async (userId, afterKey, limit) => pageOfMap(this.inbox, (_key, row) => row.userId === userId, afterKey, limit),
    findExportableReceipt: async (organizationId, id) => {
      const row = this.expReceipts.get(id);
      if (!row || row.organizationId !== organizationId || row.status !== 'READY' || row.deletedAt || !row.storageKey) return null;
      return { storageKey: row.storageKey, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
    },
  };

  /** MUT-359. Synchronous inside each method, so concurrent claims of one key resolve to exactly one claim. */
  readonly email: EmailRepository = {
    isSuppressed: async (email) => this.emailSuppressions.has(email),
    suppress: async ({ email, reason, eventId, at }) => {
      if (this.emailSuppressions.has(email)) return { created: false };
      this.emailSuppressions.set(email, { reason, eventId, createdAt: at });
      return { created: true };
    },
    claimDelivery: async (input) => {
      const existing = this.emailDeliveries.get(input.keyDigest);
      if (existing && (existing.status === 'SENT' || (existing.status === 'PENDING' && existing.createdAt >= input.staleBefore))) return { status: 'duplicate' };
      const counted = [...this.emailDeliveries.entries()]
        .filter(([key, row]) => key !== input.keyDigest && row.status !== 'FAILED' && row.createdAt >= input.since && row.createdAt <= input.at)
        .map(([, row]) => row);
      if (counted.length >= input.limit.total) return { status: 'capped', scope: 'global' };
      const perRecipient = input.limit.perRecipient;
      if (perRecipient !== null && counted.filter((row) => row.recipientDigest === input.recipientDigest).length >= perRecipient) return { status: 'capped', scope: 'recipient' };
      const id = existing?.id ?? randomUUID();
      this.emailDeliveries.set(input.keyDigest, { id, recipientDigest: input.recipientDigest, status: 'PENDING', createdAt: input.at });
      return { status: 'claimed', id };
    },
    finishDelivery: async (id, outcome) => {
      for (const row of this.emailDeliveries.values()) if (row.id === id) row.status = 'providerId' in outcome ? 'SENT' : outcome.uncertain ? 'UNCERTAIN' : 'FAILED';
    },
    pruneDeliveries: async (before) => {
      let removed = 0;
      for (const [key, row] of this.emailDeliveries) {
        if (row.createdAt < before) {
          this.emailDeliveries.delete(key);
          removed++;
        }
      }
      return removed;
    },
  };

  // MUT-367 (ADR-178): the review queue. Each method runs without an await: the stand-in for Prisma's transaction and lock.
  /** MUT-333 (R1): deleted profiles' bucket prefixes waiting to be emptied; outside the snapshot like the billing maps. */
  private readonly storagePurges = new Map<string, Date>();

  readonly accountPurge: AccountPurgeRepository = {
    listDue: async (at, limit) =>
      [...this.people.values()]
        .filter((u) => isDueForPurge(u.closure, at))
        .sort((a, b) => (a.closure!.purgeLastTriedAt?.getTime() ?? -Infinity) - (b.closure!.purgeLastTriedAt?.getTime() ?? -Infinity) || a.closure!.deleteAfter.getTime() - b.closure!.deleteAfter.getTime())
        .slice(0, limit)
        .map((u) => ({ ...u })),
    countClosing: async (at) => {
      const closing = [...this.people.values()].filter((u) => u.closure);
      return { closing: closing.length, due: closing.filter((u) => isDueForPurge(u.closure, at)).length };
    },
    claim: async (userId, at) => {
      const u = this.people.get(userId);
      if (!u?.closure || !isDueForPurge(u.closure, at)) return null;
      u.closure = { ...u.closure, purgeStartedAt: u.closure.purgeStartedAt ?? at, purgeLastTriedAt: at };
      return { ...u };
    },
    planOf: async (userId) => {
      const u = this.people.get(userId);
      if (!u) return null;
      return { userId, ...this.purgeDecisionFor(userId), stripeCustomerIds: [...this.billingAccounts.values()].filter((a) => a.userId === userId).map((a) => a.stripeCustomerId) };
    },
    purge: async (userId, at) => {
      const u = this.people.get(userId);
      if (!u?.closure?.purgeStartedAt) return null;
      const decision = this.purgeDecisionFor(userId);
      // R18: never with other people's work in it; nothing is written.
      if (decision.blockedProfileIds.length > 0) throw new StateConflict('account', 'PROFILE_HAS_MEMBERS');
      const deleted = new Set(decision.deleteProfileIds);
      for (const { organizationId, toUserId } of decision.transfers) Object.assign(this.orgs.get(organizationId)!, { ownerUserId: toUserId });
      // D8 / MUT-324 review: every acceptance the person ever recorded goes, wherever it was written.
      this.dropEvents((e) => (e.action === 'user.terms_accepted' && e.actorId === userId) || deleted.has(e.organizationId));
      this.dropProfiles(deleted);
      for (const id of deleted) this.storagePurges.set(id, at);
      const auditRowsScrubbed = this.anonymize(userId);
      for (const event of purgeAuditRows(userId, decision)) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      this.dropPerson(u);
      return { ...decision, auditRowsScrubbed };
    },
    listStoragePurges: async (limit) =>
      [...this.storagePurges]
        .sort((a, b) => a[1].getTime() - b[1].getTime() || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([id]) => id),
    finishStoragePurge: async (organizationId) => {
      this.storagePurges.delete(organizationId);
    },
  };

  /** MUT-333: the shared rule (accounts/purge-plan.ts) over this store's own rows. */
  private purgeDecisionFor(userId: string) {
    const ids = new Set([...this.members.values()].filter((m) => m.userId === userId).map((m) => m.organizationId));
    for (const o of this.orgs.values()) if (o.ownerUserId === userId || o.personalOwnerUserId === userId) ids.add(o.id);
    const profiles = [...ids].map((id) => this.orgs.get(id)).filter((o): o is Organization => o !== undefined);
    const othersOf = (organizationId: string): PurgeCandidate[] =>
      [...this.members.values()]
        .filter((m) => m.organizationId === organizationId && m.userId !== userId)
        .flatMap((m) => {
          const person = this.people.get(m.userId);
          return person ? [{ userId: m.userId, role: m.role, status: person.status, deleteAfter: person.closure?.deleteAfter ?? null, membershipCreatedAt: m.createdAt }] : [];
        });
    return decidePurge(userId, profiles, othersOf);
  }

  private dropEvents(drop: (event: AuditEventRecord) => boolean): void {
    for (let i = this.events.length - 1; i >= 0; i--) if (drop(this.events[i]!)) this.events.splice(i, 1);
  }

  /** Every row of the deleted profiles, in every map that holds a profile's rows. */
  private dropProfiles(deleted: ReadonlySet<string>): void {
    const inDeleted = (row: { organizationId: string }) => deleted.has(row.organizationId);
    const maps: Array<Map<string, { organizationId: string }>> = [
      this.keys, this.ints, this.idem, this.custs, this.projs, this.refs, this.rates, this.agrs, this.insts, this.charges, this.recs, this.supps,
      this.versions, this.files, this.pays, this.allocs, this.credits, this.props, this.members, this.exps, this.expCats, this.expReceipts,
      this.convs, this.expGroups, this.groupMarks, this.vendorMap, this.vendorNames,
    ];
    for (const map of maps) for (const [key, row] of map) if (inDeleted(row)) map.delete(key);
    for (const [key, grant] of this.grants) if (grant.organizationId !== null && deleted.has(grant.organizationId)) this.grants.delete(key);
    // SET NULL, as in Postgres: a subscription is the payer's, and the payer's own are deleted with their account.
    for (const sub of this.billingSubs.values()) if (sub.organizationId !== null && deleted.has(sub.organizationId)) sub.organizationId = null;
    for (const key of this.counters.keys()) if (deleted.has(key.slice(0, key.indexOf(':')))) this.counters.delete(key);
    for (const id of deleted) this.orgs.delete(id);
  }

  /** D7, R3: on every profile that survives, the person's records lose their name and the audit loses its details. */
  private anonymize(userId: string): number {
    for (const e of this.exps.values()) if (e.createdByUserId === userId) e.createdByUserId = null;
    for (const r of this.expReceipts.values()) {
      if (r.uploadedByUserId === userId) r.uploadedByUserId = null;
      if (r.approvedByUserId === userId) r.approvedByUserId = null;
    }
    for (const c of this.convs.values()) if (c.createdByUserId === userId) c.createdByUserId = null;
    for (const g of this.expGroups.values()) if (g.createdByUserId === userId) g.createdByUserId = null;
    for (const p of this.pays.values()) if (p.createdByUserId === userId) p.createdByUserId = null;
    for (const r of this.recs.values()) if (r.createdByUserId === userId) r.createdByUserId = null;
    for (const o of this.orgs.values()) if (o.firmRequestedByUserId === userId) o.firmRequestedByUserId = null;
    for (const [key, row] of this.idem) if (mentions(row.responseBody, userId)) this.idem.delete(key);
    let scrubbed = 0;
    for (const e of this.events) {
      if ((e.actorId === userId || e.entityId === userId || mentions(e.metadata, userId)) && e.metadata !== undefined) {
        delete e.metadata;
        scrubbed++;
      }
    }
    return scrubbed;
  }

  /** Every row that is the person's own, then the person (D9, R4). */
  private dropPerson(person: UserRecord): void {
    const id = person.id;
    for (const [key, m] of this.members) if (m.userId === id) this.members.delete(key);
    for (const [key, s] of this.sessionsById) if (s.userId === id) this.sessionsById.delete(key);
    for (const [key, p] of this.passkeyMap) if (p.userId === id) this.passkeyMap.delete(key);
    this.passkeyPrompts.delete(id);
    for (const [key, c] of this.challenges) if (c.userId === id) this.challenges.delete(key);
    for (const [key, link] of this.setupLinks) if (('userId' in link && link.userId === id) || (link.purpose === 'SIGNUP' && 'email' in link && link.email === person.email)) this.setupLinks.delete(key);
    for (const [key, entry] of this.inbox) if (entry.userId === id) this.inbox.delete(key);
    for (const [key, claim] of this.userIdem) if (claim.userId === id) this.userIdem.delete(key);
    for (const [key, acceptance] of this.termsAcceptances) if (acceptance.userId === id) this.termsAcceptances.delete(key);
    for (const [key, grant] of this.grants) if (grant.userId === id) this.grants.delete(key);
    for (const [key, grant] of this.featureGrants) if (grant.userId === id) this.featureGrants.delete(key);
    // MUT-434: grants and decided requests cascade with the person; codes and tokens with their grant.
    for (const [key, g] of this.oauthGrants) {
      if (g.userId !== id) continue;
      for (const [digest, code] of this.oauthCodes) if (code.grantId === key) this.oauthCodes.delete(digest);
      for (const [digest, token] of this.oauthTokens) if (token.grantId === key) this.oauthTokens.delete(digest);
      this.oauthGrants.delete(key);
    }
    for (const [key, r] of this.oauthRequests) if (r.userId === id) this.oauthRequests.delete(key);
    for (const [key, account] of this.billingAccounts) {
      if (account.userId !== id) continue;
      for (const [subKey, sub] of this.billingSubs) if (sub.billingAccountId === account.id) this.billingSubs.delete(subKey);
      this.billingAccounts.delete(key);
    }
    for (const [key, review] of this.reviews) if (review.userId === id) this.reviews.delete(key);
    this.trialStarts.delete(id);
    this.people.delete(id);
  }

  readonly signupReviews: SignupReviewRepository = {
    list: async ({ state, limit, cursor }) => {
      const rows = [...this.reviews.values()]
        .filter((r) => (state === 'pending' ? r.decision === null : r.decision !== null))
        .filter((r) => (cursor ? isAfterCursor(r, cursor) : true))
        .sort(compareByCreatedAtThenId);
      const items = rows.slice(0, limit).map((r) => {
        const person = r.userId ? this.people.get(r.userId) : undefined;
        return { ...cloneReview(r), person: person ? { email: person.email, displayName: person.displayName, locale: person.locale } : null };
      });
      const last = items.at(-1);
      return { items, nextCursor: rows.length > limit && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    findByUser: async (userId) => {
      const review = [...this.reviews.values()].find((r) => r.userId === userId);
      return review ? cloneReview(review) : null;
    },
    digestFacts: async () => {
      const open = [...this.reviews.values()].filter((r) => r.decision === null);
      return { pending: open.length, unannounced: open.filter((r) => r.notifiedAt === null).sort(compareByCreatedAtThenId).map((r) => r.id) };
    },
    markNotified: async (ids, at) => {
      let count = 0;
      for (const id of ids) {
        const review = this.reviews.get(id);
        if (review && review.notifiedAt === null) {
          review.notifiedAt = at;
          count++;
        }
      }
      return count;
    },
    approve: async ({ userId, at, decidedBy, auditFor }) => {
      const review = [...this.reviews.values()].find((r) => r.userId === userId);
      const person = this.people.get(userId);
      if (!review || !person) return { kind: 'not_found' };
      if (review.decision !== null || person.status !== 'PENDING_REVIEW') return { kind: 'already_decided', review: cloneReview(review) };
      const personal = [...this.orgs.values()].find((o) => o.personalOwnerUserId === userId);
      Object.assign(person, { status: 'ACTIVE', updatedAt: at });
      this.trialStarts.set(userId, at);
      Object.assign(review, { decision: 'APPROVED', decidedAt: at, decidedBy });
      if (personal) for (const event of auditFor(personal.id)) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { kind: 'approved', review: cloneReview(review), user: { ...person }, trialStartedAt: at };
    },
    decline: async ({ userId, at, decidedBy }) => {
      const review = [...this.reviews.values()].find((r) => r.userId === userId);
      const person = this.people.get(userId);
      if (!review || !person) return { kind: 'not_found' };
      if (review.decision !== null || person.status !== 'PENDING_REVIEW') return { kind: 'already_decided', review: cloneReview(review) };
      const personal = [...this.orgs.values()].find((o) => o.personalOwnerUserId === userId);
      if (this.holdsAnythingBut(userId, personal?.id ?? null)) return { kind: 'not_empty' };
      // Every check passed: delete, as the Prisma transaction does (D12, D28).
      for (const [id, link] of this.setupLinks) if (link.userId === userId || (link.purpose === 'SIGNUP' && link.email === person.email)) this.setupLinks.delete(id);
      for (const [id, s] of this.sessionsById) if (s.userId === userId) this.sessionsById.delete(id);
      for (const [key, m] of this.members) if (m.userId === userId) this.members.delete(key);
      for (const [key, a] of this.termsAcceptances) if (a.userId === userId) this.termsAcceptances.delete(key);
      // MUT-433: Prisma cascades a declined person's feature rows; the memory store drops them the same way.
      for (const [key, g] of this.featureGrants) if (g.userId === userId) this.featureGrants.delete(key);
      this.trialStarts.delete(userId);
      if (personal) {
        for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i]!.organizationId === personal.id) this.events.splice(i, 1);
        this.orgs.delete(personal.id);
      }
      this.people.delete(userId);
      Object.assign(review, { userId: null, decision: 'DECLINED', decidedAt: at, decidedBy });
      return { kind: 'declined', review: cloneReview(review), person: { email: person.email, locale: person.locale } };
    },
  };

  /**
   * MUT-367 (D12): whether the account holds anything a decline would lose besides its empty personal profile. The
   * Prisma store gets the same answer from its foreign keys (RESTRICT) plus explicit grant and billing checks.
   */
  private holdsAnythingBut(userId: string, personalOrganizationId: string | null): boolean {
    if ([...this.members.values()].some((m) => m.userId === userId && m.organizationId !== personalOrganizationId)) return true;
    if ([...this.orgs.values()].some((o) => o.ownerUserId === userId && o.id !== personalOrganizationId)) return true;
    if ([...this.grants.values()].some((g) => g.userId === userId || (personalOrganizationId !== null && g.organizationId === personalOrganizationId))) return true;
    if ([...this.billingAccounts.values()].some((a) => a.userId === userId)) return true;
    if ([...this.inbox.values()].some((e) => e.userId === userId)) return true;
    if ([...this.userIdem.values()].some((r) => (r as { userId?: string }).userId === userId)) return true;
    if (personalOrganizationId === null) return false;
    const scoped: Map<string, { organizationId: string }>[] = [this.idem, this.keys, this.ints, this.custs, this.projs, this.refs, this.rates, this.agrs, this.insts, this.charges, this.recs, this.supps, this.versions, this.files, this.pays, this.allocs, this.credits, this.props, this.exps, this.expCats, this.expReceipts, this.convs, this.expGroups, this.groupMarks];
    return scoped.some((map) => [...map.values()].some((row) => row.organizationId === personalOrganizationId));
  }

  readonly billing: BillingRepository = {
    factsFor: async ({ ownerUserIds, organizationIds }) => {
      const owners = new Set(ownerUserIds);
      const orgs = new Set(organizationIds);
      const accounts = [...this.billingAccounts.values()];
      const payerOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.userId ?? null;
      const subscriptions = [...this.billingSubs.values()]
        .map((sub) => ({ ...sub, userId: payerOf(sub.billingAccountId) }))
        .filter((sub) => (sub.userId !== null && owners.has(sub.userId)) || (sub.organizationId !== null && orgs.has(sub.organizationId)));
      const grants = [...this.grants.values()]
        .filter((g) => (g.userId !== null && owners.has(g.userId)) || (g.organizationId !== null && orgs.has(g.organizationId)))
        .map((g) => ({ ...g }));
      const trialStarts = new Map([...owners].filter((id) => this.people.has(id)).map((id) => [id, this.trialStarts.get(id) ?? null] as const));
      return { subscriptions, grants, trialStarts };
    },
    setTrialStart: async (userId, at) => {
      if (!this.people.has(userId)) return null;
      this.trialStarts.set(userId, at);
      return { trialStartedAt: at };
    },
    trialMailCandidates: async ({ startedAfter, startedUpTo }) =>
      [...this.trialStarts]
        .flatMap(([userId, trialStartedAt]) => {
          const person = this.people.get(userId);
          const inWindow = trialStartedAt > startedAfter && trialStartedAt <= startedUpTo;
          // MUT-333 (R16): a closing account gets no trial reminders.
          return person && person.status === 'ACTIVE' && !person.closure && inWindow ? [{ userId, email: person.email, locale: person.locale, trialStartedAt }] : [];
        })
        .sort((a, b) => a.trialStartedAt.getTime() - b.trialStartedAt.getTime() || a.userId.localeCompare(b.userId)),
    createGrant: async (input) => {
      if ((input.userId === null) === (input.organizationId === null)) throw new StateConflict('entitlement_grant', 'ONE_TARGET');
      if (input.userId !== null && !this.people.has(input.userId)) throw new ForeignKeyViolation('entitlement_grants.userId');
      if (input.organizationId !== null && !this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('entitlement_grants.organizationId');
      const { id, userId, organizationId, tier, reason, expiresAt, grantedBy, at } = input;
      if (this.grants.has(id)) throw new UniqueViolation('entitlement_grants.id');
      const grant: EntitlementGrantRecord = { id, userId, organizationId, tier, reason, expiresAt, grantedBy, createdAt: at, revokedAt: null };
      this.grants.set(grant.id, grant);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { ...grant };
    },
    revokeGrant: async (id, at, audit) => {
      const grant = this.grants.get(id);
      if (!grant) return null;
      if (grant.revokedAt) return { grant: { ...grant }, revoked: false };
      grant.revokedAt = at;
      for (const event of audit) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { grant: { ...grant }, revoked: true };
    },
    getGrant: async (id) => clone(this.grants.get(id)),
    listGrants: async ({ userId, organizationId, activeAt }) =>
      [...this.grants.values()]
        .filter((g) => (userId === undefined || g.userId === userId) && (organizationId === undefined || g.organizationId === organizationId))
        .filter((g) => !activeAt || (!g.revokedAt && (!g.expiresAt || g.expiresAt > activeAt)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
        .map((g) => ({ ...g })),
    linkAccount: async (input) => {
      if (!this.people.has(input.userId)) throw new ForeignKeyViolation('billing_accounts.userId');
      const existing = [...this.billingAccounts.values()].find((a) => a.stripeCustomerId === input.stripeCustomerId);
      const usersAccount = [...this.billingAccounts.values()].find((a) => a.userId === input.userId);
      if (existing?.userId === input.userId) return { account: { ...existing }, linked: false };
      if (existing?.userId) throw new StateConflict('billing_account', 'CUSTOMER_LINKED_ELSEWHERE');
      if (usersAccount) throw new StateConflict('billing_account', 'USER_HAS_ANOTHER_ACCOUNT');
      if (!existing && !input.currency) throw new StateConflict('billing_account', 'CURRENCY_REQUIRED');
      const account: BillingAccountRecord = existing ?? {
        id: randomUUID(),
        userId: null,
        stripeCustomerId: input.stripeCustomerId,
        country: null,
        currency: input.currency!,
        createdAt: input.at,
        updatedAt: input.at,
      };
      Object.assign(account, { userId: input.userId, updatedAt: input.at });
      this.billingAccounts.set(account.id, account);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { account: { ...account }, linked: true };
    },
    getSubscription: async (stripeSubscriptionId) => clone([...this.billingSubs.values()].find((s) => s.stripeSubscriptionId === stripeSubscriptionId)),
    getAccount: async (stripeCustomerId) => clone([...this.billingAccounts.values()].find((a) => a.stripeCustomerId === stripeCustomerId)),
    listAccounts: async ({ linked }) =>
      [...this.billingAccounts.values()]
        .filter((a) => linked === undefined || (a.userId !== null) === linked)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => ({ ...a })),
    summaryOf: async (userId) => {
      const trialStartedAt = this.trialStarts.get(userId) ?? null;
      const account = [...this.billingAccounts.values()].find((a) => a.userId === userId);
      if (!account) return { account: null, subscriptions: [], trialStartedAt };
      const subscriptions = [...this.billingSubs.values()]
        .filter((s) => s.billingAccountId === account.id)
        .sort((a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime())
        .map((s) => ({ ...s }));
      return { account: { ...account }, subscriptions, trialStartedAt };
    },
    saveAccount: async (input) => {
      const accounts = [...this.billingAccounts.values()];
      const existing = accounts.find((a) => a.stripeCustomerId === input.stripeCustomerId);
      if (!existing && input.onlyIfExists) throw new StateConflict('billing_account', 'GONE');
      let userId = existing?.userId ?? null;
      let conflict: SaveBillingAccountConflict | null = null;
      if (input.userId !== null && input.userId !== userId) {
        if (userId !== null) conflict = 'CUSTOMER_LINKED_ELSEWHERE';
        else if (!this.people.has(input.userId)) conflict = 'UNKNOWN_USER';
        else if (accounts.some((a) => a.userId === input.userId)) conflict = 'USER_HAS_ANOTHER_ACCOUNT';
        else userId = input.userId;
      }
      const linked = userId !== null && userId !== (existing?.userId ?? null);
      const currency = input.currency ?? existing?.currency ?? null;
      if (currency === null) throw new StateConflict('billing_account', 'CURRENCY_REQUIRED');
      const account: BillingAccountRecord = existing ?? {
        id: randomUUID(),
        userId: null,
        stripeCustomerId: input.stripeCustomerId,
        country: null,
        currency,
        createdAt: input.at,
        updatedAt: input.at,
      };
      Object.assign(account, { userId, country: input.country ?? account.country, currency, updatedAt: input.at });
      this.billingAccounts.set(account.id, account);
      if (linked) for (const event of input.linkAudit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { account: { ...account }, linked, conflict };
    },
    saveSubscription: async (input) => {
      const account = [...this.billingAccounts.values()].find((a) => a.stripeCustomerId === input.stripeCustomerId);
      if (!account) throw new ForeignKeyViolation('billing_subscriptions.billingAccountId');
      if (input.organizationId !== null && !this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('billing_subscriptions.organizationId');
      const { stripeCustomerId, at, audit, ...fields } = input;
      void stripeCustomerId; // matched above; the subscription row stores the account id instead
      const existing = [...this.billingSubs.values()].find((s) => s.stripeSubscriptionId === input.stripeSubscriptionId);
      if (existing && existing.stripeUpdatedAt > input.stripeUpdatedAt) return { subscription: { ...existing }, outcome: 'stale' as const };
      const before = existing ? { ...existing } : null;
      const sub: BillingSubscriptionRecord = existing ?? { id: randomUUID(), billingAccountId: account.id, ...fields, createdAt: at, updatedAt: at };
      Object.assign(sub, fields, { billingAccountId: account.id, updatedAt: at });
      this.billingSubs.set(sub.id, sub);
      const changed = before === null || subscriptionChanged(before, sub);
      if (changed) for (const event of subscriptionChangeAudit(before, sub, audit)) this.events.push({ id: randomUUID(), createdAt: at, ...event });
      return { subscription: { ...sub }, outcome: before === null ? ('created' as const) : changed ? ('changed' as const) : ('unchanged' as const) };
    },
    beginStripeEvent: async ({ id, type, at }) => {
      const row = this.stripeEvents.get(id);
      if (!row) this.stripeEvents.set(id, { type, receivedAt: at, processedAt: null, error: null });
      return { alreadyProcessed: row?.processedAt != null };
    },
    finishStripeEvent: async (id, outcome) => {
      const row = this.stripeEvents.get(id);
      if (!row) return;
      if ('processedAt' in outcome) Object.assign(row, { processedAt: outcome.processedAt, error: null });
      else row.error = outcome.error.slice(0, STRIPE_EVENT_ERROR_MAX);
    },
    pruneStripeEvents: async (before) => {
      let count = 0;
      for (const [id, row] of this.stripeEvents) {
        if (row.receivedAt < before) {
          this.stripeEvents.delete(id);
          count += 1;
        }
      }
      return count;
    },
  };

  /** The profile-owned maps by snapshot field name (MUT-325), so an export page names its map the way the file does. */
  private exportMaps(): { [F in ProfileExportField]: Map<string, ProfileExportRecords[F]> } {
    const m = this.snapshot().maps;
    return {
      custs: m.custs, projs: m.projs, refs: m.refs, rates: m.rates, agrs: m.agrs, insts: m.insts, charges: m.charges, recs: m.recs, supps: m.supps, versions: m.versions,
      pays: m.pays, allocs: m.allocs, credits: m.credits, counters: m.counters, props: m.props, exps: m.exps, expCats: m.expCats, expReceipts: m.expReceipts,
      convs: m.convs, expGroups: m.expGroups, groupMarks: m.groupMarks, vendors: m.vendors, vendorNames: m.vendorNames,
    };
  }

  readonly entries: EntriesRepository = {
    list: async (organizationIds, page) => {
      const rows: EntryRow[] = [
        ...[...this.exps.values()].filter((e) => !e.deletedAt).map((e): EntryRow => ({ kind: 'expense', record: { ...e } })),
        ...[...this.pays.values()].filter((p) => p.reversalReason !== CAPTURE_UNDO_REASON).map((p): EntryRow => ({ kind: 'payment', record: { ...p } })),
        ...[...this.recs.values()].filter((r) => r.origin === 'ADJUSTMENT' && !r.deletedAt).map((r): EntryRow => ({ kind: 'receivable', record: { ...r } })),
        ...[...this.convs.values()].filter((c) => !c.deletedAt).map((c): EntryRow => ({ kind: 'conversion', record: { ...c } })),
      ].filter((row) => {
        const day = moneyDateOf(row);
        return (
          organizationIds.includes(row.record.organizationId) &&
          (page.occurredFrom === undefined || day >= page.occurredFrom) &&
          (page.occurredBefore === undefined || day < page.occurredBefore) &&
          (page.loggedSince === undefined || row.record.createdAt.getTime() >= page.loggedSince.getTime())
        );
      });
      if (page.order === 'occurredOn') {
        const cursor = moneyDateCursorOf(page.cursor);
        return mergeByMoneyDate([rows.filter((row) => !cursor || isBeforeMoneyDateCursor(moneyDateKeyOf(row), cursor))], page.limit, moneyDateKeyOf);
      }
      const cursor = createdAtCursorOf(page.cursor);
      return mergeNewestFirst([rows.filter((row) => !cursor || isBeforeCursor(row.record, cursor))], page.limit, (row) => row.record);
    },
    loggedDays: async (organizationId, since, timezone) => {
      const at = [
        ...[...this.exps.values()].filter((e) => !e.deletedAt).map((e) => ({ org: e.organizationId, createdAt: e.createdAt })),
        ...[...this.pays.values()].filter((p) => p.reversalReason !== CAPTURE_UNDO_REASON).map((p) => ({ org: p.organizationId, createdAt: p.createdAt })),
        ...[...this.recs.values()].filter((r) => r.origin === 'ADJUSTMENT' && !r.deletedAt).map((r) => ({ org: r.organizationId, createdAt: r.createdAt })),
      ].filter((row) => row.org === organizationId && row.createdAt.getTime() >= since.getTime());
      return [...new Set(at.map((row) => todayIn(timezone, row.createdAt)))].sort().reverse();
    },
    settledOwedIds: async (organizationIds, paymentIds) => {
      const byPayment = new Map<string, AllocationRecord[]>();
      for (const a of this.allocs.values()) {
        if (!organizationIds.includes(a.organizationId) || !paymentIds.includes(a.paymentId)) continue;
        byPayment.set(a.paymentId, [...(byPayment.get(a.paymentId) ?? []), a]);
      }
      const links = new Map<string, string>();
      for (const [paymentId, allocations] of byPayment) {
        const only = allocations.length === 1 ? allocations[0]! : null;
        if (only && this.recs.get(only.receivableId)?.origin === 'ADJUSTMENT') links.set(paymentId, only.receivableId);
      }
      return links;
    },
  };

  private categoryNamed(organizationId: string, name: string): ExpenseCategoryRecord | undefined {
    const key = categoryNameKey(name);
    return [...this.expCats.values()].find((c) => c.organizationId === organizationId && categoryNameKey(c.name) === key);
  }

  // ---- MUT-66: the unsorted inbox ------------------------------------------

  readonly inboxEntries: InboxEntryRepository = {
    create: async (input: CreateInboxEntryInput, at) => {
      if (!this.people.has(input.userId)) throw new ForeignKeyViolation('inbox_entries.userId');
      const record: InboxEntryRecord = { id: randomUUID(), ...input, version: 1, createdAt: at, updatedAt: at };
      this.inbox.set(record.id, record);
      return { ...record };
    },
    getById: async (userId, id) => {
      const e = this.inbox.get(id);
      return e && e.userId === userId ? { ...e } : null;
    },
    list: async (userId, page) => {
      const rows = [...this.inbox.values()]
        .filter((e) => e.userId === userId && (!page.cursor || isBeforeInboxCursor(e, page.cursor)))
        .sort(newestInboxFirst)
        .slice(0, page.limit + 1);
      const items = rows.slice(0, page.limit).map((e) => ({ ...e }));
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    update: async (userId, id, expectedVersion, patch: UpdateInboxEntryPatch, at) => {
      const e = this.inbox.get(id);
      if (!e || e.userId !== userId) return { kind: 'not_found' };
      if (e.version !== expectedVersion) return { kind: 'stale', record: { ...e } };
      Object.assign(e, definedOnly(patch));
      e.version += 1;
      e.updatedAt = at;
      return { kind: 'updated', record: { ...e } };
    },
    delete: async (userId, id) => {
      const e = this.inbox.get(id);
      if (!e || e.userId !== userId) return false;
      this.inbox.delete(id);
      return true;
    },
    countByUser: async (userId) => [...this.inbox.values()].filter((e) => e.userId === userId).length,
    fileAsExpense: async (params, at) => {
      const claimed = this.claimInboxEntry(params);
      if (!claimed) return { kind: 'not_found' };
      const expense = await this.restoringOnFailure(claimed, () => this.expenses.create(params.expense, at));
      return { kind: 'filed', expense };
    },
    fileAsIncome: async (params, at) => {
      const claimed = this.claimInboxEntry(params);
      if (!claimed) return { kind: 'not_found' };
      const result = await this.restoringOnFailure(claimed, async (): Promise<IncomeWriteResult> => {
        if (params.write.kind === 'received') {
          const { payment, allocations } = await this.payments.create(params.write.payment, at);
          return { kind: 'received', payment, allocations };
        }
        return { kind: 'owed', receivable: await this.receivables.createAdjustment(params.write.receivable, at) };
      });
      return { kind: 'filed', result };
    },
  };

  /**
   * The in-memory stand-in for the filing transaction's row lock: take the
   * entry out of the map synchronously, before any await, so that of two
   * concurrent filings of the same entry exactly one proceeds and the other
   * sees `not_found` — rather than both passing an "it still exists" check and
   * writing two financial records.
   */
  private claimInboxEntry(params: { userId: string; inboxEntryId: string; kind: InboxEntryKind }): InboxEntryRecord | null {
    const entry = this.inbox.get(params.inboxEntryId);
    if (!entry || entry.userId !== params.userId || entry.kind !== params.kind) return null;
    this.inbox.delete(entry.id);
    return entry;
  }

  /** The rollback half: a financial write that throws puts the claimed entry back exactly as it was. */
  private async restoringOnFailure<T>(claimed: InboxEntryRecord, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      this.inbox.set(claimed.id, claimed);
      throw err;
    }
  }

  async ping(): Promise<void> {
    /* always up */
  }

  /** Test helper: how many audit events exist for an organization. */
  auditCount(organizationId: string): number {
    return this.events.filter((e) => e.organizationId === organizationId).length;
    }

  /** MUT-324: the (userId, version) unique key; an existing acceptance is kept as it is. */
  private recordTermsAcceptance(userId: string, terms: TermsAcceptanceInput, at: Date): { acceptance: TermsAcceptanceRecord; created: boolean } {
    const key = `${userId}:${terms.version}`;
    const existing = this.termsAcceptances.get(key);
    if (existing) return { acceptance: { ...existing }, created: false };
    const { version, locale, textSha256, surface, clientRelease } = terms;
    const acceptance: TermsAcceptanceRecord = { userId, version, locale, textSha256, surface, clientRelease, acceptedAt: at };
    this.termsAcceptances.set(key, acceptance);
    return { acceptance: { ...acceptance }, created: true };
  }

  /**
   * The business-data half of this store (MUT-286): every field in
   * `LocalSnapshotMaps`, by reference. Safe to pass by reference because the
   * only caller outside tests — the portal's local-mode persistence layer
   * (Phase B) — structured-clones it into IndexedDB immediately, rather than
   * holding the live Maps.
   */
  snapshot(): LocalSnapshot {
    return {
      formatVersion: CURRENT_STORE_SNAPSHOT_VERSION,
      maps: {
        orgs: this.orgs,
        ints: this.ints,
        custs: this.custs,
        projs: this.projs,
        refs: this.refs,
        rates: this.rates,
        agrs: this.agrs,
        insts: this.insts,
        charges: this.charges,
        recs: this.recs,
        supps: this.supps,
        versions: this.versions,
        files: this.files,
        pays: this.pays,
        allocs: this.allocs,
        credits: this.credits,
        counters: this.counters,
        props: this.props,
        people: this.people,
        members: this.members,
        exps: this.exps,
        expCats: this.expCats,
        expReceipts: this.expReceipts,
        convs: this.convs,
        expGroups: this.expGroups,
        groupMarks: this.groupMarks,
        inbox: this.inbox,
        vendors: this.vendorMap,
        vendorNames: this.vendorNames,
      },
    };
  }

  /**
   * Replaces every business-data field with the snapshot's rows. The six
   * ephemeral fields (idempotency keys, sessions, setup links, the audit log,
   * API keys) are left exactly as they are on this instance — a restored
   * store never replays old idempotency keys or sessions (ADR-097 §2.3.4);
   * the portal's local-mode boot mints a fresh device session afterward.
   * Mutates each field's own Map in place (`clear()` then repopulate) rather
   * than reassigning, since every field is `private readonly`.
   */
  restore(snapshot: LocalSnapshot): void {
    const { maps } = snapshot;
    replaceMap(this.orgs, maps.orgs);
    replaceMap(this.ints, maps.ints);
    replaceMap(this.custs, maps.custs);
    replaceMap(this.projs, maps.projs);
    replaceMap(this.refs, maps.refs);
    replaceMap(this.rates, maps.rates);
    replaceMap(this.agrs, maps.agrs);
    replaceMap(this.insts, maps.insts);
    replaceMap(this.charges, maps.charges);
    replaceMap(this.recs, maps.recs);
    replaceMap(this.supps, maps.supps);
    replaceMap(this.versions, maps.versions);
    replaceMap(this.files, maps.files);
    replaceMap(this.pays, maps.pays);
    replaceMap(this.allocs, maps.allocs);
    replaceMap(this.credits, maps.credits);
    replaceMap(this.counters, maps.counters);
    replaceMap(this.props, maps.props);
    replaceMap(this.people, maps.people);
    replaceMap(this.members, maps.members);
    replaceMap(this.exps, maps.exps);
    replaceMap(this.expCats, maps.expCats);
    replaceMap(this.expReceipts, maps.expReceipts);
    replaceMap(this.convs, maps.convs);
    replaceMap(this.expGroups, maps.expGroups);
    replaceMap(this.groupMarks, maps.groupMarks);
    replaceMap(this.inbox, maps.inbox);
    replaceMap(this.vendorMap, maps.vendors);
    replaceMap(this.vendorNames, maps.vendorNames);
  }
}

/** One page of `map`'s matching rows in ascending key order, strictly after `afterKey` (MUT-325 export). Copies, like every other read. */
function pageOfMap<T>(map: Map<string, T>, matches: (key: string, row: T) => boolean, afterKey: string | null, limit: number): ExportPage<T> {
  const keys = [...map.keys()].filter((key) => (afterKey === null || key > afterKey) && matches(key, map.get(key) as T)).sort();
  const page = keys.slice(0, limit);
  const entries = page.map((key): [string, T] => {
    const row = map.get(key) as T;
    return [key, typeof row === 'object' && row !== null ? (structuredClone(row) as T) : row];
  });
  return { entries, nextKey: keys.length > limit ? (page[page.length - 1] ?? null) : null };
}

/**
 * MUT-254: the typeahead's ranking, shared by both stores. Scores each candidate name against the query key
 * (vendors/keys.ts scoreVendorName), keeps the best name per vendor, and orders by score, then most recently used.
 */
/** How many of the most recently used vendors a typeahead also scores for near-misses (both stores, A16). */
export const RECENT_VENDORS_SCORED = 50;

export function bestVendorSuggestions(names: readonly VendorNameRecord[], vendorOf: (id: string) => VendorRecord | undefined, queryKey: string, limit: number): VendorSuggestion[] {
  const best = new Map<string, VendorSuggestion>();
  for (const n of names) {
    const score = scoreVendorName(queryKey, n.nameKey);
    if (score <= 0) continue;
    const vendor = vendorOf(n.vendorId);
    if (!vendor) continue;
    const exact = n.nameKey === queryKey;
    const held = best.get(vendor.id);
    if (!held || (exact && !held.exact) || (exact === held.exact && score > held.score)) best.set(vendor.id, { vendor: { ...vendor }, matchedName: n.name, score, exact });
  }
  return [...best.values()]
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || b.vendor.lastUsedAt.getTime() - a.vendor.lastUsedAt.getTime() || a.vendor.id.localeCompare(b.vendor.id))
    .slice(0, limit);
}

/** `target.clear()` then repopulate from `source` — `target` is a `private readonly` field, so it is mutated in place, never reassigned. */
function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function membershipKey(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
}

/** MUT-262: the session that replaces `kept` on a rotating password change; never outlives `kept`'s absolute deadline. */
function rotatedSession(kept: SessionRecord, rotation: { tokenDigest: string; idleMs: number }, at: Date): SessionRecord {
  const idleExpiresAt = new Date(Math.min(at.getTime() + rotation.idleMs, kept.absoluteExpiresAt.getTime()));
  return {
    ...kept,
    id: randomUUID(),
    tokenDigest: rotation.tokenDigest,
    createdAt: at,
    credentialsVerifiedAt: at,
    lastSeenAt: at,
    idleExpiresAt,
    revokedAt: null,
    revokedReason: null,
  };
}

export class UniqueViolation extends Error {
  constructor(readonly constraint: string) {
    super(`unique constraint violated: ${constraint}`);
    this.name = 'UniqueViolation';
  }
}

export class ForeignKeyViolation extends Error {
  constructor(readonly constraint: string) {
    super(`foreign key violated: ${constraint}`);
    this.name = 'ForeignKeyViolation';
  }
}

/** An entity is no longer in the state a transaction needs (M7: converting a proposal that moved). `reason` is the published 409 reason. */
export class StateConflict extends Error {
  constructor(readonly entity: string, readonly reason: string) {
    super(`${entity} is not in the expected state: ${reason}`);
    this.name = 'StateConflict';
  }
}

/**
 * Postgres aborted the write to break a deadlock or a serialization conflict (40P01 / 40001), so nothing was written
 * and a retry can succeed (MUT-130). Only the Prisma store raises it; the memory store has no locks.
 */
export class LockConflict extends Error {
  constructor() {
    super('the write lost a lock conflict and was rolled back');
    this.name = 'LockConflict';
  }
}

/** A receivable (or payment) can no longer absorb an allocation or credit — a race the preview token did not see (M4); since MUT-267 also a profile already at its expense-group cap. */
export class InsufficientCapacity extends Error {
  constructor(readonly entityId: string) {
    super(`insufficient capacity on ${entityId}`);
    this.name = 'InsufficientCapacity';
  }
}

function outstanding(r: ReceivableRecord): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

/** Status and version follow the sums: SETTLED iff nothing is outstanding. */
function settle(r: ReceivableRecord): void {
  r.status = outstanding(r) <= 0n ? 'SETTLED' : 'OPEN';
  r.version += 1;
}

function clone<T extends object>(value: T | undefined): T | null {
  return value ? { ...value } : null;
}

function matchesExpense(e: ExpenseRecord, f: ExpenseFilter): boolean {
  // MUT-286: mirrors Prisma's where-object spread (prisma.ts expenseWhere), where a later `customerId: null` key
  // (from `unlinked`) overwrites an earlier `customerId: f.customerId` key — `unlinked` wins whenever both are set,
  // rather than ANDing them (which was never true: a real customerId can never equal null).
  const customerMatches = f.unlinked ? e.customerId === null : !f.customerId || e.customerId === f.customerId;
  return (
    (!f.from || e.occurredOn >= f.from) &&
    (!f.to || e.occurredOn <= f.to) &&
    (!f.currency || e.currency === f.currency) &&
    (!f.categoryId || e.categoryId === f.categoryId) &&
    customerMatches &&
    (!f.projectId || e.projectId === f.projectId)
  );
}

/** (occurredOn, id) descending. ISO dates compare as strings. */
function newestFirst(a: ExpenseRecord, b: ExpenseRecord): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Strictly after the cursor, or at it too when the cursor is inclusive (MUT-91 anchor). */
function isBeforeExpenseCursor(e: ExpenseRecord, cursor: ExpenseCursor): boolean {
  const sameDay = cursor.inclusive ? e.id <= cursor.id : e.id < cursor.id;
  return e.occurredOn < cursor.occurredOn || (e.occurredOn === cursor.occurredOn && sameDay);
}

function matchesConversion(c: ConversionRecord, f: ConversionFilter): boolean {
  return (
    (!f.from || c.occurredOn >= f.from) &&
    (!f.to || c.occurredOn <= f.to) &&
    (!f.currency || c.currency === f.currency || c.toCurrency === f.currency)
  );
}

/** (occurredOn, id) descending. ISO dates compare as strings. */
function newestConversionFirst(a: ConversionRecord, b: ConversionRecord): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Strictly after the cursor, or at it too when the cursor is inclusive (MUT-91 anchor). */
function isBeforeConversionCursor(c: ConversionRecord, cursor: ConversionCursor): boolean {
  const sameDay = cursor.inclusive ? c.id <= cursor.id : c.id < cursor.id;
  return c.occurredOn < cursor.occurredOn || (c.occurredOn === cursor.occurredOn && sameDay);
}

/** The inbox's own newest-first order: (createdAt, id) descending, so entries captured in the same millisecond still page without gaps or repeats. */
function newestInboxFirst(a: InboxEntryRecord, b: InboxEntryRecord): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isBeforeInboxCursor(e: InboxEntryRecord, cursor: InboxEntryCursor): boolean {
  const t = e.createdAt.getTime();
  const c = cursor.createdAt.getTime();
  return t < c || (t === c && e.id < cursor.id);
}

/** The keys of a patch that are present (undefined = unchanged; null = cleared). */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function paginate<T extends { id: string; createdAt: Date }>(rows: T[], page: PageRequest): Page<T> {
  const ordered = rows
    .filter((r) => (page.cursor ? isAfterCursor(r, page.cursor) : true))
    .sort(compareByCreatedAtThenId)
    .slice(0, page.limit + 1);
  const items = ordered.slice(0, page.limit).map((r) => ({ ...r }));
  const last = items[items.length - 1];
  const nextCursor = ordered.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { items, nextCursor };
}

/** MUT-255/389: why a library receipt can't be filed, or null when it can (live, READY, To review, on this profile). */
function toReviewRefusal(r: ExpenseReceiptRecord | undefined, organizationId: string): { kind: 'not_found' | 'already_filed' | 'not_ready' } | null {
  if (!r || r.organizationId !== organizationId || r.deletedAt) return { kind: 'not_found' };
  if (r.filingStatus === 'FILED') return { kind: 'already_filed' };
  if (r.status !== 'READY') return { kind: 'not_ready' };
  return null;
}

/** MUT-434: a stored token without its digest, which never leaves the store. */
function oauthTokenRecordOf(t: OAuthTokenRecord & { digest: string }): OAuthTokenRecord {
  return { id: t.id, grantId: t.grantId, kind: t.kind, createdAt: t.createdAt, expiresAt: t.expiresAt, rotatedAt: t.rotatedAt, successorId: t.successorId };
}

function clonePasskey(p: PasskeyRecord): PasskeyRecord {
  return { ...p, publicKey: Uint8Array.from(p.publicKey), transports: [...p.transports] };
}

function cloneReview(review: SignupReviewRecord): SignupReviewRecord {
  return { ...review, reasons: [...review.reasons] };
}

/** MUT-333 (R3): whether a JSON value names this id anywhere (a uuid can't occur by accident). */
function mentions(value: unknown, id: string): boolean {
  if (value === null || value === undefined) return false;
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)).includes(id);
}
