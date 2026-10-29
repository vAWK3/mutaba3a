import { randomUUID } from 'node:crypto';
import { todayFor, validationError } from '../agreements/compose.js';
import { checkFile, movedReceiptStorageKey, receiptStorageKey } from '../attachments/rules.js';
import { agentWriteGate } from '../auth/billing-gate.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { verifyUploadedObject } from '../attachments/verify.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { ReceiptReadTrigger } from '../receipts/reading/reader.js';
import type { ExpenseReceiptRecord, JsonObject, LedgerStore, Organization, ReceiptCaptureHint, ReceiptSuggestion } from '../repositories/ports.js';
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
  /** MUT-441: the server's reader, while SERVER_OCR is on. Absent = no receipt is read (readStatus stays NONE). */
  reading?: ReceiptReadTrigger | null;
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

export interface MoveReceiptOptions {
  /** MUT-361: whether the lapse gate is on; the target profile is gated here (the selected one was, at the door). */
  billingGate: boolean;
  /** A clean-up that failed after the move held (ADR-091): reported, never thrown (D8). */
  reportError: (err: unknown) => void;
  /** The per-move key suffix (D5); a test may fix it. */
  nonce?: () => string;
}

const moveNonce = () => randomUUID().replace(/-/g, '').slice(0, 12);

/** The target profile, refused unless the person belongs to it and may write it now (MUT-503 AC2, D7). */
async function writableTarget(deps: ReceiptDeps, actor: ReceiptActor, targetProfileId: string, billingGate: boolean): Promise<Organization> {
  const notFound = () => new ApiError('NOT_FOUND', 'No such profile', { reason: 'PROFILE_NOT_FOUND' });
  if (!(await deps.store.memberships.find(actor.userId, targetProfileId))) throw notFound();
  const target = await deps.store.organizations.getById(targetProfileId);
  if (!target) throw notFound();
  // `expenses` is read-write for every session (writability.ts), so a lapse is the only way a member can't write it.
  await agentWriteGate(deps.store, target, actor.now, billingGate);
  return target;
}

/**
 * MUT-503 (ADR-228): move a To-review receipt from the actor's profile to another of theirs. The object is copied
 * inside the bucket to a key of its own on the target (D5), then one transaction re-homes the row; only after that
 * holds is the old object removed. A failure before the commit leaves the receipt on the source with its file (the
 * copy is removed); nothing after the commit throws (D8). The reading travels with the row: an in-flight read that
 * finds the old file gone is retried, not failed (reader.ts, D6).
 */
export async function moveLibraryReceipt(deps: ReceiptDeps, actor: ReceiptActor, receiptId: string, targetProfileId: string, options: MoveReceiptOptions): Promise<{ receipt: ExpenseReceiptRecord; fromProfileId: string }> {
  const storage = requireStorage(deps);
  const { organization } = actor;
  if (targetProfileId === organization.id) throw validationError('SAME_PROFILE', 'The receipt is already on this profile');
  const receipt = await deps.store.expenseReceipts.getById(organization.id, receiptId);
  if (!receipt) throw new ApiError('NOT_FOUND', 'No such receipt', { reason: 'RECEIPT_NOT_FOUND' });
  if (receipt.filingStatus === 'FILED') throw new ApiError('CONFLICT', 'This receipt is already filed', { reason: 'RECEIPT_ALREADY_FILED', expenseId: receipt.expenseId });
  if (receipt.status !== 'READY') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
  const target = await writableTarget(deps, actor, targetProfileId, options.billingGate);
  if (!(await storage.head(receipt.storageKey))) throw new ApiError('CONFLICT', 'The receipt\'s file is missing', { reason: 'RECEIPT_FILE_MISSING' });

  const storageKey = movedReceiptStorageKey(target.id, receipt.id, (options.nonce ?? moveNonce)());
  // Storage first, outside any transaction: no network I/O under a database lock. A failed copy throws (a 5xx).
  await storage.copy(receipt.storageKey, storageKey);
  const result = await deps.store.expenseReceipts.moveToProfile({ organizationId: organization.id, receiptId: receipt.id, targetOrganizationId: target.id, storageKey });
  if (result.kind !== 'moved') {
    // The key is this move's own, so no receipt points at it: removing it can't touch a live file.
    await storage.remove(storageKey).catch(options.reportError);
    if (result.kind === 'already_filed') throw new ApiError('CONFLICT', 'This receipt is already filed', { reason: 'RECEIPT_ALREADY_FILED', expenseId: (await deps.store.expenseReceipts.getById(organization.id, receipt.id))?.expenseId ?? null });
    if (result.kind === 'not_ready') throw validationError('ATTACHMENT_NOT_READY', 'The upload has not been completed');
    throw new ApiError('NOT_FOUND', 'No such receipt', { reason: 'RECEIPT_NOT_FOUND' });
  }

  // After the commit, never a throw (D8): the receipt is on the target whatever happens below.
  const settle = (work: () => Promise<unknown>) => work().catch(options.reportError);
  await settle(() => actor.audit('expense_receipt.moved_out', 'expense_receipt', receipt.id, { toProfileId: target.id }));
  await settle(() => receiptAudit(deps.store, { organizationId: target.id, userId: actor.userId, requestId: actor.requestId })('expense_receipt.moved_in', 'expense_receipt', receipt.id, { fromProfileId: organization.id }));
  // The old key was this receipt's alone and the row no longer names it (TD-190: the bucket keeps it 14 days).
  await settle(() => storage.remove(result.previousStorageKey));
  return { receipt: result.receipt, fromProfileId: organization.id };
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

/** MUT-441: how the image was taken, as a client says it (`capture`) and as it is stored (`captureHint`). */
export type ReceiptCapture = 'scanned' | 'photo';
const CAPTURE_HINT: Record<ReceiptCapture, ReceiptCaptureHint> = { scanned: 'SCANNED', photo: 'PHOTO' };

/** MUT-255: a To-review receipt with no expense, behind the per-person start budget and the profile's pending cap. Either refusal is a 429, so an idempotency key stays free. */
export async function startLibraryReceipt(
  deps: ReceiptDeps & { uploadLimiter: RateLimiter },
  actor: ReceiptActor,
  file: ReceiptFile & { suggested?: ReceiptSuggestion | null | undefined; capture?: ReceiptCapture | undefined },
): Promise<{ receipt: ExpenseReceiptRecord; upload: SignedReceiptUpload }> {
  requireStorage(deps);
  assertFile(file);
  await assertUploadBudget(deps, actor);
  const { organization, now } = actor;
  const receipt = await createKeyed(
    deps,
    {
      organizationId: organization.id,
      expenseId: null,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      receivedOn: todayFor(organization, now),
      suggested: file.suggested ?? null,
      uploadedByUserId: actor.userId,
      requestId: actor.requestId,
      ...(file.capture ? { captureHint: CAPTURE_HINT[file.capture] } : {}),
    },
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
  if (receipt.status === 'READY') {
    // A retried complete re-asks for a read still waiting (its first ask may have failed); the task name dedupes it.
    await deps.reading?.requested(receipt, actor.now);
    return receipt;
  }
  await verifyUploadedObject(storage, receipt);
  // MUT-441 (R10 #5): whether the server reads it is decided first and saved in the same UPDATE as READY.
  const read = deps.reading ? await deps.reading.decide(receipt) : null;
  const ready = await deps.store.expenseReceipts.complete(organization.id, receipt.id, actor.now, read ?? undefined);
  if (!ready) throw new ApiError('NOT_FOUND', 'No such receipt');
  await actor.audit('expense_receipt.added', 'expense_receipt', ready.id, { expenseId: ready.expenseId, filename: ready.filename, sizeBytes: ready.sizeBytes, ...auditMetadata });
  await deps.reading?.requested(ready, actor.now);
  return ready;
}
