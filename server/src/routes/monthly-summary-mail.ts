import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setupLinkOrigin } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp } from '../auth/sessions.js';
import { choiceForSwitch, mailProfilesOf } from '../billing/monthly-summary.js';
import { coveredProfilesOf, MONTHLY_SUMMARY_DAILY_SENDS, runMonthlySummaryMail } from '../billing/monthly-summary-mail.js';
import type { CheckoutGateway } from '../billing/stripe/checkout-gateway.js';
import type { PlanGateway } from '../billing/stripe/plan-gateway.js';
import { offerCatalogsOf } from '../billing/yearly-switch-line.js';
import { verifyMailOffToken } from '../email/mail-off-token.js';
import { verifyUnsubscribeToken } from '../email/unsubscribe.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, MailOffRequestSchema, MonthlySummaryMailChangeSchema, MonthlySummaryMailRunSchema, MonthlySummaryMailSchema, MonthlySummaryMailSummarySchema, OfferMailSchema, TrialMailRequestSchema, UnsubscribedSchema, UnsubscribeQuerySchema } from '../schemas.js';

/**
 * MUT-535 (plan D6–D8, D12, D13; ADR-259): the monthly summary mail's doors.
 *
 *   POST /jobs/v1/billing/monthly-summary-mail     Cloud Scheduler, days 1–7, X-Job-Token: counts only
 *   POST /admin/v1/billing/monthly-summary-mail    the operator (`npm run billing:monthly-summary-mail [-- --dry-run]`)
 *   GET|PATCH /v1/me/monthly-summary-mail          You › Account's switch (a session)
 *   POST /v1/mail-preferences/monthly-summary      the mail's opt-out page (public; the signed token is the credential)
 *   POST /v1/mail-preferences/offers               ADR-279: the same page for promotional mail (the come-back offer)
 *   POST /v1/mail-preferences/unsubscribe          ADR-279: a mail client's one-click unsubscribe (RFC 8058), either mail
 *
 * Without Stripe the run still mails, with no yearly line (D9).
 */
export const MONTHLY_SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me/monthly-summary-mail', 'PATCH /v1/me/monthly-summary-mail']);

export interface MonthlySummaryMailRouteOptions {
  /** The unguarded store: the job and the token door act for no session. */
  store: LedgerStore;
  /** The guarded store, for You › Account's switch (a session's own identity row). */
  sessionStore: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  settings: SessionSettings;
  /** The sign-in IP limiter, under its own key, for the public opt-out door. */
  ipLimiter: RateLimiter;
  checkout: CheckoutGateway | null;
  plan: PlanGateway | null;
  /** MONTHLY_SUMMARY_DAILY_SENDS (D12). */
  sendBudget?: number;
  /** Production: refuse a real operator run whose links would point at a loopback origin (the trial mail's R11). */
  refuseLoopbackLinks: boolean;
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const SESSION = [{ session: [] }, { deviceSession: [] }];

export function monthlySummaryMailRoutes(options: MonthlySummaryMailRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const { store, settings } = options;

  const run = (requestUrl: string, now: Date, dryRun: boolean, invoicingForAll: boolean) => {
    const origin = setupLinkOrigin(settings.portalOrigin, requestUrl).replace(/\/+$/, '');
    if (!dryRun && options.refuseLoopbackLinks && LOOPBACK.test(origin)) {
      throw new ApiError('LINK_ORIGIN_LOOPBACK', 'These mails would link to a local address; set PORTAL_ORIGIN or call the service by its public URL', { origin });
    }
    const { checkout, plan } = options;
    return runMonthlySummaryMail({
      store,
      mailer: options.mailer,
      logger: options.logger,
      now,
      portalOrigin: origin,
      pepper: settings.pepper,
      stripe: checkout && plan ? { catalog: () => offerCatalogsOf(checkout), plan } : null,
      dryRun,
      invoicingForAll,
      sendBudget: options.sendBudget ?? MONTHLY_SUMMARY_DAILY_SENDS,
    });
  };

  /** D7: what the switch shows, from the same covered profiles the run reads. */
  const switchView = async (on: LedgerStore, user: UserRecord, now: Date) => ({ on: mailProfilesOf(user.monthlySummaryMail, await coveredProfilesOf(on, user.id, now)).length > 0 });

  /** D7 (R5): what turning it on or off stores, then what the switch now shows. */
  const setSwitch = async (on: LedgerStore, userId: string, switchOn: boolean, now: Date) => {
    const choice = choiceForSwitch(switchOn, await coveredProfilesOf(on, userId, now));
    const user = await on.users.setMonthlySummaryMail(userId, choice, now);
    if (!user) throw new ApiError('NOT_FOUND', 'No such person');
    options.logger.info({ userId, monthlySummaryMail: choice ?? 'DEFAULT' }, 'monthly summary choice changed');
    return switchView(on, user, now);
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/monthly-summary-mail',
      tags: ['Billing'],
      summary: 'Monthly summary mails (Cloud Scheduler, days 1–7)',
      description:
        'MUT-535 (ADR-259). Mails each person who pays or trials, in their language, one summary of the month before: per profile their plan ' +
        'covers and per currency, what came in, what is still owed and what is overdue, read as Reports reads them. Sends at most ' +
        '`MONTHLY_SUMMARY_DAILY_SENDS` per run and stops at the first mail the daily cap refuses; each person is mailed once a month. Answers ' +
        'counts only. Always 200 once it ran; `incomplete` means the next run continues.',
      security: [{ jobToken: [] }],
      responses: {
        200: { description: 'The run’s counts', content: { 'application/json': { schema: MonthlySummaryMailSummarySchema } } },
        401: errorResponse('JOB_UNAUTHORIZED'),
        503: errorResponse('JOBS_NOT_CONFIGURED'),
      },
    }),
    async (c) => c.json((await run(c.req.url, c.get('now')(), false, c.get('invoicingForAll'))).summary, 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/monthly-summary-mail',
      tags: ['Admin'],
      summary: 'Run the monthly summary mails now, or see who they would mail',
      description:
        'The same run as the job, for the operator, with one row per person looked at: how many panels it mails, or why not. `dryRun` mails ' +
        'and writes nothing (it doesn’t post due installments, so owed can lag by them). In production a real run whose links would point at a ' +
        'local address is refused (409 LINK_ORIGIN_LOOPBACK).',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: TrialMailRequestSchema } } } },
      responses: {
        200: { description: 'The run', content: { 'application/json': { schema: MonthlySummaryMailRunSchema } } },
        401: errorResponse('Missing or invalid admin token'),
        409: errorResponse('LINK_ORIGIN_LOOPBACK'),
        422: errorResponse('VALIDATION_FAILED'),
      },
    }),
    async (c) => {
      const { dryRun } = c.req.valid('json');
      return c.json(await run(c.req.url, c.get('now')(), dryRun, c.get('invoicingForAll')), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me/monthly-summary-mail',
      tags: ['Sessions'],
      summary: 'Whether the monthly summary mail reaches you (MUT-535)',
      description: '`on` is true when next month’s run would mail you, given a month with something to show: you haven’t turned it off and your plan covers a profile (Malafat-covered profiles only if you turned it on yourself). Person-level: no X-Mutaba3a-Profile.',
      security: SESSION,
      responses: {
        200: { description: 'The switch', content: { 'application/json': { schema: MonthlySummaryMailSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => c.json(await switchView(options.sessionStore, c.get('identity').user, c.get('now')()), 200),
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/me/monthly-summary-mail',
      tags: ['Sessions'],
      summary: 'Turn the monthly summary mail on or off (MUT-535)',
      description:
        'Off stops it. On returns to the default (every profile your plan covers except Malafat-covered ones), or includes Malafat-covered ' +
        'profiles when they are all you have. Idempotent, so no Idempotency-Key; writes no audit row (a preference, not an event a firm sees).',
      security: SESSION,
      request: { body: { required: true, content: { 'application/json': { schema: MonthlySummaryMailChangeSchema } } } },
      responses: {
        200: { description: 'The switch now', content: { 'application/json': { schema: MonthlySummaryMailSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED or CROSS_SITE_REQUEST'),
        422: errorResponse('Invalid body'),
      },
    }),
    async (c) => c.json(await setSwitch(options.sessionStore, c.get('identity').user.id, c.req.valid('json').on, c.get('now')()), 200),
  );

  /** The opt-out page is the one caller: same origin only, then the client address's budget, before the token is read. */
  async function publicGuard(c: Context<AppEnv>): Promise<Date> {
    if (!isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Open the link from the MTB3A portal itself');
    const now = c.get('now')();
    const ip = await options.ipLimiter.check(`mail-off:${requestClientIp((name) => c.req.header(name), settings)}`, now);
    if (!ip.allowed) {
      c.header('Retry-After', String(ip.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
    }
    return now;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/mail-preferences/monthly-summary',
      tags: ['Sessions'],
      summary: 'Turn the monthly summary mail off (or back on) from its link (MUT-535)',
      description:
        'D8: the token from the mail link’s fragment, in the body; it names one person and does nothing but this switch. The page asks for a ' +
        'press first, so a link scanner opening the mail changes nothing. An unknown or voided token (the session pepper rotated) answers 404.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: MailOffRequestSchema } } } },
      responses: {
        200: { description: 'The switch now', content: { 'application/json': { schema: MonthlySummaryMailSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        404: errorResponse('NOT_FOUND: the link no longer works'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const { token, on } = c.req.valid('json');
      const userId = verifyMailOffToken(settings.pepper, token);
      const person = userId ? await store.users.getById(userId) : null;
      if (!person || person.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 'This link no longer works');
      return c.json(await setSwitch(store, person.id, on, now), 200);
    },
  );

  /** ADR-279: the person a token names, if they are active; anything else is a link that no longer works. */
  async function personOf(token: string) {
    const userId = verifyMailOffToken(settings.pepper, token);
    const person = userId ? await store.users.getById(userId) : null;
    if (!person || person.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 'This link no longer works');
    return person;
  }

  const setOffers = async (userId: string, on: boolean, now: Date) => {
    const user = await store.users.setOfferMail(userId, on ? null : 'OFF', now);
    if (!user) throw new ApiError('NOT_FOUND', 'No such person');
    options.logger.info({ userId, offerMail: user.offerMail ?? 'DEFAULT' }, 'offer mail choice changed');
    return { on: user.offerMail !== 'OFF' };
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/mail-preferences/offers',
      tags: ['Sessions'],
      summary: 'Turn promotional mail off (or back on) from its link (ADR-279)',
      description:
        'Since 1.140.0. The come-back offer’s unsubscribe page: the token from the link’s fragment, as the monthly summary’s. It switches only ' +
        'promotional mail; mail about the account keeps coming. An unknown or voided token answers 404.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: MailOffRequestSchema } } } },
      responses: {
        200: { description: 'Promotional mail now', content: { 'application/json': { schema: OfferMailSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        404: errorResponse('NOT_FOUND: the link no longer works'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const { token, on } = c.req.valid('json');
      return c.json(await setOffers((await personOf(token)).id, on, now), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/mail-preferences/unsubscribe',
      tags: ['Sessions'],
      summary: 'One-click unsubscribe from a mail client (RFC 8058, ADR-279)',
      description:
        'Since 1.140.0. The List-Unsubscribe URL of the come-back offer (`mail=offers`) and the monthly summary (`mail=monthly-summary`). A ' +
        'mail client posts `List-Unsubscribe=One-Click` with no page and no origin, so there is no same-origin check. RFC 8058 puts the recipient ' +
        'in the URL, so its token is its own: signed for one person and one mail, it can only turn that mail off (never the mail-off page’s ' +
        'token). The client address’s budget applies.',
      security: [],
      request: { query: UnsubscribeQuerySchema },
      responses: {
        200: { description: 'Unsubscribed', content: { 'application/json': { schema: UnsubscribedSchema } } },
        404: errorResponse('NOT_FOUND: the link no longer works'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = c.get('now')();
      const ip = await options.ipLimiter.check(`mail-off:${requestClientIp((name) => c.req.header(name), settings)}`, now);
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      const { mail, token } = c.req.valid('query');
      const userId = verifyUnsubscribeToken(settings.pepper, mail, token);
      const person = userId ? await store.users.getById(userId) : null;
      if (!person || person.status !== 'ACTIVE') throw new ApiError('NOT_FOUND', 'This link no longer works');
      if (mail === 'offers') await setOffers(person.id, false, now);
      else await setSwitch(store, person.id, false, now);
      return c.json({ unsubscribed: true as const }, 200);
    },
  );

  return app;
}
