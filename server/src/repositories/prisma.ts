import { Prisma, PrismaClient } from '@prisma/client';
import type { KeyScope } from '../auth/scopes.js';
import { parseScopes } from '../auth/scopes.js';
import { categoryNameKey } from '../expenses/names.js';
import { ForeignKeyViolation, InsufficientCapacity, StateConflict, UniqueViolation } from './memory.js';
import { OPEN_PROPOSAL_STATUSES } from '../proposals/transitions.js';
import type {
  AttachmentFilter,
  AttachmentRepository,
  AuditEventRecord,
  AuditFilter,
  CreateAttachmentInput,
  AppendVersionInput,
  RetainerVersionRecord,
  AgreementFilter,
  AgreementRecord,
  AgreementRepository,
  AllocationInput,
  AllocationRecord,
  CreditInput,
  PaymentFilter,
  PaymentRecord,
  PaymentRepository,
  ApiKeyRecord,
  ApiKeyRepository,
  ApplySupplementInput,
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
  ExpenseCategoryRecord,
  ExpenseCategoryRepository,
  ExpenseCursor,
  ExpenseFilter,
  ExpenseReceiptRepository,
  ExpenseRecord,
  ExpenseRepository,
} from './ports.js';

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
          const membership = await tx.membership.create({ data: { userId: user.id, organizationId: input.organizationId, createdAt: input.at } });
          return { user: toUser(user), membership: toMembership(membership) };
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
        ...(r.metadata && typeof r.metadata === 'object' ? { metadata: r.metadata as Record<string, unknown> } : {}),
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
      if (existing.fingerprint !== fingerprint || existing.operation !== operation) return { kind: 'mismatch' };
      if (existing.status === 'COMPLETED') {
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
      return { kind: 'in_progress' };
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
          // Only the first poster wins; the guard is the WHERE receivableId IS NULL.
          const { count } = await tx.installment.updateMany({
            where: { id: current.id, receivableId: null },
            data: { receivableId: receivable.id, postedAt: input.at, postingDate: input.postingDate, version: { increment: 1 } },
          });
          if (count !== 1) throw new AlreadyPosted();
          const installment = await tx.installment.findUniqueOrThrow({ where: { id: current.id } });
          return { installment, receivable, created: true };
        });
      } catch (err) {
        if (!(err instanceof AlreadyPosted)) throw err;
        const installment = await this.prisma.installment.findFirstOrThrow({ where: { id: installmentId } });
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
    cancel: async (organizationId, agreementId, input, at) => {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.agreement.updateMany({
          where: { id: agreementId, organizationId, status: 'ACTIVE' },
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

  readonly receivables: ReceivableRepository = {
    getById: (organizationId, id) => this.prisma.receivable.findFirst({ where: { id, organizationId } }),
    getByIds: async (organizationId, ids) => {
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, id: { in: [...ids] } } });
      const order = new Map(ids.map((id, i) => [id, i]));
      return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    listEligible: async (organizationId, customerId, currency) => {
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, customerId, currency, status: 'OPEN' }, orderBy: [{ dueDate: 'asc' }, { postingDate: 'asc' }, { id: 'asc' }] });
      return rows.filter((r) => r.grossMinor - r.paidMinor - r.creditedMinor > 0n);
    },
    credit: async (organizationId, receivableId, input: CreditInput, at) => {
      const exists = await this.prisma.receivable.findFirst({ where: { id: receivableId, organizationId }, select: { id: true } });
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
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, projectId, status: 'OPEN' }, select: { grossMinor: true, paidMinor: true, creditedMinor: true } });
      return rows.filter((r) => r.grossMinor - r.paidMinor - r.creditedMinor > 0n).length;
    },
  };

  readonly payments: PaymentRepository = {
    create: async (input, at) => {
      const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, organizationId: input.organizationId }, select: { id: true } });
      if (!customer) throw new ForeignKeyViolation('payments.customerId');
      const { allocations: requested, ...rest } = input;
      const year = Number(input.receivedOn.slice(0, 4));
      // The counter upsert can race on first use of a year (two inserts); one loses with P2002 and retries once.
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await this.prisma.$transaction(async (tx) => {
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
          });
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
          ...(filter.receivedBefore || filter.receivedAfter ? { receivedOn: { ...(filter.receivedBefore ? { lte: filter.receivedBefore } : {}), ...(filter.receivedAfter ? { gte: filter.receivedAfter } : {}) } } : {}),
          ...(filter.projectId ? { allocations: { some: { receivable: { projectId: filter.projectId } } } } : {}),
          ...cursorWhere(page),
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
  };

  private async entityIdsForExternal(organizationId: string, entityType: ExternalEntityType, filter: CustomerFilter | ProjectFilter): Promise<string[] | null> {
    if (filter.externalId === undefined) return null;
    const refs = await this.externalReferences.findByExternalIds(organizationId, filter.provider ?? 'MALAFAT', entityType, [filter.externalId]);
    return refs.map((r) => r.entityId);
  }

  // ---- MUT-42: expenses ----------------------------------------------------

  readonly expenses: ExpenseRepository = {
    create: (input, at) => translate(() => this.prisma.expense.create({ data: { ...input, createdAt: at, updatedAt: at } })),
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

/** Newest first: rows strictly before the cursor in (occurredOn, id) descending order. */
function expenseCursorWhere(cursor: ExpenseCursor | null): Prisma.ExpenseWhereInput {
  if (!cursor) return {};
  return { AND: [{ OR: [{ occurredOn: { lt: cursor.occurredOn } }, { occurredOn: cursor.occurredOn, id: { lt: cursor.id } }] }] };
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
    ...(r.metadata && typeof r.metadata === 'object' ? { metadata: r.metadata as Record<string, unknown> } : {}),
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
