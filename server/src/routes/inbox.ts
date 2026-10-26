import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import { assertCategoryChoosable, expenseOccurredOn, resolveLinks, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import { identityIdempotent, idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import { assertFilableCurrency, assertKind, inboxDate, parseInboxAmount } from '../inbox/compose.js';
import { decodeInboxCursor, encodeInboxCursor } from '../inbox/cursor.js';
import { incomeCaptureRulesFor, incomeMoneyDate, owedDueDate, owedVatFields, resolveIncomeLinks } from '../income/compose.js';
import type { IsoDate } from '../dates.js';
import { formatMoney, type Currency } from '../money.js';
import type { InboxEntryRecord, LedgerStore, UpdateInboxEntryPatch } from '../repositories/ports.js';
import {
  CreateInboxEntryRequestSchema,
  ExpenseSchema,
  FileAsExpenseRequestSchema,
  FileAsIncomeRequestSchema,
  IfMatchHeaderSchema,
  InboxCountSchema,
  InboxEntryIdParamSchema,
  InboxEntryPageSchema,
  InboxEntrySchema,
  IncomeResponseSchema,
  ListInboxQuerySchema,
  UpdateInboxEntryRequestSchema,
} from '../schemas.js';
import { serializeExpense, serializeIncomeEntry, serializeInboxEntry } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

// MUT-64: a device session is the same 'session' principal, so it reaches every route a cookie session does.
const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;

/**
 * /v1/inbox — the unsorted inbox (MUT-66): money you know happened, before you
 * have decided which profile it belongs to.
 *
 * The four CRUD routes are the one part of /v1 that names no profile: they
 * declare no scope and read `identity`, exactly as `GET /v1/me` does, because
 * an unsorted entry belongs to the person and to no organization. Filing is
 * the opposite — it names a destination profile and declares the real scope of
 * the record it creates, so it is refused in exactly the places a direct
 * create already would be.
 */
export function inboxRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The person behind the request. Deliberately not `sessionAuth`: there is no organization on these four routes. */
  function owner(c: { get(key: 'identity'): { user: { id: string } } }): string {
    return c.get('identity').user.id;
  }

  async function mustGet(userId: string, entryId: string): Promise<InboxEntryRecord> {
    const entry = await store.inboxEntries.getById(userId, entryId);
    if (!entry) throw new ApiError('NOT_FOUND', 'No such inbox entry');
    return entry;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/inbox',
      tags: ['Inbox'],
      summary: 'List your unsorted entries, newest first',
      description: 'Yours alone, on every device you sign in on. No X-Mutaba3a-Profile: an unsorted entry belongs to no profile.',
      security: SESSION_ONLY,
      request: { query: ListInboxQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: InboxEntryPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const page = await store.inboxEntries.list(owner(c), { limit: q.limit, cursor: q.cursor ? decodeInboxCursor(q.cursor) : null });
      return c.json({ items: page.items.map(serializeInboxEntry), nextCursor: page.nextCursor ? encodeInboxCursor(page.nextCursor) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/inbox/count',
      tags: ['Inbox'],
      summary: 'How many unsorted entries are waiting',
      description:
        'Yours alone, on every device you sign in on. No X-Mutaba3a-Profile: an unsorted entry belongs to no profile. ' +
        'MUT-240: the Capture hub\'s Recent handle wants an exact "N to file" without paging a whole list.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'The count', content: { 'application/json': { schema: InboxCountSchema } } }, ...errorResponses },
    }),
    async (c) => {
      const count = await store.inboxEntries.countByUser(owner(c));
      return c.json({ count }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/inbox',
      tags: ['Inbox'],
      summary: 'Capture an amount now, decide where it belongs later',
      description: 'occurredOn may be in the future: with no profile there is no timezone to judge "today" in, so that check happens when you file. A typo year is refused at once: not more than ten years before UTC yesterday (MUT-227); filing applies the exact floor. kind is fixed at capture.',
      security: SESSION_ONLY,
      // MUT-131: a lost response could otherwise be replayed into a duplicate entry — the same
      // protection every other create route (income, expenses, file-as-*) already has.
      middleware: [identityIdempotent(store, 'inbox.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateInboxEntryRequestSchema) },
      responses: { 201: { description: 'Captured', content: { 'application/json': { schema: InboxEntrySchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const entry = await store.inboxEntries.create(
        {
          userId: owner(c),
          kind: body.kind === 'income' ? 'INCOME' : 'EXPENSE',
          amountMinor: parseInboxAmount(body.amount, body.currency),
          currency: body.currency,
          occurredOn: inboxDate(body.occurredOn, c.get('now')()),
          note: body.note ?? null,
          captureSource: body.captureSource ?? null,
        },
        c.get('now')(),
      );
      return c.json(serializeInboxEntry(entry), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/inbox/{entryId}',
      tags: ['Inbox'],
      summary: 'Fix an unsorted entry (optimistic, If-Match)',
      description: 'Anything you captured. Not kind: what an entry is destined to become is fixed at capture. A changed currency needs the amount again (422 AMOUNT_INVALID), read in that currency\'s digits. null clears an optional field.',
      security: SESSION_ONLY,
      middleware: [ifMatch()] as const,
      request: { params: InboxEntryIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateInboxEntryRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: InboxEntrySchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const userId = owner(c);
      const body = c.req.valid('json');
      const existing = await mustGet(userId, c.req.valid('param').entryId);
      // MUT-272: stale is a 409 before the body's business rules run (zod schema validation still runs first), since
      // the amount is parsed in a currency a newer version may have changed. The store's version check still covers a
      // write that lands after this read.
      if (existing.version !== c.get('expectedVersion')) throw versionMismatch(existing.version);
      // The amount is re-parsed against whichever currency ends up on the row, not the one it had.
      const currency: Currency = body.currency ?? (existing.currency as Currency);
      const patch: UpdateInboxEntryPatch = {
        ...(body.amount !== undefined ? { amountMinor: parseInboxAmount(body.amount, currency) } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        // An unchanged date is not re-checked, so an entry already older than MUT-227's floor stays editable.
        ...(body.occurredOn !== undefined && body.occurredOn !== existing.occurredOn ? { occurredOn: inboxDate(body.occurredOn, c.get('now')()) } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.captureSource !== undefined ? { captureSource: body.captureSource } : {}),
      };
      // A currency change with no new amount would silently reinterpret the stored minor units.
      if (body.currency !== undefined && body.currency !== existing.currency && body.amount === undefined) {
        throw validationError('AMOUNT_INVALID', 'Send the amount again when you change the currency', { field: 'amount' });
      }
      const result = await store.inboxEntries.update(userId, existing.id, c.get('expectedVersion'), patch, c.get('now')());
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such inbox entry');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      return c.json(serializeInboxEntry(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/inbox/{entryId}',
      tags: ['Inbox'],
      summary: 'Throw away an unsorted entry',
      description: 'Gone for good — an entry is a scratch note, not a ledger row, so there is no tombstone and no 204-again. A second delete is 404.',
      security: SESSION_ONLY,
      request: { params: InboxEntryIdParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const deleted = await store.inboxEntries.delete(owner(c), c.req.valid('param').entryId);
      if (!deleted) throw new ApiError('NOT_FOUND', 'No such inbox entry');
      return c.body(null, 204);
    },
  );

  // ---- filing: the entry becomes a real record on one chosen profile --------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/inbox/{entryId}/file-as-expense',
      tags: ['Inbox'],
      summary: 'File an unsorted entry as an expense on a profile',
      description:
        'Amount, currency, date and note come from the entry; only what it could not know is sent here. The expense is created and the entry removed in one transaction: on success it is gone, on any refusal it is untouched. 409 ENTRY_KIND_MISMATCH for an entry captured as income.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'inbox.fileAsExpense')] as const,
      request: { params: InboxEntryIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(FileAsExpenseRequestSchema) },
      responses: { 201: { description: 'Filed', content: { 'application/json': { schema: ExpenseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const entry = await mustGet(user.id, c.req.valid('param').entryId);
      assertKind(entry, 'EXPENSE');
      assertFilableCurrency(entry);
      // Every destination-side rule is checked before the transaction opens, so a refusal can never consume the entry.
      // POST /v1/expenses' own date rule (MUT-227 floor, MUT-392 ceiling), so filing is refused exactly where a direct
      // create is, not more.
      expenseOccurredOn(entry.occurredOn, todayFor(organization, now));
      const links = await resolveLinks(store, organization.id, { customerId: body.customerId ?? null, projectId: body.projectId ?? null });
      if (body.categoryId) await assertCategoryChoosable(store, organization.id, body.categoryId);

      // MUT-254: after every check, so a refusal never creates a vendor it didn't need (A2).
      const expense = await withResolvedVendor(
        store,
        organization.id,
        {
          organizationId: organization.id,
          occurredOn: entry.occurredOn,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
          title: body.title ?? null,
          vendor: body.vendor ?? null,
          categoryId: body.categoryId ?? null,
          ...links,
          notes: entry.note,
          createdByUserId: user.id,
          // MUT-436 (review R6): the entry's source stays with the expense it becomes, so its marker survives filing.
          ...(entry.captureSource ? { captureSource: entry.captureSource } : {}),
        },
        body.vendorDetails,
        now,
      );
      const filed = await withCategoryForeignKey(() => store.inboxEntries.fileAsExpense({ userId: user.id, inboxEntryId: entry.id, kind: 'EXPENSE', expense }, now));
      if (filed.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such inbox entry');
      await touchExpenseVendor(store, filed.expense, now);

      await store.audit.append({
        organizationId: organization.id,
        actorType: 'USER',
        actorId: user.id,
        action: 'expense.created',
        entityType: 'expense',
        entityId: filed.expense.id,
        metadata: { currency: filed.expense.currency, occurredOn: filed.expense.occurredOn, filedFromInbox: true, ...(entry.captureSource ? { captureSource: entry.captureSource } : {}) },
        requestId: c.get('requestId'),
      });
      return c.json(serializeExpense(filed.expense), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/inbox/{entryId}/file-as-income',
      tags: ['Inbox'],
      summary: 'File an unsorted entry as income on a profile',
      description:
        'Received or Owed is chosen here, not at capture: the distinction only means something once a client is (or deliberately is not) in the picture. The date rules are POST /v1/income\'s for the chosen kind: an Owed may be up to ten years ahead, a Received not later than today (MUT-392). MUT-65\'s rules apply unchanged — Owed requires a client, and a Malafat-fed profile refuses the write with READ_ONLY_PROFILE, leaving the entry in place. 409 ENTRY_KIND_MISMATCH for an entry captured as an expense.',
      security: SESSION_ONLY,
      middleware: [requireScope('payments:write'), idempotent(store, 'inbox.fileAsIncome')] as const,
      request: { params: InboxEntryIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(FileAsIncomeRequestSchema) },
      responses: { 201: { description: 'Filed', content: { 'application/json': { schema: IncomeResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user, writerOfRecord } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const entry = await mustGet(user.id, c.req.valid('param').entryId);
      assertKind(entry, 'INCOME');
      assertFilableCurrency(entry);
      incomeMoneyDate(entry.occurredOn, body.kind, todayFor(organization, now), 'occurredOn');
      // MUT-65's own validators, reused rather than reimplemented. This route stays on payments:write, so a Malafat-fed
      // profile is refused before this line and only personal-profile rules ever apply here (TD-094).
      const links = await resolveIncomeLinks(store, organization.id, body.kind, { customerId: body.customerId ?? null, projectId: body.projectId ?? null }, entry.currency, incomeCaptureRulesFor(writerOfRecord));

      const filed = await store.inboxEntries.fileAsIncome(
        { userId: user.id, inboxEntryId: entry.id, kind: 'INCOME', write: incomeWrite(entry, body, links, organization.id, user.id, now, todayFor(organization, now), c.get('requestId')) },
        now,
      );
      if (filed.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such inbox entry');

      const metadata = {
        // The entry's own amount, formatted as routes/income.ts formats it — the audit row for a filed
        // entry must read the same as one written directly, not carry the kind in the amount's place.
        amount: formatMoney({ minor: entry.amountMinor, currency: entry.currency as Currency }),
        currency: entry.currency,
        customerId: links.customerId,
        projectId: links.projectId,
        filedFromInbox: true,
        ...(body.kind === 'received' ? { origin: 'CAPTURE' } : {}),
        ...(entry.captureSource ? { captureSource: entry.captureSource } : {}),
      };
      if (filed.result.kind === 'received') {
        await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.received', entityType: 'payment', entityId: filed.result.payment.id, metadata, requestId: c.get('requestId') });
        return c.json(serializeIncomeEntry({ kind: 'received', payment: filed.result.payment }), 201);
      }
      await store.audit.append({ organizationId: organization.id, actorType: 'USER', actorId: user.id, action: 'income.owed', entityType: 'receivable', entityId: filed.result.receivable.id, metadata, requestId: c.get('requestId') });
      return c.json(serializeIncomeEntry({ kind: 'owed', receivable: filed.result.receivable }), 201);
    },
  );

  return app;
}

/** The financial row the entry becomes: the entry supplies the money and the date, the body only what it could not know. */
function incomeWrite(
  entry: InboxEntryRecord,
  body: { kind: 'received' | 'owed'; title?: string | undefined; dueDate?: string | undefined; method?: 'CASH' | 'BANK' | undefined },
  links: { customerId: string | null; projectId: string | null },
  organizationId: string,
  userId: string,
  now: Date,
  today: IsoDate,
  requestId: string,
) {
  if (body.kind === 'received') {
    return {
      kind: 'received' as const,
      payment: {
        organizationId,
        customerId: links.customerId,
        projectId: links.projectId,
        currency: entry.currency,
        amountMinor: entry.amountMinor,
        receivedOn: entry.occurredOn,
        method: body.method ?? ('CASH' as const),
        reference: null,
        notes: entry.note,
        replacesPaymentId: null,
        requestId,
        createdByUserId: userId,
        origin: 'CAPTURE' as const,
        captureSource: entry.captureSource,
        allocations: [],
      },
    };
  }
  if (!links.customerId) throw new ApiError('INTERNAL', 'resolveIncomeLinks guarantees a customerId for owed');
  const vat = owedVatFields(entry.amountMinor);
  return {
    kind: 'owed' as const,
    receivable: {
      organizationId,
      customerId: links.customerId,
      projectId: links.projectId,
      currency: entry.currency,
      netMinor: vat.netMinor,
      vatMinor: vat.vatMinor,
      grossMinor: vat.grossMinor,
      vatTreatment: vat.vatTreatment,
      vatRateBasisPoints: vat.vatRateBasisPoints,
      title: body.title ?? null,
      dueDate: owedDueDate(body.dueDate, entry.occurredOn, today),
      postingDate: entry.occurredOn,
      postedAt: now,
      createdByUserId: userId,
      requestId,
    },
  };
}
