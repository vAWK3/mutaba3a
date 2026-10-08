import { randomUUID } from 'node:crypto';
import { compareByCreatedAtThenId, isAfterCursor } from '../pagination.js';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  AuditEventInput,
  AuditEventRecord,
  AuditRepository,
  ConnectIntegrationInput,
  CreateApiKeyInput,
  CreateCustomerInput,
  CreateOrganizationInput,
  CreateProjectInput,
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
  private readonly custs = new Map<string, CustomerRecord>();
  private readonly projs = new Map<string, ProjectRecord>();
  private readonly refs = new Map<string, ExternalReferenceRecord>();
  private readonly postedProjects = new Set<string>();

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
      const record: CustomerRecord = { id: randomUUID(), ...input, status: 'ACTIVE', archivedAt: null, version: 1, createdAt: at, updatedAt: at };
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
      const record: ProjectRecord = { id: randomUUID(), ...input, status: 'ACTIVE', archivedAt: null, version: 1, createdAt: at, updatedAt: at };
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
    hasPostedActivity: async (organizationId, id) => {
      const p = this.projs.get(id);
      return !!p && p.organizationId === organizationId && this.postedProjects.has(id);
    },
  };

  /** Test helper: simulate M3+ posted activity so the currency lock can be exercised. */
  markProjectPosted(projectId: string): void {
    this.postedProjects.add(projectId);
  }

  private async entityIdsForExternal(organizationId: string, entityType: ExternalEntityType, filter: CustomerFilter): Promise<Set<string> | null> {
    if (filter.externalId === undefined) return null;
    const provider: IntegrationProvider = filter.provider ?? 'MALAFAT';
    const refs = await this.externalReferences.findByExternalIds(organizationId, provider, entityType, [filter.externalId]);
    return new Set(refs.map((r) => r.entityId));
  }

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
