import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { assertNotFuture, dueDateForOwed, owedVatFields, resolveIncomeLinks } from '../income/compose.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import type { LedgerStore } from '../repositories/ports.js';
import { CreateIncomeRequestSchema, IncomeIdParamSchema, IncomeResponseSchema } from '../schemas.js';
import { serializeIncomeEntry } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

const SESSION_ONLY = [{ session: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;

/**
 * /v1/income — Received or Owed, captured directly by the signed-in person on
 * a personal hosted profile (MUT-65). Session-only: Malafat has its own,
 * richer payment/allocation routes and never needs this simplified contract.
 */
export function incomeRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/income',
      tags: ['Income'],
      summary: 'Capture money received or owed, directly — no agreement, no allocation dance',
      description:
        'Received can stand alone with no client; Owed requires one (explicit or resolved from projectId), else 422 CUSTOMER_REQUIRED_FOR_OWED. Owed is written as a Receivable (origin ADJUSTMENT), always OUT_OF_SCOPE VAT; its dueDate defaults to EOM_15 of occurredOn. occurredOn may not be later than today.',
      security: SESSION_ONLY,
      middleware: [requireScope('payments:write'), idempotent(store, 'income.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateIncomeRequestSchema) },
      responses: { 201: { description: 'Captured', content: { 'application/json': { schema: IncomeResponseSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const occurredOn = assertIsoDate(body.occurredOn, 'occurredOn');
      assertNotFuture(occurredOn, today, 'occurredOn');
      const amountMinor = parseAmount(body.amount, body.currency);
      if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const links = await resolveIncomeLinks(store, organization.id, body.kind, { customerId: body.customerId ?? null, projectId: body.projectId ?? null });

      const metadata = { amount: body.amount, currency: body.currency, customerId: links.customerId, projectId: links.projectId, ...(body.captureSource ? { captureSource: body.captureSource } : {}) };

      if (body.kind === 'received') {
        const created = await store.payments.create(
          {
            organizationId: organization.id,
            customerId: links.customerId,
            projectId: links.projectId,
            currency: body.currency,
            amountMinor,
            receivedOn: occurredOn,
            method: body.method ?? 'CASH',
            reference: null,
            notes: body.notes ?? null,
            replacesPaymentId: null,
            requestId: c.get('requestId'),
            createdByUserId: user.id,
            allocations: [],
          },
          now,
        );
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.received', entityType: 'payment', entityId: created.payment.id, metadata, requestId: c.get('requestId') });
        return c.json(serializeIncomeEntry({ kind: 'received', payment: created.payment }), 201);
      }

      if (!links.customerId) throw new ApiError('INTERNAL', 'resolveIncomeLinks guarantees a customerId for owed');
      const dueDate = body.dueDate ? assertIsoDate(body.dueDate, 'dueDate') : dueDateForOwed(occurredOn, undefined);
      const vat = owedVatFields(amountMinor);
      const created = await store.receivables.createAdjustment(
        {
          organizationId: organization.id,
          customerId: links.customerId,
          projectId: links.projectId,
          currency: body.currency,
          netMinor: vat.netMinor,
          vatMinor: vat.vatMinor,
          grossMinor: vat.grossMinor,
          vatTreatment: vat.vatTreatment,
          vatRateBasisPoints: vat.vatRateBasisPoints,
          title: body.title ?? null,
          dueDate,
          postingDate: occurredOn,
          postedAt: now,
          createdByUserId: user.id,
          requestId: c.get('requestId'),
        },
        now,
      );
      await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.owed', entityType: 'receivable', entityId: created.id, metadata, requestId: c.get('requestId') });
      return c.json(serializeIncomeEntry({ kind: 'owed', receivable: created }), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/income/{incomeId}',
      tags: ['Income'],
      summary: 'Undo an income entry this session created',
      description:
        '204 again for an id already undone; 404 for an id this profile never had, that belongs to another user, or that is not this session’s to touch. A settled Owed entry or an allocated Received payment is refused with 409, since undoing one with real money applied is an edit, not an undo.',
      security: SESSION_ONLY,
      middleware: [requireScope('payments:write')] as const,
      request: { params: IncomeIdParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...conflictResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const now = c.get('now')();
      const { incomeId } = c.req.valid('param');

      // Includes an already-voided row, so a repeat call can re-confirm ownership and answer 204 again instead of 404.
      const receivable = await store.receivables.getByIdIncludingDeleted(organization.id, incomeId);
      if (receivable) {
        if (receivable.origin !== 'ADJUSTMENT' || receivable.createdByUserId !== user.id) throw new ApiError('NOT_FOUND', 'No such income entry');
        if (receivable.deletedAt) return c.body(null, 204);
        if (receivable.paidMinor > 0n || receivable.creditedMinor > 0n) throw new ApiError('CONFLICT', 'This entry has already been settled', { reason: 'ALREADY_SETTLED' });
        // The store re-asserts that guard atomically; a row that comes back still undeleted means a settle
        // won the race since the check above, and this is the same refusal, not a silent 204.
        const voided = await store.receivables.softDeleteAdjustment(organization.id, receivable.id, now);
        if (voided && !voided.deletedAt) throw new ApiError('CONFLICT', 'This entry has already been settled', { reason: 'ALREADY_SETTLED' });
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.owed.voided', entityType: 'receivable', entityId: receivable.id, requestId: c.get('requestId') });
        return c.body(null, 204);
      }

      const payment = await store.payments.getById(organization.id, incomeId);
      if (payment) {
        if (payment.createdByUserId !== user.id) throw new ApiError('NOT_FOUND', 'No such income entry');
        if (payment.allocatedMinor > 0n) throw new ApiError('CONFLICT', 'This entry has already been allocated', { reason: 'ALREADY_ALLOCATED' });
        const result = await store.payments.reverse(organization.id, payment.id, 'capture_undo', now);
        if (result?.changed) {
          await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'payment.reversed', entityType: 'payment', entityId: payment.id, metadata: { number: payment.number, reason: 'capture_undo' }, requestId: c.get('requestId') });
        }
        return c.body(null, 204);
      }

      throw new ApiError('NOT_FOUND', 'No such income entry');
    },
  );

  return app;
}
