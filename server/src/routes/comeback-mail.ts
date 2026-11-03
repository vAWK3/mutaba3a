import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { runComebackMail } from '../billing/comeback-mail.js';
import { comebackOfferOrNothing } from '../billing/comeback-read.js';
import { OFFERS, type OfferEntry } from '../billing/offer.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import type { PlanGateway } from '../billing/stripe/plan-gateway.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ComebackMailRunSchema, ComebackMailSummarySchema, ErrorEnvelopeSchema, TrialMailRequestSchema } from '../schemas.js';

/**
 * MUT-534 (D11, ADR-243): the two doors to the daily come-back mail (billing/comeback-mail.ts), shaped like the
 * renewal notice's.
 *
 *   POST /jobs/v1/billing/comeback-mail    Cloud Scheduler, daily, X-Job-Token: counts only, no address in its logs
 *   POST /admin/v1/billing/comeback-mail   the operator (`npm run billing:comeback-mail [-- --dry-run]`): counts and rows
 *
 * Both need Stripe: the coupon and the catalog make the prices, and the paid-invoice count proves a paid lapse.
 */
export interface ComebackMailRouteOptions {
  /** The unguarded store: a job, not a principal's request. */
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  portalOrigin: string | undefined;
  /** Null (either): no Stripe on this server; both doors answer 503 BILLING_NOT_CONFIGURED. */
  checkout: CheckoutGateway | null;
  plan: PlanGateway | null;
  offers?: readonly OfferEntry[];
  /** Production: refuse a real operator run whose links would point at a loopback origin (the trial mail's R11). */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function comebackMailRoutes(options: ComebackMailRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const run = (requestUrl: string, now: Date, dryRun: boolean) => {
    const { checkout, plan } = options;
    if (!checkout || !plan) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server, so no come-back offer can be made');
    const offers = options.offers ?? OFFERS;
    const origin = setupLinkOrigin(options.portalOrigin, requestUrl).replace(/\/+$/, '');
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    return runComebackMail({
      store: options.store,
      mailer: options.mailer,
      logger: options.logger,
      now,
      stripe: { offer: () => comebackOfferOrNothing(checkout, offers, options.logger), paidInvoices: (id) => plan.paidInvoiceCount(id, { fresh: true }) },
      subscribeLink: `${origin}/?billing=true&step=subscribe`,
      offers,
      dryRun,
    });
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/comeback-mail',
      tags: ['Billing'],
      summary: 'Daily come-back mails (Cloud Scheduler)',
      description:
        'Mails each person whose latest paid Freelancer plan Stripe ended 30–44 or 90–104 days ago, in their language: their records are ' +
        'still there, and the first month back costs the list price less the come-back coupon. Each stage is recorded once per person, ' +
        'ever, and that record opens the offer at Checkout. Answers counts only. Always 200 once it ran; `incomplete` means its time ' +
        'budget ran out and the next run continues.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: ComebackMailSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('BILLING_NOT_CONFIGURED or JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false)).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/comeback-mail',
      tags: ['Admin'],
      summary: 'Run the come-back mails now, or see who they would mail',
      description:
        'The same run as the daily job, for the operator, with one row per lapsed person: the stage it mails or why not. `dryRun` mails ' +
        'and records nothing. In production a real run whose links would point at a local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: ComebackMailRunSchema } } },
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
