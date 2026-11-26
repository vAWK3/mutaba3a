import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, UsagePruneSummarySchema } from '../schemas.js';
import { pruneCutoffs, USAGE_RETENTION } from '../usage/retention.js';

/**
 * MUT-735 (ADR-281 §12): the daily prune of the usage ledger, by Cloud Scheduler with the job token. Deletes events
 * older than this month and the 12 before it, counters older than 25 months and route statistics older than 90 days.
 * Answers counts only; a second run the same day deletes nothing new.
 */
export function usagePruneRoutes(options: { store: LedgerStore; logger: Pick<Logger, 'info'> }): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/usage/prune',
      tags: ['Operator'],
      summary: 'Daily usage retention: events 13 months, counters 25 months, route statistics 90 days (Cloud Scheduler)',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'What was deleted, and the cut-offs', content: { 'application/json': { schema: UsagePruneSummarySchema } } },
        401: { description: 'JOB_UNAUTHORIZED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        503: { description: 'JOBS_NOT_CONFIGURED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      },
    }),
    async (c) => {
      const { today, ...before } = pruneCutoffs(c.get('now')());
      const deleted = await options.store.usage.prune(before);
      options.logger.info({ job: 'usage-prune', today, ...before, ...deleted }, 'usage pruned');
      return c.json({ deleted, before, retention: USAGE_RETENTION }, 200);
    },
  );
  return app;
}
