import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, lazyPostingOf, requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { assertNotFuture } from '../income/compose.js';
import { formatMoney, type Currency } from '../money.js';
import { checkCredit, splitCredit } from '../payments/credit.js';
import { InsufficientCapacity } from '../repositories/memory.js';
import type { LedgerStore } from '../repositories/ports.js';
import {
  CreditRequestSchema,
  CreditResponseSchema,
  CreditsResponseSchema,
  ListReceivablesQuerySchema,
  ReceivableIdParamSchema,
  ReceivablePageSchema,
  ReceivableSchema,
  SettleReceivableRequestSchema,
  SettleReceivableResponseSchema,
} from '../schemas.js';
import { outstandingMinor, serializeAllocation, serializeCredit, serializePayment, serializeReceivable } from '../serializers.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

/** /v1/receivables — what is owed, with statuses computed in the organization timezone (M3 brief §2.3). */
export function receivableRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receivables',
      tags: ['Receivables'],
      summary: 'List receivables',
      description: 'Posted items only. Dated installments and retainer charges whose date has arrived are posted before the list is read.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { query: ListReceivablesQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ReceivablePageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, today, now, posting.actor);
      const page = await store.receivables.list(
        organization.id,
        {
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.currency ? { currency: q.currency } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.dueBefore ? { dueBefore: q.dueBefore } : {}),
          ...(q.dueAfter ? { dueAfter: q.dueAfter } : {}),
        },
        toPageRequest(q),
      );
      return c.json({ items: page.items.map((r) => serializeReceivable(r, today)), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receivables/{receivableId}',
      tags: ['Receivables'],
      summary: 'Get a receivable',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: ReceivableIdParamSchema },
      responses: { 200: { description: 'The receivable', content: { 'application/json': { schema: ReceivableSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      if (!receivable) throw new ApiError('NOT_FOUND', 'No such receivable');
      return c.json(serializeReceivable(receivable, today), 200);
    },
  );

  // ---- credits (M4 brief decision 5) ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receivables/{receivableId}/credits',
      tags: ['Receivables'],
      summary: 'Credit a posted receivable without changing its posted figures',
      description: 'Append-only. outstanding = gross − paid − credited; the credit’s VAT share is split at the receivable’s frozen rate and treatment. A credit beyond the outstanding is refused with 422 CREDIT_EXCEEDS_OUTSTANDING (what was paid is not refunded by a credit). This is the explicit adjustment the supplement safeguard, a waived-but-posted retainer month and the archive guard point to.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'receivables.credit')] as const,
      request: { params: ReceivableIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(CreditRequestSchema) },
      responses: { 201: { description: 'Credited', content: { 'application/json': { schema: CreditResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      if (!receivable) throw new ApiError('NOT_FOUND', 'No such receivable');
      const currency = receivable.currency as Currency;
      const amountMinor = parseAmount(body.amount, currency);
      const effectiveDate = body.effectiveDate ? assertIsoDate(body.effectiveDate, 'effectiveDate') : today;
      const check = checkCredit({ amountMinor, outstandingMinor: outstandingMinor(receivable), status: receivable.status });
      if (!check.ok) {
        throw validationError(check.reason, check.reason === 'CREDIT_EXCEEDS_OUTSTANDING' ? 'The credit exceeds what is outstanding on this receivable' : check.reason === 'RECEIVABLE_NOT_OPEN' ? 'Nothing is outstanding on this receivable' : 'amount must be positive', {
          ...(check.outstandingMinor !== undefined ? { outstanding: formatMoney({ minor: check.outstandingMinor, currency }) } : {}),
        });
      }
      const split = splitCredit({ amountMinor, treatment: receivable.vatTreatment, rateBasisPoints: receivable.vatRateBasisPoints });
      let result;
      try {
        result = await store.receivables.credit(organization.id, receivable.id, { amountMinor: split.amountMinor, netMinor: split.netMinor, vatMinor: split.vatMinor, reason: body.reason, effectiveDate, requestId: c.get('requestId') }, now);
      } catch (err) {
        if (err instanceof InsufficientCapacity) throw new ApiError('CONFLICT', 'The receivable changed while crediting; re-read and retry', { reason: 'VERSION_MISMATCH' });
        throw err;
      }
      if (!result) throw new ApiError('NOT_FOUND', 'No such receivable');
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'receivable.credited', entityType: 'receivable', entityId: receivable.id, metadata: { creditId: result.credit.id, amount: body.amount, reason: body.reason, settled: result.receivable.status === 'SETTLED' }, requestId: c.get('requestId') });
      return c.json({ receivable: serializeReceivable(result.receivable, today), credit: serializeCredit(result.credit, currency) }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receivables/{receivableId}/credits',
      tags: ['Receivables'],
      summary: 'The credits on a receivable, newest first',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: ReceivableIdParamSchema },
      responses: { 200: { description: 'Credits', content: { 'application/json': { schema: CreditsResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      if (!receivable) throw new ApiError('NOT_FOUND', 'No such receivable');
      const credits = await store.receivables.listCredits(organization.id, receivable.id);
      return c.json({ receivable: serializeReceivable(receivable, today), credits: credits.map((x) => serializeCredit(x, receivable.currency)) }, 200);
    },
  );

  // ---- settle (MUT-65): a personal profile's own receivable, no preview/allocation dance ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receivables/{receivableId}/settle',
      tags: ['Receivables'],
      summary: 'Settle a receivable directly, with one payment and one allocation',
      description:
        'For a session\'s own captures, not Malafat\'s multi-receivable allocation UI: amount defaults to the full outstanding amount; paidAt defaults to today and may not be later than today, matching the rule ADR-038 ports to the server for this new surface — paidAt is never set directly, it comes from the payment this creates. Only an entry captured through POST /v1/income (origin ADJUSTMENT) can be settled here; any other receivable answers 404.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'receivables.settle')] as const,
      request: { params: ReceivableIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(SettleReceivableRequestSchema) },
      responses: { 201: { description: 'Settled (or partially)', content: { 'application/json': { schema: SettleReceivableResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const receivable = await store.receivables.getById(organization.id, c.req.valid('param').receivableId);
      // Only ever an app-captured "Owed" (origin ADJUSTMENT). An INSTALLMENT or RETAINER_CHARGE belongs to
      // Malafat's allocation engine, and a disconnected integration would otherwise hand this session
      // payments:write over that whole historical ledger. 404, not 403 — same non-leaking discipline as
      // DELETE /v1/income/{id} (routes/income.ts).
      if (!receivable || receivable.origin !== 'ADJUSTMENT') throw new ApiError('NOT_FOUND', 'No such receivable');
      const currency = receivable.currency as Currency;
      const outstanding = outstandingMinor(receivable);
      if (outstanding <= 0n) throw validationError('RECEIVABLE_NOT_OPEN', 'Nothing is outstanding on this receivable');
      const amountMinor = body.amount ? parseAmount(body.amount, currency) : outstanding;
      if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      if (amountMinor > outstanding) {
        throw validationError('ALLOCATION_EXCEEDS_OUTSTANDING', 'The amount exceeds what is outstanding on this receivable', { outstanding: formatMoney({ minor: outstanding, currency }) });
      }
      const paidAt = body.paidAt ? assertIsoDate(body.paidAt, 'paidAt') : today;
      assertNotFuture(paidAt, today, 'paidAt');
      const requestId = c.get('requestId');

      let created;
      try {
        created = await store.payments.create(
          {
            organizationId: organization.id,
            customerId: receivable.customerId,
            projectId: receivable.projectId,
            currency,
            amountMinor,
            receivedOn: paidAt,
            method: body.method ?? 'CASH',
            reference: null,
            notes: null,
            replacesPaymentId: null,
            requestId,
            createdByUserId: user.id,
            // MUT-61: a person settling their own Owed is a capture too (matches the migration's backfill rule).
            origin: 'CAPTURE',
            captureSource: body.captureSource ?? null,
            allocations: [{ receivableId: receivable.id, amountMinor }],
          },
          now,
        );
      } catch (err) {
        // The FOR UPDATE re-read found the capacity gone: another settle landed between our read and this write.
        if (err instanceof InsufficientCapacity) throw new ApiError('CONFLICT', 'The receivable changed while settling; re-read and retry', { reason: 'VERSION_MISMATCH' });
        throw err;
      }
      const settled = await store.receivables.getById(organization.id, receivable.id);
      if (!settled) throw new ApiError('INTERNAL', 'The receivable vanished mid-settle');

      const metadata = { number: created.payment.number, receivableId: receivable.id, amount: formatMoney({ minor: amountMinor, currency }), currency, ...(body.captureSource ? { captureSource: body.captureSource } : {}) };
      await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'payment.recorded', entityType: 'payment', entityId: created.payment.id, metadata, requestId });
      if (settled.status === 'SETTLED') {
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'receivable.settled', entityType: 'receivable', entityId: receivable.id, metadata: { paymentId: created.payment.id }, requestId });
      }

      const allocationViews = created.allocations.map((a) => serializeAllocation(a, settled, currency, today));
      return c.json({ receivable: serializeReceivable(settled, today), payment: serializePayment(created.payment, allocationViews, null) }, 201);
    },
  );

  return app;
}
