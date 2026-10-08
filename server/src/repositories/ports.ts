import type { ApiKeyEnvironment } from '../auth/api-key.js';
import type { Scope } from '../auth/scopes.js';

/**
 * Storage ports for the Milestone 1 control tables.
 *
 * Mutaba3a's desktop has a repository layer that is typed as storage-agnostic
 * but implemented straight against Dexie (ADR-002, audit §2.2). The service
 * keeps the port honest from day one: every route depends on `LedgerStore`,
 * and there are two implementations — Prisma for production and an in-memory
 * one for tests — both run against the same contract test suite.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
  createdAt: Date;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  defaultCurrency: string;
  timezone: string;
}

export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  name: string;
  environment: ApiKeyEnvironment;
  prefix: string;
  keyHash: string;
  scopes: Scope[];
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
  scopes: Scope[];
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

export type AuditActorType = 'API_KEY' | 'ADMIN' | 'SYSTEM';

export interface AuditEventInput {
  organizationId: string;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
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

export interface OrganizationRepository {
  create(input: CreateOrganizationInput): Promise<Organization>;
  getById(id: string): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
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

export interface AuditRepository {
  append(event: AuditEventInput): Promise<AuditEventRecord>;
  listByOrganization(organizationId: string, limit: number): Promise<AuditEventRecord[]>;
}

export interface IdempotencyRepository {
  claim(input: { organizationId: string; key: string; operation: string; fingerprint: string; at: Date }): Promise<IdempotencyClaim>;
  complete(input: { organizationId: string; key: string; responseStatus: number; responseBody: unknown; at: Date }): Promise<void>;
  /** Releases the key so a retry can run the operation again (used after a 5xx). */
  fail(input: { organizationId: string; key: string; at: Date }): Promise<void>;
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
}

/** Absent key = unchanged; null = cleared. */
export interface UpdateCustomerPatch {
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface ProjectRecord {
  id: string;
  organizationId: string;
  customerId: string;
  name: string;
  /** ISO 4217; one currency per project (plan §3.3, ADR-004). */
  currency: string;
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
}

export interface UpdateProjectPatch {
  name?: string;
  currency?: string;
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
  /**
   * True once anything financial has been posted against the project; the
   * currency is then locked (brief §2.2). Always false in M2 — M3 wires it to
   * agreements and receivables without touching the route.
   */
  hasPostedActivity(organizationId: string, id: string): Promise<boolean>;
}

export interface ExternalReferenceRepository {
  link(input: LinkExternalReferenceInput, at: Date): Promise<ExternalReferenceRecord>;
  findByExternalId(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalId: string): Promise<ExternalReferenceRecord | null>;
  findByExternalIds(organizationId: string, provider: IntegrationProvider, entityType: ExternalEntityType, externalIds: string[]): Promise<ExternalReferenceRecord[]>;
  findByEntities(organizationId: string, entityType: ExternalEntityType, entityIds: string[]): Promise<ExternalReferenceRecord[]>;
}

export interface LedgerStore {
  organizations: OrganizationRepository;
  apiKeys: ApiKeyRepository;
  integrations: IntegrationRepository;
  audit: AuditRepository;
  idempotency: IdempotencyRepository;
  customers: CustomerRepository;
  projects: ProjectRepository;
  externalReferences: ExternalReferenceRepository;
  /** Liveness of the backing store, for /ready. */
  ping(): Promise<void>;
}
