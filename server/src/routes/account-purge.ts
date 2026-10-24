import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { runAccountPurge } from '../accounts/purge-run.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import type { AppEnv } from '../auth/middleware.js';
import type { AccountStripeGateway } from '../billing/stripe/account-gateway.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { AccountPurgeRequestSchema, AccountPurgeRunSchema, AccountPurgeSummarySchema, ErrorEnvelopeSchema } from '../schemas.js';

/**
 * MUT-333 (ADR-188, D11): the two doors to the hard delete of closed accounts (accounts/purge-run.ts), the MUT-419 shape.
 *
 *   POST /jobs/v1/accounts/purge     Cloud Scheduler, hourly, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/accounts/purge    the operator (`npm run accounts:purge [-- --dry-run]`): counts and rows
 *
 * Both run on the unguarded store (a job, not a principal's request). Neither needs Stripe: a person with a Stripe
 * customer waits (skipped, alerted) until it is configured.
 */
export interface AccountPurgeRouteOptions {
  store: LedgerStore;
  stripe: AccountStripeGateway | null;
  storage: AttachmentStorage | null;
  logger: Logger;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const DESCRIPTION =
  'Deletes every account whose 30 days of grace have run out: its Stripe customers, every profile it created (a business profile with a ' +
  'co-owner passes to them instead), its records and its files, and every row naming the person; its records on profiles it belonged to stay, ' +
  'anonymized. At most 25 accounts a run, about 200 s; `incomplete` means the next run continues. A person Stripe fails for is retried next run.';

export function accountPurgeRoutes(options: AccountPurgeRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const run = (now: Date, dryRun: boolean) => runAccountPurge({ store: options.store, stripe: options.stripe, storage: options.storage, logger: options.logger, now, dryRun });

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/accounts/purge',
      tags: ['Admin'],
      summary: 'Hourly hard delete of closed accounts (Cloud Scheduler)',
      description: `${DESCRIPTION} Answers counts only; always 200 once it ran.`,
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: AccountPurgeSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/accounts/purge',
      tags: ['Admin'],
      summary: 'Run the hard delete of closed accounts now, or see what it would do',
      description: `${DESCRIPTION} One row per due account. \`dryRun\` claims, deletes and calls nothing.`,
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: AccountPurgeRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: AccountPurgeRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => c.json(await run(c.get('now')(), c.req.valid('json').dryRun), 200),
  );

  return app;
}
