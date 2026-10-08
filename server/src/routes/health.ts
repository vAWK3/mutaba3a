import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';
import { HealthSchema, ReadySchema } from '../schemas.js';

export function healthRoutes(store: LedgerStore, version: string): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/health',
      tags: ['Operations'],
      summary: 'Liveness',
      responses: { 200: { description: 'Process is up', content: { 'application/json': { schema: HealthSchema } } } },
    }),
    (c) => c.json({ status: 'ok' as const, version, time: c.get('now')().toISOString() }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/ready',
      tags: ['Operations'],
      summary: 'Readiness (database reachable)',
      responses: {
        200: { description: 'Ready', content: { 'application/json': { schema: ReadySchema } } },
        503: { description: 'Not ready', content: { 'application/json': { schema: ReadySchema } } },
      },
    }),
    async (c) => {
      try {
        await store.ping();
        return c.json({ status: 'ready' as const, checks: { database: 'ok' as const } }, 200);
      } catch {
        return c.json({ status: 'not_ready' as const, checks: { database: 'failed' as const } }, 503);
      }
    },
  );

  return app;
}
