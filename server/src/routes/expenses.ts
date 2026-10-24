import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { checkFile, receiptStorageKey } from '../attachments/rules.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { verifyUploadedObject } from '../attachments/verify.js';
import { endOfMonth, monthOf } from '../dates.js';
import { ApiError } from '../errors.js';
import { assertCategoryChoosable, expenseDate, expensePatch, MAX_RECEIPTS_PER_EXPENSE, prepareExpenseCreate, requestedLinks, resolveLinks, tooManyReceipts, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import { decodeExpenseCursor, encodeExpenseCursor } from '../expenses/cursor.js';
import { groupFilter } from '../expenses/groups.js';
import { computeStreak, loggedAtOf } from '../expenses/streak.js';
import { summarizeExpenses } from '../expenses/summary.js';
import { ownsProfile, profileTypeOf } from '../personal-profile.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { ifMatch } from '../if-match.js';
import type { ExpenseFilter, ExpenseRecord, JsonObject, LedgerStore } from '../repositories/ports.js';
import {
  AttachmentDownloadSchema,
  CreateExpenseRequestSchema,
  CreateReceiptUploadRequestSchema,
  CreateReceiptUploadResponseSchema,
  ErrorEnvelopeSchema,
  ExpenseDetailSchema,
  ExpenseIdParamSchema,
  ExpensePageSchema,
  ExpenseReceiptParamSchema,
  ExpenseReceiptSchema,
  ExpenseSchema,
  ExpenseSummaryQuerySchema,
  ExpenseSummarySchema,
  IfMatchHeaderSchema,
  ListExpensesQuerySchema,
  StreakResponseSchema,
  UpdateExpenseRequestSchema,
} from '../schemas.js';
import { serializeExpense, serializeExpenseReceipt } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, ledgerPageStart, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

/** MUT-339: how far back a streak is read; past a year it is shown as a year and more. */
const STREAK_LOOKBACK_DAYS = 400;

export interface ExpenseRouteOptions {
  /** The M6 attachments bucket; receipts use it under their own prefix (MUT-42 D1). Null: receipt routes answer 503. */
  storage: AttachmentStorage | null;
  urlTtlSeconds: number;
  /** MUT-255/389: this app has the receipts library (hosted with RECEIPTS_LIBRARY on), so a deleted expense's READY receipts go back to it. */
  receiptsLibrary: boolean;
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const noContent = { 204: { description: 'Done' } } as const;
const notConfigured = { 503: { description: 'No attachments bucket is configured for this deployment', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } } as const;

/**
 * /v1/expenses and /v1/summaries/expenses — a hosted profile's expenses (MUT-42).
 * Session-only: Malafat's key reaches none of it (hosted-portal.md §5). Written
 * by the signed-in person, audited as USER, in the original currency.
 */
export function expenseRoutes(store: LedgerStore, options: ExpenseRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  function storage(): AttachmentStorage {
    if (!options.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
    return options.storage;
  }

  function audit(c: Context<AppEnv>, action: string, entityType: 'expense' | 'expense_receipt', entityId: string, metadata?: JsonObject) {
    const auth = sessionAuth(c);
    return store.audit.append({ organizationId: auth.organization.id, actorType: 'USER', actorId: auth.user.id, action, entityType, entityId, ...(metadata ? { metadata } : {}), requestId: c.get('requestId') });
  }

  async function mustGet(organizationId: string, id: string): Promise<ExpenseRecord> {
    const expense = await store.expenses.getById(organizationId, id);
    if (!expense) throw new ApiError('NOT_FOUND', 'No such expense');
    return expense;
  }

  async function mustGetReceipt(organizationId: string, expenseId: string, receiptId: string) {
    await mustGet(organizationId, expenseId);
    const receipt = await store.expenseReceipts.getById(organizationId, receiptId);
    if (!receipt || receipt.expenseId !== expenseId) throw new ApiError('NOT_FOUND', 'No such receipt');
    return receipt;
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expenses',
      tags: ['Expenses'],
      summary: 'List expenses, newest first',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ListExpensesQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ExpensePageSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const filter: ExpenseFilter = {
        ...(q.from ? { from: expenseDate(q.from) } : {}),
        ...(q.to ? { to: expenseDate(q.to) } : {}),
        ...(q.currency ? { currency: q.currency } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.linked === 'none' ? { unlinked: true } : {}),
      };
      // MUT-267: a group's members (or its left-out expenses inside its window); 404 for a group this profile does not have.
      if (q.groupMembership && !q.groupId) throw validationError('GROUP_ID_REQUIRED', '`groupMembership` needs `groupId`', { field: 'groupMembership' });
      if (q.groupId) {
        const group = await store.expenseGroups.getById(organization.id, q.groupId);
        if (!group) throw new ApiError('NOT_FOUND', 'No such expense group');
        filter.group = groupFilter(group, q.groupMembership ?? 'member');
      }
      const cursor = await ledgerPageStart(q, decodeExpenseCursor, (id) => store.expenses.getById(organization.id, id), 'No such expense');
      const page = await store.expenses.list(organization.id, filter, { limit: q.limit, cursor });
      return c.json({ items: page.items.map(serializeExpense), nextCursor: page.nextCursor ? encodeExpenseCursor(page.nextCursor) : null }, 200);
    },
  );

  // MUT-339: before /v1/expenses/{expenseId}, so "streak" is never read as an id.
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expenses/streak',
      tags: ['Expenses'],
      summary: 'This personal profile’s logging streak',
      description:
        'MUT-339 (ADR-177): consecutive days, in the profile’s timezone, on which the profile logged an entry — an expense, money received or an Owed, by when it was logged (createdAt; a capture’s capturedAt within 48 hours). Live rows by the entries feed’s rules; conversions don’t count. Alive through yesterday (D3). Only on a personal profile the caller owns: 409 CONFLICT, details.reason NOT_PERSONAL, elsewhere.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      responses: { 200: { description: 'Streak', content: { 'application/json': { schema: StreakResponseSchema } } }, ...conflictResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user, membershipRole } = sessionAuth(c);
      if (profileTypeOf(organization) !== 'PERSONAL' || !ownsProfile(organization, user.id, membershipRole)) {
        throw new ApiError('CONFLICT', 'Streaks are for your own personal profile', { reason: 'NOT_PERSONAL' });
      }
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const since = new Date(now.getTime() - STREAK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const days = await store.entries.loggedDays(organization.id, since, organization.timezone);
      return c.json({ today, ...computeStreak(days, today, organization.timezone) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expenses/{expenseId}',
      tags: ['Expenses'],
      summary: 'An expense with its receipts',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ExpenseIdParamSchema },
      responses: { 200: { description: 'The expense', content: { 'application/json': { schema: ExpenseDetailSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const expense = await mustGet(organization.id, c.req.valid('param').expenseId);
      const receipts = await store.expenseReceipts.listByExpense(organization.id, expense.id);
      return c.json({ ...serializeExpense(expense), receipts: receipts.map(serializeExpenseReceipt) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/expenses',
      tags: ['Expenses'],
      summary: 'Record an expense',
      description: 'In its original amount and currency, never converted. Personal versus firm-associated is the profile, optionally narrowed by customerId/projectId; with projectId alone the customer is the project\'s.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'expenses.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateExpenseRequestSchema) },
      responses: { 201: { description: 'Recorded', content: { 'application/json': { schema: ExpenseSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const prepared = await prepareExpenseCreate(store, organization.id, user.id, todayFor(organization, now), body);
      const input = await withResolvedVendor(store, organization.id, prepared, body.vendorDetails, now);
      // MUT-339 (S4): kept as when it was logged on the phone, within 48 hours.
      const expense = await withCategoryForeignKey(() => store.expenses.create(input, loggedAtOf(body.capturedAt, now)));
      await touchExpenseVendor(store, expense, now);
      await audit(c, 'expense.created', 'expense', expense.id, { currency: expense.currency, occurredOn: input.occurredOn, ...(body.captureSource ? { captureSource: body.captureSource } : {}) });
      return c.json(serializeExpense(expense), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/expenses/{expenseId}',
      tags: ['Expenses'],
      summary: 'Change an expense (optimistic, If-Match)',
      description: 'Any field. A currency changes only together with its amount (422 AMOUNT_REQUIRED), and the amount is read in the merged currency\'s digits. null clears an optional field. An archived category may stay on a row but cannot be newly chosen.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), ifMatch()] as const,
      request: { params: ExpenseIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateExpenseRequestSchema) },
      responses: { 200: { description: 'Changed', content: { 'application/json': { schema: ExpenseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const body = c.req.valid('json');
      const existing = await mustGet(organization.id, c.req.valid('param').expenseId);
      // MUT-272: stale is a 409 before the body's business rules run (zod schema validation still runs first). The
      // amount is parsed in the row's current currency, which a newer version may have changed (JOD → USD would make a
      // stale "13.456" look like a bad amount). The store's version check below still covers a write after this read.
      if (existing.version !== c.get('expectedVersion')) throw versionMismatch(existing.version);
      const now = c.get('now')();
      const checked = expensePatch(existing, todayFor(organization, now), body);
      const links = requestedLinks(existing, body);
      if (links) Object.assign(checked, await resolveLinks(store, organization.id, links));
      if (checked.categoryId && checked.categoryId !== existing.categoryId) await assertCategoryChoosable(store, organization.id, checked.categoryId);
      // MUT-254: last, after every check (A2); only a sent `vendor` re-links.
      const patch = await withResolvedVendor(store, organization.id, checked, body.vendorDetails, now);
      // MUT-272: a currency move rewrites the amount too, so the audit keeps both sides of it. Built before the
      // write, so nothing that can throw runs after it commits.
      const money = (minor: bigint, currency: string) => formatMoney({ minor, currency: currency as Currency });
      const currencyMove =
        patch.currency !== undefined && patch.currency !== existing.currency
          ? { currency: { from: existing.currency, to: patch.currency }, amount: { from: money(existing.amountMinor, existing.currency), to: money(patch.amountMinor!, patch.currency) } }
          : {};
      const result = await withCategoryForeignKey(() => store.expenses.update(organization.id, existing.id, c.get('expectedVersion'), patch, now));
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such expense');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      if (body.vendor !== undefined || body.categoryId !== undefined) await touchExpenseVendor(store, result.record, now);
      await audit(c, 'expense.updated', 'expense', result.record.id, { fields: Object.keys(body), version: result.record.version, ...currencyMove });
      return c.json(serializeExpense(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/expenses/{expenseId}',
      tags: ['Expenses'],
      summary: 'Delete an expense (soft)',
      description: '204 again for an expense already deleted; 404 for an id this profile never had. Where the receipts library is on (RECEIPTS_LIBRARY, MUT-255/389), its READY receipts stay, back under To review in the library, and an unfinished upload is deleted with its file. Where it is off (the production default until MUT-260/258) and in the signed-out portal, every receipt is deleted with its file.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseIdParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const now = c.get('now')();
      const deleted = await store.expenses.softDelete(organization.id, c.req.valid('param').expenseId, now, options.receiptsLibrary ? 'unlink' : 'remove');
      if (!deleted) throw new ApiError('NOT_FOUND', 'No such expense');
      if (deleted.changed) {
        if (options.storage) for (const r of deleted.removedReceipts) if (r.storageKey) await options.storage.remove(r.storageKey);
        await audit(c, 'expense.deleted', 'expense', deleted.record.id, { pendingReceiptsRemoved: deleted.removedReceipts.length });
      }
      return c.body(null, 204);
    },
  );

  // ---- receipts: the M6 upload flow, on the same bucket and TTL ----

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/expenses/{expenseId}/receipts',
      tags: ['Expenses'],
      summary: 'Start a receipt upload: a PENDING_UPLOAD receipt and a short-lived signed PUT URL',
      description: `PDF, JPEG or PNG up to 10 MB; at most ${MAX_RECEIPTS_PER_EXPENSE} per expense. PUT the bytes to upload.url with upload.headers, then POST …/receipts/{receiptId}/complete. The object key never contains the filename.`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseIdParamSchema, body: jsonBody(CreateReceiptUploadRequestSchema) },
      responses: { 201: { description: 'Upload started', content: { 'application/json': { schema: CreateReceiptUploadResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization, user } = sessionAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const check = checkFile(body);
      if (!check.ok) throw validationError(check.reason, `Upload refused: ${check.reason}`);
      const expense = await mustGet(organization.id, c.req.valid('param').expenseId);
      await assertRoomForReceipt(organization.id, expense.id);
      const created = await store.expenseReceipts.create(
        { organizationId: organization.id, expenseId: expense.id, filename: body.filename, mimeType: body.mimeType, sizeBytes: body.sizeBytes, receivedOn: todayFor(organization, now), uploadedByUserId: user.id, requestId: c.get('requestId') },
        now,
      );
      const keyed = (await store.expenseReceipts.setKey(organization.id, created.id, receiptStorageKey(organization.id, created.id))) ?? created;
      const upload = await s.signUpload(keyed.storageKey, { mimeType: body.mimeType, sizeBytes: body.sizeBytes, ttlSeconds: options.urlTtlSeconds, now });
      return c.json({ receipt: serializeExpenseReceipt(keyed), upload: { url: upload.url, method: 'PUT' as const, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/expenses/{expenseId}/receipts/{receiptId}/complete',
      tags: ['Expenses'],
      summary: 'Finish a receipt upload: verify the object and mark the receipt READY',
      description: '422 UPLOAD_INCOMPLETE when no object exists yet; 422 UPLOAD_MISMATCH when its size or content type differ from what was declared. Idempotent once READY.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseReceiptParamSchema },
      responses: { 200: { description: 'READY', content: { 'application/json': { schema: ExpenseReceiptSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = sessionAuth(c);
      const { expenseId, receiptId } = c.req.valid('param');
      const receipt = await mustGetReceipt(organization.id, expenseId, receiptId);
      if (receipt.status === 'READY') return c.json(serializeExpenseReceipt(receipt), 200);
      // Storage first, outside any transaction: no network I/O under a database lock.
      await verifyUploadedObject(s, receipt);
      // MUT-397: the room check and the flip to READY happen under the expense lock, the same one filing takes.
      const result = await store.expenseReceipts.completeOnExpense({ organizationId: organization.id, expenseId, receiptId: receipt.id, maxReceipts: MAX_RECEIPTS_PER_EXPENSE }, c.get('now')());
      if (result.kind === 'expense_not_found') throw new ApiError('NOT_FOUND', 'No such expense');
      if (result.kind === 'receipt_not_found') throw new ApiError('NOT_FOUND', 'No such receipt');
      if (result.kind === 'too_many_receipts') throw tooManyReceipts();
      if (result.kind === 'completed') await audit(c, 'expense_receipt.added', 'expense_receipt', result.receipt.id, { expenseId, filename: result.receipt.filename, sizeBytes: result.receipt.sizeBytes });
      return c.json(serializeExpenseReceipt(result.receipt), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/expenses/{expenseId}/receipts/{receiptId}/download',
      tags: ['Expenses'],
      summary: 'A short-lived signed download URL for a READY receipt',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ExpenseReceiptParamSchema },
      responses: { 200: { description: 'Signed URL', content: { 'application/json': { schema: AttachmentDownloadSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = sessionAuth(c);
      const { expenseId, receiptId } = c.req.valid('param');
      const receipt = await mustGetReceipt(organization.id, expenseId, receiptId);
      if (receipt.status !== 'READY') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
      const signed = await s.signDownload(receipt.storageKey, { filename: receipt.filename, mimeType: receipt.mimeType, ttlSeconds: options.urlTtlSeconds, now: c.get('now')() });
      return c.json({ url: signed.url, expiresAt: signed.expiresAt.toISOString(), filename: receipt.filename, mimeType: receipt.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/expenses/{expenseId}/receipts/{receiptId}',
      tags: ['Expenses'],
      summary: 'Delete a receipt (soft; the object is removed)',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ExpenseReceiptParamSchema },
      responses: { ...noContent, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = sessionAuth(c);
      const { expenseId, receiptId } = c.req.valid('param');
      const receipt = await mustGetReceipt(organization.id, expenseId, receiptId);
      await store.expenseReceipts.softDelete(organization.id, receipt.id, c.get('now')());
      await s.remove(receipt.storageKey);
      await audit(c, 'expense_receipt.deleted', 'expense_receipt', receipt.id, { expenseId });
      return c.body(null, 204);
    },
  );

  // ---- the summary (D3): its own operation, because the organization summary is shared with Malafat ----

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/expenses',
      tags: ['Expenses'],
      summary: 'Expenses per currency for a date range, by category and by client',
      description: 'Defaults to this month in the organization timezone; from and to are inclusive. One block per currency — never summed across currencies. customerId null = spending linked to no client.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ExpenseSummaryQuerySchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: ExpenseSummarySchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const today = todayFor(organization, c.get('now')());
      const from = q.from ? expenseDate(q.from) : `${monthOf(today)}-01`;
      const to = q.to ? expenseDate(q.to) : endOfMonth(today);
      if (from > to) throw validationError('END_BEFORE_START', '`to` is before `from`', { field: 'to' });
      const expenses: ExpenseRecord[] = [];
      let cursor = null;
      do {
        const page = await store.expenses.list(organization.id, { from, to }, { limit: 200, cursor });
        expenses.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return c.json({ from, to, currencies: summarizeExpenses(expenses) }, 200);
    },
  );

  /** Advisory, for the upload start only: completion re-checks under the expense lock (completeOnExpense, MUT-397). */
  async function assertRoomForReceipt(organizationId: string, expenseId: string): Promise<void> {
    if ((await store.expenseReceipts.listByExpense(organizationId, expenseId)).length >= MAX_RECEIPTS_PER_EXPENSE) throw tooManyReceipts();
  }

  return app;
}
