import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, assertNotAbsurdDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import type { IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { eligibleFor, resultingBalances, suggestAllocations, validateAllocations, type AllocationRequest, type AllocationStrategy } from '../payments/allocate.js';
import { allocationSnapshot, paymentPreviewToken } from '../payments/preview-token.js';
import { verifyPreviewToken } from '../preview-token.js';
import { InsufficientCapacity } from '../repositories/memory.js';
import type { LedgerStore, Organization, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';
import {
  AllocatePaymentRequestSchema,
  AllocationPreviewRequestSchema,
  AllocationPreviewResponseSchema,
  CreatePaymentRequestSchema,
  ListPaymentsQuerySchema,
  PaymentIdParamSchema,
  PaymentPageSchema,
  PaymentSchema,
  ReversePaymentRequestSchema,
} from '../schemas.js';
import { outstandingMinor, receivableStatus, serializeAllocation, serializePayment } from '../serializers.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

interface Actor {
  organizationId: string;
  apiKeyId: string;
  requestId: string;
}

/** /v1/allocations/preview, /v1/payments — payments, allocations, reversals (M4 brief §2.3). */
export function paymentRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const actorOf = (c: { get: (k: 'auth') => { organization: Organization; apiKey: { id: string } } } & { get(k: 'requestId'): string }): Actor => ({ organizationId: c.get('auth').organization.id, apiKeyId: c.get('auth').apiKey.id, requestId: c.get('requestId') });

  const audit = (a: Actor, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) =>
    store.audit.append({ organizationId: a.organizationId, actorType: 'API_KEY', actorId: a.apiKeyId, action, entityType, entityId, metadata, requestId: a.requestId });

  async function paymentView(organizationId: string, payment: PaymentRecord, today: IsoDate) {
    const allocations = await store.payments.listAllocations(organizationId, payment.id);
    const receivables = new Map((await store.receivables.getByIds(organizationId, allocations.map((a) => a.receivableId))).map((r) => [r.id, r]));
    const replacedBy = await store.payments.findReplacedBy(organizationId, payment.id);
    return serializePayment(
      payment,
      allocations.map((a) => serializeAllocation(a, receivables.get(a.receivableId) ?? null, payment.currency, today)),
      replacedBy?.id ?? null,
    );
  }

  async function mustGetPayment(organizationId: string, id: string): Promise<PaymentRecord> {
    const payment = await store.payments.getById(organizationId, id);
    if (!payment) throw new ApiError('NOT_FOUND', 'No such payment');
    return payment;
  }

  /** Resolves who is paying and how much is available, from either preview source. */
  async function source(organization: Organization, body: { customerId?: string | undefined; currency?: string | undefined; amount?: string | undefined; paymentId?: string | undefined }): Promise<{ customerId: string; currency: Currency; amountMinor: bigint; payment: PaymentRecord | null }> {
    if (body.paymentId) {
      const payment = await mustGetPayment(organization.id, body.paymentId);
      if (payment.status !== 'POSTED') throw validationError('PAYMENT_NOT_POSTED', 'Only a POSTED payment can be allocated', { paymentId: payment.id });
      const available = payment.amountMinor - payment.allocatedMinor;
      if (available <= 0n) throw validationError('NO_UNALLOCATED_FUNDS', 'This payment is fully allocated', { paymentId: payment.id });
      return { customerId: payment.customerId, currency: payment.currency as Currency, amountMinor: available, payment };
    }
    if (!body.customerId || !body.currency || body.amount === undefined) {
      throw validationError('AMOUNT_INVALID', 'customerId, currency and amount are required unless paymentId is given', { field: 'amount' });
    }
    const customer = await store.customers.getById(organization.id, body.customerId);
    if (!customer) throw validationError('CUSTOMER_NOT_FOUND', 'customerId does not name a customer of this organization', { field: 'customerId' });
    if (customer.status === 'ARCHIVED') throw validationError('CUSTOMER_ARCHIVED', 'The customer is archived', { field: 'customerId' });
    const amountMinor = parseAmount(body.amount, body.currency as Currency);
    if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
    return { customerId: customer.id, currency: body.currency as Currency, amountMinor, payment: null };
  }

  /** Explicit allocations from the wire, amounts parsed in the payment currency. */
  function parseAllocations(raw: ReadonlyArray<{ receivableId: string; amount: string }> | undefined, currency: Currency): AllocationRequest[] | undefined {
    if (!raw) return undefined;
    return raw.map((a, i) => ({ receivableId: a.receivableId, amountMinor: parseAmount(a.amount, currency, `allocations[${i}].amount`) }));
  }

  /** The validated set (explicit, suggested, or empty) plus everything the response and the token need. */
  async function plan(organization: Organization, src: { customerId: string; currency: Currency; amountMinor: bigint }, explicit: AllocationRequest[] | undefined, strategy: AllocationStrategy | undefined, today: IsoDate) {
    const eligible = await store.receivables.listEligible(organization.id, src.customerId, src.currency);
    const referenced = explicit ? explicit.map((a) => a.receivableId).filter((id) => !eligible.some((r) => r.id === id)) : [];
    const extra = referenced.length > 0 ? await store.receivables.getByIds(organization.id, referenced) : [];
    const pool: ReceivableRecord[] = [...eligible, ...extra];
    const requested = explicit ?? (strategy ? suggestAllocations(strategy, src.amountMinor, eligibleFor(eligible, src.customerId, src.currency)) : []);
    const result = validateAllocations({ customerId: src.customerId, currency: src.currency, amountMinor: src.amountMinor, allocations: requested, receivables: pool });
    if (!result.ok) {
      const e = result.error;
      const fmt = (m: bigint | undefined) => (m === undefined ? undefined : formatMoney({ minor: m, currency: src.currency }));
      throw validationError(e.reason, allocationMessage(e.reason), { ...(e.receivableId ? { receivableId: e.receivableId } : {}), ...(e.outstandingMinor !== undefined ? { outstanding: fmt(e.outstandingMinor) } : {}), ...(e.excessMinor !== undefined ? { excess: fmt(e.excessMinor) } : {}) });
    }
    const balances = resultingBalances(result.value.allocations, eligible, today);
    const token = paymentPreviewToken(organization.id, tokenBody(src, result.value.allocations), eligible);
    return { eligible, value: result.value, balances, token };
  }

  function tokenBody(src: { customerId: string; currency: string; amountMinor: bigint }, allocations: readonly AllocationRequest[]) {
    return { customerId: src.customerId, currency: src.currency, amount: src.amountMinor, allocations: [...allocations].sort((a, b) => (a.receivableId < b.receivableId ? -1 : 1)).map((a) => [a.receivableId, a.amountMinor]) };
  }

  /** The same parts `paymentPreviewToken` hashes, for constant-time verification. */
  function tokenParts(organizationId: string, src: { customerId: string; currency: string; amountMinor: bigint }, allocations: readonly AllocationRequest[], eligible: readonly ReceivableRecord[]): unknown[] {
    return [organizationId, 'payment', tokenBody(src, allocations), allocationSnapshot(eligible)];
  }

  // ---- preview ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/allocations/preview',
      tags: ['Payments'],
      summary: 'Preview a payment’s allocations and the balances they would leave',
      description: 'Writes nothing. Give `customerId`, `currency`, `amount` for a new payment, or `paymentId` to allocate a posted payment’s unallocated funds. Explicit `allocations` win over `strategy`; neither leaves everything unallocated. The token covers the allocation set and the version of every eligible receivable, so a payment or credit posted in between is refused with 409 PREVIEW_STALE at post time.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { body: jsonBody(AllocationPreviewRequestSchema) },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: AllocationPreviewResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: c.get('auth').apiKey.id, requestId: c.get('requestId') });
      const src = await source(organization, body);
      const explicit = parseAllocations(body.allocations, src.currency);
      const { eligible, value, balances, token } = await plan(organization, src, explicit, body.strategy, today);
      const fmt = (m: bigint) => formatMoney({ minor: m, currency: src.currency });
      return c.json(
        {
          customerId: src.customerId,
          currency: src.currency,
          amount: fmt(src.amountMinor),
          allocations: value.allocations.map((a) => ({ receivableId: a.receivableId, amount: fmt(a.amountMinor) })),
          allocated: fmt(value.allocatedMinor),
          unallocated: fmt(value.unallocatedMinor),
          eligible: eligible.map((r) => ({ receivableId: r.id, projectId: r.projectId, agreementId: r.agreementId, origin: r.origin, dueDate: r.dueDate, gross: fmt(r.grossMinor), outstanding: fmt(outstandingMinor(r)), status: receivableStatus(r, today) })),
          balances: {
            receivables: balances.receivables.map((b) => ({ receivableId: b.receivableId, projectId: b.projectId, outstandingBefore: fmt(b.outstandingBefore), outstandingAfter: fmt(b.outstandingAfter), statusBefore: b.statusBefore, statusAfter: b.statusAfter })),
            projects: balances.projects.map((p) => ({ projectId: p.projectId, before: { outstanding: fmt(p.before.outstandingMinor), overdue: fmt(p.before.overdueMinor) }, after: { outstanding: fmt(p.after.outstandingMinor), overdue: fmt(p.after.overdueMinor) } })),
            customer: { before: { outstanding: fmt(balances.customer.before.outstandingMinor), overdue: fmt(balances.customer.before.overdueMinor) }, after: { outstanding: fmt(balances.customer.after.outstandingMinor), overdue: fmt(balances.customer.after.overdueMinor) } },
          },
          warnings: eligible.length === 0 ? ['NO_ELIGIBLE_RECEIVABLES' as const] : [],
          previewToken: token,
        },
        200,
      );
    },
  );

  // ---- create ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payments',
      tags: ['Payments'],
      summary: 'Record a payment with its allocations, from a preview',
      description: 'One transaction: the payment, its allocations, every allocated receivable’s paid amount and status, and the payment number PAY-YYYY-NNNN. The previewToken must match the allocation set and the current receivable balances (409 PREVIEW_STALE otherwise). Unallocated funds stay on the payment.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'payments.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreatePaymentRequestSchema) },
      responses: { 201: { description: 'Recorded', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const actor = actorOf(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      assertIsoDate(body.receivedOn, 'receivedOn');
      assertNotAbsurdDate(body.receivedOn, today, 'receivedOn');
      if (body.replacesPaymentId) {
        const replaced = await store.payments.getById(organization.id, body.replacesPaymentId);
        if (!replaced || replaced.status !== 'REVERSED') throw validationError('REPLACES_NOT_REVERSED', 'replacesPaymentId must name a REVERSED payment', { field: 'replacesPaymentId' });
        if (replaced.customerId !== body.customerId) throw validationError('REPLACES_CUSTOMER_MISMATCH', 'The replaced payment belongs to another customer', { field: 'replacesPaymentId' });
      }
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: actor.apiKeyId, requestId: actor.requestId });
      const src = await source(organization, { customerId: body.customerId, currency: body.currency, amount: body.amount });
      const explicit = parseAllocations(body.allocations, src.currency) ?? [];
      const { value, token } = await plan(organization, src, explicit, undefined, today);
      // Recomputed through the same path as the preview: a mismatch is the allocation set or the balances.
      if (!verifyPreviewToken(body.previewToken, tokenParts(organization.id, src, value.allocations, await store.receivables.listEligible(organization.id, src.customerId, src.currency)))) {
        throw new ApiError('CONFLICT', 'previewToken does not match this allocation set and the current balances; preview again', { reason: 'PREVIEW_STALE' });
      }
      void token;
      let created;
      try {
        created = await store.payments.create(
          { organizationId: organization.id, customerId: src.customerId, currency: src.currency, amountMinor: src.amountMinor, receivedOn: body.receivedOn, method: body.method, reference: body.reference ?? null, notes: body.notes ?? null, replacesPaymentId: body.replacesPaymentId ?? null, requestId: actor.requestId, allocations: value.allocations },
          now,
        );
      } catch (err) {
        if (err instanceof InsufficientCapacity) throw new ApiError('CONFLICT', 'A receivable changed while the payment was being recorded; preview again', { reason: 'PREVIEW_STALE', entityId: err.entityId });
        throw err;
      }
      await audit(actor, 'payment.recorded', 'payment', created.payment.id, { number: created.payment.number, customerId: src.customerId, amount: formatMoney({ minor: src.amountMinor, currency: src.currency }), currency: src.currency, allocations: created.allocations.length, unallocated: formatMoney({ minor: value.unallocatedMinor, currency: src.currency }), ...(body.replacesPaymentId ? { replacesPaymentId: body.replacesPaymentId } : {}) });
      await auditSettled(actor, created.allocations.map((a) => a.receivableId), created.payment.id);
      return c.json(await paymentView(organization.id, created.payment, today), 201);
    },
  );

  async function auditSettled(actor: Actor, receivableIds: string[], paymentId: string): Promise<void> {
    for (const r of await store.receivables.getByIds(actor.organizationId, receivableIds)) {
      if (r.status === 'SETTLED') await audit(actor, 'receivable.settled', 'receivable', r.id, { paymentId });
    }
  }

  // ---- list / get ----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/payments',
      tags: ['Payments'],
      summary: 'List payments',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { query: ListPaymentsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: PaymentPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const today = todayFor(organization, c.get('now')());
      const page = await store.payments.list(organization.id, { ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.receivedBefore ? { receivedBefore: q.receivedBefore } : {}), ...(q.receivedAfter ? { receivedAfter: q.receivedAfter } : {}) }, toPageRequest(q));
      const items = [];
      for (const p of page.items) items.push(await paymentView(organization.id, p, today));
      return c.json({ items, nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/payments/{paymentId}',
      tags: ['Payments'],
      summary: 'Get a payment with its allocations',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: PaymentIdParamSchema },
      responses: { 200: { description: 'The payment', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      return c.json(await paymentView(organization.id, await mustGetPayment(organization.id, c.req.valid('param').paymentId), today), 200);
    },
  );

  // ---- allocate later ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payments/{paymentId}/allocations',
      tags: ['Payments'],
      summary: 'Allocate a posted payment’s unallocated funds, from a { paymentId } preview',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'payments.allocate')] as const,
      request: { params: PaymentIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(AllocatePaymentRequestSchema) },
      responses: { 200: { description: 'Allocated', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const actor = actorOf(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: actor.apiKeyId, requestId: actor.requestId });
      const src = await source(organization, { paymentId: c.req.valid('param').paymentId });
      const explicit = parseAllocations(body.allocations, src.currency) ?? [];
      const { value } = await plan(organization, src, explicit, undefined, today);
      if (!verifyPreviewToken(body.previewToken, tokenParts(organization.id, src, value.allocations, await store.receivables.listEligible(organization.id, src.customerId, src.currency)))) {
        throw new ApiError('CONFLICT', 'previewToken does not match this allocation set and the current balances; preview again', { reason: 'PREVIEW_STALE' });
      }
      let result;
      try {
        result = await store.payments.allocate(organization.id, src.payment!.id, value.allocations, now);
      } catch (err) {
        if (err instanceof InsufficientCapacity) throw new ApiError('CONFLICT', 'The payment or a receivable changed while allocating; preview again', { reason: 'PREVIEW_STALE', entityId: err.entityId });
        throw err;
      }
      if (!result) throw new ApiError('NOT_FOUND', 'No such payment');
      await audit(actor, 'payment.allocated', 'payment', result.payment.id, { allocations: result.allocations.length, allocated: formatMoney({ minor: value.allocatedMinor, currency: src.currency }) });
      await auditSettled(actor, result.allocations.map((a) => a.receivableId), result.payment.id);
      return c.json(await paymentView(organization.id, result.payment, today), 200);
    },
  );

  // ---- reverse ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payments/{paymentId}/reverse',
      tags: ['Payments'],
      summary: 'Reverse a payment: every allocation undone, status REVERSED',
      description: 'Whole and final (brief decision 4). A replay with the same Idempotency-Key returns the same result; any other request on an already reversed payment is refused with 409 ALREADY_REVERSED. Record a corrected payment with replacesPaymentId afterwards.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'payments.reverse')] as const,
      request: { params: PaymentIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ReversePaymentRequestSchema) },
      responses: { 200: { description: 'Reversed', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const actor = actorOf(c);
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const payment = await mustGetPayment(organization.id, c.req.valid('param').paymentId);
      if (payment.status === 'REVERSED') throw new ApiError('CONFLICT', 'This payment is already reversed', { reason: 'ALREADY_REVERSED', reversedAt: payment.reversedAt?.toISOString() ?? null });
      const allocations = await store.payments.listAllocations(organization.id, payment.id);
      const result = await store.payments.reverse(organization.id, payment.id, c.req.valid('json').reason, now);
      if (!result) throw new ApiError('NOT_FOUND', 'No such payment');
      if (result.changed) await audit(actor, 'payment.reversed', 'payment', payment.id, { number: payment.number, reason: c.req.valid('json').reason, allocationsUndone: allocations.length, amount: formatMoney({ minor: payment.amountMinor, currency: payment.currency as Currency }) });
      return c.json(await paymentView(organization.id, result.payment, today), 200);
    },
  );

  return app;
}

function allocationMessage(reason: string): string {
  switch (reason) {
    case 'ALLOCATION_EXCEEDS_PAYMENT':
      return 'Allocations add up to more than the amount available';
    case 'ALLOCATION_EXCEEDS_OUTSTANDING':
      return 'An allocation exceeds what is outstanding on its receivable';
    case 'ALLOCATION_DUPLICATE':
      return 'A receivable appears twice in the allocations';
    case 'RECEIVABLE_NOT_FOUND':
      return 'An allocation names a receivable this organization does not have';
    case 'RECEIVABLE_NOT_OPEN':
      return 'An allocation names a receivable with nothing outstanding';
    case 'RECEIVABLE_CUSTOMER_MISMATCH':
      return 'An allocation names another customer’s receivable';
    case 'CURRENCY_MISMATCH':
      return 'An allocation names a receivable in another currency; money is never converted';
    default:
      return 'Allocations are invalid';
  }
}
