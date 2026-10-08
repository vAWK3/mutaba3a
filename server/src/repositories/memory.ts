import { randomUUID } from 'node:crypto';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  AuditEventInput,
  AuditEventRecord,
  AuditRepository,
  ConnectIntegrationInput,
  CreateApiKeyInput,
  CreateOrganizationInput,
  IdempotencyClaim,
  IdempotencyRecord,
  IdempotencyRepository,
  IntegrationRecord,
  IntegrationRepository,
  LedgerStore,
  Organization,
  OrganizationRepository,
} from './ports.js';

/**
 * In-memory LedgerStore for tests. Mirrors every uniqueness constraint the
 * Prisma schema declares so a route test fails here for the same reasons it
 * would fail in Postgres.
 */
export class MemoryLedgerStore implements LedgerStore {
  private readonly orgs = new Map<string, Organization>();
  private readonly keys = new Map<string, ApiKeyRecord>();
  private readonly ints = new Map<string, IntegrationRecord>();
  private readonly events: AuditEventRecord[] = [];
  private readonly idem = new Map<string, IdempotencyRecord>();

  readonly organizations: OrganizationRepository = {
    create: async (input: CreateOrganizationInput) => {
      for (const o of this.orgs.values()) {
        if (o.slug === input.slug) throw new UniqueViolation('organizations.slug');
      }
      const org: Organization = { id: randomUUID(), ...input, createdAt: new Date() };
      this.orgs.set(org.id, org);
      return { ...org };
    },
    getById: async (id) => clone(this.orgs.get(id)),
    getBySlug: async (slug) => clone([...this.orgs.values()].find((o) => o.slug === slug)),
  };

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
      const record: AuditEventRecord = { id: randomUUID(), createdAt: new Date(), ...event };
      this.events.push(record);
      return { ...record };
    },
    listByOrganization: async (organizationId, limit) =>
      this.events
        .filter((e) => e.organizationId === organizationId)
        .slice(-limit)
        .reverse()
        .map((e) => ({ ...e })),
  };

  readonly idempotency: IdempotencyRepository = {
    claim: async ({ organizationId, key, operation, fingerprint, at }): Promise<IdempotencyClaim> => {
      const id = `${organizationId}:${key}`;
      const existing = this.idem.get(id);
      if (!existing) {
        this.idem.set(id, {
          organizationId,
          key,
          operation,
          fingerprint,
          status: 'PENDING',
          responseStatus: null,
          responseBody: null,
          createdAt: at,
          completedAt: null,
        });
        return { kind: 'new' };
      }
      if (existing.fingerprint !== fingerprint || existing.operation !== operation) return { kind: 'mismatch' };
      if (existing.status === 'COMPLETED') return { kind: 'replay', record: { ...existing } };
      return { kind: 'in_progress' };
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
  };

  async ping(): Promise<void> {
    /* always up */
  }

  /** Test helper: how many audit events exist for an organization. */
  auditCount(organizationId: string): number {
    return this.events.filter((e) => e.organizationId === organizationId).length;
    }
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

function clone<T extends object>(value: T | undefined): T | null {
  return value ? { ...value } : null;
}
