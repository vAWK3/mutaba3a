import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor } from '../agreements/compose.js';
import { assertDifferentCurrencies, conversionDate, parseConversionAmount } from '../conversions/compose.js';
import { assertNotFuture } from '../income/compose.js';
import { decodeConversionCursor, encodeConversionCursor } from '../conversions/cursor.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import type { ConversionFilter, LedgerStore } from '../repositories/ports.js';
import { ConversionIdParamSchema, ConversionPageSchema, ConversionSchema, CreateConversionRequestSchema, ListConversionsQuerySchema } from '../schemas.js';
import { serializeConversion } from '../serializers.js';
import { errorResponses, IdempotencyHeaderSchema, ledgerPageStart, notFoundResponse, validationResponse } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

/**
 * /v1/conversions (MUT-161): money moved between currencies, logged directly
 * by the signed-in person. Create + read only — no update/delete, unlike
 * /v1/expenses: a logging mistake is corrected with a new entry, not an edit.
 * Session-only, same shape as expenses — Malafat's key reaches none of it.
 */
export function conversionRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/conversions',
      tags: ['Conversions'],
      summary: 'Log a currency conversion',
      description:
        'Two legs, each in its own currency and fractional digits. toCurrency must differ from currency. occurredOn may not be later than today (ADR-038); backdated is accepted.',
      security: SESSION_ONLY,
      middleware: [requireScope('conversions:write'), idempotent(store, 'conversions.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateConversionRequestSchema) },
      responses: { 201: { description: 'Logged', content: { 'application/json': { schema: ConversionSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const occurredOn = conversionDate(body.occurredOn);
      assertNotFuture(occurredOn, today, 'occurredOn');
      assertDifferentCurrencies(body.currency, body.toCurrency);
      const amountMinor = parseConversionAmount(body.amount, body.currency, 'amount');
      const toAmountMinor = parseConversionAmount(body.toAmount, body.toCurrency, 'toAmount');
      const created = await store.conversions.create(
        { organizationId: organization.id, occurredOn, amountMinor, currency: body.currency, toAmountMinor, toCurrency: body.toCurrency, notes: body.notes ?? null, createdByUserId: user.id },
        now,
      );
      await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'conversion.created', entityType: 'conversion', entityId: created.id, requestId: c.get('requestId') });
      return c.json(serializeConversion(created), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/conversions',
      tags: ['Conversions'],
      summary: 'List conversions, newest first',
      security: SESSION_ONLY,
      middleware: [requireScope('conversions:read')] as const,
      request: { query: ListConversionsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ConversionPageSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const filter: ConversionFilter = { ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(q.currency ? { currency: q.currency } : {}) };
      const cursor = await ledgerPageStart(q, decodeConversionCursor, (id) => store.conversions.getById(organization.id, id), 'No such conversion');
      const page = await store.conversions.list(organization.id, filter, { limit: q.limit, cursor });
      return c.json({ items: page.items.map(serializeConversion), nextCursor: page.nextCursor ? encodeConversionCursor(page.nextCursor) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/conversions/{conversionId}',
      tags: ['Conversions'],
      summary: 'A single conversion',
      security: SESSION_ONLY,
      middleware: [requireScope('conversions:read')] as const,
      request: { params: ConversionIdParamSchema },
      responses: { 200: { description: 'The conversion', content: { 'application/json': { schema: ConversionSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const conversion = await store.conversions.getById(organization.id, c.req.valid('param').conversionId);
      if (!conversion) throw new ApiError('NOT_FOUND', 'No such conversion');
      return c.json(serializeConversion(conversion), 200);
    },
  );

  return app;
}
