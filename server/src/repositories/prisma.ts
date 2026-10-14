import { Prisma, PrismaClient } from '@prisma/client';
import type { KeyScope } from '../auth/scopes.js';
import { parseScopes } from '../auth/scopes.js';
import { categoryNameKey } from '../expenses/names.js';
import { ForeignKeyViolation, InsufficientCapacity, StateConflict, UniqueViolation } from './memory.js';
import { resolveClaim } from './idempotency-claim.js';
import { OPEN_PROPOSAL_STATUSES } from '../proposals/transitions.js';
import type {
  AttachmentFilter,
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
  ExpenseReceiptRepository,
  ExpenseRecord,
  ExpenseRepository,
  CreateExpenseInput,
  IncomeWriteInput,
  IncomeWriteResult,
  InboxEntryCursor,
  InboxEntryKind,
  InboxEntryRepository,
} from './ports.js';
import { CAPTURE_UNDO_REASON } from './ports.js';

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
    return new PrismaLedgerStore(new PrismaClient({ datasources: { db: { url: databaseUrl } } }));
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
          const personalOrganization = await tx.organization.create({ data: { ...input.personal, personalOwnerUserId: user.id } });
          const memberships = [];
          for (const organizationId of [personalOrganization.id, ...(input.organizationId ? [input.organizationId] : [])]) {
            memberships.push(toMembership(await tx.membership.create({ data: { userId: user.id, organizationId, createdAt: input.at } })));
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
    setStatus: async (id, status, at) => {
      const { count } = await this.prisma.user.updateMany({ where: { id }, data: { status, updatedAt: at } });
      return count === 0 ? null : mapNullable(await this.prisma.user.findUnique({ where: { id } }), toUser);
    },
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
  };

  readonly sessions: SessionRepository = {
    create: async (input) =>
      toSession(
        await translate(() =>
          this.prisma.session.create({
            data: {
              userId: input.userId,
              tokenDigest: input.tokenDigest,
              kind: input.kind,
              createdAt: input.at,
              lastSeenAt: input.at,
              idleExpiresAt: input.idleExpiresAt,
              absoluteExpiresAt: input.absoluteExpiresAt,
              userAgent: input.userAgent,
            },
          }),
        ),
      ),
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

  readonly memberships: MembershipRepository = {
    grant: async (userId, organizationId, at) => {
      const where = { userId_organizationId: { userId, organizationId } };
      const existing = await this.prisma.membership.findUnique({ where });
      if (existing) return { membership: toMembership(existing), created: false };
      try {
        const membership = await translate(() => this.prisma.membership.create({ data: { userId, organizationId, createdAt: at } }));
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
        where: { organizationId, ...entityTypeWhere(filter), ...(filter.entityId ? { entityId: filter.entityId } : {}), ...(filter.action ? { action: filter.action } : {}), ...cursorWhere(page) },
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
  };

  readonly payments: PaymentRepository = {
    // The counter upsert can race on first use of a year (two inserts); one loses with P2002 and retries once.
    create: async (input, at) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.prisma.$transaction((tx) => createPaymentTx(tx, input, at));
        } catch (err) {
          if (attempt === 0 && isUniqueViolation(err) && String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '').includes('year')) continue;
          throw err;
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
      });
    },
    reverse: async (organizationId, paymentId, reason, at) => {
      const exists = await this.prisma.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (!exists) return null;
      return this.prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: 'POSTED' }, data: { status: 'REVERSED', reversedAt: at, reversalReason: reason, allocatedMinor: 0n, version: { increment: 1 }, updatedAt: at } });
        if (count !== 1) return { payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }), changed: false };
        const allocations = await tx.paymentAllocation.findMany({ where: { paymentId } });
        for (const a of allocations) {
          await lockReceivable(tx, a.receivableId);
          await settleReceivable(tx, a.receivableId, { paidMinor: { decrement: a.amountMinor } });
        }
        return { payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }), changed: true };
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
        where: { organizationId, deletedAt: null, ...expenseWhere(filter), ...expenseCursorWhere(page.cursor) },
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
    softDelete: async (organizationId, id, at) => {
      const { count } = await this.prisma.expense.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      const record = await this.prisma.expense.findFirst({ where: { id, organizationId } });
      return record ? { record, changed: count === 1 } : null;
    },
  };

  // ---- MUT-161: conversions (create + read only) ----------------------------

  readonly conversions: ConversionRepository = {
    create: (input, at) => translate(() => this.prisma.conversion.create({ data: { ...input, createdAt: at } })),
    getById: (organizationId, id) => this.prisma.conversion.findFirst({ where: { id, organizationId } }),
    list: async (organizationId, filter, page) => {
      const rows: ConversionRecord[] = await this.prisma.conversion.findMany({
        where: { organizationId, ...conversionWhere(filter), ...conversionCursorWhere(page.cursor) },
        orderBy: [{ occurredOn: 'desc' }, { id: 'desc' }],
        take: page.limit + 1,
      });
      const items = rows.slice(0, page.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > page.limit && last ? { occurredOn: last.occurredOn, id: last.id } : null };
    },
  };

  readonly expenseCategories: ExpenseCategoryRepository = {
    create: async (organizationId, input, at) =>
      toExpenseCategory(await translate(() => this.prisma.expenseCategory.create({ data: { organizationId, name: input.name, nameKey: categoryNameKey(input.name), color: input.color, createdAt: at, updatedAt: at } }))),
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
        if ((await tx.expenseCategory.count({ where: { organizationId } })) > 0) return false;
        // A racing seed blocks on the unique index and then skips every row, so the preset lands once.
        const { count } = await tx.expenseCategory.createMany({
          data: preset.map((p, i) => ({ organizationId, name: p.name, nameKey: categoryNameKey(p.name), color: p.color, createdAt: new Date(at.getTime() + i), updatedAt: at })),
          skipDuplicates: true,
        });
        return count > 0;
      }),
    update: async (organizationId, id, expectedVersion, patch, at) => {
      const current = await this.prisma.expenseCategory.findFirst({ where: { id, organizationId } });
      if (!current) return { kind: 'not_found' };
      const data: Prisma.ExpenseCategoryUpdateManyMutationInput = { version: { increment: 1 }, updatedAt: at };
      if (patch.name !== undefined) {
        data.name = patch.name;
        data.nameKey = categoryNameKey(patch.name);
      }
      if (patch.color !== undefined) data.color = patch.color;
      if (patch.archived !== undefined) data.archivedAt = patch.archived ? (current.archivedAt ?? at) : null;
      const { count } = await translate(() => this.prisma.expenseCategory.updateMany({ where: { id, organizationId, version: expectedVersion }, data }));
      const record = toExpenseCategory((await this.prisma.expenseCategory.findFirst({ where: { id, organizationId } }))!);
      return count === 1 ? { kind: 'updated', record } : { kind: 'stale', record };
    },
  };

  readonly expenseReceipts: ExpenseReceiptRepository = {
    create: (input, at) => translate(() => this.prisma.expenseReceipt.create({ data: { ...input, storageKey: '', status: 'PENDING_UPLOAD', createdAt: at } })),
    setKey: async (organizationId, id, storageKey) => {
      const { count } = await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId }, data: { storageKey } });
      return count === 1 ? this.prisma.expenseReceipt.findUnique({ where: { id } }) : null;
    },
    getById: (organizationId, id) => this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } }),
    listByExpense: (organizationId, expenseId) =>
      this.prisma.expenseReceipt.findMany({ where: { organizationId, expenseId, status: 'READY', deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    complete: async (organizationId, id, at) => {
      await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId, deletedAt: null, status: 'PENDING_UPLOAD' }, data: { status: 'READY', completedAt: at } });
      return this.prisma.expenseReceipt.findFirst({ where: { id, organizationId, deletedAt: null } });
    },
    softDelete: async (organizationId, id, at) => {
      await this.prisma.expenseReceipt.updateMany({ where: { id, organizationId, deletedAt: null }, data: { deletedAt: at } });
      return this.prisma.expenseReceipt.findFirst({ where: { id, organizationId } });
    },
    softDeleteByExpense: (organizationId, expenseId, at) =>
      this.prisma.$transaction(async (tx) => {
        const live = await tx.expenseReceipt.findMany({ where: { organizationId, expenseId, deletedAt: null } });
        await tx.expenseReceipt.updateMany({ where: { id: { in: live.map((r) => r.id) }, deletedAt: null }, data: { deletedAt: at } });
        return live.map((r) => ({ ...r, deletedAt: at }));
      }),
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
 * The expense row insert, inside whatever transaction the caller supplies —
 * `expenses.create` passes the client itself (an implicit one-statement
 * transaction), MUT-66's filing passes its own open `tx` so the insert and the
 * inbox-entry delete commit or roll back together.
 */
function createExpenseRow(tx: Tx | PrismaClient, input: CreateExpenseInput, at: Date): Promise<ExpenseRecord> {
  return translate(() => tx.expense.create({ data: { ...input, createdAt: at, updatedAt: at } }));
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
  };
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
  for (const a of requested) {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSession(row: Prisma.SessionGetPayload<object>): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenDigest: row.tokenDigest,
    kind: row.kind,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    userAgent: row.userAgent,
  };
}

function toMembership(row: Prisma.MembershipGetPayload<object>): MembershipRecord {
  return { userId: row.userId, organizationId: row.organizationId, createdAt: row.createdAt };
}

function mapNullable<A, B>(value: A | null, fn: (a: A) => B): B | null {
  return value === null ? null : fn(value);
}

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function translate<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]).join('_') : String(err.meta?.target ?? '');
      if (err.code === 'P2002') throw new UniqueViolation(target);
      if (err.code === 'P2003') throw new ForeignKeyViolation(target);
    }
    throw err;
  }
}

export type { IntegrationRecord };
