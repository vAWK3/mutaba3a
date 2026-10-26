import { todayFor, validationError } from '../agreements/compose.js';
import { checkFile, receiptStorageKey } from '../attachments/rules.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { verifyUploadedObject } from '../attachments/verify.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { ExpenseReceiptRecord, JsonObject, LedgerStore, Organization, ReceiptSuggestion } from '../repositories/ports.js';
import { MAX_RECEIPTS_PER_EXPENSE, tooManyReceipts } from './compose.js';

/**
 * MUT-436 (review R4): starting and finishing a receipt upload, free of HTTP, so the routes (/v1/expenses/{id}/receipts,
 * /v1/receipts/uploads) and the MCP receipt tools run the same rules in the same order: storage configured, the file's
 * type and size (checkFile), room on the expense, the library's per-person and pending caps, a signed PUT URL; then, to
 * finish, the object verified in storage and the receipt flipped to READY, audited. When MUT-56's malware scan lands it
 * belongs here, so every door scans.
 */

/** At most this many unfinished library uploads per profile in PENDING_WINDOW_MS (decision P3). */
export const MAX_PENDING_LIBRARY_UPLOADS = 20;
export const PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReceiptDeps {
  store: LedgerStore;
  /** Null: the deployment has no attachments bucket, and every receipt operation answers 503. */
  storage: AttachmentStorage | null;
  urlTtlSeconds: number;
}

export type ReceiptAuditWriter = (action: string, entityType: 'expense' | 'expense_receipt', entityId: string, metadata?: JsonObject) => Promise<unknown>;

/** Who is acting, on which profile, and how their acts are audited. */
export interface ReceiptActor {
  organization: Organization;
  userId: string;
  requestId: string;
  now: Date;
  audit: ReceiptAuditWriter;
}

export interface ReceiptFile {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SignedReceiptUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/** The audit writer the session routes use: actor USER, the person, this request. */
export function receiptAudit(store: LedgerStore, actor: { organizationId: string; userId: string; requestId: string }): ReceiptAuditWriter {
  return (action, entityType, entityId, metadata) =>
    store.audit.append({ organizationId: actor.organizationId, actorType: 'USER', actorId: actor.userId, action, entityType, entityId, ...(metadata ? { metadata } : {}), requestId: actor.requestId });
}

export function requireStorage(deps: ReceiptDeps): AttachmentStorage {
  if (!deps.storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
  return deps.storage;
}

export async function signReceiptUpload(deps: ReceiptDeps, receipt: ExpenseReceiptRecord, now: Date): Promise<SignedReceiptUpload> {
  const upload = await requireStorage(deps).signUpload(receipt.storageKey, { mimeType: receipt.mimeType, sizeBytes: receipt.sizeBytes, ttlSeconds: deps.urlTtlSeconds, now });
  return { url: upload.url, method: 'PUT', headers: upload.headers, expiresAt: upload.expiresAt.toISOString() };
}

function assertFile(file: ReceiptFile): void {
  const check = checkFile(file);
  if (!check.ok) throw validationError(check.reason, `Upload refused: ${check.reason}`);
}

async function mustGetExpense(deps: ReceiptDeps, organizationId: string, expenseId: string) {
  const expense = await deps.store.expenses.getById(organizationId, expenseId);
  if (!expense) throw new ApiError('NOT_FOUND', 'No such expense');
  return expense;
}

async function createKeyed(deps: ReceiptDeps, input: Parameters<LedgerStore['expenseReceipts']['create']>[0], now: Date): Promise<ExpenseReceiptRecord> {
  const created = await deps.store.expenseReceipts.create(input, now);
  return (await deps.store.expenseReceipts.setKey(input.organizationId, created.id, receiptStorageKey(input.organizationId, created.id))) ?? created;
}

/**
 * The per-person start budget and the profile's pending cap: a 429 either way, so an idempotency key stays free. The
 * library always applies them (P3); MUT-436's agent applies them on an expense too (review: an agent looping on fresh
 * keys would otherwise mint unlimited pending uploads). The session's expense route keeps its MUT-44 behaviour.
 */
export async function assertUploadBudget(deps: ReceiptDeps & { uploadLimiter: RateLimiter }, actor: ReceiptActor): Promise<void> {
  const { organization, now } = actor;
  const decision = await deps.uploadLimiter.check(`receipt-upload:${actor.userId}`, now);
  if (!decision.allowed) throw new ApiError('RATE_LIMITED', 'Too many receipt uploads; try again shortly', { retryAfterSeconds: decision.retryAfterSeconds });
  if ((await deps.store.expenseReceipts.countPendingSince(organization.id, new Date(now.getTime() - PENDING_WINDOW_MS))) >= MAX_PENDING_LIBRARY_UPLOADS) {
    // A 429, not a 422: nothing was done, so the Idempotency-Key stays free for the same request once there is room.
    throw new ApiError('RATE_LIMITED', `This profile already has ${MAX_PENDING_LIBRARY_UPLOADS} unfinished uploads; finish or delete one first`, { reason: 'TOO_MANY_PENDING_UPLOADS' });
  }
}

/** MUT-44: a PENDING_UPLOAD receipt on an existing expense, FILED from the start. The room check here is advisory; completion re-checks it under the expense lock (MUT-397). */
export async function startExpenseReceipt(
  deps: ReceiptDeps & { uploadLimiter?: RateLimiter },
  actor: ReceiptActor,
  expenseId: string,
  file: ReceiptFile,
): Promise<{ receipt: ExpenseReceiptRecord; upload: SignedReceiptUpload }> {
  requireStorage(deps);
  assertFile(file);
  if (deps.uploadLimiter) await assertUploadBudget({ ...deps, uploadLimiter: deps.uploadLimiter }, actor);
  const { organization } = actor;
  const expense = await mustGetExpense(deps, organization.id, expenseId);
  if ((await deps.store.expenseReceipts.listByExpense(organization.id, expense.id)).length >= MAX_RECEIPTS_PER_EXPENSE) throw tooManyReceipts();
  const receipt = await createKeyed(
    deps,
    { organizationId: organization.id, expenseId: expense.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, receivedOn: todayFor(organization, actor.now), uploadedByUserId: actor.userId, requestId: actor.requestId },
    actor.now,
  );
  return { receipt, upload: await signReceiptUpload(deps, receipt, actor.now) };
}

/** Verify the object, then flip to READY under the expense lock (MUT-397); idempotent once READY. */
export async function completeExpenseReceipt(deps: ReceiptDeps, actor: ReceiptActor, expenseId: string, receiptId: string, auditMetadata: JsonObject = {}): Promise<ExpenseReceiptRecord> {
  const storage = requireStorage(deps);
  const { organization } = actor;
  await mustGetExpense(deps, organization.id, expenseId);
  const receipt = await deps.store.expenseReceipts.getById(organization.id, receiptId);
  if (!receipt || receipt.expenseId !== expenseId) throw new ApiError('NOT_FOUND', 'No such receipt');
  if (receipt.status === 'READY') return receipt;
  // Storage first, outside any transaction: no network I/O under a database lock.
  await verifyUploadedObject(storage, receipt);
  const result = await deps.store.expenseReceipts.completeOnExpense({ organizationId: organization.id, expenseId, receiptId: receipt.id, maxReceipts: MAX_RECEIPTS_PER_EXPENSE }, actor.now);
  if (result.kind === 'expense_not_found') throw new ApiError('NOT_FOUND', 'No such expense');
  if (result.kind === 'receipt_not_found') throw new ApiError('NOT_FOUND', 'No such receipt');
  if (result.kind === 'too_many_receipts') throw tooManyReceipts();
  if (result.kind === 'completed') await actor.audit('expense_receipt.added', 'expense_receipt', result.receipt.id, { expenseId, filename: result.receipt.filename, sizeBytes: result.receipt.sizeBytes, ...auditMetadata });
  return result.receipt;
}

/** MUT-255: a To-review receipt with no expense, behind the per-person start budget and the profile's pending cap. Either refusal is a 429, so an idempotency key stays free. */
export async function startLibraryReceipt(
  deps: ReceiptDeps & { uploadLimiter: RateLimiter },
  actor: ReceiptActor,
  file: ReceiptFile & { suggested?: ReceiptSuggestion | null | undefined },
): Promise<{ receipt: ExpenseReceiptRecord; upload: SignedReceiptUpload }> {
  requireStorage(deps);
  assertFile(file);
  await assertUploadBudget(deps, actor);
  const { organization, now } = actor;
  const receipt = await createKeyed(
    deps,
    { organizationId: organization.id, expenseId: null, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes, receivedOn: todayFor(organization, now), suggested: file.suggested ?? null, uploadedByUserId: actor.userId, requestId: actor.requestId },
    now,
  );
  return { receipt, upload: await signReceiptUpload(deps, receipt, now) };
}

/** Verify the object, then mark a library receipt READY; idempotent once READY. A receipt started on an expense finishes through that expense (its room check), never here. */
export async function completeLibraryReceipt(deps: ReceiptDeps, actor: ReceiptActor, receiptId: string, auditMetadata: JsonObject = {}): Promise<ExpenseReceiptRecord> {
  const storage = requireStorage(deps);
  const { organization } = actor;
  const receipt = await deps.store.expenseReceipts.getById(organization.id, receiptId);
  if (!receipt) throw new ApiError('NOT_FOUND', 'No such receipt');
  if (receipt.expenseId !== null) throw new ApiError('NOT_FOUND', 'No such receipt in the library');
  if (receipt.status === 'READY') return receipt;
  await verifyUploadedObject(storage, receipt);
  const ready = await deps.store.expenseReceipts.complete(organization.id, receipt.id, actor.now);
  if (!ready) throw new ApiError('NOT_FOUND', 'No such receipt');
  await actor.audit('expense_receipt.added', 'expense_receipt', ready.id, { expenseId: ready.expenseId, filename: ready.filename, sizeBytes: ready.sizeBytes, ...auditMetadata });
  return ready;
}
