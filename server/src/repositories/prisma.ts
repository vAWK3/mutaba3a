import { Prisma, PrismaClient } from '@prisma/client';
import type { Scope } from '../auth/scopes.js';
import { parseScopes } from '../auth/scopes.js';
import { ForeignKeyViolation, UniqueViolation } from './memory.js';
import type {
  AgreementFilter,
  AgreementRecord,
  AgreementRepository,
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
          const { installments, ...rest } = input;
          const agreement = await tx.agreement.create({ data: { ...rest, createdAt: at, updatedAt: at } });
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
        where: { organizationId, triggerType: 'DATE', receivableId: null, voidedAt: null, triggerDate: { lte: today }, agreement: { status: 'ACTIVE' } },
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
    cancel: async (organizationId, agreementId, input, at) => {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.agreement.updateMany({
          where: { id: agreementId, organizationId, status: 'ACTIVE' },
          data: { status: 'CANCELLED', cancelledAt: at, cancelEffectiveMonth: input.cancelEffectiveMonth, finalMonth: input.finalMonth, version: { increment: 1 }, updatedAt: at },
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
      const rows = await this.prisma.receivable.findMany({ where: { organizationId, projectId, status: 'OPEN' }, select: { grossMinor: true, paidMinor: true } });
      return rows.filter((r) => r.grossMinor - r.paidMinor > 0n).length;
    },
  };

  private async entityIdsForExternal(organizationId: string, entityType: ExternalEntityType, filter: CustomerFilter | ProjectFilter): Promise<string[] | null> {
    if (filter.externalId === undefined) return null;
    const refs = await this.externalReferences.findByExternalIds(organizationId, filter.provider ?? 'MALAFAT', entityType, [filter.externalId]);
    return refs.map((r) => r.entityId);
  }
}

type PrismaApiKey = Prisma.ApiKeyGetPayload<Record<string, never>>;

/** Thrown inside the posting transaction to roll back a receivable another poster beat us to. */
class AlreadyPosted extends Error {}

export type { AgreementRecord, RetainerChargeRecord, ReceivableRecord };

/** Keyset condition for (createdAt, id) ascending. */
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
  const scopes: Scope[] = parsed.ok ? parsed.scopes : [];
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
