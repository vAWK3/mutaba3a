import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { actorOf, keyAuth, postingActorOf, requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { compareIsoDates, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { isOwnCapture, isOwnProfile, redateTo } from '../income/compose.js';
import { notOwner } from '../personal-profile.js';
import { formatMoney, type Currency } from '../money.js';
import { eligibleFor, resultingBalances, suggestAllocations, validateAllocations, type AllocationRequest, type AllocationStrategy } from '../payments/allocate.js';
import { allocationSnapshot, paymentPreviewToken } from '../payments/preview-token.js';
import { carriedReceiptNumber, normalizeReceiptNumber } from '../payments/receipt-number.js';
import { verifyPreviewToken } from '../preview-token.js';
import { InsufficientCapacity, LockConflict } from '../repositories/memory.js';
import { CAPTURE_UNDO_REASON, type JsonObject, type LedgerStore, type Organization, type PaymentRecord, type ReceivableRecord } from '../repositories/ports.js';
import {
  AllocatePaymentRequestSchema,
  AllocationPreviewRequestSchema,
  AllocationPreviewResponseSchema,
  CreatePaymentRequestSchema,
  ListPaymentsQuerySchema,
  PaymentIdParamSchema,
  PaymentPageSchema,
  IfMatchHeaderSchema,
  PaymentSchema,
  ReversePaymentRequestSchema,
  SetReceiptNumberRequestSchema,
  UpdatePaymentRequestSchema,
} from '../schemas.js';
import { outstandingMinor, receivableStatus, serializeAllocation, serializePayment, type CapturedBy } from '../serializers.js';
import { PAYMENT_REDATED } from './audit.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse, versionMismatch } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

interface Actor {
  organizationId: string;
  actorType: 'API_KEY' | 'USER';
  actorId: string;
  requestId: string;
}

/** /v1/allocations/preview, /v1/payments — payments, allocations, reversals (M4 brief §2.3). */
export function paymentRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The key-only routes (create, allocate). */
  const keyActorOf = (c: Parameters<typeof keyAuth>[0]): Actor => {
    const { organization, apiKey } = keyAuth(c);
    return { organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') };
  };

  /** MUT-453: reverse takes a key or a person; the audit says which. */
  const principalActorOf = (c: Parameters<typeof keyAuth>[0]): Actor => ({ organizationId: c.get('auth').organization.id, ...actorOf(c), requestId: c.get('requestId') });

  const audit = (a: Actor, action: string, entityType: string, entityId: string, metadata: JsonObject) =>
    store.audit.append({ organizationId: a.organizationId, actorType: a.actorType, actorId: a.actorId, action, entityType, entityId, metadata, requestId: a.requestId });

  async function paymentView(organizationId: string, payment: PaymentRecord, today: IsoDate, people: ReadonlyMap<string, CapturedBy>) {
    const allocations = await store.payments.listAllocations(organizationId, payment.id);
    const receivables = new Map((await store.receivables.getByIds(organizationId, allocations.map((a) => a.receivableId))).map((r) => [r.id, r]));
    const replacedBy = await store.payments.findReplacedBy(organizationId, payment.id);
    return serializePayment(
      payment,
      allocations.map((a) => serializeAllocation(a, receivables.get(a.receivableId) ?? null, payment.currency, today)),
      replacedBy?.id ?? null,
      (payment.createdByUserId && people.get(payment.createdByUserId)) || null,
    );
  }

  /**
   * MUT-61: who captured these payments, one lookup per distinct person (a page's
   * payments come from a handful of people at most), not one per payment.
   */
  async function capturersOf(payments: readonly PaymentRecord[]): Promise<Map<string, CapturedBy>> {
    const ids = [...new Set(payments.map((p) => p.createdByUserId).filter((id): id is string => id !== null))];
    const users = await Promise.all(ids.map((id) => store.users.getById(id)));
    return new Map(users.filter((u) => u !== null).map((u) => [u.id, { userId: u.id, displayName: u.displayName }]));
  }

  const viewOf = async (organizationId: string, payment: PaymentRecord, today: IsoDate) => paymentView(organizationId, payment, today, await capturersOf([payment]));

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
      // A session's clientless "Received" capture (MUT-65) has no customer to allocate against; Malafat's allocation flow never reaches it in practice (session writes are session-only routes), but the type is honest about it.
      if (!payment.customerId) throw validationError('PAYMENT_HAS_NO_CUSTOMER', 'This payment has no customer to allocate against', { paymentId: payment.id });
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

  /**
   * Allocation ever only concerns a receivable with a project (Malafat's
   * INSTALLMENT/RETAINER_CHARGE rows always have one). A personal profile's
   * projectless "Owed" capture (MUT-65) is simply never eligible here — it is
   * read and settled through /v1/income and /v1/receivables/{id}/settle
   * instead, never through this allocation engine.
   */
  function allocatable(records: readonly ReceivableRecord[]): Array<ReceivableRecord & { projectId: string }> {
    return records.filter((r): r is ReceivableRecord & { projectId: string } => r.projectId !== null);
  }

  /** The validated set (explicit, suggested, or empty) plus everything the response and the token need. */
  async function plan(organization: Organization, src: { customerId: string; currency: Currency; amountMinor: bigint }, explicit: AllocationRequest[] | undefined, strategy: AllocationStrategy | undefined, today: IsoDate) {
    const eligible = allocatable(await store.receivables.listEligible(organization.id, src.customerId, src.currency));
    const referenced = explicit ? explicit.map((a) => a.receivableId).filter((id) => !eligible.some((r) => r.id === id)) : [];
    const extra = referenced.length > 0 ? allocatable(await store.receivables.getByIds(organization.id, referenced)) : [];
    const pool = [...eligible, ...extra];
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
      await postDueItems(store, organization, today, now, postingActorOf(c));
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
      const actor = keyActorOf(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      assertIsoDate(body.receivedOn, 'receivedOn');
      assertNotAbsurdDate(body.receivedOn, today, 'receivedOn');
      const givenReceiptNumber = body.receiptNumber === undefined ? undefined : receiptNumberOf(body.receiptNumber);
      let replacedOn: IsoDate | null = null;
      let replaced: PaymentRecord | null = null;
      if (body.replacesPaymentId) {
        replaced = await store.payments.getById(organization.id, body.replacesPaymentId);
        if (!replaced || replaced.status !== 'REVERSED') throw validationError('REPLACES_NOT_REVERSED', 'replacesPaymentId must name a REVERSED payment', { field: 'replacesPaymentId' });
        if (replaced.customerId !== body.customerId) throw validationError('REPLACES_CUSTOMER_MISMATCH', 'The replaced payment belongs to another customer', { field: 'replacesPaymentId' });
        // Only the first replacement keeps the exemption below: it is the one correction, not a standing licence.
        if (!(await store.payments.findReplacedBy(organization.id, replaced.id))) replacedOn = replaced.receivedOn;
      }
      // MUT-227 floor. A correction (reverse, then record with replacesPaymentId) may keep the reversed payment's own
      // date, or move it later, even below the floor: the reversal has already committed, and refusing the second
      // step would leave the money with no payment at all (ADR-086).
      if (replacedOn === null || compareIsoDates(body.receivedOn, replacedOn) < 0) assertNotTooOld(body.receivedOn, today, 'receivedOn');
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: actor.actorId, requestId: actor.requestId });
      const src = await source(organization, { customerId: body.customerId, currency: body.currency, amount: body.amount });
      const explicit = parseAllocations(body.allocations, src.currency) ?? [];
      const { value, token } = await plan(organization, src, explicit, undefined, today);
      // Recomputed through the same path as the preview: a mismatch is the allocation set or the balances.
      if (!verifyPreviewToken(body.previewToken, tokenParts(organization.id, src, value.allocations, await store.receivables.listEligible(organization.id, src.customerId, src.currency)))) {
        throw new ApiError('CONFLICT', 'previewToken does not match this allocation set and the current balances; preview again', { reason: 'PREVIEW_STALE' });
      }
      void token;
      // MUT-481 (D1): a correction that leaves the field out keeps the reversed payment's number.
      const receipt = carriedReceiptNumber({ given: givenReceiptNumber, replaced });
      let created;
      try {
        created = await store.payments.create(
          { organizationId: organization.id, customerId: src.customerId, projectId: null, currency: src.currency, amountMinor: src.amountMinor, receivedOn: body.receivedOn, method: body.method, reference: body.reference ?? null, receiptNumber: receipt.value, notes: body.notes ?? null, replacesPaymentId: body.replacesPaymentId ?? null, requestId: actor.requestId, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: value.allocations },
          now,
        );
      } catch (err) {
        if (err instanceof InsufficientCapacity) throw new ApiError('CONFLICT', 'A receivable changed while the payment was being recorded; preview again', { reason: 'PREVIEW_STALE', entityId: err.entityId });
        if (err instanceof LockConflict) throw new ApiError('CONFLICT', 'A receivable was being changed at the same moment; nothing was recorded, preview again', { reason: 'PREVIEW_STALE' });
        throw err;
      }
      await audit(actor, 'payment.recorded', 'payment', created.payment.id, { number: created.payment.number, customerId: src.customerId, amount: formatMoney({ minor: src.amountMinor, currency: src.currency }), currency: src.currency, allocations: created.allocations.length, unallocated: formatMoney({ minor: value.unallocatedMinor, currency: src.currency }), ...(body.replacesPaymentId ? { replacesPaymentId: body.replacesPaymentId } : {}), ...(receipt.value ? { receiptNumber: receipt.value } : {}), ...(receipt.carried ? { receiptNumberCarried: true } : {}) });
      await auditSettled(actor, created.allocations.map((a) => a.receivableId), created.payment.id);
      return c.json(await viewOf(organization.id, created.payment, today), 201);
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
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { query: ListPaymentsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: PaymentPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const today = todayFor(organization, c.get('now')());
      const page = await store.payments.list(
        organization.id,
        {
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.receivedBefore ? { receivedBefore: q.receivedBefore } : {}),
          ...(q.receivedAfter ? { receivedAfter: q.receivedAfter } : {}),
          ...(q.origin ? { origin: q.origin === 'capture' ? ('CAPTURE' as const) : ('INTEGRATION' as const) } : {}),
          ...(q.allocationState ? { allocationState: q.allocationState } : {}),
          ...(q.receiptNumber?.trim() ? { receiptNumber: q.receiptNumber.trim() } : {}),
        },
        toPageRequest(q),
      );
      const people = await capturersOf(page.items);
      const items = [];
      for (const p of page.items) items.push(await paymentView(organization.id, p, today, people));
      return c.json({ items, nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/payments/{paymentId}',
      tags: ['Payments'],
      summary: 'Get a payment with its allocations',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: PaymentIdParamSchema },
      responses: { 200: { description: 'The payment', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const today = todayFor(organization, c.get('now')());
      return c.json(await viewOf(organization.id, await mustGetPayment(organization.id, c.req.valid('param').paymentId), today), 200);
    },
  );

  // ---- re-date (MUT-223): a person's own captured payment, on a profile they own ----
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/payments/{paymentId}',
      tags: ['Payments'],
      summary: 'Change the date of a payment you recorded (optimistic, If-Match)',
      description:
        'Date only: amount, client and allocations are never touched, and a settled entry\'s paid date follows (ADR-038). Only a POSTED payment this person captured (POST /v1/income Received, or a settle) on a profile they own; any other id answers 404. On a Malafat-fed profile the session holds no payments:write, so this answers 403 READ_ONLY_PROFILE before any lookup, as settle does. receivedOn may not be later than the organization\'s today, nor more than ten years before it (MUT-227). The payment number keeps its year.',
      security: [{ session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:write'), ifMatch()] as const,
      request: { params: PaymentIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdatePaymentRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user, membershipRole } = sessionAuth(c);
      const now = c.get('now')();
      const receivedOn = redateTo(c.req.valid('json').receivedOn, 'received', organization, now, 'receivedOn');
      const notFound = () => new ApiError('NOT_FOUND', 'No such payment');
      const payment = await store.payments.getById(organization.id, c.req.valid('param').paymentId);
      if (!payment || !isOwnProfile(organization, user.id, membershipRole) || !isOwnCapture(payment, user.id)) throw notFound();
      const updated = await redateOwnCapture(store, c, payment, receivedOn, notFound);
      return c.json(await viewOf(organization.id, updated, todayFor(organization, now)), 200);
    },
  );

  // ---- MUT-481 (D5): the receipt number, set after recording ----
  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/payments/{paymentId}/receipt-number',
      tags: ['Payments'],
      summary: 'Set or clear the legal receipt number of a recorded payment (optimistic, If-Match)',
      description:
        'For a receipt the firm issued in its invoicing app after the payment was recorded. A label only: no money moves, the allocations and the ledger figures are untouched. API key only. POSTED payments the key recorded only (a reversed one is 409 ALREADY_REVERSED: record its correction with the number instead; one a person recorded is 422 RECEIPT_NUMBER_NOT_ALLOWED). Send the version you read in If-Match; another version is 409 VERSION_MISMATCH. Setting the value it already has answers 200 without a new version, so a retry after a lost response succeeds.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:write'), ifMatch()] as const,
      request: { params: PaymentIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(SetReceiptNumberRequestSchema) },
      responses: { 200: { description: 'Set', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      // A disconnected firm's session holds payments:write: this route is the integration's only (review R7).
      const actor = keyActorOf(c);
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const receiptNumber = receiptNumberOf(c.req.valid('json').receiptNumber);
      const payment = await mustGetPayment(organization.id, c.req.valid('param').paymentId);
      // D6: a payment a person recorded never carries one, and its own re-date (If-Match) must keep its version.
      if (payment.origin !== 'INTEGRATION') throw validationError('RECEIPT_NUMBER_NOT_ALLOWED', 'Only payments recorded through the API key carry a receipt number', { field: 'receiptNumber' });
      if (payment.status === 'REVERSED') throw alreadyReversed(payment);
      const today = todayFor(organization, now);
      // Before the version check: a retry after a lost response carries the version it first read (review 1).
      if (payment.receiptNumber === receiptNumber) return c.json(await viewOf(organization.id, payment, today), 200);
      const expected = c.get('expectedVersion');
      if (payment.version !== expected) throw versionMismatch(payment.version);
      const result = await store.payments.setReceiptNumber(organization.id, payment.id, expected, receiptNumber, now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such payment');
      if (result.kind === 'stale') throw result.record.status === 'REVERSED' ? alreadyReversed(result.record) : versionMismatch(result.record.version);
      await audit(actor, 'payment.receipt_number_set', 'payment', payment.id, { from: payment.receiptNumber, to: receiptNumber, version: result.record.version });
      return c.json(await viewOf(organization.id, result.record, today), 200);
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
      const actor = keyActorOf(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      await postDueItems(store, organization, today, now, { actorType: 'API_KEY', actorId: actor.actorId, requestId: actor.requestId });
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
        if (err instanceof LockConflict) throw new ApiError('CONFLICT', 'A receivable was being changed at the same moment; nothing was allocated, preview again', { reason: 'PREVIEW_STALE' });
        throw err;
      }
      if (!result) throw new ApiError('NOT_FOUND', 'No such payment');
      await audit(actor, 'payment.allocated', 'payment', result.payment.id, { allocations: result.allocations.length, allocated: formatMoney({ minor: value.allocatedMinor, currency: src.currency }) });
      await auditSettled(actor, result.allocations.map((a) => a.receivableId), result.payment.id);
      return c.json(await viewOf(organization.id, result.payment, today), 200);
    },
  );

  // ---- reverse ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/payments/{paymentId}/reverse',
      tags: ['Payments'],
      summary: 'Reverse a payment: every allocation undone, status REVERSED',
      description: 'Whole and final (brief decision 4). A replay with the same Idempotency-Key returns the same result; any other request on an already reversed payment is refused with 409 ALREADY_REVERSED. A reversal that collides with another write on the same receivables is refused with 409 VERSION_MISMATCH and changes nothing; send it again with a new Idempotency-Key. Record a corrected payment with replacesPaymentId afterwards. MUT-453: a session or device session may reverse on a profile the person owns (its creator or a co-owner; otherwise 403 READ_ONLY_PROFILE, reason NOT_OWNER), and only a payment a person recorded (origin CAPTURE) that paid only entries a person recorded; any other is 404.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('payments:write'), idempotent(store, 'payments.reverse')] as const,
      request: { params: PaymentIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ReversePaymentRequestSchema) },
      responses: { 200: { description: 'Reversed', content: { 'application/json': { schema: PaymentSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const actor = principalActorOf(c);
      // MUT-453 (D1, owner-only, qa-reconcile): a person corrects money only on a profile they own (its creator or a
      // co-owner), before any lookup; a firm's members, a disconnected Malafat firm's included, never.
      if (actor.actorType === 'USER') {
        const { organization: org, user, membershipRole } = sessionAuth(c);
        if (!isOwnProfile(org, user.id, membershipRole)) throw notOwner();
      }
      const now = c.get('now')();
      const today = todayFor(organization, now);
      // MUT-61: the reason a person's own capture undo records is how that undo is told apart from this route's reversal.
      if (c.req.valid('json').reason === CAPTURE_UNDO_REASON) throw validationError('REASON_RESERVED', `"${CAPTURE_UNDO_REASON}" is reserved for a person undoing their own capture`, { field: 'reason' });
      const payment = await mustGetPayment(organization.id, c.req.valid('param').paymentId);
      // MUT-453 (review D5): a disconnected Malafat firm reads as writer-null, so its session holds payments:write; Malafat's
      // own payments stay its to reverse. 404, not 403, as settle answers for a receivable it may not touch.
      if (actor.actorType === 'USER' && payment.origin !== 'CAPTURE') throw new ApiError('NOT_FOUND', 'No such payment');
      if (payment.status === 'REVERSED') throw alreadyReversed(payment);
      const allocations = await store.payments.listAllocations(organization.id, payment.id);
      // MUT-453 (review fix): a person's reversal never reopens an entry Malafat posted (an installment or retainer
      // charge its key once applied this capture to); like undo's ALREADY_ALLOCATED, only what a person put on the books.
      if (actor.actorType === 'USER' && allocations.length > 0) {
        const targets = await store.receivables.getByIds(organization.id, allocations.map((a) => a.receivableId));
        if (targets.some((r) => r.origin !== 'ADJUSTMENT')) throw new ApiError('NOT_FOUND', 'No such payment');
      }
      const result = await store.payments.reverse(organization.id, payment.id, c.req.valid('json').reason, now).catch((err: unknown) => {
        if (err instanceof LockConflict) throw new ApiError('CONFLICT', 'A receivable was being changed at the same moment; nothing was reversed, send the request again', { reason: 'VERSION_MISMATCH' });
        throw err;
      });
      if (!result) throw new ApiError('NOT_FOUND', 'No such payment');
      if (result.changed) await audit(actor, 'payment.reversed', 'payment', payment.id, { number: payment.number, reason: c.req.valid('json').reason, allocationsUndone: allocations.length, amount: formatMoney({ minor: payment.amountMinor, currency: payment.currency as Currency }) });
      return c.json(await viewOf(organization.id, result.payment, today), 200);
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

/**
 * MUT-223: the payment half of both re-date routes — PATCH /v1/payments/{id}, and PATCH /v1/income/{id} on a Received
 * entry. The caller has already checked the profile (`isOwnProfile`) and the payment (`isOwnCapture`); the version is
 * checked against that read, so its `receivedOn` is exactly the date the audit row says was replaced. `notFound` is the
 * caller's own 404, so a row undone mid-request answers in that route's words.
 */
export async function redateOwnCapture(store: LedgerStore, c: Context<AppEnv>, payment: PaymentRecord, receivedOn: IsoDate, notFound: () => ApiError): Promise<PaymentRecord> {
  const { organization, user } = sessionAuth(c);
  const expected = c.get('expectedVersion');
  if (payment.version !== expected) throw versionMismatch(payment.version);
  const result = await store.payments.redateCapture(organization.id, payment.id, user.id, expected, receivedOn, c.get('now')());
  if (result.kind === 'not_found') throw notFound();
  if (result.kind === 'stale') throw versionMismatch(result.record.version);
  await store.audit.append({
    organizationId: organization.id,
    actorType: 'USER',
    actorId: user.id,
    action: PAYMENT_REDATED,
    entityType: 'payment',
    entityId: payment.id,
    metadata: { from: payment.receivedOn, to: receivedOn, version: result.record.version },
    requestId: c.get('requestId'),
  });
  return result.record;
}

function alreadyReversed(payment: PaymentRecord): ApiError {
  return new ApiError('CONFLICT', 'This payment is already reversed', { reason: 'ALREADY_REVERSED', reversedAt: payment.reversedAt?.toISOString() ?? null });
}

/** MUT-481 (D3, review R6): normalized in the handler, so a bad value is RECEIPT_NUMBER_INVALID, not a schema failure. */
function receiptNumberOf(raw: string | null): string | null {
  const result = normalizeReceiptNumber(raw);
  if (!result.ok) throw validationError('RECEIPT_NUMBER_INVALID', 'receiptNumber must be 1–64 characters with no control characters; send null for none', { field: 'receiptNumber' });
  return result.value;
}
