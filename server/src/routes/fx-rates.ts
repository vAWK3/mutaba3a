import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { requestClientIp } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { crossRates, MAX_RATE_AGE_DAYS, type CachedFxRates } from '../fx-rates.js';
import type { RateLimiter } from '../rate-limit.js';
import { ErrorEnvelopeSchema, FxRatesQuerySchema, FxRatesResponseSchema, PublicFxRatesResponseSchema } from '../schemas.js';
import { errorResponses, validationResponse } from './shared.js';

/** Reference rates read no organization's data, like GET /v1/me: no X-Mutaba3a-Profile. */
export const FX_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/fx-rates']);

/** /v1/fx-rates (MUT-228, ADR-087). `rates` null = no rate source configured: the route answers 503 FX_RATES_UNAVAILABLE. */
export function fxRateRoutes(rates: CachedFxRates | null): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/fx-rates',
      tags: ['Exchange rates'],
      summary: 'Reference exchange rates for every supported currency against a base, for display',
      description:
        'ECB reference rates (via Frankfurter), cached per server instance for FX_RATES_TTL_MINUTES. JOD is derived from the USD peg. ' +
        `Rates whose ECB rate date is more than ${MAX_RATE_AGE_DAYS} days old (or more than a day in the future) are never served. ` +
        'When a refresh fails the last good rates come back with source=stale while they are within that age; with nothing servable cached the route answers 503 FX_RATES_UNAVAILABLE, never a zero rate. ' +
        'Display only: no record stores these rates.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { query: FxRatesQuerySchema },
      responses: {
        200: { description: 'Rates', content: { 'application/json': { schema: FxRatesResponseSchema } } },
        503: {
          description: `No rates to serve: the provider is down or answered with an unusable rate date, and this instance has nothing cached within ${MAX_RATE_AGE_DAYS} days of its rate date; or no rate source is configured`,
          content: { 'application/json': { schema: ErrorEnvelopeSchema } },
        },
        ...validationResponse,
        ...errorResponses,
      },
    }),
    async (c) => {
      const { base } = c.req.valid('query');
      if (!rates) throw new ApiError('FX_RATES_UNAVAILABLE', 'Exchange rates are not configured on this server');
      const reading = await rates.get();
      return c.json(
        {
          base,
          rateDate: reading.snapshot.rateDate,
          fetchedAt: reading.fetchedAt.toISOString(),
          source: reading.source,
          rates: crossRates(reading.snapshot, base),
        },
        200,
      );
    },
  );

  return app;
}

/** The anonymous snapshot route; the portal's signed-out FX source (`src/hosted/local/fxSource.ts`) fetches exactly this path. */
export const PUBLIC_FX_RATES_PATH = '/v1/public/fx-rates';

/**
 * Per address per minute. A signed-out device asks about once an hour (its
 * page cache, seeded from the snapshot it last saved), but many people can
 * share one address (mobile carriers, offices): roomy enough for them, still
 * a wall for a scraper (MUT-287 review D8).
 */
export const PUBLIC_FX_POLICY = { ipPerMinute: 120 } as const;

export interface PublicFxRateRouteOptions {
  rates: CachedFxRates | null;
  ipLimiter: RateLimiter;
  trustedProxyHops: number;
  /** MUT-326: requests through the front door are keyed by the address it hands over. */
  frontDoorToken?: string;
}

/**
 * /v1/public/fx-rates (MUT-287; MUT-285 D3, ADR-097 §7). Anonymous and
 * profile-free: the cached ECB snapshot itself, so the portal's signed-out
 * backend feeds it to its own CachedFxRates and runs the same crossRates, JOD
 * peg and staleness rules as /v1/fx-rates. Never in PORTAL_ROUTES: the portal
 * client doesn't call it, and the local app must not serve it.
 */
export function publicFxRateRoutes(options: PublicFxRateRouteOptions): OpenAPIHono<AppEnv> {
  const { rates, ipLimiter } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: PUBLIC_FX_RATES_PATH,
      tags: ['Exchange rates'],
      summary: 'The ECB reference snapshot behind /v1/fx-rates, with no session',
      description:
        'Public market data for the portal used signed out, which computes cross rates itself. Same cache, age rules and 503 as /v1/fx-rates; ' +
        `rate-limited to ${PUBLIC_FX_POLICY.ipPerMinute} requests per minute per address. Display only.`,
      security: [],
      responses: {
        200: { description: 'Snapshot', content: { 'application/json': { schema: PublicFxRatesResponseSchema } } },
        // Public: no 401/403. Only the per-address limit and the shared no-rates answer.
        429: { description: 'Too many requests from this address; `Retry-After` and `details.retryAfterSeconds` say when to try again', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        503: { description: 'No rates to serve, or no rate source configured', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
      },
    }),
    async (c) => {
      const ip = await ipLimiter.check(`public-fx:${requestClientIp((name) => c.req.header(name), options)}`, c.get('now')());
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many requests; try again in a minute', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      if (!rates) throw new ApiError('FX_RATES_UNAVAILABLE', 'Exchange rates are not configured on this server');
      const reading = await rates.get();
      return c.json({ rateDate: reading.snapshot.rateDate, perEur: reading.snapshot.perEur, fetchedAt: reading.fetchedAt.toISOString(), source: reading.source }, 200);
    },
  );

  return app;
}
