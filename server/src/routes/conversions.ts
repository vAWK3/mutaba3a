import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor } from '../agreements/compose.js';
import type { Context } from 'hono';
import { assertDifferentCurrencies, conversionPatch, parseConversionAmount } from '../conversions/compose.js';
import { pastMoneyDate } from '../income/compose.js';
import { decodeConversionCursor, encodeConversionCursor } from '../conversions/cursor.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import type { ConversionFilter, ConversionRecord, JsonObject, LedgerStore } from '../repositories/ports.js';
import {
  ConversionIdParamSchema,
  ConversionPageSchema,
  ConversionSchema,
  CreateConversionRequestSchema,
  IfMatchHeaderSchema,
  ListConversionsQuerySchema,
  UpdateConversionRequestSchema,
} from '../schemas.js';
import { serializeConversion } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, ledgerPageStart, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;

/**
 * /v1/conversions (MUT-161): money moved between currencies, logged directly
 * by the signed-in person. MUT-194 (ADR-075, superseding ADR-070 §2): edited
 * optimistically with If-Match and soft-deleted, the same contract as
 * /v1/expenses. Session-only, same shape as expenses — Malafat's key reaches
 * none of it, and GET /v1/audit never lists its events.
 */
export function conversionRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  function audit(c: Context<AppEnv>, action: string, entityId: string, metadata?: JsonObject) {
    const { organization, user } = sessionAuth(c);
    return store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action, entityType: 'conversion', entityId, ...(metadata ? { metadata } : {}), requestId: c.get('requestId') });
  }

  async function mustGet(organizationId: string, id: string): Promise<ConversionRecord> {
    const conversion = await store.conversions.getById(organizationId, id);
    if (!conversion) throw new ApiError('NOT_FOUND', 'No such conversion');
    return conversion;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/conversions',
      tags: ['Conversions'],
      summary: 'Log a currency conversion',
      description:
        'Two legs, each in its own currency and fractional digits. toCurrency must differ from currency. occurredOn may not be later than today (ADR-038) and not more than ten years before it (MUT-227); backdated is accepted.',
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
      const occurredOn = pastMoneyDate(body.occurredOn, today, 'occurredOn');
      assertDifferentCurrencies(body.currency, body.toCurrency);
      const amountMinor = parseConversionAmount(body.amount, body.currency, 'amount');
      const toAmountMinor = parseConversionAmount(body.toAmount, body.toCurrency, 'toAmount');
      const created = await store.conversions.create(
        { organizationId: organization.id, occurredOn, amountMinor, currency: body.currency, toAmountMinor, toCurrency: body.toCurrency, notes: body.notes ?? null, createdByUserId: user.id },
        now,
      );
      await audit(c, 'conversion.created', created.id);
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
      return c.json(serializeConversion(await mustGet(organization.id, c.req.valid('param').conversionId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/conversions/{conversionId}',
      tags: ['Conversions'],
      summary: 'Change a conversion (optimistic, If-Match)',
      description:
        'Any field. A currency comes with its own amount (422 AMOUNT_REQUIRED), each amount is read in the merged currency\'s digits, and the merged legs must differ (422 SAME_CURRENCY). occurredOn, when changed, may not be later than today and not more than ten years before it (MUT-227). null clears the notes.',
      security: SESSION_ONLY,
      middleware: [requireScope('conversions:write'), ifMatch()] as const,
      request: { params: ConversionIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateConversionRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: ConversionSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const existing = await mustGet(organization.id, c.req.valid('param').conversionId);
      const patch = conversionPatch(existing, body);
      // Stricter than expense PATCH, consistent with create. Checked only when the date changes, so editing anything
      // else on an old row is never refused (MUT-227).
      if (patch.occurredOn !== undefined && patch.occurredOn !== existing.occurredOn) pastMoneyDate(patch.occurredOn, todayFor(organization, now), 'occurredOn');
      const result = await store.conversions.update(organization.id, existing.id, c.get('expectedVersion'), patch, now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such conversion');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      await audit(c, 'conversion.updated', result.record.id, { fields: Object.keys(body), version: result.record.version });
      return c.json(serializeConversion(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/conversions/{conversionId}',
      tags: ['Conversions'],
      summary: 'Delete a conversion (soft)',
      description: '204 again for a conversion already deleted; 404 for an id this profile never had.',
      security: SESSION_ONLY,
      middleware: [requireScope('conversions:write')] as const,
      request: { params: ConversionIdParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const deleted = await store.conversions.softDelete(organization.id, c.req.valid('param').conversionId, c.get('now')());
      if (!deleted) throw new ApiError('NOT_FOUND', 'No such conversion');
      if (deleted.changed) await audit(c, 'conversion.deleted', deleted.record.id);
      return c.body(null, 204);
    },
  );

  return app;
}
