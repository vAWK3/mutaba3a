import { z } from '@hono/zod-openapi';
import { ApiError } from '../errors.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import type { ExternalEntityType, ExternalReferenceRecord, IntegrationProvider, LedgerStore, PageCursor, PageRequest } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';

/** Responses every authenticated route can produce. */
export const errorResponses = {
  401: { description: 'Missing, malformed, unknown, revoked, expired or wrong-environment key', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
  403: { description: 'Key lacks the required scope', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

export const conflictResponse = {
  409: { description: 'Conflict; `details.reason` says which (see the API description)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

export const validationResponse = {
  422: { description: 'Validation or idempotency-key failure', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

export const notFoundResponse = {
  404: { description: 'No such entity in this organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().min(8).max(128).openapi({ description: 'Client-generated key, unique per operation attempt (plan §14.2).' }),
});

/** External references and imports need a CONNECTED integration for the provider. */
export async function requireConnectedIntegration(store: LedgerStore, organizationId: string, provider: IntegrationProvider): Promise<void> {
  const integration = await store.integrations.findByOrganizationAndProvider(organizationId, provider);
  if (!integration || integration.status !== 'CONNECTED') {
    throw new ApiError('CONFLICT', `No connected ${provider} integration; bind the tenant first (POST /v1/integration/bind)`, {
      reason: 'INTEGRATION_NOT_CONNECTED',
      provider,
    });
  }
}

export function toPageRequest(query: { limit: number; cursor?: string | undefined }): PageRequest {
  return { limit: query.limit, cursor: query.cursor ? decodeCursor(query.cursor) : null };
}

export function encodeNextCursor(cursor: PageCursor | null): string | null {
  return cursor ? encodeCursor(cursor) : null;
}

/** One lookup for a whole page: entity id → its reference (if any). */
export async function referencesByEntity(
  store: LedgerStore,
  organizationId: string,
  entityType: ExternalEntityType,
  entityIds: string[],
): Promise<Map<string, ExternalReferenceRecord>> {
  if (entityIds.length === 0) return new Map();
  const refs = await store.externalReferences.findByEntities(organizationId, entityType, entityIds);
  return new Map(refs.map((r) => [r.entityId, r]));
}

export function versionMismatch(currentVersion: number): ApiError {
  return new ApiError('CONFLICT', 'The entity changed since you read it; re-read and retry with the current version', {
    reason: 'VERSION_MISMATCH',
    currentVersion,
  });
}
