import { randomUUID } from 'node:crypto';
import { editRatesOf } from '../receipts/edit-rates.js';
import { applyMalafatChange } from '../malafat-suggestions.js';
import { categoryNameKey } from '../expenses/names.js';
import { compareByCreatedAtThenId, isAfterCursor } from '../pagination.js';
import { subscriptionChangeAudit, subscriptionChanged } from './billing-audit.js';
import type {
  BillingAccountRecord,
  BillingRepository,
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
  SetupLinkPurpose,
  SessionRepository,
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
} from './ports.js';
import { isGroupMember } from '../expenses/groups.js';
import { CAPTURE_UNDO_REASON, STRIPE_EVENT_ERROR_MAX } from './ports.js';
import { isBeforeCursor, mergeNewestFirst } from '../entries/merge.js';
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
 */
export const CURRENT_STORE_SNAPSHOT_VERSION = 3;

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
  /**
   * MUT-358 billing state. Deliberately not in snapshot()/restore(), like the terms acceptances: the portal's
   * signed-out mode has no billing (its /v1/me says `billing: null`), and new maps would change the local format.
   */
  private readonly billingAccounts = new Map<string, BillingAccountRecord>();
  private readonly billingSubs = new Map<string, BillingSubscriptionRecord>();
  private readonly grants = new Map<string, EntitlementGrantRecord>();
  private readonly trialStarts = new Map<string, Date>();
  /** MUT-360: Stripe webhook events by id (processedAt null until handled), also outside the snapshot. */
  private readonly stripeEvents = new Map<string, { type: string; receivedAt: Date; processedAt: Date | null; error: string | null }>();

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
      for (const u of this.people.values()) {
        if (u.email === input.email) throw new UniqueViolation('users.email');
      }
      if (input.organizationId && !this.orgs.has(input.organizationId)) throw new ForeignKeyViolation('memberships.organizationId');
      for (const o of this.orgs.values()) {
        if (o.slug === input.personal.slug) throw new UniqueViolation('organizations.slug');
      }
      if (input.setupLink) this.assertSetupDigestFree(input.setupLink.tokenDigest);
      const user: UserRecord = {
        id: randomUUID(),
        email: input.email,
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        locale: input.locale,
        status: 'ACTIVE',
        failedSignIns: 0,
        lockedUntil: null,
        passwordChangedAt: input.at,
        lastSignInAt: null,
        malafatSuggestions: null,
        createdAt: input.at,
        updatedAt: input.at,
      };
      // Every check above runs before the first write, so a refusal leaves nothing behind (the Prisma transaction's guarantee).
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
      if (input.setupLink) this.storeSetupLink(user.id, input.setupLink, input.at);
      return { user: { ...user }, memberships: memberships.map((m) => ({ ...m })), personalOrganization: { ...personalOrganization } };
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
      Object.assign(u, { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at });
      this.revokeSessionsOf(u.id, 'password_changed', input.at, input.exceptSessionId);
      // The kept session is verified as of the change, so the middleware's passwordChangedAt check lets it through.
      kept.credentialsVerifiedAt = input.at;
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { ...u };
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

  private cancelOpenSetupLinks(userId: string, at: Date): void {
    for (const link of this.setupLinks.values()) {
      if (link.userId === userId && link.usedAt === null && link.cancelledAt === null) link.cancelledAt = at;
    }
  }

  private assertSetupDigestFree(tokenDigest: string): void {
    for (const link of this.setupLinks.values()) {
      if (link.tokenDigest === tokenDigest) throw new UniqueViolation('account_setup_tokens.tokenDigest');
    }
  }

  private storeSetupLink(userId: string, input: { tokenDigest: string; purpose: SetupLinkPurpose; expiresAt: Date }, at: Date): AccountSetupTokenRecord {
    const record: AccountSetupTokenRecord = { id: randomUUID(), userId, ...input, createdAt: at, usedAt: null, cancelledAt: null };
    this.setupLinks.set(record.id, record);
    return record;
  }

  // Each method runs to completion without an await, which is the in-memory stand-in for the Prisma transaction and row lock.
  readonly accountSetup: AccountSetupRepository = {
    issue: async (input) => {
      const person = this.people.get(input.userId);
      if (!person) throw new ForeignKeyViolation('account_setup_tokens.userId');
      // Re-checked here, not only in the route, so a disable that lands first can never be followed by a fresh link.
      if (person.status !== 'ACTIVE') throw new StateConflict('user', 'USER_DISABLED');
      this.assertSetupDigestFree(input.tokenDigest);
      if (input.lock) {
        // Stamping passwordChangedAt makes the session check refuse a session a racing sign-in inserts after the lock.
        Object.assign(person, { passwordHash: null, passwordChangedAt: input.at, updatedAt: input.at });
        this.revokeSessionsOf(person.id, 'setup_link_lock', input.at);
      }
      this.cancelOpenSetupLinks(input.userId, input.at);
      const record = this.storeSetupLink(input.userId, { tokenDigest: input.tokenDigest, purpose: input.purpose, expiresAt: input.expiresAt }, input.at);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      return { ...record };
    },
    findByDigest: async (tokenDigest) => clone([...this.setupLinks.values()].find((l) => l.tokenDigest === tokenDigest)),
    redeem: async (input) => {
      const link = [...this.setupLinks.values()].find((l) => l.tokenDigest === input.tokenDigest);
      const person = link && this.people.get(link.userId);
      const claimable = link && person && link.usedAt === null && link.cancelledAt === null && input.at < link.expiresAt && person.status === 'ACTIVE';
      if (!claimable) return null;
      link.usedAt = input.at;
      Object.assign(person, { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at });
      this.revokeSessionsOf(person.id, 'password_set', input.at);
      for (const event of input.audit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      if (this.recordTermsAcceptance(person.id, input.terms, input.at).created) {
        for (const event of input.termsAudit) this.events.push({ id: randomUUID(), createdAt: input.at, ...event });
      }
      return { ...person };
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
    redateAdjustment: async (organizationId, id, userId, expectedVersion, postingDate) => {
      const r = this.recs.get(id);
      if (!r || r.organizationId !== organizationId || r.origin !== 'ADJUSTMENT' || r.createdByUserId !== userId || r.deletedAt) return { kind: 'not_found' };
      if (r.version !== expectedVersion) return { kind: 'stale', record: { ...r } };
      Object.assign(r, { postingDate, version: r.version + 1 });
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
    capture: async (input, at) => (await this.payments.create({ ...input, reference: null, replacesPaymentId: null, origin: 'CAPTURE', allocations: [] }, at)).payment,
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
      const record: ExpenseRecord = { id: randomUUID(), ...input, version: 1, createdAt: at, updatedAt: at, deletedAt: null };
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
      const items = rows.slice(0, page.limit).map((r) => ({ ...r }));
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
    saveAccount: async (input) => {
      const accounts = [...this.billingAccounts.values()];
      const existing = accounts.find((a) => a.stripeCustomerId === input.stripeCustomerId);
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
      convs: m.convs, expGroups: m.expGroups, groupMarks: m.groupMarks,
    };
  }

  readonly entries: EntriesRepository = {
    list: async (organizationIds, page) => {
      const inScope = (row: { organizationId: string; createdAt: Date; id: string }) => organizationIds.includes(row.organizationId) && (!page.cursor || isBeforeCursor(row, page.cursor));
      const branches: EntryRow[][] = [
        [...this.exps.values()].filter((e) => inScope(e) && !e.deletedAt).map((e) => ({ kind: 'expense', record: { ...e } })),
        [...this.pays.values()].filter((p) => inScope(p) && p.reversalReason !== CAPTURE_UNDO_REASON).map((p) => ({ kind: 'payment', record: { ...p } })),
        [...this.recs.values()].filter((r) => inScope(r) && r.origin === 'ADJUSTMENT' && !r.deletedAt).map((r) => ({ kind: 'receivable', record: { ...r } })),
        [...this.convs.values()].filter((c) => inScope(c) && !c.deletedAt).map((c) => ({ kind: 'conversion', record: { ...c } })),
      ];
      return mergeNewestFirst(branches, page.limit, (row) => row.record);
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

/** `target.clear()` then repopulate from `source` — `target` is a `private readonly` field, so it is mutated in place, never reassigned. */
function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

function membershipKey(userId: string, organizationId: string): string {
  return `${userId}:${organizationId}`;
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
