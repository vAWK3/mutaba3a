import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { todayFor } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ListReceivablesQuerySchema, ReceivableIdParamSchema, ReceivablePageSchema, ReceivableSchema } from '../schemas.js';
import { serializeReceivable } from '../serializers.js';
import { encodeNextCursor, errorResponses, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

/** /v1/receivables — what is owed, with statuses computed in the organization timezone (M3 brief §2.3). */
export function receivableRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receivables',
      tags: ['Receivables'],
      summary: 'List receivables',
      description: 'Posted items only. Dated installments and retainer charges whose date has arrived are posted before the list is read.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { query: ListReceivablesQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ReceivablePageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const q = c.req.valid('query');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      const page = await store.receivables.list(
        organization.id,
        {
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.currency ? { currency: q.currency } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.dueBefore ? { dueBefore: q.dueBefore } : {}),
          ...(q.dueAfter ? { dueAfter: q.dueAfter } : {}),
        },
        toPageRequest(q),
      );
      return c.json({ items: page.items.map((r) => serializeReceivable(r, today)), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receivables/{receivableId}',
      tags: ['Receivables'],
      summary: 'Get a receivable',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: ReceivableIdParamSchema },
      responses: { 200: { description: 'The receivable', content: { 'application/json': { schema: ReceivableSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      if (!receivable) throw new ApiError('NOT_FOUND', 'No such receivable');
      return c.json(serializeReceivable(receivable, today), 200);
    },
  );

  return app;
}
