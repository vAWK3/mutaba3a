import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { runTrialMail, trialMailLinks, type TrialMailRunOptions } from '../billing/trial-mail.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, TrialMailRequestSchema, TrialMailRunSchema, TrialMailSummarySchema } from '../schemas.js';

/**
 * MUT-419 (ADR-182): the two doors to the daily trial-mail run (billing/trial-mail.ts), like MUT-360's reconcile.
 *
 *   POST /jobs/v1/billing/trial-mail    Cloud Scheduler, daily, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/billing/trial-mail   the operator (`npm run billing:trial-mail [-- --dry-run]`): counts and rows
 *
 * Both need Stripe (every mail's Subscribe link leads to it) and run on the unguarded store, like the Stripe sync.
 * Links use the portal's origin (PORTAL_ORIGIN), else the host the request came to, as every other mail does.
 */
export interface TrialMailRouteOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  portalOrigin: string | undefined;
  /** Stripe keys exist: without them Subscribe answers 503, so nothing is mailed. */
  billingConfigured: boolean;
  /** BILLING_GATE: off, nobody goes read-only or locks (R5). */
  gateOn: boolean;
  /** R11 (production): refuse a real operator run whose links would point at a loopback origin. */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function trialMailRoutes(options: TrialMailRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const run = (requestUrl: string, now: Date, dryRun: boolean) => {
    if (!options.billingConfigured) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server, so a trial mail could not be acted on');
    const origin = setupLinkOrigin(options.portalOrigin, requestUrl);
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    const runOptions: TrialMailRunOptions = { store: options.store, mailer: options.mailer, logger: options.logger, now, gateOn: options.gateOn, links: trialMailLinks(origin), dryRun };
    return runTrialMail(runOptions);
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/trial-mail',
      tags: ['Billing'],
      summary: 'Daily trial reminders (Cloud Scheduler)',
      description:
        'Mails each person in days 11–30 of an unpaid trial the reminder for the stage they are in: the trial ends within 3 days, ' +
        'it has ended (read-only), the account locks within 3 days. Each stage once per person; a second run the same day sends nothing ' +
        'new. Answers counts only. Always 200 once it ran; `incomplete` means its time budget ran out and the next run continues.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: TrialMailSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('BILLING_NOT_CONFIGURED or JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/trial-mail',
      tags: ['Admin'],
      summary: 'Run the trial reminders now, or see who they would mail',
      description:
        'The same run as the daily job, for the operator, with one row per person in a reminder window: their stage, and whether they ' +
        'are mailed or why not (paying, covered, other-profiles, suppressed, gate-off). `dryRun` mails nothing. In production a real run ' +
        'whose links would point at a local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: TrialMailRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        409: errorResponse('LINK_ORIGIN_LOOPBACK'),
        422: errorResponse('VALIDATION_FAILED'),
        503: errorResponse('BILLING_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const { dryRun } = c.req.valid('json');
      return c.json(await run(c.req.url, c.get('now')(), dryRun), 200);
    },
  );

  return app;
}
