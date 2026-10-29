import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, todayFor, validationError } from '../agreements/compose.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { ApiError } from '../errors.js';
import type { ReceiptReadTrigger } from '../receipts/reading/reader.js';
import { completeLibraryReceipt, MAX_PENDING_LIBRARY_UPLOADS, moveLibraryReceipt, receiptAudit, signReceiptUpload, startLibraryReceipt, type ReceiptActor, type ReceiptDeps } from '../expenses/receipts-compose.js';
import { MAX_RECEIPTS_PER_EXPENSE, prepareExpenseCreate, tooManyReceipts, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import { idempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import type { RateLimiter } from '../rate-limit.js';
import { decodeReceiptCursor, encodeReceiptCursor } from '../receipts/cursor.js';
import type { ApprovedReceiptFields, ExpenseReceiptRecord, JsonObject, LedgerStore } from '../repositories/ports.js';
import {
  ApproveReceiptRequestSchema,
  ApproveReceiptResponseSchema,
  AttachmentDownloadSchema,
  CreateLibraryReceiptUploadRequestSchema,
  CreateReceiptUploadResponseSchema,
  ErrorEnvelopeSchema,
  ExpenseReceiptSchema,
  FileReceiptRequestSchema,
  FileReceiptResponseSchema,
  IfMatchHeaderSchema,
  ListReceiptsQuerySchema,
  MoveReceiptRequestSchema,
  MoveReceiptResponseSchema,
  ReceiptCountsSchema,
  ReceiptDownloadQuerySchema,
  ReceiptIdParamSchema,
  ReceiptPageSchema,
  ReceiptSuggestionSchema,
  SignedUploadSchema,
} from '../schemas.js';
import { serializeExpense, serializeExpenseReceipt, serializeReceiptLibraryItem } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

/** MUT-255 decision P3: unfinished library uploads one profile may hold from the last day, before a new one is refused. */
export { MAX_PENDING_LIBRARY_UPLOADS } from '../expenses/receipts-compose.js';
/** MUT-255 decision P3: upload starts per person per minute. */
export const RECEIPT_UPLOAD_POLICY = { perMinute: 30 } as const;

export interface ReceiptRouteOptions {
  /** The M6 attachments bucket, under the expense-receipts prefix (MUT-42 D1). Null: every route answers 503. */
  storage: AttachmentStorage | null;
  urlTtlSeconds: number;
  /** Per-person budget for starting uploads (decision P3). */
  uploadLimiter: RateLimiter;
  /** MUT-441: the server's reader while SERVER_OCR is on; absent = receipts are not read. */
  reading?: ReceiptReadTrigger | null;
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const notConfigured = { 503: { description: 'No attachments bucket is configured for this deployment', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } } as const;

/**
 * /v1/receipts — the receipts library (MUT-255, epic MUT-252). A receipt is saved the moment it is shared and waits
 * as To review on its profile until it is approved into an expense (or deleted). Hosted only: mounted in app.ts, not
 * in PORTAL_ROUTES, so signed-out local mode has no library (decision P1). Session-only, like every expense route:
 * Malafat's key reaches none of it. The MUT-44 routes under /v1/expenses/{id}/receipts still attach a receipt to an
 * existing expense; those receipts are FILED from the start.
 */
export function receiptRoutes(store: LedgerStore, options: ReceiptRouteOptions): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  function storage(): AttachmentStorage {
    if (!options.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
    return options.storage;
  }

  function audit(c: Context<AppEnv>, action: string, entityType: 'expense' | 'expense_receipt', entityId: string, metadata?: JsonObject) {
    const auth = sessionAuth(c);
    return receiptAudit(store, { organizationId: auth.organization.id, userId: auth.user.id, requestId: c.get('requestId') })(action, entityType, entityId, metadata);
  }

  async function mustGet(organizationId: string, id: string): Promise<ExpenseReceiptRecord> {
    const receipt = await store.expenseReceipts.getById(organizationId, id);
    if (!receipt) throw new ApiError('NOT_FOUND', 'No such receipt');
    return receipt;
  }

  const receiptDeps: ReceiptDeps = { store, storage: options.storage, urlTtlSeconds: options.urlTtlSeconds, reading: options.reading ?? null };

  function receiptActor(c: Context<AppEnv>): ReceiptActor {
    const { organization, user } = sessionAuth(c);
    return { organization, userId: user.id, requestId: c.get('requestId'), now: c.get('now')(), audit: (...args) => audit(c, ...args) };
  }

  function signUpload(receipt: ExpenseReceiptRecord, now: Date) {
    return signReceiptUpload(receiptDeps, receipt, now);
  }

  /** 409 naming where the receipt is filed, so a client whose first answer was lost can still open the expense. */
  async function alreadyFiled(organizationId: string, receiptId: string): Promise<ApiError> {
    const filed = await store.expenseReceipts.getById(organizationId, receiptId);
    return new ApiError('CONFLICT', 'This receipt is already filed', { reason: 'RECEIPT_ALREADY_FILED', expenseId: filed?.expenseId ?? null });
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/uploads',
      tags: ['Receipts'],
      summary: 'Start a library upload: a To-review receipt with no expense, and a short-lived signed PUT URL',
      description: `PDF, JPEG or PNG up to 10 MB. PUT the bytes to upload.url with upload.headers, then POST /v1/receipts/{receiptId}/complete; if the URL expired first (a replayed request answers the original), POST …/upload-url for a fresh one. 429 (reason TOO_MANY_PENDING_UPLOADS) when the profile already holds ${MAX_PENDING_LIBRARY_UPLOADS} unfinished uploads from the last 24 hours; 429 past ${RECEIPT_UPLOAD_POLICY.perMinute} starts a minute per person. Either 429 leaves the Idempotency-Key free, so the same request can be sent again with it.`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'receipts.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateLibraryReceiptUploadRequestSchema) },
      responses: { 201: { description: 'Upload started', content: { 'application/json': { schema: CreateReceiptUploadResponseSchema } } }, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const body = c.req.valid('json');
      try {
        const { receipt, upload } = await startLibraryReceipt({ ...receiptDeps, uploadLimiter: options.uploadLimiter }, receiptActor(c), body);
        return c.json({ receipt: serializeExpenseReceipt(receipt), upload }, 201);
      } catch (err) {
        const retryAfter = err instanceof ApiError ? (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds : undefined;
        if (retryAfter !== undefined) c.header('Retry-After', String(retryAfter));
        throw err;
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{receiptId}/upload-url',
      tags: ['Receipts'],
      summary: 'A fresh signed PUT URL for an unfinished upload',
      description: 'For a client whose URL expired before it sent the bytes (signed URLs live minutes; a phone may retry hours later). 422 UPLOAD_ALREADY_COMPLETE once READY.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ReceiptIdParamSchema },
      responses: { 200: { description: 'A new URL', content: { 'application/json': { schema: SignedUploadSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      const receipt = await mustGet(organization.id, c.req.valid('param').receiptId);
      if (receipt.status === 'READY') throw validationError('UPLOAD_ALREADY_COMPLETE', 'This receipt is already uploaded');
      return c.json(await signUpload(receipt, c.get('now')()), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{receiptId}/complete',
      tags: ['Receipts'],
      summary: 'Finish an upload: verify the object and mark the receipt READY',
      description: '422 UPLOAD_INCOMPLETE when no object exists yet; 422 UPLOAD_MISMATCH when its size or content type differ from what was declared. Idempotent once READY.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ReceiptIdParamSchema },
      responses: { 200: { description: 'READY', content: { 'application/json': { schema: ExpenseReceiptSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      // A receipt started on an expense (MUT-44) completes through that expense's route, which checks the expense is
      // live and has room; finishing it here would skip both (review finding: MAX_RECEIPTS_PER_EXPENSE bypass).
      return c.json(serializeExpenseReceipt(await completeLibraryReceipt(receiptDeps, receiptActor(c), c.req.valid('param').receiptId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts',
      tags: ['Receipts'],
      summary: "The profile's receipts library, newest upload first",
      description: 'READY receipts only. filingStatus TO_REVIEW is the review queue; from/to are inclusive upload days in the profile timezone.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ListReceiptsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ReceiptPageSchema } } }, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      if (q.from) assertIsoDate(q.from, 'from');
      if (q.to) assertIsoDate(q.to, 'to');
      if (q.from && q.to && q.from > q.to) throw validationError('END_BEFORE_START', '`to` is before `from`', { field: 'to' });
      const page = await store.expenseReceipts.list(
        organization.id,
        { ...(q.filingStatus ? { filingStatus: q.filingStatus } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) },
        { limit: q.limit, cursor: q.cursor ? decodeReceiptCursor(q.cursor) : null },
      );
      return c.json({ items: page.items.map(serializeReceiptLibraryItem), nextCursor: page.nextCursor ? encodeReceiptCursor(page.nextCursor) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts/counts',
      tags: ['Receipts'],
      summary: 'How many READY receipts wait To review, and how many are filed',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      responses: { 200: { description: 'Counts', content: { 'application/json': { schema: ReceiptCountsSchema } } }, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      return c.json(await store.expenseReceipts.countByFilingStatus(organization.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts/{receiptId}',
      tags: ['Receipts'],
      summary: 'One receipt, with what was read and what was approved',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ReceiptIdParamSchema },
      responses: { 200: { description: 'The receipt', content: { 'application/json': { schema: ExpenseReceiptSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      return c.json(serializeExpenseReceipt(await mustGet(organization.id, c.req.valid('param').receiptId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/receipts/{receiptId}/download',
      tags: ['Receipts'],
      summary: 'A short-lived signed download URL for a READY receipt',
      description: '`disposition=inline` (MUT-260) signs a URL that displays the file instead of saving it, for the portal\'s preview. The response type is always the stored one: PDF, JPEG or PNG.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { params: ReceiptIdParamSchema, query: ReceiptDownloadQuerySchema },
      responses: { 200: { description: 'Signed URL', content: { 'application/json': { schema: AttachmentDownloadSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = sessionAuth(c);
      const receipt = await mustGet(organization.id, c.req.valid('param').receiptId);
      if (receipt.status !== 'READY') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
      const { disposition } = c.req.valid('query');
      const signed = await s.signDownload(receipt.storageKey, { filename: receipt.filename, mimeType: receipt.mimeType, ttlSeconds: options.urlTtlSeconds, now: c.get('now')(), disposition });
      return c.json({ url: signed.url, expiresAt: signed.expiresAt.toISOString(), filename: receipt.filename, mimeType: receipt.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png' }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/receipts/{receiptId}/suggestion',
      tags: ['Receipts'],
      summary: "Add to what was read off the receipt (optimistic, If-Match)",
      description:
        "To-review receipts only: 409 CONFLICT RECEIPT_ALREADY_FILED once filed. Fills only the fields the stored suggestion lacks; a field already there (the server's reading, or an earlier client's) is never replaced (since 1.84.0-mut441, MUT-441 R7). The same rule applies to the suggestion sent with approve and file. Unknown fields in the suggestion are dropped, not refused.",
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), ifMatch()] as const,
      request: { params: ReceiptIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(ReceiptSuggestionSchema) },
      responses: { 200: { description: 'Updated', content: { 'application/json': { schema: ExpenseReceiptSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      const result = await store.expenseReceipts.setSuggested(organization.id, c.req.valid('param').receiptId, c.get('expectedVersion'), c.req.valid('json'));
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such receipt');
      if (result.kind === 'filed') throw await alreadyFiled(organization.id, c.req.valid('param').receiptId);
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      return c.json(serializeExpenseReceipt(result.record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{receiptId}/approve',
      tags: ['Receipts'],
      summary: 'Approve a To-review receipt: record its expense and file the receipt on it, in one transaction',
      description:
        'The body is an expense, checked exactly as POST /v1/expenses checks one. 409 CONFLICT RECEIPT_ALREADY_FILED, with details.expenseId, when the receipt is already filed (a replay with the same Idempotency-Key answers the first 201 instead); 422 ATTACHMENT_NOT_READY before the upload completes — a 4xx answer is stored under its Idempotency-Key, so retry that one with a new key.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'receipts.approve')] as const,
      request: { params: ReceiptIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ApproveReceiptRequestSchema) },
      responses: { 201: { description: 'Approved', content: { 'application/json': { schema: ApproveReceiptResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization, user } = sessionAuth(c);
      const receiptId = c.req.valid('param').receiptId;
      const body = c.req.valid('json');
      const now = c.get('now')();
      const prepared = await prepareExpenseCreate(store, organization.id, user.id, todayFor(organization, now), body);
      // MUT-254: before the receipt lock, after every body check. A replay or an already-filed receipt finds (never
      // duplicates) the vendor; only a filing that succeeded touches it.
      const expense = await withResolvedVendor(store, organization.id, prepared, body.vendorDetails, now);
      const approved: ApprovedReceiptFields = { occurredOn: expense.occurredOn, amountMinor: expense.amountMinor.toString(), currency: expense.currency, vendor: expense.vendor, categoryId: expense.categoryId };
      const result = await withCategoryForeignKey(() =>
        store.expenseReceipts.fileAsExpense({ organizationId: organization.id, receiptId, userId: user.id, expense, approved, ...(body.suggested ? { suggested: body.suggested } : {}) }, now),
      );
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such receipt');
      if (result.kind === 'already_filed') throw await alreadyFiled(organization.id, receiptId);
      if (result.kind === 'not_ready') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
      await touchExpenseVendor(store, result.expense, now);
      // The same row POST /v1/expenses writes, same keys, so anything counting expense.created counts these; receiptId marks where it came from.
      await audit(c, 'expense.created', 'expense', result.expense.id, { currency: result.expense.currency, occurredOn: result.expense.occurredOn, receiptId: result.receipt.id, ...(body.captureSource ? { captureSource: body.captureSource } : {}) });
      await audit(c, 'expense_receipt.filed', 'expense_receipt', result.receipt.id, { expenseId: result.expense.id, mode: 'new' });
      return c.json({ expense: serializeExpense(result.expense), receipt: serializeExpenseReceipt(result.receipt) }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{receiptId}/file',
      tags: ['Receipts'],
      summary: 'File a To-review receipt onto an expense that already exists (MUT-389)',
      description: `For the expense typed by hand and the receipt scanned later. No expense is created and none of its fields change; nothing is approved. Answers the expense with its receipts. 409 CONFLICT RECEIPT_ALREADY_FILED, with details.expenseId, when the receipt is already filed (a replay with the same Idempotency-Key answers the first 200 instead); 404 for a receipt or expense that is not this profile's, or a deleted expense, with details.reason RECEIPT_NOT_FOUND or EXPENSE_NOT_FOUND saying which; 422 ATTACHMENT_NOT_READY before the upload completes; 422 TOO_MANY_RECEIPTS once the expense holds ${MAX_RECEIPTS_PER_EXPENSE}. A 4xx answer is stored under its Idempotency-Key, so retry that one with a new key.`,
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'receipts.file')] as const,
      request: { params: ReceiptIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(FileReceiptRequestSchema) },
      responses: { 200: { description: 'Filed', content: { 'application/json': { schema: FileReceiptResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      storage();
      const { organization } = sessionAuth(c);
      const receiptId = c.req.valid('param').receiptId;
      const body = c.req.valid('json');
      const result = await store.expenseReceipts.fileOntoExpense(
        { organizationId: organization.id, receiptId, expenseId: body.expenseId, maxReceipts: MAX_RECEIPTS_PER_EXPENSE, ...(body.suggested ? { suggested: body.suggested } : {}) },
      );
      // Two different 404s, so the attach screen knows whether to refresh the library or pick another expense.
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such receipt', { reason: 'RECEIPT_NOT_FOUND' });
      if (result.kind === 'already_filed') throw await alreadyFiled(organization.id, receiptId);
      if (result.kind === 'not_ready') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
      if (result.kind === 'expense_not_found') throw new ApiError('NOT_FOUND', 'No such expense', { reason: 'EXPENSE_NOT_FOUND' });
      if (result.kind === 'too_many_receipts') throw tooManyReceipts();
      await audit(c, 'expense_receipt.filed', 'expense_receipt', result.receipt.id, { expenseId: result.expense.id, mode: 'existing' });
      const receipts = await store.expenseReceipts.listByExpense(organization.id, result.expense.id);
      return c.json({ expense: { ...serializeExpense(result.expense), receipts: receipts.map(serializeExpenseReceipt) }, receipt: serializeExpenseReceipt(result.receipt) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/receipts/{receiptId}/move',
      tags: ['Receipts'],
      summary: 'Move a To-review receipt to another of your profiles (MUT-503)',
      description:
        'The receipt keeps its id, upload day, suggestion and reading state; its file is copied inside the bucket to the other profile and removed from this one. An approval left by a deleted expense is cleared, since its category belongs to this profile. 422 SAME_PROFILE for this profile; 404 PROFILE_NOT_FOUND for a profile you are not on; 402 SUBSCRIPTION_LAPSED when that profile is read-only or locked; 404 RECEIPT_NOT_FOUND; 409 CONFLICT RECEIPT_ALREADY_FILED (details.expenseId) for a filed receipt; 409 CONFLICT RECEIPT_FILE_MISSING when its file is gone; 422 ATTACHMENT_NOT_READY before the upload completes. A retry with the same Idempotency-Key moves once; a 4xx is stored under it, so retry that one with a new key.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write'), idempotent(store, 'receipts.move')] as const,
      request: { params: ReceiptIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(MoveReceiptRequestSchema) },
      responses: { 200: { description: 'Moved', content: { 'application/json': { schema: MoveReceiptResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const result = await moveLibraryReceipt(receiptDeps, receiptActor(c), c.req.valid('param').receiptId, c.req.valid('json').profileId, { billingGate: c.get('billingGate') === true, reportError: c.get('reportError') });
      return c.json({ receipt: serializeExpenseReceipt(result.receipt), fromProfileId: result.fromProfileId }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/receipts/{receiptId}',
      tags: ['Receipts'],
      summary: 'Delete a receipt (soft; the object is removed)',
      description: 'Any filing status: a filed receipt leaves its expense. 204 again for a receipt already deleted; 404 for an id this profile never had.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:write')] as const,
      request: { params: ReceiptIdParamSchema },
      responses: { 204: { description: 'Deleted (or already was)' }, ...notFoundResponse, ...validationResponse, ...errorResponses, ...notConfigured },
    }),
    async (c) => {
      const s = storage();
      const { organization } = sessionAuth(c);
      const now = c.get('now')();
      const receiptId = c.req.valid('param').receiptId;
      const receipt = await store.expenseReceipts.getById(organization.id, receiptId);
      if (!receipt) {
        // Already deleted (soft) or never existed: idempotent for a known id, 404 otherwise.
        if (!(await store.expenseReceipts.softDelete(organization.id, receiptId, now))) throw new ApiError('NOT_FOUND', 'No such receipt');
        return c.body(null, 204);
      }
      await store.expenseReceipts.softDelete(organization.id, receipt.id, now);
      await s.remove(receipt.storageKey);
      await audit(c, 'expense_receipt.deleted', 'expense_receipt', receipt.id, { expenseId: receipt.expenseId });
      return c.body(null, 204);
    },
  );

  return app;
}
