import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { setupLinkOrigin } from '../auth/account-setup.js';
import type { AppEnv } from '../auth/middleware.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import { runReconnectReminders } from '../israel/tax-authority/reconnect-reminder.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, TaxAuthorityReminderRunSchema, TaxAuthorityReminderSummarySchema, TrialMailRequestSchema } from '../schemas.js';

/**
 * MUT-571 AC3: the two doors to the daily Tax Authority re-consent reminders (israel/tax-authority/reconnect-reminder.ts),
 * shaped like the failed-card mail's.
 *
 *   POST /jobs/v1/issuing/tax-authority-reminders    Cloud Scheduler, daily, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/issuing/tax-authority-reminders   the operator: counts and one row per profile, `dryRun` mails nothing
 *
 * A server with no Tax Authority connection configured has no connection of its own to remind: both answer an empty run.
 */
export interface TaxAuthorityReminderRouteOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  portalOrigin: string | undefined;
  /** TAX_AUTHORITY_ENV (sandbox | production); null where the connection isn't configured. */
  environment: string | null;
  /** Production: refuse a real operator run whose links would point at a loopback origin (the trial mail's R11). */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const EMPTY = (dryRun: boolean) => ({ summary: { dryRun, checked: 0, due: 0, sent: 0, duplicate: 0, notSent: 0, skipped: 0 }, rows: [] });

export function taxAuthorityReminderRoutes(options: TaxAuthorityReminderRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const run = async (requestUrl: string, now: Date, dryRun: boolean) => {
    if (!options.environment) return EMPTY(dryRun);
    const origin = setupLinkOrigin(options.portalOrigin, requestUrl).replace(/\/+$/, '');
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    return runReconnectReminders({ store: options.store, mailer: options.mailer, logger: options.logger, now, environment: options.environment, portalOrigin: origin, dryRun });
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/issuing/tax-authority-reminders',
      tags: ['Issuing'],
      summary: 'Daily Tax Authority re-consent reminders (Cloud Scheduler)',
      description:
        'MUT-571 AC3. The Tax Authority consent lasts 90 days. Mails the owner of each connected profile, in their language: once when it ends ' +
        'within 10 days, and once when it has ended (for 7 days after), each with a link to connect again. Each stage is sent once per ' +
        'consent (the send log), so a retry or a second run sends nothing new. Answers counts only; an empty run where the Tax Authority ' +
        'connection is not configured.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: TaxAuthorityReminderSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/issuing/tax-authority-reminders',
      tags: ['Admin'],
      summary: 'Run the Tax Authority re-consent reminders now, or see who they would mail',
      description:
        'The same run as the daily job, for the operator, with one row per profile looked at: the stage it mails or why not. `dryRun` mails ' +
        'nothing. In production a real run whose links would point at a local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: TaxAuthorityReminderRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        409: errorResponse('LINK_ORIGIN_LOOPBACK'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => {
      const { dryRun } = c.req.valid('json');
      return c.json(await run(c.req.url, c.get('now')(), dryRun), 200);
    },
  );

  return app;
}
