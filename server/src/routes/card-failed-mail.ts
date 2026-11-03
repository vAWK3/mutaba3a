import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { runCardFailedMail } from '../billing/card-failed-mail.js';
import type { PlanGateway } from '../billing/stripe/plan-gateway.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { CardFailedMailRunSchema, CardFailedMailSummarySchema, ErrorEnvelopeSchema, TrialMailRequestSchema } from '../schemas.js';

/**
 * MUT-533 (D1, ADR-242): the two doors to the hourly failed-card mail (billing/card-failed-mail.ts), shaped like the
 * renewal notice's.
 *
 *   POST /jobs/v1/billing/card-failed-mail    Cloud Scheduler, hourly, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/billing/card-failed-mail   the operator (`npm run billing:card-failed-mail [-- --dry-run]`): counts and rows
 *
 * Both need Stripe: its open invoices decide who is mailed and which stage.
 */
export interface CardFailedMailRouteOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  portalOrigin: string | undefined;
  /** Null: no Stripe on this server; both doors answer 503 BILLING_NOT_CONFIGURED. */
  plan: PlanGateway | null;
  /** BILLING_RETRY_WINDOW_DAYS. */
  windowDays: number;
  /** The lapse gate is on, so the reminder may say an ended plan turns the account read-only. */
  gateOn: boolean;
  /** Production: refuse a real operator run whose links would point at a loopback origin (the trial mail's R11). */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function cardFailedMailRoutes(options: CardFailedMailRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const run = (requestUrl: string, now: Date, dryRun: boolean) => {
    const plan = options.plan;
    if (!plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server, so no failed payment can be checked');
    const origin = setupLinkOrigin(options.portalOrigin, requestUrl).replace(/\/+$/, '');
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    return runCardFailedMail({
      store: options.store,
      mailer: options.mailer,
      logger: options.logger,
      now,
      stripe: plan,
      updateLink: `${origin}/?billing=true`,
      windowDays: options.windowDays,
      readOnlyAfter: options.gateOn,
      dryRun,
    });
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/card-failed-mail',
      tags: ['Billing'],
      summary: 'Hourly failed-card mails (Cloud Scheduler)',
      description:
        'Mails the payer of each past_due subscription in their language: within 72 hours of the first failed attempt, that access stays ' +
        "open while Stripe retries, with a link to update the card; and one reminder from the retry window's midpoint while a retry is " +
        'booked. Stripe’s open invoices decide. Never more than two mails per failed invoice; a second run sends nothing new. Answers ' +
        'counts only. Always 200 once it ran; `incomplete` means its time budget ran out and the next run continues.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: CardFailedMailSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('BILLING_NOT_CONFIGURED or JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/card-failed-mail',
      tags: ['Admin'],
      summary: 'Run the failed-card mails now, or see who they would mail',
      description:
        'The same run as the hourly job, for the operator, with one row per past_due subscription: the stage it mails or why not (gone, ' +
        'not-past-due, settled, needs-authentication, no-stage, suppressed). `dryRun` mails nothing. In production a real run whose links ' +
        'would point at a local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: CardFailedMailRunSchema } } },
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
