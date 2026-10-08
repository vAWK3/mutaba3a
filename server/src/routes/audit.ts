import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';
import { AuditPageSchema, ListAuditQuerySchema } from '../schemas.js';
import { serializeAuditEvent } from '../serializers.js';
import { encodeNextCursor, errorResponses, toPageRequest, validationResponse } from './shared.js';

/** /v1/audit — the organization's financial history for API keys (M6 brief §2). */
export function auditRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/audit',
      tags: ['Audit'],
      summary: 'List audit events, oldest first, filtered by entity or action',
      description: 'entityType is the API’s entity name (payment, receivable, agreement, installment, retainer_charge, customer, project, attachment, …); entityId its id. Keyset pagination like every list.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('audit:read')] as const,
      request: { query: ListAuditQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: AuditPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const page = await store.audit.list(organization.id, { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.action ? { action: q.action } : {}) }, toPageRequest(q));
      return c.json({ items: page.items.map(serializeAuditEvent), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  return app;
}
