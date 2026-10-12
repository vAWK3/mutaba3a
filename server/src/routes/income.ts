import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { writeRefusal } from '../auth/writability.js';
import { assertIsoDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { assertNotFuture, dueDateForOwed, incomeCaptureRulesFor, owedVatFields, resolveIncomeLinks } from '../income/compose.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { CAPTURE_UNDO_REASON, type LedgerStore } from '../repositories/ports.js';
import { CreateIncomeRequestSchema, IncomeIdParamSchema, IncomeResponseSchema } from '../schemas.js';
import { serializeIncomeEntry } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

// MUT-64: a device session is the same 'session' principal, so it reaches every route a cookie session does.
const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;

/**
 * /v1/income — Received or Owed, captured directly by the signed-in person
 * (MUT-65). Session-only: Malafat has its own, richer payment/allocation
 * routes and never needs this simplified contract. Both routes stand on the
 * `capture` row (MUT-61), held on every hosted profile; what a profile then
 * allows is `incomeCaptureRulesFor` — on a Malafat-fed one, Received for a
 * linked client only, and Owed is refused as the payments row's write.
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
        'What a profile allows is published per profile as `income` on GET /v1/me. On a personal profile Received can stand alone with no client; Owed requires one (explicit or resolved from projectId), else 422 CUSTOMER_REQUIRED_FOR_OWED. On a Malafat-fed profile (MUT-61) Received needs a client Malafat has linked — 422 CUSTOMER_REQUIRED / CUSTOMER_NOT_LINKED otherwise — and is stored unallocated (origin CAPTURE) for Malafat to allocate; Owed is 403 READ_ONLY_PROFILE there. Owed is written as a Receivable (origin ADJUSTMENT), always OUT_OF_SCOPE VAT; its dueDate defaults to EOM_15 of occurredOn. occurredOn may not be later than today.',
      security: SESSION_ONLY,
      middleware: [requireScope('capture:write'), idempotent(store, 'income.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateIncomeRequestSchema) },
      responses: { 201: { description: 'Captured', content: { 'application/json': { schema: IncomeResponseSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user, writerOfRecord } = sessionAuth(c);
      const body = c.req.valid('json');
      const rules = incomeCaptureRulesFor(writerOfRecord);
      // Owed is the payments row's write (a Receivable); where Malafat owns receivables it is refused before anything else.
      if (body.kind === 'owed' && !rules.owed) throw writeRefusal('payments', writerOfRecord);
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const occurredOn = assertIsoDate(body.occurredOn, 'occurredOn');
      assertNotFuture(occurredOn, today, 'occurredOn');
      const amountMinor = parseAmount(body.amount, body.currency);
      if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const links = await resolveIncomeLinks(store, organization.id, body.kind, { customerId: body.customerId ?? null, projectId: body.projectId ?? null }, rules);

      const metadata = { amount: body.amount, currency: body.currency, customerId: links.customerId, projectId: links.projectId, ...(body.captureSource ? { captureSource: body.captureSource } : {}) };

      if (body.kind === 'received') {
        const payment = await store.payments.capture(
          {
            organizationId: organization.id,
            customerId: links.customerId,
            projectId: links.projectId,
            currency: body.currency,
            amountMinor,
            receivedOn: occurredOn,
            method: body.method ?? 'CASH',
            notes: body.notes ?? null,
            requestId: c.get('requestId'),
            createdByUserId: user.id,
            captureSource: body.captureSource ?? null,
          },
          now,
        );
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.received', entityType: 'payment', entityId: payment.id, metadata, requestId: c.get('requestId') });
        return c.json(serializeIncomeEntry({ kind: 'received', payment }), 201);
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
        '204 again for an id already undone; 404 for an id this profile never had, that belongs to another user, or that is not this session’s to touch. A settled Owed entry or a Received payment with any allocation (MUT-61: Malafat allocates phone payments) is refused with 409, since undoing one with real money applied is an edit, not an undo. The Received check and the reversal are one write, so an allocation landing at the same moment is never unwound.',
      security: SESSION_ONLY,
      middleware: [requireScope('capture:write')] as const,
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

      // MUT-61: one conditional write — the old read-then-reverse could unwind an allocation Malafat made in between.
      const undone = await store.payments.undoCapture(organization.id, incomeId, user.id, now);
      if (undone.result === 'not-found') throw new ApiError('NOT_FOUND', 'No such income entry');
      if (undone.result === 'allocated') throw new ApiError('CONFLICT', 'This entry has already been allocated', { reason: 'ALREADY_ALLOCATED' });
      if (undone.result === 'reversed' && undone.payment) {
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'payment.reversed', entityType: 'payment', entityId: undone.payment.id, metadata: { number: undone.payment.number, reason: CAPTURE_UNDO_REASON }, requestId: c.get('requestId') });
      }
      return c.body(null, 204);
    },
  );

  return app;
}
