import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, todayFor } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';
import { SetVatRateRequestSchema, VatRateSchema, VatRatesResponseSchema } from '../schemas.js';
import { serializeVatRate } from '../serializers.js';
import { conflictResponse, errorResponses, validationResponse } from './shared.js';

/** /v1/vat-rates, /v1/settings/vat — the firm's effective-dated standard rate (M3 brief §2.3). */
export function vatRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/vat-rates',
      tags: ['VAT'],
      summary: 'List the firm’s VAT rates, newest first, with the one in force today',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('agreements:read')] as const,
      responses: { 200: { description: 'Rates', content: { 'application/json': { schema: VatRatesResponseSchema } } }, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      const [rates, current] = await Promise.all([store.vatRates.list(organization.id), store.vatRates.effectiveOn(organization.id, today)]);
      return c.json({ rates: rates.map(serializeVatRate), current: current ? serializeVatRate(current) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/settings/vat',
      tags: ['VAT'],
      summary: 'Set the standard VAT rate from an effective date (append-only)',
      description: 'The same effective date with the same rate is a no-op (200). The same date with a different rate is refused with 409 RATE_ALREADY_SET: history is immutable, add a later date instead. Posted records keep the rate they were posted with.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write')] as const,
      request: { body: { required: true, content: { 'application/json': { schema: SetVatRateRequestSchema } } } },
      responses: {
        200: { description: 'Already set to this rate on this date', content: { 'application/json': { schema: VatRateSchema } } },
        201: { description: 'Rate recorded', content: { 'application/json': { schema: VatRateSchema } } },
        ...conflictResponse,
        ...validationResponse,
        ...errorResponses,
      },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      assertIsoDate(body.effectiveFrom, 'effectiveFrom');
      const result = await store.vatRates.upsert(organization.id, body.rateBasisPoints, body.effectiveFrom, c.get('now')());
      if (result.outcome === 'conflict') {
        throw new ApiError('CONFLICT', `A different rate is already recorded from ${body.effectiveFrom}`, { reason: 'RATE_ALREADY_SET', existingRateBasisPoints: result.record.rateBasisPoints });
      }
      if (result.outcome === 'created') {
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'vat_rate.set', entityType: 'vat_rate', entityId: result.record.id, metadata: { rateBasisPoints: body.rateBasisPoints, effectiveFrom: body.effectiveFrom }, requestId: c.get('requestId') });
        return c.json(serializeVatRate(result.record), 201);
      }
      return c.json(serializeVatRate(result.record), 200);
    },
  );

  return app;
}
