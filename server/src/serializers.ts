import { maskApiKey } from './auth/api-key.js';
import type { ApiKeyRecord, AuditEventRecord, IntegrationRecord, Organization } from './repositories/ports.js';

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
