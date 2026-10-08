import { maskApiKey } from './auth/api-key.js';
import type {
  ApiKeyRecord,
  AuditEventRecord,
  CustomerRecord,
  ExternalReferenceRecord,
  IntegrationRecord,
  Organization,
  ProjectRecord,
} from './repositories/ports.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function serializeOrganization(o: Organization) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    defaultCurrency: o.defaultCurrency as 'ILS' | 'USD' | 'EUR',
    timezone: o.timezone,
    createdAt: o.createdAt.toISOString(),
  };
}

export function serializeApiKey(k: ApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    environment: k.environment,
    masked: maskApiKey(k.environment, k.prefix, k.keyHash),
    scopes: k.scopes,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: iso(k.lastUsedAt),
    expiresAt: iso(k.expiresAt),
    revokedAt: iso(k.revokedAt),
  };
}

export function serializeIntegration(i: IntegrationRecord) {
  return {
    id: i.id,
    provider: i.provider,
    externalTenantId: i.externalTenantId,
    displayName: i.displayName,
    status: i.status,
    connectedAt: i.connectedAt.toISOString(),
    disconnectedAt: iso(i.disconnectedAt),
  };
}

export function serializeAuditEvent(e: AuditEventRecord) {
  return {
    id: e.id,
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    ...(e.metadata ? { metadata: e.metadata } : {}),
    requestId: e.requestId,
    createdAt: e.createdAt.toISOString(),
  };
}

function serializeReference(r: ExternalReferenceRecord | null | undefined) {
  return r ? { provider: r.provider, externalId: r.externalId } : null;
}

export function serializeCustomer(c: CustomerRecord, reference?: ExternalReferenceRecord | null) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    status: c.status,
    archivedAt: iso(c.archivedAt),
    externalReference: serializeReference(reference),
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function serializeProject(p: ProjectRecord, reference?: ExternalReferenceRecord | null) {
  return {
    id: p.id,
    customerId: p.customerId,
    name: p.name,
    currency: p.currency as 'ILS' | 'USD' | 'EUR',
    status: p.status,
    archivedAt: iso(p.archivedAt),
    externalReference: serializeReference(reference),
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
