import { randomBytes } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { isLocalHttpUrl } from '../oauth/client-assertion.js';
import { canonicalResource, mcpResourceUrl, v1ResourceUrl } from '../oauth/protocol.js';
import type { LedgerStore, OAuthClientRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';

/**
 * MUT-593 (ADR-254 §4.1): the operator registers a confidential client (Malafat) and, if its key is ever compromised,
 * disables it, which ends every token it holds. Only here, behind MUTABA3A_ADMIN_TOKEN (npm run oauth:client), never
 * through /oauth/register. A routine key rotation needs nothing here: the client publishes its new key at its JWKS URL.
 */

/** A confidential client's id: `mcc_` and 128 random bits. */
const CONFIDENTIAL_CLIENT_PREFIX = 'mcc_';

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const httpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => u.startsWith('https://') || isLocalHttpUrl(u), 'must be https');

const RegisterConfidentialClientSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    redirectUris: z.array(httpsUrl).min(1).max(5),
    jwksUri: httpsUrl,
  })
  .openapi('RegisterConfidentialClientRequest');

const ConfidentialClientSchema = z
  .object({
    clientId: z.string(),
    name: z.string(),
    redirectUris: z.array(z.string()),
    jwksUri: z.string().nullable(),
    allowedResources: z.array(z.string()),
    disabledAt: z.string().datetime().nullable(),
    grantsRevoked: z.number().int().optional(),
  })
  .openapi('ConfidentialClient');

const ClientIdParam = z.object({ clientId: z.string().max(64).openapi({ param: { name: 'clientId', in: 'path' } }) });

function serialize(client: OAuthClientRecord, grantsRevoked?: number) {
  return {
    clientId: client.id,
    name: client.clientName,
    redirectUris: client.redirectUris,
    jwksUri: client.jwksUri,
    allowedResources: client.allowedResources,
    disabledAt: client.disabledAt?.toISOString() ?? null,
    ...(grantsRevoked === undefined ? {} : { grantsRevoked }),
  };
}

/** `localHttp` (OAUTH_CLIENT_LOCAL_HTTP, MUT-596): a local QA stub's http URLs are accepted; otherwise https only. */
export function adminOAuthClientRoutes(options: { store: LedgerStore; logger: Logger; issuer: string | null; localHttp?: boolean }): OpenAPIHono<AppEnv> {
  const { store, logger } = options;
  const app = new OpenAPIHono<AppEnv>();
  /** `/v1` for its own calls, `/mcp` for the tools its connector forwards (MUT-598, D11). */
  const resources = (): string[] => {
    const issuer = options.issuer;
    const found = issuer ? [canonicalResource(v1ResourceUrl(issuer)), canonicalResource(mcpResourceUrl(issuer))] : [];
    if (found.length === 0 || found.some((r) => r === null)) throw new ApiError('OAUTH_NOT_CONFIGURED', 'This server has no portal origin to issue tokens for');
    return found as string[];
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/oauth/confidential-clients',
      tags: ['Admin'],
      summary: 'Register a confidential client that acts as each person (Malafat, MUT-593)',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: RegisterConfidentialClientSchema } } } },
      responses: {
        201: { description: 'Registered; give clientId to the client', content: { 'application/json': { schema: ConfidentialClientSchema } } },
        401: errorResponse('Missing or wrong admin token'),
        422: errorResponse('Validation failed'),
        503: errorResponse('OAUTH_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      if (!options.localHttp && [...body.redirectUris, body.jwksUri].some((u) => !u.startsWith('https://'))) {
        throw new ApiError('VALIDATION_FAILED', 'Redirect URIs and the JWKS URL must be https', { field: 'jwksUri' });
      }
      const client = await store.oauth.createConfidentialClient({
        id: CONFIDENTIAL_CLIENT_PREFIX + randomBytes(16).toString('hex'),
        clientName: body.name,
        redirectUris: body.redirectUris,
        jwksUri: body.jwksUri,
        allowedResources: resources(),
        at: c.get('now')(),
      });
      logger.info({ clientId: client.id, requestId: c.get('requestId') }, 'oauth.confidential_client_registered');
      return c.json(serialize(client), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/oauth/confidential-clients/{clientId}/disable',
      tags: ['Admin'],
      summary: 'Disable a confidential client: every token it holds ends on its next call (MUT-593)',
      description: 'For a compromised key. Not needed for a routine key rotation, which the client does at its JWKS URL.',
      security: [{ adminToken: [] }],
      request: { params: ClientIdParam },
      responses: {
        200: { description: 'Disabled', content: { 'application/json': { schema: ConfidentialClientSchema } } },
        401: errorResponse('Missing or wrong admin token'),
        404: errorResponse('NOT_FOUND — no such confidential client'),
      },
    }),
    async (c) => {
      const { clientId } = c.req.valid('param');
      const existing = await store.oauth.findClient(clientId);
      if (existing?.kind !== 'CONFIDENTIAL') throw new ApiError('NOT_FOUND', 'No such confidential client');
      const result = await store.oauth.disableClient({ clientId, at: c.get('now')() });
      if (!result) throw new ApiError('NOT_FOUND', 'No such confidential client');
      logger.warn({ clientId, grantsRevoked: result.grantsRevoked, requestId: c.get('requestId') }, 'oauth.confidential_client_disabled');
      return c.json(serialize(result.client, result.grantsRevoked), 200);
    },
  );

  return app;
}
