import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { personSession, type AppEnv } from '../auth/middleware.js';
import { assertOperatorStepUp, operatorStepUpUntil } from '../auth/step-up.js';
import { todayIn, addDays, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import {
  ErrorEnvelopeSchema,
  OperatorAccountUsageSchema,
  OperatorUsageExportQuerySchema,
  OperatorUsageMonthQuerySchema,
  OperatorUsageOverviewSchema,
  OperatorUsagePeopleQuerySchema,
  OperatorUsagePeopleSchema,
  OperatorUsageRoutesQuerySchema,
  OperatorUsageRoutesSchema,
} from '../schemas.js';
import { USAGE_TIMEZONE, usageMonthOf } from '../usage/month.js';
import { accountUsage, overviewCsv, peopleCsv, routesCsv, usageOverview, usagePeople, usageRoutes, type UsagePerson } from '../usage/reports.js';

/**
 * MUT-735 (ADR-281): Operator › Usage, read from the usage ledger. Mounted behind the /v1 authenticate() and the
 * operator gate (a non-operator gets 404), on the unguarded base store like the rest of the console (the store guard
 * refuses the `operator` usage reads to every principal). Reads change nothing, so they need no step-up; the CSV export
 * leaves the system, so it does (RECENT_SIGN_IN_REQUIRED, like a write).
 *
 *   GET /v1/operator/usage/overview?month=                       per plan: payers, near / at / over a cap, events per kind
 *   GET /v1/operator/usage/people?month=&plan=&filter=&cursor=   the payers, keyset-paged (the upgrade leads)
 *   GET /v1/operator/accounts/{userId}/usage                     one account's last six months, per profile
 *   GET /v1/operator/usage/routes?from=&to=                      the busiest 50 routes: volume, errors, mean, p95
 *   GET /v1/operator/usage/export.csv?view=…                     the same rows as CSV, UTF-8 with a BOM
 */
export const OPERATOR_USAGE_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/operator/usage/overview',
  'GET /v1/operator/usage/people',
  'GET /v1/operator/accounts/:userId/usage',
  'GET /v1/operator/usage/routes',
  'GET /v1/operator/usage/export.csv',
]);

const SESSION = [{ session: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const operatorErrors = {
  401: errorResponse('Not signed in'),
  403: errorResponse('CROSS_SITE_REQUEST'),
  404: errorResponse('Not an operator'),
  422: errorResponse('Validation failed (a malformed month, day or cursor)'),
} as const;
/** The days the routes view covers by default, today included. */
const DEFAULT_ROUTE_DAYS = 7;
/** The most people one CSV export writes. */
const CSV_PEOPLE_MAX = 5000;

export function operatorUsageRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const stepUpUntilOf = (c: Context<AppEnv>) => operatorStepUpUntil(personSession(c).session, c.get('now')())?.toISOString() ?? null;
  const monthOf = (c: Context<AppEnv>, month: string | undefined) => month ?? usageMonthOf(c.get('now')());
  const rangeOf = (c: Context<AppEnv>, from: string | undefined, to: string | undefined): { from: IsoDate; to: IsoDate } => {
    const end = to ?? todayIn(USAGE_TIMEZONE, c.get('now')());
    const start = from ?? addDays(end, -(DEFAULT_ROUTE_DAYS - 1));
    if (start > end) throw new ApiError('VALIDATION_FAILED', '`from` is after `to`', { field: 'from' });
    return { from: start, to: end };
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/usage/overview',
      tags: ['Operator'],
      summary: 'Usage this month per plan: payers, how many are near, at or over a cap, and events per kind (MUT-735)',
      security: SESSION,
      request: { query: OperatorUsageMonthQuerySchema },
      responses: { 200: { description: 'The overview', content: { 'application/json': { schema: OperatorUsageOverviewSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const month = monthOf(c, c.req.valid('query').month);
      return c.json({ month, plans: await usageOverview(store, month), stepUpUntil: stepUpUntilOf(c) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/usage/people',
      tags: ['Operator'],
      summary: 'The payers with usage this month, filtered by plan and by near / capped / over, 50 a page (MUT-735)',
      security: SESSION,
      request: { query: OperatorUsagePeopleQuerySchema },
      responses: { 200: { description: 'A page of payers', content: { 'application/json': { schema: OperatorUsagePeopleSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const month = monthOf(c, q.month);
      const page = await usagePeople(store, { month, ...(q.plan ? { plan: q.plan } : {}), ...(q.filter ? { filter: q.filter } : {}), limit: q.limit, after: q.cursor ?? null });
      return c.json({ month, ...page, stepUpUntil: stepUpUntilOf(c) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/accounts/{userId}/usage',
      tags: ['Operator'],
      summary: "One account's last six months: documents and scans against the plan of each month, and per profile (MUT-735)",
      security: SESSION,
      request: { params: z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) }) },
      responses: { 200: { description: "The account's usage", content: { 'application/json': { schema: OperatorAccountUsageSchema } } }, ...operatorErrors, 404: errorResponse('Not an operator, or no such account') },
    }),
    async (c) => {
      const { userId } = c.req.valid('param');
      if (!(await store.users.getById(userId))) throw new ApiError('NOT_FOUND', 'No such account');
      return c.json({ ...(await accountUsage(store, userId, usageMonthOf(c.get('now')()))), stepUpUntil: stepUpUntilOf(c) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/usage/routes',
      tags: ['Operator'],
      summary: 'The busiest 50 routes over a range of days: requests, errors, mean and p95 duration (MUT-735)',
      security: SESSION,
      request: { query: OperatorUsageRoutesQuerySchema },
      responses: { 200: { description: 'The routes', content: { 'application/json': { schema: OperatorUsageRoutesSchema } } }, ...operatorErrors },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const range = rangeOf(c, q.from, q.to);
      return c.json({ ...range, routes: await usageRoutes(store, range.from, range.to), stepUpUntil: stepUpUntilOf(c) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/usage/export.csv',
      tags: ['Operator'],
      summary: 'One usage view as CSV, UTF-8 with a byte-order mark; needs a fresh passkey step-up (MUT-735)',
      security: SESSION,
      request: { query: OperatorUsageExportQuerySchema },
      responses: {
        200: { description: 'The CSV file', content: { 'text/csv': { schema: z.string() } } },
        ...operatorErrors,
        403: errorResponse('CROSS_SITE_REQUEST, or RECENT_SIGN_IN_REQUIRED `{ method: "passkey", windowMinutes }`: step up with the passkey first'),
      },
    }),
    async (c) => {
      // The data leaves the system: the same fresh step-up as a write (operator-gate.ts lets a GET through without one).
      assertOperatorStepUp(personSession(c).session, c.get('now')());
      const q = c.req.valid('query');
      const month = monthOf(c, q.month);
      let csv: string;
      let name: string;
      if (q.view === 'routes') {
        const range = rangeOf(c, q.from, q.to);
        csv = routesCsv(range.from, range.to, await usageRoutes(store, range.from, range.to));
        name = `usage-routes-${range.from}-${range.to}`;
      } else if (q.view === 'people') {
        const people: UsagePerson[] = [];
        let after: string | null = null;
        do {
          const page = await usagePeople(store, { month, ...(q.plan ? { plan: q.plan } : {}), ...(q.filter ? { filter: q.filter } : {}), limit: 100, after });
          people.push(...page.items);
          after = page.nextCursor;
        } while (after && people.length < CSV_PEOPLE_MAX);
        csv = peopleCsv(month, people);
        name = `usage-people-${month}`;
      } else {
        csv = overviewCsv(month, await usageOverview(store, month));
        name = `usage-overview-${month}`;
      }
      return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` });
    },
  );

  return app;
}
