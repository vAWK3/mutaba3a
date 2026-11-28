import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { setupLinkOrigin } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, VatPeriodSweepSummarySchema } from '../schemas.js';
import { runVatPeriodSweep } from '../vat-periods/run.js';

/**
 * MUT-782 (ADR-343): the daily VAT period sweep (vat-periods/run.ts), by Cloud Scheduler with the job token, on the
 * unguarded store. Counts only, never an address. 404 while VAT_PERIOD_REMINDERS is off (`enabled`), after the job token.
 */
export function vatPeriodSweepRoutes(options: { store: LedgerStore; mailer: Mailer; logger: Logger; settings: SessionSettings; enabled: boolean }): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/vat-periods/sweep',
      tags: ['VAT periods'],
      summary: 'Daily: announce the VAT periods that ended, follow up, and mail each accountant one digest (Cloud Scheduler)',
      description:
        'On the first day after a client\'s VAT period ends (in the profile\'s own zone), every owner is asked whether all receipts are sent and each accountant gets one digest; a period that ended more than 10 days ago is never announced. The client is reminded once, 5 days later, while the period is still open (and 5 days after each Ask for more). A second run the same day does nothing more. Additive since 1.215.0-mut782.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: VatPeriodSweepSummarySchema } } },
        401: { description: 'JOB_UNAUTHORIZED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        404: { description: 'The feature is off on this server', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        503: { description: 'JOBS_NOT_CONFIGURED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      },
    }),
    async (c) => {
      if (!options.enabled) throw new ApiError('NOT_FOUND', 'Not found');
      const summary = await runVatPeriodSweep({ store: options.store, mailer: options.mailer, logger: options.logger, origin: setupLinkOrigin(options.settings.portalOrigin, c.req.url), now: c.get('now')() });
      options.logger.info({ job: 'vat-period-sweep', ...summary }, 'VAT periods swept');
      return c.json(summary, 200);
    },
  );
  return app;
}
