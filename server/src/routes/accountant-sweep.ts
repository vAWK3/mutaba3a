import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { runUnclaimedSweep } from '../accountants/unclaimed-sweep.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { PushService } from '../push/service.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, UnclaimedSweepSummarySchema } from '../schemas.js';

/**
 * MUT-767 (ADR-300): the daily sweep of unclaimed provisioned accounts (accountants/unclaimed-sweep.ts), by Cloud
 * Scheduler with the job token, on the unguarded store. Counts only, never an address. 404 while
 * ACCOUNTANT_PROVISIONING is off (`enabled`), after the job token.
 */
export function accountantSweepRoutes(options: { store: LedgerStore; mailer: Mailer; logger: Logger; settings: SessionSettings; enabled: boolean; push?: PushService }): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/accountants/unclaimed-sweep',
      tags: ['Accountants'],
      summary: 'Daily: reminders for accounts an accountant created that nobody claimed, and removal of the unpaid ones after 60 days (Cloud Scheduler)',
      description:
        'Customer reminders on days 3, 10, 30 and 53 (a fresh 14-day link, the same claim code), one digest a day per accountant (with a phone push the same day when the accountant has a device, MUT-780), and on day 60 an unpaid account is closed with its grace over so the hourly purge deletes it with its Stripe customers; a paid one is kept and counted `flagged`. A second run the same day does nothing more. Additive since 1.170.0-mut767.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: UnclaimedSweepSummarySchema } } },
        401: { description: 'JOB_UNAUTHORIZED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        404: { description: 'The feature is off on this server', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        503: { description: 'JOBS_NOT_CONFIGURED', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      },
    }),
    async (c) => {
      if (!options.enabled) throw new ApiError('NOT_FOUND', 'Not found');
      const now = c.get('now')();
      const summary = await runUnclaimedSweep({ store: options.store, mailer: options.mailer, logger: options.logger, pepper: options.settings.pepper, ...(options.push ? { push: options.push } : {}), origin: setupLinkOrigin(options.settings.portalOrigin, c.req.url), now });
      options.logger.info({ job: 'accountant-unclaimed-sweep', ...summary }, 'unclaimed accounts swept');
      return c.json(summary, 200);
    },
  );
  return app;
}
