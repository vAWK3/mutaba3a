import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { writeRefusal } from '../auth/writability.js';
import { assertIsoDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { dueDateForOwed, incomeCaptureRulesFor, isOwnCapture, isOwnProfile, owedVatFields, pastMoneyDate, redateTo, resolveIncomeLinks } from '../income/compose.js';
import { ifMatch } from '../if-match.js';
import { OWED_REDATED } from './audit.js';
import { redateOwnCapture } from './payments.js';
import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import { idempotent } from '../idempotency.js';
import { CAPTURE_UNDO_REASON, type LedgerStore } from '../repositories/ports.js';
import { CreateIncomeRequestSchema, IfMatchHeaderSchema, IncomeIdParamSchema, IncomeResponseSchema, UpdateIncomeRequestSchema } from '../schemas.js';
import { serializeIncomeEntry } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

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
      const occurredOn = pastMoneyDate(body.occurredOn, today, 'occurredOn');
      const amountMinor = parseAmount(body.amount, body.currency);
      if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const links = await resolveIncomeLinks(store, organization.id, body.kind, { customerId: body.customerId ?? null, projectId: body.projectId ?? null }, body.currency, rules);

      const metadata = { amount: body.amount, currency: body.currency, customerId: links.customerId, projectId: links.projectId, ...(body.kind === 'received' ? { origin: 'CAPTURE' } : {}), ...(body.captureSource ? { captureSource: body.captureSource } : {}) };

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
      if (undone.result === 'reversed-elsewhere') throw new ApiError('CONFLICT', 'Malafat reversed this entry; it is no longer yours to undo', { reason: 'REVERSED_BY_MALAFAT' });
      if (undone.result === 'reversed' && undone.payment) {
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'payment.reversed', entityType: 'payment', entityId: undone.payment.id, metadata: { number: undone.payment.number, reason: CAPTURE_UNDO_REASON, allocationsUndone: 0, amount: formatMoney({ minor: undone.payment.amountMinor, currency: undone.payment.currency as Currency }) }, requestId: c.get('requestId') });
      }
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/income/{incomeId}',
      tags: ['Income'],
      summary: 'Change the date of an income entry you captured (optimistic, If-Match)',
      description:
        'Date only (MUT-223). An Owed entry moves its date and keeps its stored dueDate; a Received entry moves its payment\'s receivedOn. Only on a profile this person owns, and only an entry they captured: any other id, a voided Owed entry or an undone Received answers 404. A Received payment already applied to an entry (a settle) is 409 ALREADY_ALLOCATED — change it through PATCH /v1/payments/{id}. occurredOn may not be later than the organization\'s today.',
      security: SESSION_ONLY,
      middleware: [requireScope('capture:write'), ifMatch()] as const,
      request: { params: IncomeIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateIncomeRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: IncomeResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const occurredOn = redateTo(c.req.valid('json').occurredOn, organization, c.get('now')(), 'occurredOn');
      const { incomeId } = c.req.valid('param');
      const notFound = () => new ApiError('NOT_FOUND', 'No such income entry');
      if (!isOwnProfile(organization, user.id)) throw notFound();

      const receivable = await store.receivables.getById(organization.id, incomeId);
      if (receivable) {
        if (receivable.origin !== 'ADJUSTMENT' || receivable.createdByUserId !== user.id) throw notFound();
        const expected = c.get('expectedVersion');
        if (receivable.version !== expected) throw versionMismatch(receivable.version);
        const result = await store.receivables.redateAdjustment(organization.id, receivable.id, user.id, expected, occurredOn);
        if (result.kind === 'not_found') throw notFound();
        if (result.kind === 'stale') throw versionMismatch(result.record.version);
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: OWED_REDATED, entityType: 'receivable', entityId: receivable.id, metadata: { from: receivable.postingDate, to: occurredOn, version: result.record.version }, requestId: c.get('requestId') });
        return c.json(serializeIncomeEntry({ kind: 'owed', receivable: result.record }), 200);
      }

      const payment = await store.payments.getById(organization.id, incomeId);
      if (!payment || !isOwnCapture(payment, user.id)) throw notFound();
      // Checked on this read, not in the write (eng review D3): on an owned profile only settle allocates, and only to the
      // payment it creates, because POST /v1/payments/{id}/allocations is API-key only (routes/payments.ts) and API keys
      // are refused on owned profiles (auth/middleware.ts ownedProfileConflict). So allocatedMinor cannot change under us.
      if (payment.allocatedMinor > 0n) throw new ApiError('CONFLICT', 'This payment is applied to an entry; change its date through PATCH /v1/payments/{id}', { reason: 'ALREADY_ALLOCATED' });
      return c.json(serializeIncomeEntry({ kind: 'received', payment: await redateOwnCapture(store, c, payment, occurredOn, notFound) }), 200);
    },
  );

  return app;
}
