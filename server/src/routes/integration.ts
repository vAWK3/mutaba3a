import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { MALAFAT_REQUIRED_SCOPES, missingScopes } from '../auth/scopes.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';
import {
  ApiKeySummarySchema,
  BindIntegrationRequestSchema,
  BindIntegrationResponseSchema,
  DisconnectIntegrationResponseSchema,
  ErrorEnvelopeSchema,
  IntegrationStatusResponseSchema,
} from '../schemas.js';
import { serializeApiKey, serializeIntegration, serializeOrganization } from '../serializers.js';

const errorResponses = {
  401: { description: 'Missing, malformed, unknown, revoked, expired or wrong-environment key', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
  403: { description: 'Key lacks the required scope', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
  429: { description: 'Rate limited', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;

/**
 * /v1/integration — the credential and binding surface Malafat uses
 * (plan §10.1 validate credential, §10.4 disconnect, §11 "Integration:
 * validate credential, inspect scopes").
 */
export function integrationRoutes(store: LedgerStore, version: string): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/integration',
      tags: ['Integration'],
      summary: 'Validate the API key and describe its organization, scopes and binding',
      security: [{ apiKey: [] }],
      middleware: [requireScope('integration:read')] as const,
      responses: {
        200: { description: 'Credential is valid', content: { 'application/json': { schema: IntegrationStatusResponseSchema } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const integration = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
      return c.json(
        {
          organization: serializeOrganization(organization),
          apiKey: serializeApiKey(apiKey),
          requiredScopes: [...MALAFAT_REQUIRED_SCOPES],
          missingScopes: missingScopes(apiKey.scopes, MALAFAT_REQUIRED_SCOPES),
          integration: integration ? serializeIntegration(integration) : null,
          server: { version, apiVersion: 'v1' as const, time: c.get('now')().toISOString() },
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/integration/bind',
      tags: ['Integration'],
      summary: 'Bind this organization to the calling system’s tenant',
      description:
        'Idempotent. Re-binding the same tenant returns the existing binding; binding a different tenant while one is CONNECTED is rejected with ORGANIZATION_MISMATCH. A DISCONNECTED binding to the same tenant is reconnected, keeping its id so external references survive (plan §10.4).',
      security: [{ apiKey: [] }],
      middleware: [requireScope('integration:write'), idempotent(store, 'integration.bind')] as const,
      request: {
        headers: z.object({
          'idempotency-key': z
            .string()
            .min(8)
            .max(128)
            .openapi({ description: 'Client-generated key, unique per operation attempt (plan §14.2).' }),
        }),
        body: { required: true, content: { 'application/json': { schema: BindIntegrationRequestSchema } } },
      },
      responses: {
        200: { description: 'Already bound to this tenant', content: { 'application/json': { schema: BindIntegrationResponseSchema } } },
        201: { description: 'Bound', content: { 'application/json': { schema: BindIntegrationResponseSchema } } },
        409: { description: 'Bound to a different tenant, or the tenant is bound to another organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation or idempotency-key failure', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();

      const existing = await store.integrations.findByOrganizationAndProvider(organization.id, body.provider);
      if (existing && existing.status === 'CONNECTED') {
        if (existing.externalTenantId !== body.externalTenantId) {
          throw new ApiError('ORGANIZATION_MISMATCH', 'This organization is already connected to a different tenant', {
            connectedTenantId: existing.externalTenantId,
          });
        }
        return c.json({ integration: serializeIntegration(existing), created: false }, 200);
      }

      const takenBy = await store.integrations.findByProviderAndTenant(body.provider, body.externalTenantId);
      if (takenBy && takenBy.organizationId !== organization.id && takenBy.status === 'CONNECTED') {
        throw new ApiError('ORGANIZATION_MISMATCH', 'This tenant is already connected to another organization');
      }

      let integration;
      try {
        integration = await store.integrations.connect({
          organizationId: organization.id,
          provider: body.provider,
          externalTenantId: body.externalTenantId,
          displayName: body.displayName,
          connectedByApiKeyId: apiKey.id,
          at: now,
        });
      } catch (err) {
        if (err instanceof UniqueViolation) {
          throw new ApiError('ORGANIZATION_MISMATCH', 'This tenant is already connected to another organization');
        }
        throw err;
      }

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: existing ? 'integration.reconnected' : 'integration.connected',
        entityType: 'integration',
        entityId: integration.id,
        metadata: { provider: body.provider, externalTenantId: body.externalTenantId },
        requestId: c.get('requestId'),
      });

      return c.json({ integration: serializeIntegration(integration), created: !existing }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/integration/disconnect',
      tags: ['Integration'],
      summary: 'Disconnect the binding and revoke the calling key',
      description:
        'Financial history and external references are preserved (plan §10.4). The calling API key is revoked; the response is the last one it can make.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('integration:write')] as const,
      responses: {
        200: { description: 'Disconnected', content: { 'application/json': { schema: DisconnectIntegrationResponseSchema } } },
        404: { description: 'No binding exists', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const now = c.get('now')();
      const existing = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
      if (!existing) throw new ApiError('NOT_FOUND', 'This organization has no integration to disconnect');

      const integration = existing.status === 'CONNECTED' ? await store.integrations.disconnect(existing.id, now) : existing;
      await store.apiKeys.revoke(apiKey.id, 'DISCONNECTED_BY_CLIENT', now);
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'integration.disconnected',
        entityType: 'integration',
        entityId: existing.id,
        metadata: { apiKeyRevoked: true },
        requestId: c.get('requestId'),
      });

      return c.json({ integration: serializeIntegration(integration ?? existing), apiKeyRevoked: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/api-keys/self/revoke',
      tags: ['Integration'],
      summary: 'Revoke the calling key (rotation: validate the new key first, then call this with the old one)',
      description: 'Idempotent. The binding is untouched; only this key stops working. Audited.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('integration:write')] as const,
      responses: {
        200: { description: 'Revoked', content: { 'application/json': { schema: ApiKeySummarySchema } } },
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const now = c.get('now')();
      const record = await store.apiKeys.revoke(apiKey.id, 'ROTATED_BY_CLIENT', now);
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'api_key.revoked',
        entityType: 'api_key',
        entityId: apiKey.id,
        metadata: { reason: 'ROTATED_BY_CLIENT' },
        requestId: c.get('requestId'),
      });
      return c.json(serializeApiKey(record ?? apiKey), 200);
    },
  );

  return app;
}
