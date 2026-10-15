import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { crossRates, type CachedFxRates } from '../fx-rates.js';
import { ErrorEnvelopeSchema, FxRatesQuerySchema, FxRatesResponseSchema } from '../schemas.js';
import { errorResponses, validationResponse } from './shared.js';

/** Reference rates read no organization's data, like GET /v1/me: no X-Mutaba3a-Profile. */
export const FX_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/fx-rates']);

/** /v1/fx-rates (MUT-228, ADR-086). `rates` null = no rate source configured: the route answers 503 FX_RATES_UNAVAILABLE. */
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
        'When a refresh fails the last good rates come back with source=stale; with nothing cached the route answers 503 FX_RATES_UNAVAILABLE, never a zero rate. ' +
        'Display only: no record stores these rates.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { query: FxRatesQuerySchema },
      responses: {
        200: { description: 'Rates', content: { 'application/json': { schema: FxRatesResponseSchema } } },
        503: { description: 'No rates to serve: the provider is down and this instance has none cached, or no rate source is configured', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
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
