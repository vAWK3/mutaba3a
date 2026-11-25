import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { agentAuditFor } from '../oauth/audit.js';
import { OAUTH_SCOPES, type OAuthScope } from '../oauth/protocol.js';
import type { LedgerStore, OAuthGrantListing } from '../repositories/ports.js';
import { ConnectedAppListSchema, ErrorEnvelopeSchema } from '../schemas.js';

/**
 * MUT-593 (ADR-254 §4.7, AC9): You › Connected apps — Malafat acting as the person, one row per firm, and the person's
 * revoke. Person-level, a session's only (cookie or the phone's device session): never a delegated token, so Malafat
 * can't hide or undo its own revoke. Agents keep their own list (/v1/oauth/grants).
 */
export const CONNECTED_APPS_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me/connected-apps', 'DELETE /v1/me/connected-apps/:grantId']);

/** Dark (404) while MALAFAT_DELEGATION is off. */
export const CONNECTED_APPS_ENDPOINTS: ReadonlySet<string> = CONNECTED_APPS_ORGANIZATION_INDEPENDENT_ROUTES;

const OWN = [{ session: [] }, { deviceSession: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const GrantParams = z.object({ grantId: z.string().uuid().openapi({ param: { name: 'grantId', in: 'path' } }) });

const scopesOf = (scopes: string[]): OAuthScope[] => OAUTH_SCOPES.filter((s) => scopes.includes(s));

export function connectedAppRoutes(options: { store: LedgerStore }): OpenAPIHono<AppEnv> {
  const { store } = options;
  const app = new OpenAPIHono<AppEnv>();

  /** The person's live Malafat grants. Agents' grants are never in this list, and never revoked through it. */
  const liveConnections = async (userId: string, now: Date): Promise<OAuthGrantListing[]> =>
    (await store.oauth.listLiveGrants(userId, now)).filter((g) => g.clientKind === 'CONFIDENTIAL' && g.tenantId !== null);

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me/connected-apps',
      tags: ['Account'],
      summary: 'Apps that act for you in a firm: Malafat (MUT-593)',
      security: OWN,
      responses: {
        200: { description: 'Live connections, newest first', content: { 'application/json': { schema: ConnectedAppListSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — Malafat access is switched off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const grants = await liveConnections(user.id, c.get('now')());
      const firms = new Map<string, string | null>();
      for (const tenantId of new Set(grants.map((g) => g.tenantId as string))) {
        const integration = await store.integrations.findByProviderAndTenant('MALAFAT', tenantId);
        firms.set(tenantId, integration?.status === 'CONNECTED' ? integration.displayName : null);
      }
      const items = grants.map((g) => ({
        grantId: g.id,
        clientName: g.clientName,
        tenantId: g.tenantId as string,
        firmName: firms.get(g.tenantId as string) ?? null,
        scopes: scopesOf(g.scopes),
        connectedAt: g.createdAt.toISOString(),
        lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
      }));
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/me/connected-apps/{grantId}',
      tags: ['Account'],
      summary: 'Stop an app acting for you in a firm (MUT-593)',
      description: 'Ends every connection of that app in that firm; its next call fails. Malafat asks you to reconnect if you use it again.',
      security: OWN,
      request: { params: GrantParams },
      responses: {
        204: { description: 'Disconnected' },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — no such live connection of yours, or Malafat access is switched off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      const grant = (await liveConnections(user.id, now)).find((g) => g.id === c.req.valid('param').grantId);
      if (!grant?.tenantId) throw new ApiError('NOT_FOUND', 'No such connection');
      const audit = await agentAuditFor(store)({ userId: user.id, action: 'user.agent_disconnected', metadata: { reason: 'user', clientName: grant.clientName, tenantId: grant.tenantId }, actor: { actorType: 'USER', actorId: user.id }, requestId: c.get('requestId') });
      await store.oauth.revokeForUserTenant({ userId: user.id, clientId: grant.clientId, tenantId: grant.tenantId, reason: 'user', at: now, audit });
      return c.body(null, 204);
    },
  );

  return app;
}
