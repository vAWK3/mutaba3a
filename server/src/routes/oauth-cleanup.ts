import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';

const DAY_MS = 86_400_000;
/** Tokens of a grant that ended (revoked, or past its 180 days) are kept a week, for support questions. */
export const OAUTH_TOKEN_RETENTION_MS = 7 * DAY_MS;
/** A registered client with no grant is deleted after 30 days; one that ever had a grant is kept (OV5). */
export const OAUTH_UNUSED_CLIENT_MS = 30 * DAY_MS;

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

const OAuthCleanupSummarySchema = z
  .object({ requests: z.number().int(), codes: z.number().int(), tokens: z.number().int(), clients: z.number().int() })
  .openapi('OAuthCleanupSummary');

/** MUT-434: the nightly OAuth housekeeping (Cloud Scheduler, oauth_cleanup in Terraform). Runs on the raw store, like the other jobs. */
export function oauthCleanupRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/oauth/cleanup',
      tags: ['Admin'],
      summary: 'Nightly OAuth housekeeping for MCP agents (Cloud Scheduler)',
      description: 'Deletes expired consent requests and codes, the tokens of grants that ended a week ago, and registered clients that never got a grant within 30 days. Answers counts only.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'What was deleted', content: { 'application/json': { schema: OAuthCleanupSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const at = c.get('now')();
      const summary = await store.oauth.cleanup({ at, before: new Date(at.getTime() - OAUTH_TOKEN_RETENTION_MS), clientsBefore: new Date(at.getTime() - OAUTH_UNUSED_CLIENT_MS) });
      return c.json(summary, 200);
    },
  );
  return app;
}
