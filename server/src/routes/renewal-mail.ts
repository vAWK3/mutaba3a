import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { runRenewalMail } from '../billing/renewal-mail.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, RenewalMailRunSchema, RenewalMailSummarySchema, TrialMailRequestSchema } from '../schemas.js';

/**
 * MUT-525 (DD8, ADR-237): the two doors to the daily pre-renewal notice (billing/renewal-mail.ts), shaped like MUT-419's
 * trial mail.
 *
 *   POST /jobs/v1/billing/renewal-mail    Cloud Scheduler, daily, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/billing/renewal-mail   the operator (`npm run billing:renewal-mail [-- --dry-run]`): counts and rows
 *
 * Both need Stripe: Stripe's own subscription decides who is told and at what price.
 */
export interface RenewalMailRouteOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  portalOrigin: string | undefined;
  /** Null: no Stripe on this server; both doors answer 503 BILLING_NOT_CONFIGURED. */
  checkout: CheckoutGateway | null;
  /** Production: refuse a real operator run whose links would point at a loopback origin (the trial mail's R11). */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function renewalMailRoutes(options: RenewalMailRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const run = (requestUrl: string, now: Date, dryRun: boolean) => {
    const checkout = options.checkout;
    if (!checkout) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server, so no renewal can be checked');
    const origin = setupLinkOrigin(options.portalOrigin, requestUrl).replace(/\/+$/, '');
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    return runRenewalMail({ store: options.store, mailer: options.mailer, logger: options.logger, now, stripe: checkout, manageLink: `${origin}/?billing=true`, dryRun });
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/renewal-mail',
      tags: ['Billing'],
      summary: 'Daily launch-offer renewal notices (Cloud Scheduler)',
      description:
        'Mails the payer of each launch-offer subscription whose first renewal is within 30 days: the day, the yearly price it renews at ' +
        "and how to cancel. Stripe's own subscription decides (active, not cancelling, first paid year, a list price). Once per " +
        'subscription and renewal day; a second run sends nothing new. Answers counts only. Always 200 once it ran; `incomplete` means ' +
        'its time budget ran out and the next run continues.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: RenewalMailSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('BILLING_NOT_CONFIGURED or JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/renewal-mail',
      tags: ['Admin'],
      summary: 'Run the launch-offer renewal notices now, or see who they would mail',
      description:
        'The same run as the daily job, for the operator, with one row per subscription in the window: whether it is mailed or why not ' +
        '(gone, not-active, cancelling, not-first-year, not-list-price, suppressed). `dryRun` mails nothing. In production a real run whose ' +
        'links would point at a local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: RenewalMailRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        409: errorResponse('LINK_ORIGIN_LOOPBACK'),
        422: errorResponse('VALIDATION_FAILED'),
        503: errorResponse('BILLING_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const { dryRun } = c.req.valid('json');
      const { summary, rows } = await run(c.req.url, c.get('now')(), dryRun);
      return c.json({ summary, rows: rows.map((r) => ({ ...r, renewsAt: r.renewsAt.toISOString() })) }, 200);
    },
  );

  return app;
}
