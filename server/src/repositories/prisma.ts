import { Prisma, PrismaClient } from '@prisma/client';
import type { Scope } from '../auth/scopes.js';
import { parseScopes } from '../auth/scopes.js';
import { ForeignKeyViolation, UniqueViolation } from './memory.js';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  AuditRepository,
  IdempotencyClaim,
  IdempotencyRepository,
  IntegrationRecord,
  IntegrationRepository,
  LedgerStore,
  OrganizationRepository,
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
}

type PrismaApiKey = Prisma.ApiKeyGetPayload<Record<string, never>>;

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
