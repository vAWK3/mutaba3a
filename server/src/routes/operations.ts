import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { OperationKeyParamSchema, OperationSchema } from '../schemas.js';
import { serializeOperation } from '../serializers.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

/** /v1/operations/{key} — reconcile an unknown outcome after a lost response (plan §12.7, §14.2; M4 brief decision 7). */
export function operationRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operations/{idempotencyKey}',
      tags: ['Payments'],
      summary: 'The stored outcome of an idempotent write',
      description: 'COMPLETED carries the response the original request received (2xx or 4xx, both final). PENDING means a request with this key is still running. 404 means the key was never claimed by this organization or was released after a server error — retrying with the same key is safe.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: OperationKeyParamSchema },
      responses: { 200: { description: 'The operation', content: { 'application/json': { schema: OperationSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const record = await store.idempotency.get(organization.id, c.req.valid('param').idempotencyKey);
      if (!record) throw new ApiError('NOT_FOUND', 'No operation with this key; retrying with the same key is safe');
      return c.json(serializeOperation(record), 200);
    },
  );

  return app;
}
