import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { hasFeature } from '../features.js';
import { mcpResourceUrl, OAUTH_SCOPES, type OAuthScope } from '../oauth/protocol.js';
import type { OAuthService } from '../oauth/service.js';
import { clientTrust } from '../oauth/trust.js';
import type { LedgerStore, OAuthGrantListing } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, OAuthAuthorizationRequestSchema, OAuthDecisionRequestSchema, OAuthDecisionSchema, OAuthGrantListSchema } from '../schemas.js';
import { agentAuditFor } from '../oauth/audit.js';

/**
 * MUT-434: what the portal needs to connect an agent — the consent page's request and decision, and Connected apps
 * (list and revoke). Signed in only, person-level. Not open to a closing account (not in CLOSING_OPEN_ENDPOINTS).
 */
export const OAUTH_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/oauth/requests/:requestId',
  'POST /v1/oauth/requests/:requestId/decision',
  'GET /v1/oauth/grants',
  'DELETE /v1/oauth/grants/:grantId',
]);

const OWN = [{ session: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const RequestParams = z.object({ requestId: z.string().uuid().openapi({ param: { name: 'requestId', in: 'path' } }) });
const GrantParams = z.object({ grantId: z.string().uuid().openapi({ param: { name: 'grantId', in: 'path' } }) });

const scopesOf = (scopes: string[]): OAuthScope[] => OAUTH_SCOPES.filter((s) => scopes.includes(s));
const hostOf = (uri: string): string => new URL(uri).host;

function notConfigured(): ApiError {
  return new ApiError('OAUTH_NOT_CONFIGURED', 'Connecting an agent is not available on this server');
}

function featureRefusal(): ApiError {
  return new ApiError('FEATURE_NOT_ENABLED', 'Connecting an agent is not turned on for this account', { feature: 'agent_access' });
}

function serializeGrant(g: OAuthGrantListing) {
  return {
    id: g.id,
    clientName: g.clientName,
    clientKind: g.clientKind,
    trust: clientTrust(g.redirectUri),
    scopes: scopesOf(g.scopes),
    connectedAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
    expiresAt: g.expiresAt.toISOString(),
  };
}

export function oauthConsentRoutes(options: { store: LedgerStore; service: OAuthService | null }): OpenAPIHono<AppEnv> {
  const { store } = options;
  const app = new OpenAPIHono<AppEnv>();
  const service = (): OAuthService => {
    if (!options.service) throw notConfigured();
    return options.service;
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/oauth/requests/{requestId}',
      tags: ['Agents'],
      summary: 'The agent asking to connect (MUT-434)',
      description: 'What the consent page shows. Answers even without agent_access (agentAccess: false), so the page can refuse clearly and send the person back to the agent.',
      security: OWN,
      request: { params: RequestParams },
      responses: {
        200: { description: 'The pending request', content: { 'application/json': { schema: OAuthAuthorizationRequestSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — decided, expired (30 minutes) or unknown'),
        503: errorResponse('OAUTH_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const now = c.get('now')();
      const described = await service().describeRequest(c.req.valid('param').requestId, now);
      if (!described) throw new ApiError('NOT_FOUND', 'This request has expired or was already answered; start again from your agent');
      const { request, client } = described;
      return c.json(
        {
          id: request.id,
          client: { name: client.clientName, kind: client.kind, trust: clientTrust(request.redirectUri), redirectHost: hostOf(request.redirectUri) },
          scopes: scopesOf(request.scopes),
          expiresAt: request.expiresAt.toISOString(),
          agentAccess: await hasFeature(store, c.get('identity').user.id, 'agent_access'),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/oauth/requests/{requestId}/decision',
      tags: ['Agents'],
      summary: 'Allow or deny an agent (MUT-434)',
      description: 'Allow creates the connection and returns the agent’s redirect with a one-time code; deny returns it with error=access_denied. Either way, send the browser to redirectTo.',
      security: OWN,
      request: { params: RequestParams, body: { required: true, content: { 'application/json': { schema: OAuthDecisionRequestSchema } } } },
      responses: {
        200: { description: 'Where to send the browser', content: { 'application/json': { schema: OAuthDecisionSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('FEATURE_NOT_ENABLED (allow without agent_access), PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        409: errorResponse('CONFLICT (reason REQUEST_GONE) — already answered or expired'),
        503: errorResponse('OAUTH_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const oauth = service();
      const { user } = c.get('identity');
      const approve = c.req.valid('json').decision === 'approve';
      if (approve && !(await hasFeature(store, user.id, 'agent_access'))) throw featureRefusal();
      const result = await oauth.decide({ requestId: c.req.valid('param').requestId, userId: user.id, approve, at: c.get('now')(), actor: { actorType: 'USER', actorId: user.id }, requestIdForAudit: c.get('requestId') });
      if (result.kind === 'gone') throw new ApiError('CONFLICT', 'This request was already answered or has expired; start again from your agent', { reason: 'REQUEST_GONE' });
      return c.json({ redirectTo: result.redirectTo }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/oauth/grants',
      tags: ['Agents'],
      summary: 'Your connected agents (MUT-434)',
      security: OWN,
      responses: {
        200: { description: 'Live connections, newest first, and the MCP address', content: { 'application/json': { schema: OAuthGrantListSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('FEATURE_NOT_ENABLED, PRINCIPAL_NOT_ACCEPTED or ACCOUNT_CLOSING'),
        503: errorResponse('OAUTH_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const oauth = service();
      const { user } = c.get('identity');
      if (!(await hasFeature(store, user.id, 'agent_access'))) throw featureRefusal();
      const grants = await store.oauth.listLiveGrants(user.id, c.get('now')());
      return c.json({ items: grants.map(serializeGrant), mcpUrl: mcpResourceUrl(oauth.issuer) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/oauth/grants/{grantId}',
      tags: ['Agents'],
      summary: 'Disconnect an agent (MUT-434)',
      description: 'It loses access on its next call. Allowed without agent_access, so a person can always disconnect.',
      security: OWN,
      request: { params: GrantParams },
      responses: {
        204: { description: 'Disconnected' },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — no such live connection of yours'),
        503: errorResponse('OAUTH_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      service();
      const { user } = c.get('identity');
      const audit = await agentAuditFor(store)({ userId: user.id, action: 'user.agent_disconnected', metadata: { reason: 'user' }, actor: { actorType: 'USER', actorId: user.id }, requestId: c.get('requestId') });
      const revoked = await store.oauth.revokeGrant({ grantId: c.req.valid('param').grantId, userId: user.id, reason: 'user', at: c.get('now')(), audit });
      if (!revoked) throw new ApiError('NOT_FOUND', 'No such connection');
      return c.body(null, 204);
    },
  );

  return app;
}
