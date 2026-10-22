import { Prisma, PrismaClient } from '@prisma/client';
import type { KeyScope } from '../auth/scopes.js';
import { parseScopes } from '../auth/scopes.js';
import { categoryNameKey } from '../expenses/names.js';
import { SENTRY_RULES } from '../observability/sentry-rules.js';
import { ForeignKeyViolation, InsufficientCapacity, LockConflict, StateConflict, UniqueViolation } from './memory.js';
import { resolveClaim } from './idempotency-claim.js';
import { prismaRecordsExport } from './prisma-records-export.js';
import { editRatesOf } from '../receipts/edit-rates.js';
import { applyMalafatChange, resolveMalafatSuggestions } from '../malafat-suggestions.js';
import type { TermsLocale } from '../legal.js';
import { OPEN_PROPOSAL_STATUSES } from '../proposals/transitions.js';
import { ownedProfileCreatedAudit, ownedProfileUpdatedAudit, profileTypeOf, type TypeChangeDetail } from '../personal-profile.js';
import { firmAuditRow, firmEnableRefusal, firmOwnersOf, firmUnchanged, roleForNewMembership } from '../firm.js';
import { grantOwnerRefusal, ownerIdsOf, ownerRemovedAudit, removeOwnerDecision } from '../co-owners.js';
import type {
  SaveBillingAccountConflict,
  BillingRepository,
  TermsAcceptanceInput,
  TermsAcceptanceRecord,
  AccountSetupRepository,
  AccountSetupTokenRecord,
  AttachmentFilter,
  AuditEventInput,
  ExpenseCategoryInput,
  ProfileTypeChange,
  AttachmentRepository,
  AuditEventRecord,
  CreditRecord,
  JsonObject,
  AuditFilter,
  CreateAttachmentInput,
  AppendVersionInput,
  RetainerVersionRecord,
  AgreementFilter,
  AgreementRecord,
  AgreementRepository,
  AllocationInput,
  AllocationRecord,
  CreateAdjustmentReceivableInput,
  CreatePaymentInput,
  CreditInput,
  PaymentFilter,
  AllocationState,
  PaymentRecord,
  PaymentRepository,
  ApiKeyRecord,
  ApiKeyRepository,
  ApplySupplementInput,
  CorrectOutcomeInput,
  OutcomeWriteInput,
  AuditRepository,
  InstallmentRecord,
  ReceivableFilter,
  ReceivableRecord,
  ReceivableRepository,
  RetainerChargeRecord,
  SupplementRecord,
  VatRateRepository,
  CustomerFilter,
  CustomerRecord,
  CustomerRepository,
  ExternalEntityType,
  ExternalReferenceRepository,
  IdempotencyClaim,
  IdempotencyRepository,
  UserIdempotencyClaim,
  UserIdempotencyRepository,
  IntegrationRecord,
  IntegrationRepository,
  LedgerStore,
  OrganizationRepository,
  Page,
  PageRequest,
  ProjectFilter,
  ProjectRecord,
  ProjectRepository,
  UpdateResult,
  FeeProposalRecord,
  FeeProposalRepository,
  TransitionResult,
  MembershipRecord,
  MembershipRepository,
  SessionRecord,
  SessionRepository,
  UserLocale,
  UserRecord,
  UserRepository,
  ConversionCursor,
  ConversionFilter,
  ConversionRecord,
  ConversionRepository,
  ExpenseCategoryRecord,
  ExpenseCategoryRepository,
  ExpenseCursor,
  ExpenseFilter,
  ExpenseGroupFilter,
  ExpenseGroupOverrideMode,
  ExpenseGroupOverrideRecord,
  ExpenseGroupRepository,
  ApprovedReceiptFields,
  ExpenseReceiptRecord,
  ExpenseReceiptRepository,
  ReceiptSuggestion,
  ExpenseRecord,
  ExpenseRepository,
  CreateExpenseInput,
  IncomeWriteInput,
  IncomeWriteResult,
  InboxEntryCursor,
  InboxEntryKind,
  InboxEntryRepository,
  EntriesRepository,
  EntryRow,
  FeedPageRequest,
  MoneyDateCursor,
  PageCursor,
} from './ports.js';
import { CAPTURE_UNDO_REASON, STRIPE_EVENT_ERROR_MAX } from './ports.js';
import { subscriptionChangeAudit, subscriptionChanged } from './billing-audit.js';
import { createdAtCursorOf, mergeByMoneyDate, mergeNewestFirst, moneyDateCursorOf, moneyDateKeyOf } from '../entries/merge.js';

/**
 * Production LedgerStore over Postgres.
 *
 * Constraint violations are translated to the same error classes the memory
 * store throws, so routes handle one vocabulary. Scopes are validated on read:
 * a row with an unknown scope (only possible by hand-editing the table) is
 * treated as having none of its scopes rather than some of them.
 */
export class PrismaLedgerStore implements LedgerStore {
  constructor(private readonly prisma: PrismaClient) {}

  static connect(databaseUrl: string): PrismaLedgerStore {
    // ADR-091 (MUT-148): a minimal error never prints the query input into a log line or an error report.
    return new PrismaLedgerStore(new PrismaClient({ datasources: { db: { url: databaseUrl } }, errorFormat: SENTRY_RULES.serverPrismaErrorFormat }));
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  readonly organizations: OrganizationRepository = {
    create: (input) => translate(() => this.prisma.organization.create({ data: input })),
    getById: (id) => this.prisma.organization.findUnique({ where: { id } }),
    getBySlug: (slug) => this.prisma.organization.findUnique({ where: { slug } }),
    list: () => this.prisma.organization.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    createOwned: (ownerUserId, input, cap, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // MUT-182: the user's row is what two concurrent creates queue on, so the count below can never be raced past the cap.
          // NO KEY UPDATE (qa-reconcile D2): it still queues two creates, but no longer blocks every insert that references the user.
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerUserId}::uuid FOR NO KEY UPDATE`;
          const count = await tx.organization.count({ where: ownedBy(ownerUserId) });
          if (count >= cap) return { kind: 'limit' as const, count };
          const { at, ...fields } = input;
          const organization = await tx.organization.create({ data: { ...fields, ownerUserId, createdAt: at } });
          const membership = toMembership(await tx.membership.create({ data: { userId: ownerUserId, organizationId: organization.id, createdAt: at } }));
          // qa-reconcile D3: committed with the profile, so a failed audit can never leave a profile behind for a retry to duplicate.
          await tx.auditEvent.createMany({ data: auditRows(ownedProfileCreatedAudit(organization, audit), at) });
          return { kind: 'created' as const, organization, membership };
        }),
      ),
    countOwnedBy: (userId) => this.prisma.organization.count({ where: ownedBy(userId) }),
    updateOwned: (id, ownerUserId, expectedVersion, patch, preset, at, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // MUT-182, in order (eng review D3/D4): hold the row, check owner and version, retype (uncategorize, delete,
          // seed), set the fields, bump the version once, audit (qa-reconcile D3). organizations_personal_owned_check
          // refuses a BUSINESS MUT-120 profile.
          await lockOrganization(tx, id);
          // MUT-373: its creator, or a co-owner — whose branch demands an owned BUSINESS profile (outside voice OV2), so an
          // OWNER-role member of an operator firm never matches, and the D1 stamp below only ever runs for the creator.
          const current = await tx.organization.findFirst({ where: { id, OR: [ownedBy(ownerUserId), coOwnedBy(ownerUserId)] } });
          if (!current) return { kind: 'not_found' as const };
          if (current.version !== expectedVersion) return { kind: 'stale' as const, record: current };
          const from = profileTypeOf(current);
          const retype = patch.profileType !== undefined && patch.profileType !== from;
          // MUT-373 (OV3): under the same lock a co-owner grant takes, so a profile can't be retyped PERSONAL while shared.
          if (retype && patch.profileType === 'PERSONAL' && (await tx.membership.count({ where: { organizationId: id, role: 'OWNER' } })) > 1) {
            return { kind: 'co_owned' as const };
          }
          const typeChange = retype ? await replaceCategories(tx, id, preset ?? [], at) : null;
          const data: Prisma.OrganizationUncheckedUpdateInput = { version: { increment: 1 } };
          // qa-reconcile D1: a MUT-120 profile the old revision wrote without an owner gets stamped on its first update.
          if (current.ownerUserId === null) Object.assign(data, { ownerUserId, profileType: from });
          if (patch.name !== undefined) data.name = patch.name;
          if (patch.defaultCurrency !== undefined) data.defaultCurrency = patch.defaultCurrency;
          if (patch.profileType !== undefined) data.profileType = patch.profileType;
          const record = await tx.organization.update({ where: { id }, data });
          const events = ownedProfileUpdatedAudit(id, { from, to: record.profileType }, audit, typeChange && { ...typeChange, seeded: preset?.length ?? 0 });
          await tx.auditEvent.createMany({ data: auditRows(events, at) });
          return { kind: 'updated' as const, record, typeChange: typeChange?.impact ?? null };
        }),
      ),
    typeChangeImpact: (id) => typeChangeImpactOf(this.prisma, id),
    requestFirm: (id, userId, at, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // MUT-300: the row lock queues two requests (and a request against an enable), so only one writes and audits.
          await lockOrganization(tx, id);
          const current = await tx.organization.findUnique({ where: { id } });
          if (!current) return { kind: 'not_found' as const };
          if (current.firmEnabledAt) return { kind: 'already_firm' as const };
          if (current.firmRequestedAt) return { kind: 'requested' as const, organization: current, created: false };
          // No version bump (eng review O3): the owner's open edit form keeps its If-Match.
          const organization = await tx.organization.update({ where: { id }, data: { firmRequestedAt: at, firmRequestedByUserId: userId } });
          await tx.auditEvent.createMany({ data: auditRows([firmAuditRow(id, 'firm.requested', audit)], at) });
          return { kind: 'requested' as const, organization, created: true };
        }),
      ),
    setFirm: (id, input, at, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, id);
          const current = await tx.organization.findUnique({ where: { id } });
          if (!current) return { kind: 'not_found' as const };
          if (firmUnchanged(current, input)) return { kind: 'updated' as const, organization: current, changed: false };
          if (!input.enabled) {
            const organization = await tx.organization.update({ where: { id }, data: { firmEnabledAt: null, version: { increment: 1 } } });
            await tx.auditEvent.createMany({ data: auditRows([firmAuditRow(id, 'firm.disabled', audit)], at) });
            return { kind: 'updated' as const, organization, changed: true };
          }
          const members = await tx.membership.findMany({ where: { organizationId: id }, select: { userId: true, role: true } });
          const refusal = firmEnableRefusal(current, input.ownerUserIds, new Set(members.map((m) => m.userId)));
          if (refusal) return refusal;
          // MUT-373: an owned profile's co-owners stay OWNER.
          const owners = firmOwnersOf(current, input.ownerUserIds, members.filter((m) => m.role === 'OWNER').map((m) => m.userId));
          await tx.membership.updateMany({ where: { organizationId: id, userId: { in: owners } }, data: { role: 'OWNER' } });
          await tx.membership.updateMany({ where: { organizationId: id, userId: { notIn: owners } }, data: { role: 'BOOKKEEPER' } });
          const organization = await tx.organization.update({
            where: { id },
            data: { firmEnabledAt: at, firmRequestedAt: null, firmRequestedByUserId: null, version: { increment: 1 } },
          });
          await tx.auditEvent.createMany({ data: auditRows([firmAuditRow(id, 'firm.enabled', audit, { ownerUserIds: owners })], at) });
          return { kind: 'updated' as const, organization, changed: true };
        }),
      ),
    declineFirmRequest: (id, at, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, id);
          const current = await tx.organization.findUnique({ where: { id } });
          if (!current?.firmRequestedAt) return { kind: 'not_found' as const };
          const organization = await tx.organization.update({ where: { id }, data: { firmRequestedAt: null, firmRequestedByUserId: null } });
          await tx.auditEvent.createMany({ data: auditRows([firmAuditRow(id, 'firm.request_declined', audit)], at) });
          return { kind: 'declined' as const, organization };
        }),
      ),
    listFirmRequests: async (page) => {
      const after = page.cursor
        ? { OR: [{ firmRequestedAt: { gt: page.cursor.createdAt } }, { firmRequestedAt: page.cursor.createdAt, id: { gt: page.cursor.id } }] }
        : {};
      const rows = await this.prisma.organization.findMany({
        where: { firmRequestedAt: { not: null }, firmEnabledAt: null, ...after },
        orderBy: [{ firmRequestedAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last?.firmRequestedAt ? { createdAt: last.firmRequestedAt, id: last.id } : null };
    },
  };

  readonly apiKeys: ApiKeyRepository = {
    create: async (input) => toApiKey(await translate(() => this.prisma.apiKey.create({ data: input }))),
    findByPrefix: async (prefix) => mapNullable(await this.prisma.apiKey.findUnique({ where: { prefix } }), toApiKey),
    getById: async (id) => mapNullable(await this.prisma.apiKey.findUnique({ where: { id } }), toApiKey),
    listByOrganization: async (organizationId) =>
      (await this.prisma.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } })).map(toApiKey),
    touchLastUsed: async (id, at) => {
      await this.prisma.apiKey.updateMany({ where: { id }, data: { lastUsedAt: at } });
    },
    revoke: async (id, reason, at) => {
      // Only the first revocation writes; a repeated revoke is a no-op (idempotent, plan §7.4 spirit).
      await this.prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at, revokedReason: reason } });
      return mapNullable(await this.prisma.apiKey.findUnique({ where: { id } }), toApiKey);
    },
  };

  readonly users: UserRepository = {
    create: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: input.email,
              displayName: input.displayName,
              passwordHash: input.passwordHash,
              locale: input.locale,
              passwordChangedAt: input.at,
              createdAt: input.at,
              updatedAt: input.at,
            },
          });
          const personalOrganization = await tx.organization.create({ data: { ...input.personal, personalOwnerUserId: user.id, ownerUserId: user.id, profileType: 'PERSONAL' } });
          const memberships = [];
          const firm = input.organizationId ? await tx.organization.findUnique({ where: { id: input.organizationId }, select: { firmEnabledAt: true } }) : null;
          for (const organizationId of [personalOrganization.id, ...(input.organizationId ? [input.organizationId] : [])]) {
            const role = roleForNewMembership(organizationId === personalOrganization.id ? personalOrganization : (firm ?? { firmEnabledAt: null }));
            memberships.push(toMembership(await tx.membership.create({ data: { userId: user.id, organizationId, role, createdAt: input.at } })));
          }
          // MUT-235 review fix: the first setup link commits with the user, or neither does.
          if (input.setupLink) {
            await tx.accountSetupToken.create({ data: { userId: user.id, ...input.setupLink, createdAt: input.at } });
          }
          return { user: toUser(user), memberships, personalOrganization };
        }),
      ),
    getById: async (id) => mapNullable(await this.prisma.user.findUnique({ where: { id } }), toUser),
    findByEmail: async (email) => mapNullable(await this.prisma.user.findUnique({ where: { email } }), toUser),
    setPassword: async (id, passwordHash, at) => {
      const { count } = await this.prisma.user.updateMany({
        where: { id },
        data: { passwordHash, passwordChangedAt: at, failedSignIns: 0, lockedUntil: null, updatedAt: at },
      });
      return count === 0 ? null : mapNullable(await this.prisma.user.findUnique({ where: { id } }), toUser);
    },
    setStatus: async (id, status, at) =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({ where: { id }, data: { status, updatedAt: at } });
        if (count === 0) return null;
        // MUT-235 review fix: a disable kills open setup links, so re-enabling never revives one.
        if (status === 'DISABLED') {
          await tx.accountSetupToken.updateMany({ where: { userId: id, usedAt: null, cancelledAt: null }, data: { cancelledAt: at } });
        }
        return mapNullable(await tx.user.findUnique({ where: { id } }), toUser);
      }),
    recordFailedSignIn: async (id, at, lockUntil) => {
      const { count } = await this.prisma.user.updateMany({
        where: { id },
        data: { failedSignIns: { increment: 1 }, updatedAt: at, ...(lockUntil ? { lockedUntil: lockUntil } : {}) },
      });
      return count === 0 ? null : mapNullable(await this.prisma.user.findUnique({ where: { id } }), toUser);
    },
    recordSignIn: async (id, at) => {
      const { count } = await this.prisma.user.updateMany({ where: { id }, data: { lastSignInAt: at, failedSignIns: 0, lockedUntil: null, updatedAt: at } });
      return count === 0 ? null : mapNullable(await this.prisma.user.findUnique({ where: { id } }), toUser);
    },
    // MUT-191: read, union and write under a row lock, so concurrent dismissals from two devices both survive
    updateMalafatSuggestions: async (id, change, at) =>
      this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<Array<{ malafatSuggestions: unknown }>>`SELECT "malafatSuggestions" FROM "users" WHERE "id" = ${id}::uuid FOR UPDATE`;
        if (!locked) return null;
        const next = applyMalafatChange(locked.malafatSuggestions, change);
        return toUser(await tx.user.update({ where: { id }, data: { malafatSuggestions: next as unknown as Prisma.InputJsonValue, updatedAt: at } }));
      }),
    latestTermsAcceptance: async (userId) =>
      mapNullable(await this.prisma.termsAcceptance.findFirst({ where: { userId }, orderBy: { version: 'desc' } }), toTermsAcceptance),
    listLatestTermsVersions: async () =>
      (
        await this.prisma.user.findMany({
          orderBy: { email: 'asc' },
          select: { id: true, email: true, status: true, termsAcceptances: { orderBy: { version: 'desc' }, take: 1, select: { version: true, clientRelease: true } } },
        })
      ).map((u) => ({
        userId: u.id,
        email: u.email,
        status: u.status,
        latestVersion: u.termsAcceptances[0]?.version ?? null,
        latestClientRelease: u.termsAcceptances[0]?.clientRelease ?? null,
      })),
    acceptTerms: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const created = await insertTermsAcceptance(tx, input.userId, input, input.at);
          if (created && input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, input.at) });
          return { created };
        }),
      ),
    // MUT-237: the same NO KEY UPDATE lock accountSetup.redeem takes, so a sign-in racing this call either
    // commits first (then gets revoked below, unless it is the excepted session) or sees the new hash and refuses.
    changePassword: (input) =>
      this.prisma.$transaction(async (tx) => {
        const [person] = await tx.$queryRaw<Array<{ passwordHash: string | null }>>`SELECT "passwordHash" FROM users WHERE id = ${input.userId}::uuid FOR NO KEY UPDATE`;
        if (!person) return null;
        // MUT-238 review: two changes can each verify the old password before either holds this lock. The one that
        // gets it second finds the hash it verified gone and its own session revoked by the first, and writes nothing.
        const kept = await tx.session.findFirst({ where: { id: input.exceptSessionId, userId: input.userId, revokedAt: null }, select: { id: true } });
        if (person.passwordHash !== input.verifiedPasswordHash || !kept) throw new StateConflict('user', 'CREDENTIAL_CHANGED');
        const user = await tx.user.update({
          where: { id: input.userId },
          data: { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at },
        });
        await tx.session.updateMany({
          where: { userId: input.userId, revokedAt: null, id: { not: input.exceptSessionId } },
          data: { revokedAt: input.at, revokedReason: 'password_changed' },
        });
        // The kept session just proved the old password and set the new one: verified as of the change, so the
        // middleware's passwordChangedAt check lets it through. Its deadlines stay where sign-in put them.
        await tx.session.updateMany({
          where: { id: input.exceptSessionId, userId: input.userId, revokedAt: null },
          data: { credentialsVerifiedAt: input.at },
        });
        if (input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, input.at) });
        return toUser(user);
      }),
  };

  readonly sessions: SessionRepository = {
    create: async (input) => {
      const data = {
        userId: input.userId,
        tokenDigest: input.tokenDigest,
        kind: input.kind,
        createdAt: input.at,
        credentialsVerifiedAt: input.at,
        lastSeenAt: input.at,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        userAgent: input.userAgent,
      };
      const { verifiedPasswordHash } = input;
      if (verifiedPasswordHash === undefined) return toSession(await translate(() => this.prisma.session.create({ data })));
      // MUT-235 review: FOR SHARE conflicts with the FOR NO KEY UPDATE that a setup-link lock or redeem holds until it
      // commits, so this waits for either and then sees its result. A credential that changed since sign-in verified it,
      // or a person no longer ACTIVE, gets no session.
      return translate(() =>
        this.prisma.$transaction(async (tx) => {
          const [owner] = await tx.$queryRaw<Array<{ passwordHash: string | null; status: string }>>`SELECT "passwordHash", status FROM users WHERE id = ${input.userId}::uuid FOR SHARE`;
          if (!owner) throw new ForeignKeyViolation('sessions.userId');
          if (owner.passwordHash !== verifiedPasswordHash || owner.status !== 'ACTIVE') throw new StateConflict('user', 'CREDENTIAL_CHANGED');
          return toSession(await tx.session.create({ data }));
        }),
      );
    },
    findByDigest: async (tokenDigest) => mapNullable(await this.prisma.session.findUnique({ where: { tokenDigest } }), toSession),
    touch: async (id, at, idleExpiresAt) => {
      await this.prisma.session.updateMany({ where: { id }, data: { lastSeenAt: at, idleExpiresAt } });
    },
    revoke: async (id, reason, at) => {
      await this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at, revokedReason: reason } });
      return mapNullable(await this.prisma.session.findUnique({ where: { id } }), toSession);
    },
    revokeAllForUser: async (userId, reason, at) =>
      (await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at, revokedReason: reason } })).count,
  };

  /**
   * MUT-235 (ADR-088). Both writes take the person's row lock first, so issues and redeems for one person
   * run one at a time: at most one open link, and of two redeems of one link exactly one claims it.
   * NO KEY UPDATE, like MUT-182's owner lock, so the lock never blocks an insert that references the user.
   */
  readonly accountSetup: AccountSetupRepository = {
    issue: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const [person] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM users WHERE id = ${input.userId}::uuid FOR NO KEY UPDATE`;
          if (!person) throw new ForeignKeyViolation('account_setup_tokens.userId');
          // Re-checked under the lock, not only in the route, so a disable that lands first can never be followed by a fresh link.
          if (person.status !== 'ACTIVE') throw new StateConflict('user', 'USER_DISABLED');
          if (input.lock) {
            // Stamping passwordChangedAt makes the session check refuse a session a racing sign-in inserts after the lock.
            await tx.user.update({ where: { id: input.userId }, data: { passwordHash: null, passwordChangedAt: input.at, updatedAt: input.at } });
            await tx.session.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: input.at, revokedReason: 'setup_link_lock' } });
          }
          await tx.accountSetupToken.updateMany({ where: { userId: input.userId, usedAt: null, cancelledAt: null }, data: { cancelledAt: input.at } });
          const row = await tx.accountSetupToken.create({
            data: { userId: input.userId, tokenDigest: input.tokenDigest, purpose: input.purpose, createdAt: input.at, expiresAt: input.expiresAt },
          });
          if (input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, input.at) });
          return toSetupLink(row);
        }),
      ),
    findByDigest: async (tokenDigest) => mapNullable(await this.prisma.accountSetupToken.findUnique({ where: { tokenDigest } }), toSetupLink),
    redeem: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const link = await tx.accountSetupToken.findUnique({ where: { tokenDigest: input.tokenDigest } });
          if (!link) return null;
          const [person] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM users WHERE id = ${link.userId}::uuid FOR NO KEY UPDATE`;
          if (person?.status !== 'ACTIVE') return null;
          const { count } = await tx.accountSetupToken.updateMany({
            where: { id: link.id, usedAt: null, cancelledAt: null, expiresAt: { gt: input.at } },
            data: { usedAt: input.at },
          });
          if (count === 0) return null;
          const user = await tx.user.update({
            where: { id: link.userId },
            data: { passwordHash: input.passwordHash, passwordChangedAt: input.at, failedSignIns: 0, lockedUntil: null, updatedAt: input.at },
          });
          await tx.session.updateMany({ where: { userId: link.userId, revokedAt: null }, data: { revokedAt: input.at, revokedReason: 'password_set' } });
          if (input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, input.at) });
          // MUT-324: an operator reset after acceptance must still set the password, so an existing acceptance is kept.
          const accepted = await insertTermsAcceptance(tx, link.userId, input.terms, input.at);
          if (accepted && input.termsAudit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.termsAudit, input.at) });
          return toUser(user);
        }),
      ),
  };

  readonly memberships: MembershipRepository = {
    grant: async (userId, organizationId, at) => {
      const where = { userId_organizationId: { userId, organizationId } };
      const existing = await this.prisma.membership.findUnique({ where });
      if (existing) return { membership: toMembership(existing), created: false };
      try {
        // MUT-300 (D3): BOOKKEEPER into a firm. An unknown organization falls through to the insert's ForeignKeyViolation.
        const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { firmEnabledAt: true } });
        const role = roleForNewMembership(organization ?? { firmEnabledAt: null });
        const membership = await translate(() => this.prisma.membership.create({ data: { userId, organizationId, role, createdAt: at } }));
        return { membership: toMembership(membership), created: true };
      } catch (err) {
        // Two concurrent grants: the loser reads the winner's row.
        if (!(err instanceof UniqueViolation)) throw err;
        const winner = await this.prisma.membership.findUniqueOrThrow({ where });
        return { membership: toMembership(winner), created: false };
      }
    },
    revoke: async (userId, organizationId) =>
      (await this.prisma.membership.deleteMany({ where: { userId, organizationId } })).count > 0,
    grantOwner: (userId, organizationId, at, maxOwners, audit) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // MUT-373: the row lock queues two grants (and a retype, OV3), so the owner count below can't be raced past.
          await lockOrganization(tx, organizationId);
          const organization = await tx.organization.findUnique({ where: { id: organizationId } });
          if (!organization) return { kind: 'not_found' as const };
          const members = await tx.membership.findMany({ where: { organizationId }, select: { userId: true, role: true } });
          const existing = members.find((m) => m.userId === userId) ?? null;
          const refusal = grantOwnerRefusal(organization, existing?.role ?? null, ownerIdsOf(organization, members).length, maxOwners);
          if (refusal) return refusal;
          if (existing) {
            const granted = await tx.auditEvent.findFirst({
              where: { organizationId, entityType: 'user', entityId: userId, action: 'membership.granted', metadata: { path: ['role'], equals: 'OWNER' } },
              select: { id: true },
            });
            if (!granted) await tx.auditEvent.createMany({ data: auditRows([audit], at) });
            const row = await tx.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId, organizationId } } });
            return { kind: 'granted' as const, membership: toMembership(row), created: false };
          }
          const membership = await tx.membership.create({ data: { userId, organizationId, role: 'OWNER', createdAt: at } });
          await tx.auditEvent.createMany({ data: auditRows([audit], at) });
          return { kind: 'granted' as const, membership: toMembership(membership), created: true };
        }),
      ),
    removeOwner: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          await lockOrganization(tx, input.organizationId);
          const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
          if (!organization) return { kind: 'not_found' as const };
          const roleOf = async (userId: string) =>
            (await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: input.organizationId } }, select: { role: true } }))?.role ?? null;
          const decision = removeOwnerDecision(organization, input, await roleOf(input.actorId), await roleOf(input.userId));
          if (decision.kind !== 'removed') return decision;
          await tx.membership.deleteMany({ where: { userId: input.userId, organizationId: input.organizationId } });
          await tx.auditEvent.createMany({ data: auditRows([ownerRemovedAudit(input, decision.reason)], input.at) });
          return decision;
        }),
      ),
    listOwnersOf: async (organizationIds) => {
      if (organizationIds.length === 0) return [];
      const rows = await this.prisma.membership.findMany({
        where: { organizationId: { in: [...organizationIds] }, role: 'OWNER' },
        select: { organizationId: true, userId: true, createdAt: true, user: { select: { displayName: true, email: true } } },
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      });
      return rows.map((r) => ({ organizationId: r.organizationId, userId: r.userId, displayName: r.user.displayName, email: r.user.email, createdAt: r.createdAt }));
    },
    find: async (userId, organizationId) =>
      mapNullable(await this.prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } }), toMembership),
    listByUser: async (userId) =>
      (await this.prisma.membership.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { organizationId: 'asc' }] })).map(toMembership),
    listByOrganization: async (organizationId) =>
      (await this.prisma.membership.findMany({ where: { organizationId }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] })).map(toMembership),
  };

  readonly integrations: IntegrationRepository = {
    findByOrganizationAndProvider: (organizationId, provider) =>
      this.prisma.integration.findUnique({ where: { organizationId_provider: { organizationId, provider } } }),
    findByProviderAndTenant: (provider, externalTenantId) =>
      this.prisma.integration.findUnique({ where: { provider_externalTenantId: { provider, externalTenantId } } }),
    listByOrganization: (organizationId) => this.prisma.integration.findMany({ where: { organizationId } }),
    connect: (input) =>
      translate(() =>
        this.prisma.integration.upsert({
          where: { organizationId_provider: { organizationId: input.organizationId, provider: input.provider } },
          create: {
            organizationId: input.organizationId,
            provider: input.provider,
            externalTenantId: input.externalTenantId,
            displayName: input.displayName,
            status: 'CONNECTED',
            connectedByApiKeyId: input.connectedByApiKeyId,
            connectedAt: input.at,
          },
          update: {
            externalTenantId: input.externalTenantId,
            displayName: input.displayName,
            status: 'CONNECTED',
            connectedByApiKeyId: input.connectedByApiKeyId,
            connectedAt: input.at,
            disconnectedAt: null,
          },
        }),
      ),
    disconnect: async (id, at) => {
      await this.prisma.integration.updateMany({ where: { id }, data: { status: 'DISCONNECTED', disconnectedAt: at } });
      return this.prisma.integration.findUnique({ where: { id } });
    },
  };

  readonly audit: AuditRepository = {
    append: async (event) => {
      const row = await this.prisma.auditEvent.create({
        data: {
          organizationId: event.organizationId,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          metadata: event.metadata === undefined ? Prisma.JsonNull : (event.metadata as Prisma.InputJsonValue),
          requestId: event.requestId,
        },
      });
      return { ...event, id: row.id, createdAt: row.createdAt };
    },
    listByOrganization: async (organizationId, limit) =>
      (
        await this.prisma.auditEvent.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: limit })
      ).map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        ...(r.metadata && typeof r.metadata === 'object' ? { metadata: r.metadata as JsonObject } : {}),
        requestId: r.requestId,
        createdAt: r.createdAt,
      })),
    list: async (organizationId, filter: AuditFilter, page) => {
      const rows = await this.prisma.auditEvent.findMany({
        where: { organizationId, ...entityTypeWhere(filter), ...(filter.entityId ? { entityId: filter.entityId } : {}), ...actionWhere(filter), ...cursorWhere(page) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows.map(toAuditEvent), page);
    },
  };

  readonly attachments: AttachmentRepository = {
    create: async (input: Omit<CreateAttachmentInput, 'storageKey'>, at) => this.prisma.attachment.create({ data: { ...input, storageKey: '', status: 'PENDING_UPLOAD', createdAt: at } }),
    setKey: async (organizationId, id, storageKey) => {
      const { count } = await this.prisma.attachment.updateMany({ where: { id, organizationId }, data: { storageKey } });
      return count === 1 ? this.prisma.attachment.findUnique({ where: { id } }) : null;
    },
    getById: (organizationId, id) => this.prisma.attachment.findFirst({ where: { id, organizationId, deletedAt: null } }),
    list: async (organizationId, filter: AttachmentFilter, page) => {
      const rows = await this.prisma.attachment.findMany({
        where: {
          organizationId,
          status: 'READY',
          deletedAt: null,
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.paymentId ? { paymentId: filter.paymentId } : {}),
          ...(filter.kind ? { kind: filter.kind } : {}),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    complete: async (organizationId, id, at) => {
      await this.prisma.attachment.updateMany({ where: { id, organizationId, deletedAt: null, status: 'PENDING_UPLOAD' }, data: { status: 'READY', completedAt: at } });
      return this.prisma.attachment.findFirst({ where: { id, organizationId, deletedAt: null } });
    },
    softDelete: async (organizationId, id, at) => {
      await this.prisma.attachment.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      return this.prisma.attachment.findFirst({ where: { id, organizationId } });
    },
  };

  readonly idempotency: IdempotencyRepository = {
    claim: async ({ organizationId, key, operation, fingerprint, at }): Promise<IdempotencyClaim> => {
      try {
        await this.prisma.idempotencyKey.create({
          data: { organizationId, key, operation, fingerprint, status: 'PENDING', createdAt: at },
        });
        return { kind: 'new' };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId, key } } });
      if (!existing) return { kind: 'in_progress' }; // deleted between insert and read: treat as racing
      const outcome = resolveClaim(existing, operation, fingerprint);
      if (outcome === 'replay') {
        return {
          kind: 'replay',
          record: {
            organizationId: existing.organizationId,
            key: existing.key,
            operation: existing.operation,
            fingerprint: existing.fingerprint,
            status: existing.status,
            responseStatus: existing.responseStatus,
            responseBody: existing.responseBody,
            createdAt: existing.createdAt,
            completedAt: existing.completedAt,
          },
        };
      }
      return { kind: outcome }; // 'new' is unreachable: `existing` is non-null here, and resolveClaim only returns 'new' when it isn't
    },
    complete: async ({ organizationId, key, responseStatus, responseBody, at }) => {
      await this.prisma.idempotencyKey.updateMany({
        where: { organizationId, key },
        data: { status: 'COMPLETED', responseStatus, responseBody: responseBody as Prisma.InputJsonValue, completedAt: at },
      });
    },
    fail: async ({ organizationId, key }) => {
      await this.prisma.idempotencyKey.deleteMany({ where: { organizationId, key } });
    },
    get: async (organizationId, key) => {
      const r = await this.prisma.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId, key } } });
      if (!r) return null;
      return { organizationId: r.organizationId, key: r.key, operation: r.operation, fingerprint: r.fingerprint, status: r.status, responseStatus: r.responseStatus, responseBody: r.responseBody, createdAt: r.createdAt, completedAt: r.completedAt };
    },
  };

  /** MUT-131: same contract as `idempotency`, keyed by user instead of organization. */
  readonly userIdempotency: UserIdempotencyRepository = {
    claim: async ({ userId, key, operation, fingerprint, at }): Promise<UserIdempotencyClaim> => {
      try {
        await this.prisma.userIdempotencyKey.create({
          data: { userId, key, operation, fingerprint, status: 'PENDING', createdAt: at },
        });
        return { kind: 'new' };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      const existing = await this.prisma.userIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!existing) return { kind: 'in_progress' }; // deleted between insert and read: treat as racing
      const outcome = resolveClaim(existing, operation, fingerprint);
      if (outcome === 'replay') {
        return {
          kind: 'replay',
          record: {
            userId: existing.userId,
            key: existing.key,
            operation: existing.operation,
            fingerprint: existing.fingerprint,
            status: existing.status,
            responseStatus: existing.responseStatus,
            responseBody: existing.responseBody,
            createdAt: existing.createdAt,
            completedAt: existing.completedAt,
          },
        };
      }
      return { kind: outcome }; // 'new' is unreachable: `existing` is non-null here, and resolveClaim only returns 'new' when it isn't
    },
    complete: async ({ userId, key, responseStatus, responseBody, at }) => {
      await this.prisma.userIdempotencyKey.updateMany({
        where: { userId, key },
        data: { status: 'COMPLETED', responseStatus, responseBody: responseBody as Prisma.InputJsonValue, completedAt: at },
      });
    },
    fail: async ({ userId, key }) => {
      await this.prisma.userIdempotencyKey.deleteMany({ where: { userId, key } });
    },
    get: async (userId, key) => {
      const r = await this.prisma.userIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
      if (!r) return null;
      return { userId: r.userId, key: r.key, operation: r.operation, fingerprint: r.fingerprint, status: r.status, responseStatus: r.responseStatus, responseBody: r.responseBody, createdAt: r.createdAt, completedAt: r.completedAt };
    },
  };

  readonly externalReferences: ExternalReferenceRepository = {
    link: (input, at) => translate(() => this.prisma.externalReference.create({ data: { ...input, createdAt: at } })),
    findByExternalId: (organizationId, provider, entityType, externalId) =>
      this.prisma.externalReference.findUnique({
        where: { organizationId_provider_entityType_externalId: { organizationId, provider, entityType, externalId } },
      }),
    findByExternalIds: (organizationId, provider, entityType, externalIds) =>
      this.prisma.externalReference.findMany({ where: { organizationId, provider, entityType, externalId: { in: externalIds } } }),
    findByEntities: (organizationId, entityType, entityIds) =>
      this.prisma.externalReference.findMany({ where: { organizationId, entityType, entityId: { in: entityIds } } }),
  };

  readonly customers: CustomerRepository = {
    create: (input, at, reference) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const row = await tx.customer.create({ data: { ...input, createdAt: at, updatedAt: at } });
          if (reference) {
            await tx.externalReference.create({
              data: { organizationId: input.organizationId, entityType: 'CUSTOMER', entityId: row.id, ...reference, createdAt: at },
            });
          }
          return row;
        }),
      ),
    getById: (organizationId, id) => this.prisma.customer.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter, page) => {
      const ids = await this.entityIdsForExternal(organizationId, 'CUSTOMER', filter);
      if (ids !== null && ids.length === 0) return { items: [], nextCursor: null };
      const rows = await this.prisma.customer.findMany({
        where: {
          organizationId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(ids ? { id: { in: ids } } : {}),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    update: async (organizationId, id, expectedVersion, patch, at): Promise<UpdateResult<CustomerRecord>> => {
      const data: Prisma.CustomerUpdateManyMutationInput = { version: { increment: 1 }, updatedAt: at };
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.email !== undefined) data.email = patch.email;
      if (patch.phone !== undefined) data.phone = patch.phone;
      if (patch.notes !== undefined) data.notes = patch.notes;
      if (patch.vatTreatment !== undefined) data.vatTreatment = patch.vatTreatment;
      const { count } = await this.prisma.customer.updateMany({ where: { id, organizationId, version: expectedVersion }, data });
      const record = await this.prisma.customer.findFirst({ where: { id, organizationId } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    archive: async (organizationId, id, at) => {
      await this.prisma.customer.updateMany({
        where: { id, organizationId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED', archivedAt: at, version: { increment: 1 }, updatedAt: at },
      });
      return this.prisma.customer.findFirst({ where: { id, organizationId } });
    },
  };

  readonly projects: ProjectRepository = {
    create: (input, at, reference) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { id: true } });
          if (!customer) throw new ForeignKeyViolation('projects.customerId');
          const row = await tx.project.create({ data: { ...input, createdAt: at, updatedAt: at } });
          if (reference) {
            await tx.externalReference.create({
              data: { organizationId: input.organizationId, entityType: 'PROJECT', entityId: row.id, ...reference, createdAt: at },
            });
          }
          return row;
        }),
      ),
    getById: (organizationId, id) => this.prisma.project.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter, page) => {
      const ids = await this.entityIdsForExternal(organizationId, 'PROJECT', filter);
      if (ids !== null && ids.length === 0) return { items: [], nextCursor: null };
      const rows = await this.prisma.project.findMany({
        where: {
          organizationId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.currency ? { currency: filter.currency } : {}),
          ...(ids ? { id: { in: ids } } : {}),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    update: async (organizationId, id, expectedVersion, patch, at): Promise<UpdateResult<ProjectRecord>> => {
      const data: Prisma.ProjectUpdateManyMutationInput = { version: { increment: 1 }, updatedAt: at };
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.currency !== undefined) data.currency = patch.currency;
      if (patch.vatTreatment !== undefined) data.vatTreatment = patch.vatTreatment;
      const { count } = await this.prisma.project.updateMany({ where: { id, organizationId, version: expectedVersion }, data });
      const record = await this.prisma.project.findFirst({ where: { id, organizationId } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    archive: async (organizationId, id, at) => {
      await this.prisma.project.updateMany({
        where: { id, organizationId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED', archivedAt: at, version: { increment: 1 }, updatedAt: at },
      });
      return this.prisma.project.findFirst({ where: { id, organizationId } });
    },
    countActiveByCustomer: (organizationId, customerId) => this.prisma.project.count({ where: { organizationId, customerId, status: 'ACTIVE' } }),
    hasPostedActivity: async (organizationId, id) => (await this.prisma.agreement.count({ where: { organizationId, projectId: id } })) > 0,
  };

  readonly feeProposals: FeeProposalRepository = {
    create: (input, at) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // The project row lock serialises "one open proposal per project" (M7 brief §4).
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "projects" WHERE "id" = ${input.projectId}::uuid AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE`;
          if (locked.length === 0) throw new ForeignKeyViolation('fee_proposals.projectId');
          const open = await tx.feeProposal.findFirst({ where: { organizationId: input.organizationId, projectId: input.projectId, status: { in: [...OPEN_PROPOSAL_STATUSES] } }, select: { id: true } });
          if (open) throw new UniqueViolation('fee_proposals.open_per_project');
          return tx.feeProposal.create({ data: { ...input, createdAt: at, updatedAt: at } });
        }),
      ),
    getById: (organizationId, id) => this.prisma.feeProposal.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter, page) => {
      const rows = await this.prisma.feeProposal.findMany({
        where: {
          organizationId,
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.open === undefined ? {} : filter.open ? { status: { in: [...OPEN_PROPOSAL_STATUSES] } } : { status: { notIn: [...OPEN_PROPOSAL_STATUSES] } }),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    findOpenByProject: (organizationId, projectId) => this.prisma.feeProposal.findFirst({ where: { organizationId, projectId, status: { in: [...OPEN_PROPOSAL_STATUSES] } } }),
    transition: async (organizationId, id, from, patch, at): Promise<TransitionResult<FeeProposalRecord>> => {
      const { status, ...rest } = patch;
      const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Prisma.FeeProposalUpdateManyMutationInput;
      const { count } = await this.prisma.feeProposal.updateMany({ where: { id, organizationId, status: { in: [...from] } }, data: { ...defined, status, version: { increment: 1 }, updatedAt: at } });
      const record = await this.prisma.feeProposal.findFirst({ where: { id, organizationId } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'wrong_status', record };
    },
  };

  readonly vatRates: VatRateRepository = {
    upsert: async (organizationId, rateBasisPoints, effectiveFrom, at) => {
      try {
        const record = await this.prisma.vatRate.create({ data: { organizationId, rateBasisPoints, effectiveFrom, createdAt: at } });
        return { outcome: 'created', record };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      const existing = await this.prisma.vatRate.findUnique({ where: { organizationId_effectiveFrom: { organizationId, effectiveFrom } } });
      if (!existing) throw new Error('vat rate vanished between insert and read');
      return existing.rateBasisPoints === rateBasisPoints ? { outcome: 'unchanged', record: existing } : { outcome: 'conflict', record: existing };
    },
    list: (organizationId) => this.prisma.vatRate.findMany({ where: { organizationId }, orderBy: { effectiveFrom: 'desc' } }),
    effectiveOn: (organizationId, date) =>
      this.prisma.vatRate.findFirst({ where: { organizationId, effectiveFrom: { lte: date } }, orderBy: { effectiveFrom: 'desc' } }),
  };

  readonly agreements: AgreementRepository = {
    create: (input, at) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const project = await tx.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true } });
          if (!project) throw new ForeignKeyViolation('agreements.projectId');
          const { installments, approveProposal, ...rest } = input;
          const agreement = await tx.agreement.create({ data: { ...rest, createdAt: at, updatedAt: at } });
          if (approveProposal) {
            // M8: approve in the same transaction; a proposal that moved since the route checked it refuses the create.
            const { count } = await tx.feeProposal.updateMany({
              where: { id: approveProposal.id, organizationId: input.organizationId, projectId: input.projectId, status: 'PROPOSED' },
              data: { status: 'APPROVED', agreedAmountMinor: approveProposal.agreedAmountMinor, clientApprovedOn: approveProposal.approvedOn, clientApprovalNote: approveProposal.note, agreementId: agreement.id, version: { increment: 1 }, updatedAt: at },
            });
            if (count !== 1) throw new StateConflict('fee_proposal', 'PROPOSAL_NOT_OPEN');
          }
          const created: InstallmentRecord[] = [];
          for (const spec of installments) {
            created.push(await tx.installment.create({ data: { ...spec, organizationId: input.organizationId, agreementId: agreement.id } }));
          }
          return { agreement, installments: created };
        }),
      ),
    getById: (organizationId, id) => this.prisma.agreement.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter: AgreementFilter, page) => {
      const rows = await this.prisma.agreement.findMany({
        where: {
          organizationId,
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.type ? { type: filter.type } : {}),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    listInstallments: (organizationId, agreementId) => this.prisma.installment.findMany({ where: { organizationId, agreementId }, orderBy: { position: 'asc' } }),
    getInstallment: (organizationId, id) => this.prisma.installment.findFirst({ where: { id, organizationId } }),
    postInstallment: async (organizationId, installmentId, input) => {
      const current = await this.prisma.installment.findFirst({ where: { id: installmentId, organizationId } });
      if (!current) return null;
      if (current.receivableId) {
        const receivable = await this.prisma.receivable.findUnique({ where: { id: current.receivableId } });
        return receivable ? { installment: current, receivable, created: false } : null;
      }
      if (current.voidedAt) return null;
      const agreement = await this.prisma.agreement.findFirst({ where: { id: current.agreementId, organizationId } });
      if (!agreement) return null;
      try {
        return await this.prisma.$transaction(async (tx) => {
          const receivable = await tx.receivable.create({
            data: {
              organizationId,
              customerId: agreement.customerId,
              projectId: agreement.projectId,
              agreementId: agreement.id,
              origin: 'INSTALLMENT',
              originId: current.id,
              currency: agreement.currency,
              netMinor: current.netMinor,
              vatMinor: current.vatMinor,
              grossMinor: current.grossMinor,
              vatTreatment: current.vatTreatment,
              vatRateBasisPoints: current.rateBasisPoints,
              dueDate: input.dueDate,
              postingDate: input.postingDate,
              postedAt: input.at,
              createdAt: input.at,
            },
          });
          // Only the first poster wins, and never on a voided line (a correction or cancel voiding it concurrently).
          const { count } = await tx.installment.updateMany({
            where: { id: current.id, receivableId: null, voidedAt: null },
            data: { receivableId: receivable.id, postedAt: input.at, postingDate: input.postingDate, version: { increment: 1 } },
          });
          if (count !== 1) throw new AlreadyPosted();
          const installment = await tx.installment.findUniqueOrThrow({ where: { id: current.id } });
          return { installment, receivable, created: true };
        });
      } catch (err) {
        if (!(err instanceof AlreadyPosted)) throw err;
        const installment = await this.prisma.installment.findFirstOrThrow({ where: { id: installmentId } });
        if (!installment.receivableId) return null; // voided under us: nothing posts.
        const receivable = await this.prisma.receivable.findUniqueOrThrow({ where: { id: installment.receivableId ?? '' } });
        return { installment, receivable, created: false };
      }
    },
    listUnpostedDue: (organizationId, today) =>
      this.prisma.installment.findMany({
        where: { organizationId, receivableId: null, voidedAt: null, agreement: { status: 'ACTIVE' }, OR: [{ triggerType: 'DATE', triggerDate: { lte: today } }, { triggerType: 'IMMEDIATE' }] },
      }),
    applySupplement: async (organizationId, agreementId, input: ApplySupplementInput, at) =>
      this.prisma.$transaction(async (tx) => {
        const current = await tx.agreement.findFirst({ where: { id: agreementId, organizationId } });
        if (!current) return { kind: 'not_found' as const };
        const { count } = await tx.agreement.updateMany({
          where: { id: agreementId, version: input.expectedVersion },
          data: { ...input.totals, version: { increment: 1 }, updatedAt: at },
        });
        if (count !== 1) return { kind: 'stale' as const, record: { agreement: current, supplement: null as unknown as SupplementRecord, installments: [] } };
        for (const u of input.installmentUpdates) {
          await tx.installment.update({ where: { id: u.id }, data: { amountMinor: u.amountMinor, netMinor: u.netMinor, vatMinor: u.vatMinor, grossMinor: u.grossMinor, version: { increment: 1 } } });
        }
        for (const spec of input.newInstallments) {
          await tx.installment.create({ data: { ...spec, organizationId, agreementId } });
        }
        const supplement = await tx.agreementSupplement.create({ data: { organizationId, agreementId, ...input.supplement, resultingAmountMinor: input.totals.amountMinor, createdAt: at } });
        const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
        const installments = await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } });
        return { kind: 'updated' as const, record: { agreement, supplement, installments } };
      }),
    listSupplements: (organizationId, agreementId) => this.prisma.agreementSupplement.findMany({ where: { organizationId, agreementId }, orderBy: { createdAt: 'asc' } }),
    appendVersion: async (input: AppendVersionInput, at) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const current = await tx.agreement.findFirst({ where: { id: input.agreementId, organizationId: input.organizationId } });
          if (!current) return { kind: 'not_found' as const };
          const { count } = await tx.agreement.updateMany({ where: { id: input.agreementId, version: input.expectedAgreementVersion }, data: { version: { increment: 1 }, updatedAt: at } });
          if (count !== 1) return { kind: 'stale' as const, record: { agreement: current, version: null as unknown as RetainerVersionRecord } };
          const { expectedAgreementVersion, ...rest } = input;
          void expectedAgreementVersion;
          const version = await tx.retainerVersion.create({ data: { ...rest, createdAt: at } });
          const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: input.agreementId } });
          return { kind: 'updated' as const, record: { agreement, version } };
        }),
      ),
    listVersions: (organizationId, agreementId) => this.prisma.retainerVersion.findMany({ where: { organizationId, agreementId }, orderBy: { version: 'asc' } }),
    updateContingencyTerms: async (organizationId, agreementId, expectedVersion, patch, at) => {
      const current = await this.prisma.agreement.findFirst({ where: { id: agreementId, organizationId } });
      if (!current) return { kind: 'not_found' as const };
      const { count } = await this.prisma.agreement.updateMany({
        where: { id: agreementId, organizationId, version: expectedVersion, outcome: null },
        data: {
          ...(patch.commissionRateBasisPoints !== undefined ? { commissionRateBasisPoints: patch.commissionRateBasisPoints } : {}),
          ...(patch.upfrontTreatment !== undefined ? { upfrontTreatment: patch.upfrontTreatment } : {}),
          version: { increment: 1 },
          updatedAt: at,
        },
      });
      const record = await this.prisma.agreement.findUniqueOrThrow({ where: { id: agreementId } });
      return count === 1 ? { kind: 'updated' as const, record } : { kind: 'stale' as const, record };
    },
    recordOutcome: (organizationId, agreementId, input: OutcomeWriteInput, at) =>
      this.asStaleOnLockConflict(organizationId, agreementId, () =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // Agreement row first, then receivables: the same lock order as correctOutcome.
          const lockedAgreement = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "agreements" WHERE "id" = ${agreementId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
          if (lockedAgreement.length === 0) return { kind: 'not_found' as const };
          const current = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
          if (await upfrontMoved(tx, organizationId, input.upfrontReceivables)) return { kind: 'stale' as const, record: { agreement: current, installments: await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }) } };
          // The conditional write is the guard: a second record, or one racing a terms change, matches no row.
          const { count } = await tx.agreement.updateMany({ where: { id: agreementId, organizationId, version: input.expectedVersion, outcome: null }, data: outcomeData(input, at) });
          if (count !== 1) return { kind: 'stale' as const, record: { agreement: current, installments: await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }) } };
          if (input.commissionInstallment) await tx.installment.create({ data: { ...input.commissionInstallment, isCommission: true, organizationId, agreementId } });
          const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
          return { kind: 'updated' as const, record: { agreement, installments: await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }) } };
        }),
      )),
    correctOutcome: (organizationId, agreementId, input: CorrectOutcomeInput, at) =>
      this.asStaleOnLockConflict(organizationId, agreementId, () =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          // The agreement row lock serializes corrections (and a record) against each other: a loser waits, then
          // reads the winner's version and is stale, never half-way through someone else's credit.
          const lockedAgreement = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "agreements" WHERE "id" = ${agreementId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
          if (lockedAgreement.length === 0) return { kind: 'not_found' as const };
          const current = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
          const stale = async () => ({ kind: 'stale' as const, record: { agreement: current, installments: await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }), credit: null } });
          if (current.version !== input.expectedVersion || current.outcome === null) return stale();
          const replaced = input.replaceInstallmentId ? await tx.installment.findFirst({ where: { id: input.replaceInstallmentId, organizationId, agreementId, isCommission: true, voidedAt: null } }) : null;
          // Gone, or posted since the bill was composed (its preview promised no credit): stale either way.
          if (input.replaceInstallmentId && (!replaced || replaced.receivableId !== input.replaceReceivableId)) return stale();
          if (await upfrontMoved(tx, organizationId, input.upfrontReceivables)) return stale();
          // Under the receivable's row lock, before anything is written: a payment or credit that landed after the
          // preview refuses the whole correction (an allocation waits on this lock until we commit or roll back).
          const locked = replaced?.receivableId ? await lockReceivable(tx, replaced.receivableId) : null;
          if (locked && (locked.paidMinor > 0n || locked.creditedMinor > 0n)) return { kind: 'has_payments' as const, receivableId: locked.id };
          // First write, and conditional: a lazy read that posted the old line since we read it matches no row.
          if (replaced) {
            const voided = await tx.installment.updateMany({ where: { id: replaced.id, receivableId: replaced.receivableId, voidedAt: null }, data: { voidedAt: at } });
            if (voided.count !== 1) return stale();
          }
          // Cannot miss under the agreement lock; kept conditional so the invariant stays local.
          const { count } = await tx.agreement.updateMany({ where: { id: agreementId, organizationId, version: input.expectedVersion, outcome: { not: null } }, data: outcomeData(input, at) });
          if (count !== 1) throw new Error('correctOutcome: agreement moved under its row lock');
          let credit: CreditRecord | null = null;
          if (locked) {
            const r = await tx.receivable.findUniqueOrThrow({ where: { id: locked.id } });
            credit = await tx.receivableCredit.create({ data: { organizationId, receivableId: r.id, amountMinor: r.grossMinor, netMinor: r.netMinor, vatMinor: r.vatMinor, ...input.credit, createdAt: at } });
            await settleReceivable(tx, r.id, { creditedMinor: { increment: r.grossMinor } });
          }
          if (input.commissionInstallment) await tx.installment.create({ data: { ...input.commissionInstallment, isCommission: true, organizationId, agreementId } });
          const agreement = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
          return { kind: 'updated' as const, record: { agreement, installments: await tx.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }), credit } };
        }),
      )),
    cancel: async (organizationId, agreementId, input, at) => {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.agreement.updateMany({
          // outcome: null — a contingency agreement whose outcome is recorded is never cancelled, even by a cancel racing the record.
          where: { id: agreementId, organizationId, status: 'ACTIVE', outcome: null },
          data: { status: 'CANCELLED', cancelledAt: at, cancelEffectiveMonth: input.cancelEffectiveMonth, cancelEffectiveDate: input.cancelEffectiveDate ?? null, finalMonth: input.finalMonth, version: { increment: 1 }, updatedAt: at },
        });
        if (count === 1) await tx.installment.updateMany({ where: { agreementId, receivableId: null, voidedAt: null }, data: { voidedAt: at } });
      });
      return this.prisma.agreement.findFirst({ where: { id: agreementId, organizationId } });
    },
    listRetainers: (organizationId) =>
      this.prisma.agreement.findMany({ where: { organizationId, type: 'RECURRING', OR: [{ status: 'ACTIVE' }, { cancelEffectiveMonth: { not: null } }] } }),
    listCharges: (organizationId, agreementId) => this.prisma.retainerCharge.findMany({ where: { organizationId, agreementId }, orderBy: { serviceMonth: 'asc' } }),
    createPostedCharge: async (input, at) => {
      const existing = await this.prisma.retainerCharge.findUnique({ where: { agreementId_serviceMonth: { agreementId: input.agreementId, serviceMonth: input.serviceMonth } } });
      if (existing) return { charge: existing, receivable: await this.prisma.receivable.findUniqueOrThrow({ where: { id: existing.receivableId } }), created: false };
      try {
        return await this.prisma.$transaction(async (tx) => {
          const receivable = await tx.receivable.create({
            data: {
              organizationId: input.organizationId,
              customerId: input.customerId,
              projectId: input.projectId,
              agreementId: input.agreementId,
              origin: 'RETAINER_CHARGE',
              currency: input.currency,
              netMinor: input.netMinor,
              vatMinor: input.vatMinor,
              grossMinor: input.grossMinor,
              vatTreatment: input.vatTreatment,
              vatRateBasisPoints: input.rateBasisPoints,
              dueDate: input.dueDate,
              postingDate: input.chargeDate,
              postedAt: at,
              createdAt: at,
            },
          });
          const charge = await tx.retainerCharge.create({
            data: {
              organizationId: input.organizationId,
              agreementId: input.agreementId,
              version: input.version ?? 1,
              serviceMonth: input.serviceMonth,
              chargeDate: input.chargeDate,
              amountMinor: input.amountMinor,
              netMinor: input.netMinor,
              vatMinor: input.vatMinor,
              grossMinor: input.grossMinor,
              vatTreatment: input.vatTreatment,
              rateBasisPoints: input.rateBasisPoints,
              postedAt: at,
              receivableId: receivable.id,
              createdAt: at,
            },
          });
          await tx.receivable.update({ where: { id: receivable.id }, data: { originId: charge.id } });
          return { charge, receivable: { ...receivable, originId: charge.id }, created: true };
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await this.prisma.retainerCharge.findUniqueOrThrow({ where: { agreementId_serviceMonth: { agreementId: input.agreementId, serviceMonth: input.serviceMonth } } });
        return { charge: raced, receivable: await this.prisma.receivable.findUniqueOrThrow({ where: { id: raced.receivableId } }), created: false };
      }
    },
  };

  /**
   * MUT-100 review: the outcome writes lock receivables, which can deadlock with an allocation locking them in another
   * order. Postgres rolls the loser back, so nothing was written; answer `stale` (409, preview again) rather than a 500.
   */
  private async asStaleOnLockConflict<T>(organizationId: string, agreementId: string, write: () => Promise<T>): Promise<T | { kind: 'stale'; record: { agreement: AgreementRecord; installments: InstallmentRecord[]; credit: null } }> {
    try {
      return await write();
    } catch (err) {
      if (!isLockConflict(err)) throw err;
      const agreement = await this.prisma.agreement.findFirstOrThrow({ where: { id: agreementId, organizationId } });
      return { kind: 'stale', record: { agreement, installments: await this.prisma.installment.findMany({ where: { agreementId }, orderBy: { position: 'asc' } }), credit: null } };
    }
  }

  readonly receivables: ReceivableRepository = {
    getById: (organizationId, id) => this.prisma.receivable.findFirst({ where: { id, organizationId, deletedAt: null } }),
    getByIdIncludingDeleted: (organizationId, id) => this.prisma.receivable.findFirst({ where: { id, organizationId } }),
    getByIds: async (organizationId, ids) => {
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, id: { in: [...ids] }, deletedAt: null } });
      const order = new Map(ids.map((id, i) => [id, i]));
      return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    listEligible: async (organizationId, customerId, currency) => {
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, customerId, currency, status: 'OPEN', deletedAt: null }, orderBy: [{ dueDate: 'asc' }, { postingDate: 'asc' }, { id: 'asc' }] });
      return rows.filter((r) => r.grossMinor - r.paidMinor - r.creditedMinor > 0n);
    },
    credit: async (organizationId, receivableId, input: CreditInput, at) => {
      const exists = await this.prisma.receivable.findFirst({ where: { id: receivableId, organizationId, deletedAt: null }, select: { id: true } });
      if (!exists) return null;
      return this.prisma.$transaction(async (tx) => {
        const r = await lockReceivable(tx, receivableId);
        if (r.status !== 'OPEN' || input.amountMinor > r.grossMinor - r.paidMinor - r.creditedMinor) throw new InsufficientCapacity(receivableId);
        const credit = await tx.receivableCredit.create({ data: { organizationId, receivableId, ...input, createdAt: at } });
        const receivable = await settleReceivable(tx, receivableId, { creditedMinor: { increment: input.amountMinor } });
        return { receivable, credit };
      });
    },
    listCredits: (organizationId, receivableId) => this.prisma.receivableCredit.findMany({ where: { organizationId, receivableId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    list: async (organizationId, filter: ReceivableFilter, page) => {
      const rows = await this.prisma.receivable.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.projectId ? { projectId: filter.projectId } : {}),
          ...(filter.currency ? { currency: filter.currency } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.dueBefore || filter.dueAfter ? { dueDate: { ...(filter.dueBefore ? { lte: filter.dueBefore } : {}), ...(filter.dueAfter ? { gte: filter.dueAfter } : {}) } } : {}),
          ...cursorWhere(page),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    countOutstandingByProject: async (organizationId, projectId) => {
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, projectId, status: 'OPEN', deletedAt: null }, select: { grossMinor: true, paidMinor: true, creditedMinor: true } });
      return rows.filter((r) => r.grossMinor - r.paidMinor - r.creditedMinor > 0n).length;
    },
    // MUT-65: "Owed", written directly, not through an Agreement/Installment.
    createAdjustment: (input: CreateAdjustmentReceivableInput, at) => this.prisma.$transaction((tx) => createAdjustmentTx(tx, input, at)),
    // The money guard is re-asserted in the WHERE, not trusted from the caller's earlier read: a settle
    // landing in between would otherwise hide a row a POSTED payment is allocated to. Same shape as
    // payments.reverse re-asserting `status: 'POSTED'`. A refusal shows up as a row that comes back undeleted.
    softDeleteAdjustment: async (organizationId, id, at) => {
      await this.prisma.receivable.updateMany({ where: { id, organizationId, deletedAt: null, paidMinor: 0n, creditedMinor: 0n }, data: { deletedAt: at } });
      return this.prisma.receivable.findFirst({ where: { id, organizationId } });
    },
    // One transaction (MUT-223 pre-landing review, write-race fix): the updated row stays locked until commit, so the re-read is exactly this
    // write — never an undo or a second re-date that landed between two separate statements (404 with no audit row).
    redateAdjustment: (organizationId, id, userId, expectedVersion, postingDate) =>
      this.prisma.$transaction(async (tx): Promise<UpdateResult<ReceivableRecord>> => {
        const owned = { id, organizationId, origin: 'ADJUSTMENT' as const, createdByUserId: userId, deletedAt: null };
        const { count } = await tx.receivable.updateMany({ where: { ...owned, version: expectedVersion }, data: { postingDate, version: { increment: 1 } } });
        if (count === 1) return { kind: 'updated', record: await tx.receivable.findUniqueOrThrow({ where: { id } }) };
        const record = await tx.receivable.findFirst({ where: owned });
        return record ? { kind: 'stale', record } : { kind: 'not_found' };
      }),
  };

  readonly payments: PaymentRepository = {
    // The counter upsert can race on first use of a year (two inserts); one loses with P2002 and retries once.
    create: async (input, at) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.prisma.$transaction((tx) => createPaymentTx(tx, input, at));
        } catch (err) {
          if (attempt === 0 && isUniqueViolation(err) && String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '').includes('year')) continue;
          throw asLockConflict(err);
        }
      }
    },
    getById: (organizationId, id) => this.prisma.payment.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter: PaymentFilter, page) => {
      const rows = await this.prisma.payment.findMany({
        where: {
          organizationId,
          ...(filter.customerId ? { customerId: filter.customerId } : {}),
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.origin ? { origin: filter.origin } : {}),
          ...(filter.receivedBefore || filter.receivedAfter ? { receivedOn: { ...(filter.receivedBefore ? { lte: filter.receivedBefore } : {}), ...(filter.receivedAfter ? { gte: filter.receivedAfter } : {}) } } : {}),
          // Every OR-shaped condition goes in AND: spread side by side, the cursor's OR used to replace the project's (MUT-61).
          AND: [
            // MUT-65: a payment whose own projectId names it, OR one with an allocation on it. MUT-61 D2: the own
            // projectId is a capture-time hint, so it counts only while the payment has no allocations at all.
            ...(filter.projectId ? [{ OR: [{ projectId: filter.projectId, allocations: { none: { organizationId } } }, { allocations: { some: { organizationId, receivable: { projectId: filter.projectId } } } }] }] : []),
            ...(filter.allocationState ? [this.allocationStateWhere(filter.allocationState)] : []),
            cursorWhere(page),
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: page.limit + 1,
      });
      return toPage(rows, page);
    },
    listAllocations: (organizationId, paymentId) => this.prisma.paymentAllocation.findMany({ where: { organizationId, paymentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    allocate: async (organizationId, paymentId, requested, at) => {
      const exists = await this.prisma.payment.findFirst({ where: { id: paymentId, organizationId }, select: { id: true } });
      if (!exists) return null;
      return this.prisma.$transaction(async (tx) => {
        const [payment] = await tx.$queryRaw<Array<{ id: string; status: string; amountMinor: bigint; allocatedMinor: bigint }>>`SELECT "id", "status", "amountMinor", "allocatedMinor" FROM "payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`;
        if (!payment || payment.status !== 'POSTED') throw new InsufficientCapacity(paymentId);
        const total = requested.reduce((s, a) => s + a.amountMinor, 0n);
        if (total > payment.amountMinor - payment.allocatedMinor) throw new InsufficientCapacity(paymentId);
        const full = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        const allocations = await applyAllocations(tx, full, requested, at);
        return { payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }), allocations };
      }).catch((err: unknown) => {
        throw asLockConflict(err);
      });
    },
    reverse: async (organizationId, paymentId, reason, at) => {
      const exists = await this.prisma.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (!exists) return null;
      return this.prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'POSTED' }, data: { status: 'REVERSED', reversedAt: at, reversalReason: reason, allocatedMinor: 0n, version: { increment: 1 }, updatedAt: at } });
        if (count !== 1) return { payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }), changed: false };
        const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } });
        await lockReceivablesInIdOrder(tx, allocations.map((a) => a.receivableId));
        for (const a of allocations) {
          await settleReceivable(tx, a.receivableId, { paidMinor: { decrement: a.amountMinor } });
        }
        return { payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }), changed: true };
      }).catch((err: unknown) => {
        throw asLockConflict(err);
      });
    },
    findReplacedBy: (organizationId, paymentId) => this.prisma.payment.findFirst({ where: { organizationId, replacesPaymentId: paymentId, status: 'POSTED' } }),
    capture: async (input, at) => (await this.payments.create({ ...input, reference: null, replacesPaymentId: null, origin: 'CAPTURE', allocations: [] }, at)).payment,
    undoCapture: async (organizationId, paymentId, userId, at) => {
      // One conditional write. allocate() holds FOR UPDATE on this row; whichever commits first wins, and Postgres
      // re-checks this WHERE against the row allocate() left behind, so an allocation is never silently undone.
      const { count } = await this.prisma.payment.updateMany({
        where: { id: paymentId, organizationId, origin: 'CAPTURE', createdByUserId: userId, status: 'POSTED', allocatedMinor: 0n },
        data: { status: 'REVERSED', reversedAt: at, reversalReason: CAPTURE_UNDO_REASON, version: { increment: 1 }, updatedAt: at },
      });
      const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (count === 1) return { result: 'reversed', payment };
      if (!payment || payment.origin !== 'CAPTURE' || payment.createdByUserId !== userId) return { result: 'not-found', payment: null };
      if (payment.status !== 'REVERSED') return { result: 'allocated', payment };
      return { result: payment.reversalReason === CAPTURE_UNDO_REASON ? 'already-reversed' : 'reversed-elsewhere', payment };
    },
    // Same single-transaction shape as receivables.redateAdjustment (MUT-223 pre-landing review).
    redateCapture: (organizationId, paymentId, userId, expectedVersion, receivedOn, at) =>
      this.prisma.$transaction(async (tx): Promise<UpdateResult<PaymentRecord>> => {
        const owned = { id: paymentId, organizationId, origin: 'CAPTURE' as const, createdByUserId: userId, status: 'POSTED' as const };
        const { count } = await tx.payment.updateMany({ where: { ...owned, version: expectedVersion }, data: { receivedOn, version: { increment: 1 }, updatedAt: at } });
        if (count === 1) return { kind: 'updated', record: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }) };
        const record = await tx.payment.findFirst({ where: owned });
        return record ? { kind: 'stale', record } : { kind: 'not_found' };
      }),
  };

  /** MUT-61: allocationStateOf (payments/allocation-state.ts) as a where clause, POSTED payments only. */
  private allocationStateWhere(state: AllocationState): Prisma.PaymentWhereInput {
    const amount = this.prisma.payment.fields.amountMinor;
    if (state === 'unallocated') return { status: 'POSTED', allocatedMinor: 0n };
    if (state === 'partial') return { status: 'POSTED', allocatedMinor: { gt: 0n, lt: amount } };
    return { status: 'POSTED', allocatedMinor: { gte: amount } };
  }

  private async entityIdsForExternal(organizationId: string, entityType: ExternalEntityType, filter: CustomerFilter | ProjectFilter): Promise<string[] | null> {
    if (filter.externalId === undefined) return null;
    const refs = await this.externalReferences.findByExternalIds(organizationId, filter.provider ?? 'MALAFAT', entityType, [filter.externalId]);
    return refs.map((r) => r.entityId);
  }

  // ---- MUT-42: expenses ----------------------------------------------------

  readonly expenses: ExpenseRepository = {
    // The row insert itself lives in createExpenseRow so MUT-66's filing can run it inside its own transaction.
    create: (input, at) => createExpenseRow(this.prisma, input, at),
    getById: (organizationId, id) => this.prisma.expense.findFirst({ where: { id, organizationId, deletedAt: null } }),
    list: async (organizationId, filter, page) => {
      const rows: ExpenseRecord[] = await this.prisma.expense.findMany({
        // One AND array (MUT-267 Q1): the group clause and the cursor each need their own OR, and spread keys would overwrite each other.
        where: { organizationId, deletedAt: null, AND: [expenseWhere(filter), expenseCursorWhere(page.cursor)] },
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },
    update: async (organizationId, id, expectedVersion, patch, at) => {
      const data: Prisma.ExpenseUncheckedUpdateManyInput = { version: { increment: 1 }, updatedAt: at };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const { count } = await translate(() => this.prisma.expense.updateMany({ where: { id, organizationId, deletedAt: null, version: expectedVersion }, data }));
      const record = await this.prisma.expense.findFirst({ where: { id, organizationId, deletedAt: null } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    softDelete: (organizationId, id, at, receipts) =>
      this.prisma.$transaction(async (tx) => {
        const { count } = await tx.expense.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
        const record = await tx.expense.findFirst({ where: { id, organizationId } });
        if (!record) return null;
        if (count !== 1) return { record, changed: false, removedReceipts: [] };
        // MUT-255: READY receipts go back to the library ('unlink'); everything left goes with the expense.
        if (receipts === 'unlink') {
          await tx.expenseReceipt.updateMany({ where: { organizationId, expenseId: id, status: 'READY', deletedAt: null }, data: { expenseId: null, filingStatus: 'TO_REVIEW', version: { increment: 1 } } });
        }
        const pending = await tx.expenseReceipt.findMany({ where: { organizationId, expenseId: id, deletedAt: null } });
        await tx.expenseReceipt.updateMany({ where: { id: { in: pending.map((r) => r.id) } }, data: { deletedAt: at } });
        return { record, changed: true, removedReceipts: pending.map((r) => toExpenseReceipt({ ...r, deletedAt: at })) };
      }),
    totalsByCurrency: async (organizationId, filter) => {
      const rows = await this.prisma.expense.groupBy({
        by: ['currency'],
        where: { organizationId, deletedAt: null, ...expenseWhere(filter) },
        _sum: { amountMinor: true },
        _count: { _all: true },
        orderBy: { currency: 'asc' },
      });
      return rows.map((r) => ({ currency: r.currency, totalMinor: r._sum.amountMinor ?? 0n, count: r._count._all }));
    },
  };

  // ---- MUT-267: expense groups (ADR-094) ------------------------------------

  readonly expenseGroups: ExpenseGroupRepository = {
    create: (input, at, maxLive) =>
      translate(() =>
        maxLive === undefined
          ? this.prisma.expenseGroup.create({ data: { ...input, createdAt: at, updatedAt: at } })
          : this.prisma.$transaction(async (tx) => {
              // The org row lock serializes concurrent creates, so the count and the insert can't interleave past the cap.
              await lockOrganization(tx, input.organizationId);
              if ((await tx.expenseGroup.count({ where: { organizationId: input.organizationId, deletedAt: null } })) >= maxLive) throw new InsufficientCapacity(input.organizationId);
              return tx.expenseGroup.create({ data: { ...input, createdAt: at, updatedAt: at } });
            }),
      ),
    getById: (organizationId, id) => this.prisma.expenseGroup.findFirst({ where: { id, organizationId, deletedAt: null } }),
    list: (organizationId) =>
      this.prisma.expenseGroup.findMany({ where: { organizationId, deletedAt: null }, orderBy: [{ startOn: 'desc' }, { id: 'desc' }] }),
    update: async (organizationId, id, expectedVersion, patch, at) => {
      const data: Prisma.ExpenseGroupUncheckedUpdateManyInput = { version: { increment: 1 }, updatedAt: at };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const { count } = await translate(() => this.prisma.expenseGroup.updateMany({ where: { id, organizationId, deletedAt: null, version: expectedVersion }, data }));
      const record = await this.prisma.expenseGroup.findFirst({ where: { id, organizationId, deletedAt: null } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    softDelete: async (organizationId, id, at) => {
      const { count } = await this.prisma.expenseGroup.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      const record = await this.prisma.expenseGroup.findFirst({ where: { id, organizationId } });
      return record ? { record, changed: count === 1 } : null;
    },
    setOverride: async (organizationId, groupId, expenseId, mode, at) => {
      const key = { groupId_expenseId: { groupId, expenseId } };
      const existing = await this.prisma.expenseGroupOverride.findUnique({ where: key });
      if (existing?.mode === mode) return { record: toGroupOverride(existing), changed: false };
      // Native INSERT … ON CONFLICT DO UPDATE (verified at review), so concurrent first marks don't collide.
      const row = await translate(() =>
        this.prisma.expenseGroupOverride.upsert({ where: key, create: { groupId, expenseId, organizationId, mode, createdAt: at, updatedAt: at }, update: { mode, updatedAt: at } }),
      );
      return { record: toGroupOverride(row), changed: true };
    },
    clearOverride: async (organizationId, groupId, expenseId) => {
      const { count } = await this.prisma.expenseGroupOverride.deleteMany({ where: { groupId, expenseId, organizationId } });
      return count === 1;
    },
    overridesForExpense: async (organizationId, expenseId) =>
      (await this.prisma.expenseGroupOverride.findMany({ where: { expenseId, organizationId } })).map(toGroupOverride),
  };

  // ---- MUT-161: conversions; MUT-194: versioned update and soft delete ------

  readonly conversions: ConversionRepository = {
    create: (input, at) => translate(() => this.prisma.conversion.create({ data: { ...input, createdAt: at, updatedAt: at } })),
    getById: (organizationId, id) => this.prisma.conversion.findFirst({ where: { id, organizationId, deletedAt: null } }),
    list: async (organizationId, filter, page) => {
      const rows: ConversionRecord[] = await this.prisma.conversion.findMany({
        where: { organizationId, deletedAt: null, ...conversionWhere(filter), ...conversionCursorWhere(page.cursor) },
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },
    update: async (organizationId, id, expectedVersion, patch, at) => {
      const data: Prisma.ConversionUncheckedUpdateManyInput = { version: { increment: 1 }, updatedAt: at };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const { count } = await translate(() => this.prisma.conversion.updateMany({ where: { id, organizationId, deletedAt: null, version: expectedVersion }, data }));
      const record = await this.prisma.conversion.findFirst({ where: { id, organizationId, deletedAt: null } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    softDelete: async (organizationId, id, at) => {
      const { count } = await this.prisma.conversion.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      const record = await this.prisma.conversion.findFirst({ where: { id, organizationId } });
      return record ? { record, changed: count === 1 } : null;
    },
  };

  readonly expenseCategories: ExpenseCategoryRepository = {
    create: async (organizationId, input, at) =>
      toExpenseCategory(
        await translate(() =>
          this.prisma.$transaction(async (tx) => {
            // qa-reconcile D5: waits out a type change, so a new category can't land between its delete and its reseed.
            await lockOrganization(tx, organizationId);
            return tx.expenseCategory.create({ data: { organizationId, name: input.name, nameKey: categoryNameKey(input.name), color: input.color, createdAt: at, updatedAt: at } });
          }),
        ),
      ),
    getById: async (organizationId, id) => mapNullable(await this.prisma.expenseCategory.findFirst({ where: { id, organizationId } }), toExpenseCategory),
    list: async (organizationId, options) =>
      (
        await this.prisma.expenseCategory.findMany({
          where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      ).map(toExpenseCategory),
    seed: (organizationId, preset, at) =>
      this.prisma.$transaction(async (tx) => {
        // MUT-182 D3: a type change holds this row while it replaces the categories, so a seed of the old preset waits,
        // then finds the new rows and does nothing — instead of slipping its own preset in beside them.
        await lockOrganization(tx, organizationId);
        if ((await tx.expenseCategory.count({ where: { organizationId } })) > 0) return false;
        // A racing seed blocks on the unique index and then skips every row, so the preset lands once.
        const { count } = await tx.expenseCategory.createMany({ data: presetRows(organizationId, preset, at), skipDuplicates: true });
        return count > 0;
      }),
    update: (organizationId, id, expectedVersion, patch, at) =>
      translate(() =>
        this.prisma.$transaction(async (tx): Promise<UpdateResult<ExpenseCategoryRecord>> => {
          // qa-reconcile D5: waits out a type change, which may delete this very row (categories are no longer only archived).
          await lockOrganization(tx, organizationId);
          const current = await tx.expenseCategory.findFirst({ where: { id, organizationId } });
          if (!current) return { kind: 'not_found' };
          const data: Prisma.ExpenseCategoryUpdateManyMutationInput = { version: { increment: 1 }, updatedAt: at };
          if (patch.name !== undefined) {
            data.name = patch.name;
            data.nameKey = categoryNameKey(patch.name);
          }
          if (patch.color !== undefined) data.color = patch.color;
          if (patch.archived !== undefined) data.archivedAt = patch.archived ? (current.archivedAt ?? at) : null;
          const { count } = await tx.expenseCategory.updateMany({ where: { id, organizationId, version: expectedVersion }, data });
          const record = await tx.expenseCategory.findFirst({ where: { id, organizationId } });
          if (!record) return { kind: 'not_found' };
          return count === 1 ? { kind: 'updated', record: toExpenseCategory(record) } : { kind: 'stale', record: toExpenseCategory(record) };
        }),
      ),
  };

  readonly expenseReceipts: ExpenseReceiptRepository = {
    create: async (input, at) =>
      toExpenseReceipt(
        await translate(() =>
          this.prisma.expenseReceipt.create({
            data: {
              organizationId: input.organizationId,
              expenseId: input.expenseId,
              filename: input.filename,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
              receivedOn: input.receivedOn,
              uploadedByUserId: input.uploadedByUserId,
              requestId: input.requestId,
              filingStatus: input.expenseId ? 'FILED' : 'TO_REVIEW',
              suggested: input.suggested ? (input.suggested as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
              storageKey: '',
              status: 'PENDING_UPLOAD',
              createdAt: at,
            },
          }),
        ),
      ),
    setKey: async (organizationId, id, storageKey) => {
      const { count } = await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId }, data: { storageKey } });
      return count === 1 ? toExpenseReceiptOrNull(await this.prisma.expenseReceipt.findUnique({ where: { id } })) : null;
    },
    getById: async (organizationId, id) => toExpenseReceiptOrNull(await this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } })),
    listByExpense: async (organizationId, expenseId) =>
      (await this.prisma.expenseReceipt.findMany({ where: { organizationId, expenseId, status: 'READY', deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(toExpenseReceipt),
    complete: async (organizationId, id, at) => {
      await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId, deletedAt: null, status: 'PENDING_UPLOAD' }, data: { status: 'READY', completedAt: at } });
      return toExpenseReceiptOrNull(await this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } }));
    },
    softDelete: async (organizationId, id, at) => {
      await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      return toExpenseReceiptOrNull(await this.prisma.expenseReceipt.findFirst({ where: { id, organizationId } }));
    },
    countReadyByExpenseIds: async (organizationIds, expenseIds) => {
      if (expenseIds.length === 0) return new Map();
      const groups = await this.prisma.expenseReceipt.groupBy({
        by: ['expenseId'],
        where: { organizationId: { in: [...organizationIds] }, expenseId: { in: [...expenseIds] }, status: 'READY', deletedAt: null },
        _count: { _all: true },
      });
      return new Map(groups.flatMap((g) => (g.expenseId ? [[g.expenseId, g._count._all] as const] : [])));
    },
    list: async (organizationId, filter, page) => {
      const rows = await this.prisma.expenseReceipt.findMany({
        where: {
          organizationId,
          status: 'READY',
          deletedAt: null,
          ...(filter.filingStatus ? { filingStatus: filter.filingStatus } : {}),
          ...(filter.from || filter.to ? { receivedOn: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
          ...(page.cursor ? { OR: [{ createdAt: { lt: page.cursor.createdAt } }, { createdAt: page.cursor.createdAt, id: { lt: page.cursor.id } }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit).map(toExpenseReceipt);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    countByFilingStatus: async (organizationId) => {
      const groups = await this.prisma.expenseReceipt.groupBy({ by: ['filingStatus'], where: { organizationId, status: 'READY', deletedAt: null }, _count: { _all: true } });
      const of = (status: 'TO_REVIEW' | 'FILED') => groups.find((g) => g.filingStatus === status)?._count._all ?? 0;
      return { toReview: of('TO_REVIEW'), filed: of('FILED') };
    },
    countPendingSince: (organizationId, since) => this.prisma.expenseReceipt.count({ where: { organizationId, status: 'PENDING_UPLOAD', deletedAt: null, createdAt: { gte: since } } }),
    setSuggested: async (organizationId, id, expectedVersion, suggested) => {
      const existing = await this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } });
      if (!existing) return { kind: 'not_found' };
      if (existing.filingStatus === 'FILED') return { kind: 'filed' };
      const { count } = await this.prisma.expenseReceipt.updateMany({
        where: { id, organizationId, deletedAt: null, filingStatus: 'TO_REVIEW', version: expectedVersion },
        data: { suggested: suggested as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      const record = await this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } });
      if (!record) return { kind: 'not_found' };
      if (count === 0 && record.filingStatus === 'FILED') return { kind: 'filed' };
      return count === 1 ? { kind: 'updated', record: toExpenseReceipt(record) } : { kind: 'stale', record: toExpenseReceipt(record) };
    },
    fileAsExpense: (params, at) =>
      this.prisma.$transaction(async (tx) => {
        const refused = await lockToReviewReceipt(tx, params.organizationId, params.receiptId);
        if (refused) return refused;
        // TODO(blocked-by MUT-307): firm profiles take `initialApprovalFor(role, firm)` here, before the expense is written.
        // TODO(blocked-by MUT-312): `assertOpenPeriod` for the expense's date, in this transaction.
        const expense = await createExpenseRow(tx, params.expense, at);
        const receipt = await markReceiptFiled(tx, params.organizationId, params.receiptId, {
          expenseId: expense.id,
          approved: params.approved as unknown as Prisma.InputJsonValue,
          approvedAt: at,
          approvedByUserId: params.userId,
          ...(params.suggested ? { suggested: params.suggested as unknown as Prisma.InputJsonValue } : {}),
        });
        return { kind: 'filed' as const, expense, receipt };
      }),
    fileOntoExpense: (params) =>
      this.prisma.$transaction(async (tx) => {
        const refused = await lockToReviewReceipt(tx, params.organizationId, params.receiptId);
        if (refused) return refused;
        // NO KEY UPDATE (DECISIONS.md:1961): queues a second filing and an expense delete behind this one, but not an
        // insert that only references the expense. Read again under the lock, so a delete that committed meanwhile shows.
        const [expenseRow] = await tx.$queryRaw<Array<{ deletedAt: Date | null }>>`SELECT "deletedAt" FROM "expenses" WHERE "id" = ${params.expenseId}::uuid AND "organizationId" = ${params.organizationId}::uuid FOR NO KEY UPDATE`;
        if (!expenseRow || expenseRow.deletedAt) return { kind: 'expense_not_found' as const };
        // Counted under the expense lock, so two filings can't both take its last place (READY only, as listByExpense).
        // A MUT-44 completion counts without this lock, so it can still race one filing to 11 (known, ADR-167 "Extended by MUT-389").
        const held = await tx.expenseReceipt.count({ where: { organizationId: params.organizationId, expenseId: params.expenseId, status: 'READY', deletedAt: null } });
        if (held >= params.maxReceipts) return { kind: 'too_many_receipts' as const };
        // TODO(blocked-by MUT-307): whether evidence may be added to an approved or posted firm expense.
        // TODO(blocked-by MUT-312): `assertOpenPeriod` for the expense's date, in this transaction.
        // An earlier approval keeps the reading it was made against, so the edit-rate pair never changes after the fact.
        const keepsReading = params.suggested !== undefined && (await tx.expenseReceipt.findUniqueOrThrow({ where: { id: params.receiptId }, select: { approved: true } })).approved !== null;
        const receipt = await markReceiptFiled(tx, params.organizationId, params.receiptId, {
          expenseId: params.expenseId,
          ...(params.suggested && !keepsReading ? { suggested: params.suggested as unknown as Prisma.InputJsonValue } : {}),
        });
        const expense = await tx.expense.findUniqueOrThrow({ where: { id: params.expenseId } });
        return { kind: 'filed' as const, expense, receipt };
      }),
    editRates: async (range) => {
      // Counted in JS from the week's approvals (a few hundred rows at most for the operator's Monday read), so the
      // memory and Prisma stores share one definition (`editRatesOf`).
      const rows = await this.prisma.expenseReceipt.findMany({
        where: { approvedAt: { gte: range.from, lt: range.to }, approved: { not: Prisma.DbNull } },
        select: { suggested: true, approved: true },
      });
      return editRatesOf(rows.map((r) => ({ suggested: r.suggested as unknown as ReceiptSuggestion | null, approved: r.approved as unknown as ApprovedReceiptFields })));
    },
  };


  // ---- MUT-270: the entries feed -------------------------------------------

  readonly recordsExport = prismaRecordsExport(() => this.prisma);

  /** MUT-358 (ADR-160): three queries whatever the number of profiles (brief §2.3). */
  readonly billing: BillingRepository = {
    factsFor: async ({ ownerUserIds, organizationIds }) => {
      const owners = [...ownerUserIds];
      const orgs = [...organizationIds];
      const [subscriptions, grants, people] = await Promise.all([
        this.prisma.billingSubscription.findMany({
          where: { OR: [{ billingAccount: { userId: { in: owners } } }, { organizationId: { in: orgs } }] },
          include: { billingAccount: { select: { userId: true } } },
        }),
        this.prisma.entitlementGrant.findMany({ where: { OR: [{ userId: { in: owners } }, { organizationId: { in: orgs } }] } }),
        this.prisma.user.findMany({ where: { id: { in: owners } }, select: { id: true, trialStartedAt: true } }),
      ]);
      return {
        subscriptions: subscriptions.map(({ billingAccount, ...sub }) => ({ ...sub, userId: billingAccount.userId })),
        grants,
        trialStarts: new Map(people.map((p) => [p.id, p.trialStartedAt] as const)),
      };
    },
    setTrialStart: async (userId, at) => {
      const { count } = await this.prisma.user.updateMany({ where: { id: userId }, data: { trialStartedAt: at } });
      return count === 0 ? null : { trialStartedAt: at };
    },
    createGrant: (input) =>
      translate(() =>
        this.prisma.$transaction(async (tx) => {
          const { id, userId, organizationId, tier, reason, expiresAt, grantedBy, at } = input;
          const grant = await tx.entitlementGrant.create({ data: { id, userId, organizationId, tier, reason, expiresAt, grantedBy, createdAt: at } });
          if (input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, at) });
          return grant;
        }),
      ),
    revokeGrant: (id, at, audit) =>
      this.prisma.$transaction(async (tx) => {
        // Only an unrevoked grant changes; two revokes racing write one revokedAt and one audit row.
        const { count } = await tx.entitlementGrant.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
        const grant = await tx.entitlementGrant.findUnique({ where: { id } });
        if (!grant) return null;
        if (count > 0 && audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(audit, at) });
        return { grant, revoked: count > 0 };
      }),
    getGrant: (id) => this.prisma.entitlementGrant.findUnique({ where: { id } }),
    listGrants: ({ userId, organizationId, activeAt }) =>
      this.prisma.entitlementGrant.findMany({
        where: {
          ...(userId !== undefined ? { userId } : {}),
          ...(organizationId !== undefined ? { organizationId } : {}),
          ...(activeAt ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: activeAt } }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    linkAccount: async (input) => {
      const attempt = () =>
        translate(() =>
          this.prisma.$transaction(async (tx) => {
            // Lock the customer's row (if any), then the person's — saveAccount's order, so the two never deadlock — so two
            // links can't both pass the checks below and a concurrent Stripe sync can't write back a stale userId.
            await tx.$queryRaw`SELECT id FROM billing_accounts WHERE "stripeCustomerId" = ${input.stripeCustomerId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId}::uuid FOR NO KEY UPDATE`;
            const existing = await tx.billingAccount.findUnique({ where: { stripeCustomerId: input.stripeCustomerId } });
            if (existing?.userId === input.userId) return { account: existing, linked: false };
            if (existing?.userId) throw new StateConflict('billing_account', 'CUSTOMER_LINKED_ELSEWHERE');
            if (await tx.billingAccount.findUnique({ where: { userId: input.userId } })) throw new StateConflict('billing_account', 'USER_HAS_ANOTHER_ACCOUNT');
            if (!existing && !input.currency) throw new StateConflict('billing_account', 'CURRENCY_REQUIRED');
            const account = existing
              ? await tx.billingAccount.update({ where: { id: existing.id }, data: { userId: input.userId, updatedAt: input.at } })
              : await tx.billingAccount.create({
                  data: { stripeCustomerId: input.stripeCustomerId, userId: input.userId, currency: input.currency!, createdAt: input.at, updatedAt: input.at },
                });
            if (input.audit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.audit, input.at) });
            return { account, linked: true };
          }),
        );
      try {
        return await attempt();
      } catch (err) {
        // A Stripe sync creating the same new customer at the same moment: read again and decide on what it wrote.
        if (err instanceof UniqueViolation) return attempt();
        throw err;
      }
    },
    getSubscription: (stripeSubscriptionId) => this.prisma.billingSubscription.findUnique({ where: { stripeSubscriptionId } }),
    getAccount: (stripeCustomerId) => this.prisma.billingAccount.findUnique({ where: { stripeCustomerId } }),
    listAccounts: ({ linked }) =>
      this.prisma.billingAccount.findMany({
        where: linked === undefined ? {} : { userId: linked ? { not: null } : null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    saveAccount: async (input) => {
      const attempt = () =>
        translate(() =>
          this.prisma.$transaction(async (tx) => {
            // Customer row, then person row, the same order as linkAccount: a concurrent link or sync waits here and
            // then reads what the other one wrote, so nothing is decided (or written back) from a stale read.
            await tx.$queryRaw`SELECT id FROM billing_accounts WHERE "stripeCustomerId" = ${input.stripeCustomerId} FOR UPDATE`;
            const existing = await tx.billingAccount.findUnique({ where: { stripeCustomerId: input.stripeCustomerId } });
            let userId = existing?.userId ?? null;
            let conflict: SaveBillingAccountConflict | null = null;
            if (input.userId !== null && input.userId !== userId) {
              const person = UUID_RE.test(input.userId) ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${input.userId}::uuid FOR NO KEY UPDATE` : [];
              if (userId !== null) conflict = 'CUSTOMER_LINKED_ELSEWHERE';
              else if (person.length === 0) conflict = 'UNKNOWN_USER';
              else if (await tx.billingAccount.findUnique({ where: { userId: input.userId }, select: { id: true } })) conflict = 'USER_HAS_ANOTHER_ACCOUNT';
              else userId = input.userId;
            }
            const linked = userId !== null && userId !== (existing?.userId ?? null);
            // userId is written only when this call links: never copied back from what it read (D5: never unlink).
            const currency = input.currency ?? existing?.currency ?? null;
            if (currency === null) throw new StateConflict('billing_account', 'CURRENCY_REQUIRED');
            const data = { country: input.country ?? existing?.country ?? null, currency, updatedAt: input.at, ...(linked ? { userId } : {}) };
            const account = existing
              ? await tx.billingAccount.update({ where: { id: existing.id }, data })
              : await tx.billingAccount.create({ data: { ...data, userId, stripeCustomerId: input.stripeCustomerId, createdAt: input.at } });
            if (linked && input.linkAudit.length > 0) await tx.auditEvent.createMany({ data: auditRows(input.linkAudit, input.at) });
            return { account, linked, conflict };
          }),
        );
      try {
        return await attempt();
      } catch (err) {
        // Two first sightings of a new customer (checkout and subscription events arrive together): the loser reads again.
        if (err instanceof UniqueViolation) return attempt();
        throw err;
      }
    },
    saveSubscription: async (input) => {
      const { stripeCustomerId, at, audit, ...fields } = input;
      const attempt = () =>
        translate(() =>
          this.prisma.$transaction(async (tx) => {
            const account = await tx.billingAccount.findUnique({ where: { stripeCustomerId }, select: { id: true } });
            if (!account) throw new ForeignKeyViolation('billing_subscriptions.billingAccountId');
            // Serialize two reads of the same subscription: the compare below must see the row the other one wrote.
            await tx.$queryRaw`SELECT id FROM billing_subscriptions WHERE "stripeSubscriptionId" = ${fields.stripeSubscriptionId} FOR UPDATE`;
            const before = await tx.billingSubscription.findUnique({ where: { stripeSubscriptionId: fields.stripeSubscriptionId } });
            if (before && before.stripeUpdatedAt > fields.stripeUpdatedAt) return { subscription: before, outcome: 'stale' as const };
            const data = { ...fields, billingAccountId: account.id, updatedAt: at };
            const subscription = before
              ? await tx.billingSubscription.update({ where: { id: before.id }, data })
              : await tx.billingSubscription.create({ data: { ...data, createdAt: at } });
            const changed = before === null || subscriptionChanged(before, subscription);
            const rows = changed ? subscriptionChangeAudit(before, subscription, audit) : [];
            if (rows.length > 0) await tx.auditEvent.createMany({ data: auditRows(rows, at) });
            return { subscription, outcome: before === null ? ('created' as const) : changed ? ('changed' as const) : ('unchanged' as const) };
          }),
        );
      try {
        return await attempt();
      } catch (err) {
        // Two first reads of a new subscription race on the unique id: the loser runs again and compares.
        if (err instanceof UniqueViolation) return attempt();
        throw err;
      }
    },
    beginStripeEvent: async ({ id, type, at }) => {
      await this.prisma.stripeEvent.createMany({ data: [{ id, type, receivedAt: at }], skipDuplicates: true });
      const row = await this.prisma.stripeEvent.findUnique({ where: { id }, select: { processedAt: true } });
      return { alreadyProcessed: row?.processedAt != null };
    },
    finishStripeEvent: async (id, outcome) => {
      await this.prisma.stripeEvent.updateMany({
        where: { id },
        data: 'processedAt' in outcome ? { processedAt: outcome.processedAt, error: null } : { error: outcome.error.slice(0, STRIPE_EVENT_ERROR_MAX) },
      });
    },
    pruneStripeEvents: async (before) => (await this.prisma.stripeEvent.deleteMany({ where: { receivedAt: { lt: before } } })).count,
  };

  readonly entries: EntriesRepository = {
    // D3: one typed, index-bounded query per organization and kind (limit + 1 rows each), merged in memory. Review D1:
    // one organization at a time, its 4 kinds in parallel, so a request holds at most 4 pooled connections.
    // MUT-390: `order=occurredOn` reads the same branches by each kind's money date column (`moneyDateOf`), on its own
    // index. Every bound (cursor, filters) is its own AND entry, so two on one column never overwrite each other.
    list: async (organizationIds, page) => {
      const take = page.limit + 1;
      const byMoneyDate = page.order === 'occurredOn';
      const moneyCursor = byMoneyDate ? moneyDateCursorOf(page.cursor) : null;
      const loggedCursor = byMoneyDate ? null : createdAtCursorOf(page.cursor);
      const bounds = (dateColumn: MoneyDateColumn) => ({ AND: feedBounds(dateColumn, page, moneyCursor, loggedCursor) });
      const orderBy = (dateColumn: MoneyDateColumn) =>
        byMoneyDate ? [{ [dateColumn]: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }] : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
      const branchesOf = (organizationId: string) => [
        this.prisma.expense
          .findMany({ where: { organizationId, deletedAt: null, ...bounds('occurredOn') }, orderBy: orderBy('occurredOn'), take })
          .then((rows) => rows.map((record): EntryRow => ({ kind: 'expense', record }))),
        this.prisma.payment
          .findMany({ where: { organizationId, OR: [{ reversalReason: null }, { reversalReason: { not: CAPTURE_UNDO_REASON } }], ...bounds('receivedOn') }, orderBy: orderBy('receivedOn'), take })
          .then((rows) => rows.map((record): EntryRow => ({ kind: 'payment', record }))),
        this.prisma.receivable
          .findMany({ where: { organizationId, origin: 'ADJUSTMENT', deletedAt: null, ...bounds('postingDate') }, orderBy: orderBy('postingDate'), take })
          .then((rows) => rows.map((record): EntryRow => ({ kind: 'receivable', record }))),
        this.prisma.conversion
          .findMany({ where: { organizationId, deletedAt: null, ...bounds('occurredOn') }, orderBy: orderBy('occurredOn'), take })
          .then((rows) => rows.map((record): EntryRow => ({ kind: 'conversion', record }))),
      ];
      const branches: EntryRow[][] = [];
      for (const organizationId of organizationIds) branches.push(...(await Promise.all(branchesOf(organizationId))));
      if (byMoneyDate) return mergeByMoneyDate(branches, page.limit, moneyDateKeyOf);
      return mergeNewestFirst(branches, page.limit, (row) => row.record);
    },
    settledOwedIds: async (organizationIds, paymentIds) => {
      if (paymentIds.length === 0) return new Map();
      const allocations = await this.prisma.paymentAllocation.findMany({
        where: { organizationId: { in: [...organizationIds] }, paymentId: { in: [...paymentIds] } },
        select: { paymentId: true, receivableId: true, receivable: { select: { origin: true } } },
      });
      const count = new Map<string, number>();
      for (const a of allocations) count.set(a.paymentId, (count.get(a.paymentId) ?? 0) + 1);
      return new Map(allocations.filter((a) => count.get(a.paymentId) === 1 && a.receivable.origin === 'ADJUSTMENT').map((a) => [a.paymentId, a.receivableId]));
    },
  };

  // ---- MUT-66: the unsorted inbox ------------------------------------------

  readonly inboxEntries: InboxEntryRepository = {
    create: (input, at) => translate(() => this.prisma.inboxEntry.create({ data: { ...input, createdAt: at, updatedAt: at } })),
    getById: (userId, id) => this.prisma.inboxEntry.findFirst({ where: { id, userId } }),
    list: async (userId, page) => {
      const rows = await this.prisma.inboxEntry.findMany({
        where: { userId, ...inboxCursorWhere(page.cursor) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    update: async (userId, id, expectedVersion, patch, at) => {
      const data: Prisma.InboxEntryUncheckedUpdateManyInput = { version: { increment: 1 }, updatedAt: at };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      const { count } = await translate(() => this.prisma.inboxEntry.updateMany({ where: { id, userId, version: expectedVersion }, data }));
      const record = await this.prisma.inboxEntry.findFirst({ where: { id, userId } });
      if (!record) return { kind: 'not_found' };
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
    delete: async (userId, id) => {
      const { count } = await this.prisma.inboxEntry.deleteMany({ where: { id, userId } });
      return count === 1;
    },
    countByUser: (userId) => this.prisma.inboxEntry.count({ where: { userId } }),
    fileAsExpense: (params, at) =>
      this.prisma.$transaction(async (tx) => {
        if (!(await claimInboxEntryTx(tx, params))) return { kind: 'not_found' as const };
        return { kind: 'filed' as const, expense: await createExpenseRow(tx, params.expense, at) };
      }),
    fileAsIncome: async (params, at) => {
      // Same single retry payments.create uses: two filings in the first payment of a year can collide on the number counter.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.prisma.$transaction(async (tx) => {
            if (!(await claimInboxEntryTx(tx, params))) return { kind: 'not_found' as const };
            return { kind: 'filed' as const, result: await writeIncomeTx(tx, params.write, at) };
          });
        } catch (err) {
          if (attempt === 0 && isUniqueViolation(err) && String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '').includes('year')) continue;
          throw err;
        }
      }
    },
  };
}

/**
 * Takes the organization's row lock for the rest of the transaction (MUT-182 D3). NO KEY UPDATE (qa-reconcile D2):
 * it queues the writers that must not interleave (seed, type change, category create/rename) on each other, but not
 * the many inserts whose foreign key only needs the row to exist (expenses, audit rows, idempotency keys).
 */
async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
}

/** A profile `userId` owns, an unstamped MUT-120 one included (qa-reconcile D1; `profileOwnerOf` in SQL). */
function ownedBy(userId: string): Prisma.OrganizationWhereInput {
  return { OR: [{ ownerUserId: userId }, { ownerUserId: null, personalOwnerUserId: userId }] };
}

/** MUT-373: a profile `userId` co-owns — `canCoOwn` and an OWNER membership (`ownsProfile`'s second branch in SQL). */
function coOwnedBy(userId: string): Prisma.OrganizationWhereInput {
  return { ownerUserId: { not: null }, personalOwnerUserId: null, profileType: 'BUSINESS', memberships: { some: { userId, role: 'OWNER' } } };
}

/**
 * Audit rows written together in one createMany. Each gets its own millisecond, in order: `audit.list` sorts on
 * (createdAt, random id), so equal timestamps would list them in any order — unlike the memory store (re-review).
 */
function auditRows(events: AuditEventInput[], at: Date): Prisma.AuditEventCreateManyInput[] {
  return events.map((event, i) => ({
    ...event,
    metadata: event.metadata === undefined ? Prisma.JsonNull : (event.metadata as Prisma.InputJsonValue),
    createdAt: new Date(at.getTime() + i),
  }));
}

/** Same instant for the whole preset; the 1 ms steps keep creation order equal to preset order. */
function presetRows(organizationId: string, preset: readonly ExpenseCategoryInput[], at: Date) {
  return preset.map((p, i) => ({ organizationId, name: p.name, nameKey: categoryNameKey(p.name), color: p.color, createdAt: new Date(at.getTime() + i), updatedAt: at }));
}

async function typeChangeImpactOf(db: Tx | PrismaClient, organizationId: string): Promise<ProfileTypeChange> {
  const [uncategorizedExpenses, deletedCategories] = await Promise.all([
    db.expense.count({ where: { organizationId, deletedAt: null, categoryId: { not: null } } }),
    db.expenseCategory.count({ where: { organizationId } }),
  ]);
  return { uncategorizedExpenses, deletedCategories };
}

/**
 * MUT-182: a type change replaces the profile's categories. Every expense
 * loses its category first — deleted ones too, so none points at a removed
 * row — and bumps its version, then every category goes and `preset` comes in.
 */
async function replaceCategories(tx: Tx, organizationId: string, preset: readonly ExpenseCategoryInput[], at: Date): Promise<{ impact: ProfileTypeChange; detail: TypeChangeDetail }> {
  // qa-reconcile D5, in the order every expense writer locks: the categorised expense rows first, then the categories.
  // An expense PATCH locks its own row and then (foreign key) the category it names, so taking categories first would
  // deadlock against one moving an expense between two categories (re-review). Holding the categories, an expense write
  // naming one waits and then fails cleanly at 422, instead of committing between our clear and our delete and losing
  // its category to ON DELETE SET NULL without a version bump. Both reads are also the D4 record of what is removed.
  const pairs = await tx.$queryRaw<Array<{ id: string; categoryId: string }>>`
    SELECT id::text, "categoryId"::text FROM expenses WHERE "organizationId" = ${organizationId}::uuid AND "categoryId" IS NOT NULL ORDER BY id FOR NO KEY UPDATE`;
  const categories = await tx.$queryRaw<Array<{ id: string; name: string; color: string | null; archivedAt: Date | null }>>`
    SELECT id::text, name, color, "archivedAt" FROM expense_categories WHERE "organizationId" = ${organizationId}::uuid ORDER BY "createdAt", id FOR UPDATE`;
  const impact = await typeChangeImpactOf(tx, organizationId);
  await tx.expense.updateMany({ where: { organizationId, categoryId: { not: null } }, data: { categoryId: null, version: { increment: 1 }, updatedAt: at } });
  await tx.expenseCategory.deleteMany({ where: { organizationId } });
  await tx.expenseCategory.createMany({ data: presetRows(organizationId, preset, at) });
  return {
    impact,
    detail: {
      removedCategories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, archived: c.archivedAt !== null })),
      uncategorized: pairs.map((e) => ({ expenseId: e.id, categoryId: e.categoryId })),
    },
  };
}

/**
 * The expense row insert, inside whatever transaction the caller supplies —
 * `expenses.create` passes the client itself (an implicit one-statement
 * transaction), MUT-66's filing passes its own open `tx` so the insert and the
 * inbox-entry delete commit or roll back together.
 */
/** The row as the port types it: the two JSON columns carry `ReceiptSuggestion` / `ApprovedReceiptFields` (validated on the way in). */
function toExpenseReceipt(row: Prisma.ExpenseReceiptGetPayload<object>): ExpenseReceiptRecord {
  return { ...row, suggested: row.suggested as unknown as ReceiptSuggestion | null, approved: row.approved as unknown as ApprovedReceiptFields | null };
}

function toExpenseReceiptOrNull(row: Prisma.ExpenseReceiptGetPayload<object> | null): ExpenseReceiptRecord | null {
  return row ? toExpenseReceipt(row) : null;
}

function createExpenseRow(tx: Tx | PrismaClient, input: CreateExpenseInput, at: Date): Promise<ExpenseRecord> {
  return translate(() => tx.expense.create({ data: { ...input, createdAt: at, updatedAt: at } }));
}

/**
 * MUT-255/389: the first step of filing a library receipt. Locks its row, so of two concurrent filings the second
 * waits here and then reads FILED; null when it may be filed (live, READY, To review, on this profile).
 */
async function lockToReviewReceipt(tx: Tx, organizationId: string, receiptId: string): Promise<{ kind: 'not_found' | 'already_filed' | 'not_ready' } | null> {
  const [locked] = await tx.$queryRaw<Array<{ status: string; filingStatus: string; deletedAt: Date | null }>>`SELECT "status", "filingStatus", "deletedAt" FROM "expense_receipts" WHERE "id" = ${receiptId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
  if (!locked || locked.deletedAt) return { kind: 'not_found' };
  if (locked.filingStatus === 'FILED') return { kind: 'already_filed' };
  if (locked.status !== 'READY') return { kind: 'not_ready' };
  return null;
}

/** MUT-255/389: the last step, under `lockToReviewReceipt`'s lock: FILED on `expenseId`, with whatever else `data` sets. */
async function markReceiptFiled(tx: Tx, organizationId: string, receiptId: string, data: { expenseId: string } & Prisma.ExpenseReceiptUncheckedUpdateManyInput): Promise<ExpenseReceiptRecord> {
  const { count } = await tx.expenseReceipt.updateMany({
    where: { id: receiptId, organizationId, filingStatus: 'TO_REVIEW', status: 'READY', deletedAt: null },
    data: { ...data, filingStatus: 'FILED', version: { increment: 1 } },
  });
  // The row is locked, so this can't happen short of a bug; throwing rolls the transaction back rather than leaving
  // an expense orphaned or a receipt half-filed.
  if (count !== 1) throw new Error(`receipt ${receiptId} changed under its lock`);
  return toExpenseReceipt(await tx.expenseReceipt.findUniqueOrThrow({ where: { id: receiptId } }));
}

/**
 * Takes the entry out, inside the filing transaction: the delete both proves
 * the entry was this user's and of the expected kind, and holds its row lock
 * until commit — so of two concurrent filings of the same entry, the second
 * matches zero rows and answers `not_found` rather than writing a second
 * financial record. False means unknown id, another user's, already filed, or
 * the wrong kind; the caller never distinguishes them.
 */
async function claimInboxEntryTx(tx: Tx, params: { userId: string; inboxEntryId: string; kind: InboxEntryKind }): Promise<boolean> {
  const { count } = await tx.inboxEntry.deleteMany({ where: { id: params.inboxEntryId, userId: params.userId, kind: params.kind } });
  return count === 1;
}

/** MUT-65's two income writes, composed into the filing transaction rather than reimplemented. */
async function writeIncomeTx(tx: Tx, write: IncomeWriteInput, at: Date): Promise<IncomeWriteResult> {
  if (write.kind === 'received') {
    const { payment, allocations } = await createPaymentTx(tx, write.payment, at);
    return { kind: 'received', payment, allocations };
  }
  return { kind: 'owed', receivable: await createAdjustmentTx(tx, write.receivable, at) };
}

/** Newest first: rows strictly before the cursor in (createdAt, id) descending order. */
function inboxCursorWhere(cursor: InboxEntryCursor | null): Prisma.InboxEntryWhereInput {
  if (!cursor) return {};
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

function expenseWhere(f: ExpenseFilter): Prisma.ExpenseWhereInput {
  return {
    ...(f.from || f.to ? { occurredOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.currency ? { currency: f.currency } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.unlinked ? { customerId: null } : {}),
    ...(f.group ? { AND: [expenseGroupWhere(f.group)] } : {}),
  };
}

/**
 * MUT-267 D4 in SQL, kept equal to groups.ts `isGroupMember` by the shared
 * store contract: in the window and not left out, or kept. `excluded` lists
 * left-out expenses dated inside the window only (design review 22A).
 */
function expenseGroupWhere(g: ExpenseGroupFilter): Prisma.ExpenseWhereInput {
  const inWindow = { occurredOn: { gte: g.startOn, lte: g.windowEnd } };
  const marked = (mode: ExpenseGroupOverrideMode) => ({ groupId: g.groupId, mode });
  if (g.membership === 'excluded') return { ...inWindow, groupOverrides: { some: marked('excluded') } };
  return { OR: [{ ...inWindow, groupOverrides: { none: marked('excluded') } }, { groupOverrides: { some: marked('included') } }] };
}

function toGroupOverride(row: { groupId: string; expenseId: string; organizationId: string; mode: string; createdAt: Date; updatedAt: Date }): ExpenseGroupOverrideRecord {
  return { ...row, mode: row.mode as ExpenseGroupOverrideMode };
}

/** Newest first: rows before the cursor in (occurredOn, id) descending order; an inclusive cursor keeps its own row (MUT-91 anchor). */
function expenseCursorWhere(cursor: ExpenseCursor | null): Prisma.ExpenseWhereInput {
  if (!cursor) return {};
  const sameDay = cursor.inclusive ? { lte: cursor.id } : { lt: cursor.id };
  return { AND: [{ OR: [{ occurredOn: { lt: cursor.occurredOn } }, { occurredOn: cursor.occurredOn, id: sameDay }] }] };
}

function conversionWhere(f: ConversionFilter): Prisma.ConversionWhereInput {
  return {
    ...(f.from || f.to ? { occurredOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.currency ? { OR: [{ currency: f.currency }, { toCurrency: f.currency }] } : {}),
  };
}

/** Newest first: rows before the cursor in (occurredOn, id) descending order; an inclusive cursor keeps its own row (MUT-91 anchor). */
function conversionCursorWhere(cursor: ConversionCursor | null): Prisma.ConversionWhereInput {
  if (!cursor) return {};
  const sameDay = cursor.inclusive ? { lte: cursor.id } : { lt: cursor.id };
  return { AND: [{ OR: [{ occurredOn: { lt: cursor.occurredOn } }, { occurredOn: cursor.occurredOn, id: sameDay }] }] };
}

function toExpenseCategory(row: Prisma.ExpenseCategoryGetPayload<object>): ExpenseCategoryRecord {
  return { id: row.id, organizationId: row.organizationId, name: row.name, color: row.color, archivedAt: row.archivedAt, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** `action` equals the filter's and is none of the excluded ones (MUT-223); the same shape as entityTypeWhere. */
function actionWhere(filter: AuditFilter): { action?: Prisma.StringFilter } {
  const excluded = filter.excludeActions ?? [];
  if (!filter.action && excluded.length === 0) return {};
  return { action: { ...(filter.action ? { equals: filter.action } : {}), ...(excluded.length ? { notIn: [...excluded] } : {}) } };
}

/** `entityType` equals the filter's and is none of the excluded ones (MUT-42). */
function entityTypeWhere(filter: AuditFilter): { entityType?: Prisma.StringFilter } {
  const excluded = filter.excludeEntityTypes ?? [];
  if (!filter.entityType && excluded.length === 0) return {};
  return { entityType: { ...(filter.entityType ? { equals: filter.entityType } : {}), ...(excluded.length ? { notIn: [...excluded] } : {}) } };
}

type PrismaApiKey = Prisma.ApiKeyGetPayload<Record<string, never>>;
type Tx = Prisma.TransactionClient;

/**
 * MUT-100 review D2: locks the posted upfront receivables the counted upfront was read from (in id order) and reports
 * whether any is gone or moved since — a credit landing between the commit's compose and this write would otherwise
 * bill against an upfront that no longer stands. Allocations and reversals lock receivables in request order, so a
 * deadlock with one is possible; `asStaleOnLockConflict` turns it into a retryable `stale` instead of a 500.
 */
async function upfrontMoved(tx: Tx, organizationId: string, seen: ReadonlyArray<{ id: string; version: number }>): Promise<boolean> {
  if (seen.length === 0) return false;
  const ids = [...seen.map((s) => s.id)].sort();
  const rows = await tx.$queryRaw<Array<{ id: string; version: number }>>`SELECT "id"::text AS "id", "version" FROM "receivables" WHERE "id" = ANY(${ids}::uuid[]) AND "organizationId" = ${organizationId}::uuid ORDER BY "id" FOR UPDATE`;
  const now = new Map(rows.map((r) => [r.id, r.version]));
  return seen.some((s) => now.get(s.id) !== s.version);
}

/** A lock conflict becomes the store's LockConflict (MUT-130), so the routes answer 409, not 500; anything else passes through. */
function asLockConflict(err: unknown): unknown {
  return isLockConflict(err) ? new LockConflict() : err;
}

/** Postgres aborted the transaction to break a deadlock or a serialization conflict (40P01 / 40001): safe to retry. */
export function isLockConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  const dbCode = (err.meta as { code?: unknown } | undefined)?.code;
  return err.code === 'P2010' && (dbCode === '40P01' || dbCode === '40001');
}

/** The agreement columns a contingency outcome (or its correction) writes, with the totals and the version bump. */
function outcomeData(input: OutcomeWriteInput, at: Date): Prisma.AgreementUpdateManyMutationInput {
  return {
    outcome: input.outcome,
    outcomeDate: input.outcomeDate,
    awardedAmountMinor: input.awardedAmountMinor,
    outcomeNote: input.outcomeNote,
    commissionRateBasisPoints: input.commissionRateBasisPoints,
    upfrontTreatment: input.upfrontTreatment,
    outcomeRecordedAt: at,
    ...input.totals,
    version: { increment: 1 },
    updatedAt: at,
  };
}

/** Row lock so capacity checks and sum updates serialise per receivable. */
async function lockReceivable(tx: Tx, receivableId: string): Promise<{ id: string; status: string; grossMinor: bigint; paidMinor: bigint; creditedMinor: bigint }> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string; grossMinor: bigint; paidMinor: bigint; creditedMinor: bigint }>>`SELECT "id", "status", "grossMinor", "paidMinor", "creditedMinor" FROM "receivables" WHERE "id" = ${receivableId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new ForeignKeyViolation('payment_allocations.receivableId');
  return row;
}

/**
 * Locks every receivable a write will touch, in id order: the order the contingency outcome writes lock the upfront
 * receivables (`upfrontMoved`), so a payment write and an outcome write can't deadlock (MUT-130). The caller then
 * works in its own order on rows it already holds.
 */
async function lockReceivablesInIdOrder(tx: Tx, receivableIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(receivableIds)].sort()) await lockReceivable(tx, id);
}

/** Applies a sum change, then recomputes status from the sums and bumps the version. */
async function settleReceivable(tx: Tx, receivableId: string, data: Prisma.ReceivableUpdateInput): Promise<ReceivableRecord> {
  await tx.receivable.update({ where: { id: receivableId }, data });
  const r = await tx.receivable.findUniqueOrThrow({ where: { id: receivableId } });
  const status = r.grossMinor - r.paidMinor - r.creditedMinor > 0n ? 'OPEN' : 'SETTLED';
  return tx.receivable.update({ where: { id: receivableId }, data: { status, version: { increment: 1 } } });
}

/**
 * Payment + allocations + receivable sums/status + number, inside the
 * caller's transaction (the `settleReceivable(tx, ...)` idiom). The public
 * `payments.create` wraps this in its own `$transaction` with the year-counter
 * retry; MUT-66 composes this directly inside its own transaction alongside
 * other writes (e.g. deleting an inbox row), so "file" is atomic.
 */
async function createPaymentTx(tx: Tx, input: CreatePaymentInput, at: Date): Promise<{ payment: PaymentRecord; allocations: AllocationRecord[] }> {
  if (input.customerId) {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { id: true } });
    if (!customer) throw new ForeignKeyViolation('payments.customerId');
  }
  if (input.projectId) {
    const project = await tx.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true } });
    if (!project) throw new ForeignKeyViolation('payments.projectId');
  }
  const { allocations: requested, ...rest } = input;
  const year = Number(input.receivedOn.slice(0, 4));
  const counter = await tx.paymentCounter.upsert({
    where: { organizationId_year: { organizationId: input.organizationId, year } },
    create: { organizationId: input.organizationId, year, next: 1 },
    update: { next: { increment: 1 } },
  });
  const number = `PAY-${year}-${String(counter.next).padStart(4, '0')}`;
  const payment = await tx.payment.create({ data: { ...rest, number, allocatedMinor: 0n, status: 'POSTED', createdAt: at, updatedAt: at } });
  const allocations = await applyAllocations(tx, payment, requested, at);
  const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return { payment: fresh, allocations };
}

/**
 * "Owed", inside the caller's transaction (same idiom as `createPaymentTx`
 * above). The public `receivables.createAdjustment` wraps this in its own
 * `$transaction`; MUT-66 composes it directly inside its own.
 */
async function createAdjustmentTx(tx: Tx, input: CreateAdjustmentReceivableInput, at: Date): Promise<ReceivableRecord> {
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { id: true } });
  if (!customer) throw new ForeignKeyViolation('receivables.customerId');
  if (input.projectId) {
    const project = await tx.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId }, select: { id: true } });
    if (!project) throw new ForeignKeyViolation('receivables.projectId');
  }
  return tx.receivable.create({
    data: {
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
      createdAt: at,
    },
  });
}

/** Allocation rows + receivable sums + payment allocated total, all inside the caller's transaction; capacity checked under row locks. */
async function applyAllocations(tx: Tx, payment: PaymentRecord, requested: readonly AllocationInput[], at: Date): Promise<AllocationRecord[]> {
  const created: AllocationRecord[] = [];
  let total = 0n;
  await lockReceivablesInIdOrder(tx, requested.map((a) => a.receivableId));
  for (const a of requested) {
    // Already held: this re-read sees the sums an earlier allocation in this loop moved.
    const r = await lockReceivable(tx, a.receivableId);
    if (r.status !== 'OPEN' || a.amountMinor <= 0n || a.amountMinor > r.grossMinor - r.paidMinor - r.creditedMinor) throw new InsufficientCapacity(a.receivableId);
    created.push(await tx.paymentAllocation.create({ data: { organizationId: payment.organizationId, paymentId: payment.id, receivableId: a.receivableId, amountMinor: a.amountMinor, createdAt: at } }));
    await settleReceivable(tx, a.receivableId, { paidMinor: { increment: a.amountMinor } });
    total += a.amountMinor;
  }
  if (created.length > 0) await tx.payment.update({ where: { id: payment.id }, data: { allocatedMinor: { increment: total }, version: { increment: 1 }, updatedAt: at } });
  return created;
}

/** Thrown inside the posting transaction to roll back a receivable another poster beat us to. */
class AlreadyPosted extends Error {}

export type { AgreementRecord, RetainerChargeRecord, ReceivableRecord };

/** Keyset condition for (createdAt, id) ascending. */
function toAuditEvent(r: { id: string; organizationId: string; actorType: AuditEventRecord['actorType']; actorId: string | null; action: string; entityType: string; entityId: string | null; metadata: unknown; requestId: string | null; createdAt: Date }): AuditEventRecord {
  return {
    id: r.id,
    organizationId: r.organizationId,
    actorType: r.actorType,
    actorId: r.actorId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    ...(r.metadata && typeof r.metadata === 'object' ? { metadata: r.metadata as JsonObject } : {}),
    requestId: r.requestId,
    createdAt: r.createdAt,
  };
}

/** Each feed kind's money date column (`moneyDateOf` in entries/merge.ts reads the same ones). */
type MoneyDateColumn = 'occurredOn' | 'receivedOn' | 'postingDate';

/**
 * MUT-390: one kind's feed bounds as AND entries — the cursor of either order and the filters, on the kind's money
 * date column. The money-date cursor is `day <= o AND (day < o OR (createdAt <= t AND (createdAt < t OR id < i)))`:
 * the leading `day <= o` is the index range, as `createdAt <= t` is in `feedCursorWhere`.
 */
function feedBounds(dateColumn: MoneyDateColumn, page: FeedPageRequest, moneyCursor: MoneyDateCursor | null, createdAtCursor: PageCursor | null): Array<Record<string, unknown>> {
  const and: Array<Record<string, unknown>> = [];
  if (moneyCursor) {
    and.push({ [dateColumn]: { lte: moneyCursor.occurredOn } }, { OR: [{ [dateColumn]: { lt: moneyCursor.occurredOn } }, feedCursorWhere(moneyCursor)] });
  } else if (createdAtCursor) {
    and.push(feedCursorWhere(createdAtCursor));
  }
  if (page.occurredFrom !== undefined) and.push({ [dateColumn]: { gte: page.occurredFrom } });
  if (page.occurredBefore !== undefined) and.push({ [dateColumn]: { lt: page.occurredBefore } });
  if (page.loggedSince !== undefined) and.push({ createdAt: { gte: page.loggedSince } });
  return and;
}

/**
 * MUT-270: newest first — rows strictly after the cursor in (createdAt, id) descending order, written as
 * `createdAt <= t AND (createdAt < t OR id < i)`. Equivalent to `(createdAt < t) OR (createdAt = t AND id < i)`,
 * but the leading `createdAt <= t` becomes the index range: the plain OR form made Postgres scan and sort the whole
 * organization (store-prisma-entries-plan.test.ts).
 */
function feedCursorWhere(cursor: PageCursor | null): { createdAt?: { lte: Date }; OR?: Array<Record<string, unknown>> } {
  if (!cursor) return {};
  return { createdAt: { lte: cursor.createdAt }, OR: [{ createdAt: { lt: cursor.createdAt } }, { id: { lt: cursor.id } }] };
}

function cursorWhere(page: PageRequest): { OR?: Array<Record<string, unknown>> } {
  if (!page.cursor) return {};
  return {
    OR: [{ createdAt: { gt: page.cursor.createdAt } }, { createdAt: page.cursor.createdAt, id: { gt: page.cursor.id } }],
  };
}

function toPage<T extends { id: string; createdAt: Date }>(rows: T[], page: PageRequest): Page<T> {
  const items = rows.slice(0, page.limit);
  const last = items[items.length - 1];
  const nextCursor = rows.length > page.limit && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { items, nextCursor };
}

function toApiKey(row: PrismaApiKey): ApiKeyRecord {
  const parsed = parseScopes(row.scopes);
  const scopes: KeyScope[] = parsed.ok ? parsed.scopes : [];
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    environment: row.environment,
    prefix: row.prefix,
    keyHash: row.keyHash,
    scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
  };
}

/** MUT-324: the (userId, version) unique key; true when this call wrote the row, false when it already existed. */
async function insertTermsAcceptance(tx: Prisma.TransactionClient, userId: string, terms: TermsAcceptanceInput, at: Date): Promise<boolean> {
  const { version, locale, textSha256, surface, clientRelease } = terms;
  const { count } = await tx.termsAcceptance.createMany({ data: [{ userId, version, locale, textSha256, surface, clientRelease, acceptedAt: at }], skipDuplicates: true });
  return count === 1;
}

function toTermsAcceptance(row: Prisma.TermsAcceptanceGetPayload<object>): TermsAcceptanceRecord {
  return {
    userId: row.userId,
    version: row.version,
    locale: row.locale as TermsLocale,
    textSha256: row.textSha256,
    surface: row.surface,
    clientRelease: row.clientRelease,
    acceptedAt: row.acceptedAt,
  };
}

function toUser(row: Prisma.UserGetPayload<object>): UserRecord {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    locale: row.locale as UserLocale,
    status: row.status,
    failedSignIns: row.failedSignIns,
    lockedUntil: row.lockedUntil,
    passwordChangedAt: row.passwordChangedAt,
    lastSignInAt: row.lastSignInAt,
    malafatSuggestions: row.malafatSuggestions === null ? null : resolveMalafatSuggestions(row.malafatSuggestions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSetupLink(row: Prisma.AccountSetupTokenGetPayload<object>): AccountSetupTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenDigest: row.tokenDigest,
    purpose: row.purpose,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    cancelledAt: row.cancelledAt,
  };
}

function toSession(row: Prisma.SessionGetPayload<object>): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenDigest: row.tokenDigest,
    kind: row.kind,
    createdAt: row.createdAt,
    credentialsVerifiedAt: row.credentialsVerifiedAt,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    userAgent: row.userAgent,
  };
}

function toMembership(row: Prisma.MembershipGetPayload<object>): MembershipRecord {
  return { userId: row.userId, organizationId: row.organizationId, role: row.role, createdAt: row.createdAt };
}

function mapNullable<A, B>(value: A | null, fn: (a: A) => B): B | null {
  return value === null ? null : fn(value);
}

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** A Stripe metadata user id is free text; only a UUID is looked up (the `::uuid` cast would throw otherwise). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function translate<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 names its columns in `target`; P2003 names its constraint in `constraint` (e.g. "expenses_categoryId_fkey").
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join('_') : String(err.meta?.target ?? err.meta?.constraint ?? '');
      if (err.code === 'P2002') throw new UniqueViolation(target);
      if (err.code === 'P2003') throw new ForeignKeyViolation(target);
    }
    throw err;
  }
}

export type { IntegrationRecord };
