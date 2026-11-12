import { randomUUID } from 'node:crypto';
import { validationError } from '../agreements/compose.js';
import { movedReceiptStorageKey } from '../attachments/rules.js';
import { agentWriteGate } from '../auth/billing-gate.js';
import { profileWriterOf } from '../auth/writability.js';
import { ApiError } from '../errors.js';
import { notOwner, ownsProfile } from '../personal-profile.js';
import type { AuditEventInput, ExpenseReceiptRecord, ExpenseRecord, JsonObject, Organization, UserLocale } from '../repositories/ports.js';
import { learnedFromNew, touchExpenseVendor, withResolvedVendor } from './compose.js';
import { isGroupMember } from './groups.js';
import { planExpenseMove, type ExpenseMoveChange, type ExpenseMovePlan } from './move-plan.js';
import { requireStorage, writableTarget, type MoveReceiptOptions, type ReceiptActor, type ReceiptDeps } from './receipts-compose.js';

/**
 * MUT-589 (ADR-254): move a saved expense, with every receipt on it, to another of the person's profiles. The preview
 * and the move run the same gates in the same order and build the changes with the same planner (move-plan.ts), so
 * what the confirm step lists is what the move applies, unless the target changed in between (review R2): the move
 * answers the changes it applied. Receipt files move as MUT-503 moves them (ADR-228): copied inside the bucket to a key
 * of their own, the rows re-homed in one transaction, the old objects removed after the commit, never thrown.
 */

export interface ExpenseMoveOptions extends MoveReceiptOptions {
  /** The language the changes are listed in (seeded category names follow it, MUT-464). */
  lang: UserLocale;
}

export interface ExpenseMovePreview {
  changes: ExpenseMoveChange[];
  receiptCount: number;
  expenseVersion: number;
}

export interface ExpenseMoved {
  expense: ExpenseRecord;
  receipts: ExpenseReceiptRecord[];
  fromProfileId: string;
  target: Organization;
  changes: ExpenseMoveChange[];
}

/** The same 409 a stale PATCH answers (routes/shared.ts `versionMismatch`), so the client reloads the preview. */
function versionMismatch(currentVersion: number): ApiError {
  return new ApiError('CONFLICT', 'The expense changed since you read it; load the preview again', { reason: 'VERSION_MISMATCH', currentVersion });
}

const moveNonce = () => randomUUID().replace(/-/g, '').slice(0, 12);

function malafatProfile(): ApiError {
  return new ApiError('READ_ONLY_PROFILE', 'Malafat is the writer of record on this profile; its expenses do not move between profiles', { reason: 'MALAFAT_PROFILE', writerOfRecord: 'MALAFAT' });
}

/** D2, in the plan's order: same profile, the expense, the source's owner and writer, then the target. */
async function gate(deps: ReceiptDeps, actor: ReceiptActor, expenseId: string, targetProfileId: string, billingGate: boolean): Promise<{ expense: ExpenseRecord; target: Organization }> {
  const { organization } = actor;
  if (targetProfileId === organization.id) throw validationError('SAME_PROFILE', 'The expense is already on this profile');
  const expense = await deps.store.expenses.getById(organization.id, expenseId);
  if (!expense) throw new ApiError('NOT_FOUND', 'No such expense', { reason: 'EXPENSE_NOT_FOUND' });
  // The source is gated for a lapse at the door (a write); the preview, a read, checks it here as the move would.
  await agentWriteGate(deps.store, organization, actor.now, billingGate);
  if ((await profileWriterOf(deps.store, organization.id)) === 'MALAFAT') throw malafatProfile();
  const membership = await deps.store.memberships.find(actor.userId, organization.id);
  if (!ownsProfile(organization, actor.userId, membership?.role ?? null)) throw notOwner();
  const target = await writableTarget(deps, actor, targetProfileId, billingGate);
  if ((await profileWriterOf(deps.store, target.id)) === 'MALAFAT') throw malafatProfile();
  return { expense, target };
}

/** Everything the planner reads, from both profiles. `targetVendorId` is the move's (the preview creates no vendor). */
async function planFor(deps: ReceiptDeps, expense: ExpenseRecord, target: Organization, lang: UserLocale, targetVendorId: string | null): Promise<ExpenseMovePlan> {
  const { store } = deps;
  const source = expense.organizationId;
  const [category, targetCategories, client, matter, sourceGroups, marks, targetGroups] = await Promise.all([
    expense.categoryId ? store.expenseCategories.getById(source, expense.categoryId) : null,
    store.expenseCategories.list(target.id, { includeArchived: true }),
    expense.customerId ? store.customers.getById(source, expense.customerId) : null,
    expense.projectId ? store.projects.getById(source, expense.projectId) : null,
    store.expenseGroups.list(source),
    store.expenseGroups.overridesForExpense(source, expense.id),
    store.expenseGroups.list(target.id),
  ]);
  const markOf = (groupId: string) => marks.find((m) => m.groupId === groupId)?.mode ?? null;
  return planExpenseMove(expense, {
    lang,
    sourceCategoryName: category?.name ?? null,
    targetCategories,
    targetFirm: target.firmEnabledAt !== null,
    targetVendorId,
    clientName: client?.name ?? null,
    matterName: matter?.name ?? null,
    sourceGroups: sourceGroups.filter((g) => isGroupMember(expense, g, markOf(g.id))).map((g) => g.name),
    targetGroups: targetGroups.filter((g) => isGroupMember(expense, g, null)).map((g) => g.name),
  });
}

export async function previewExpenseMove(deps: ReceiptDeps, actor: ReceiptActor, expenseId: string, targetProfileId: string, options: Pick<ExpenseMoveOptions, 'billingGate' | 'lang'>): Promise<ExpenseMovePreview> {
  const { expense, target } = await gate(deps, actor, expenseId, targetProfileId, options.billingGate);
  const plan = await planFor(deps, expense, target, options.lang, null);
  const receipts = await deps.store.expenseReceipts.listByExpense(actor.organization.id, expense.id);
  return { changes: plan.changes, receiptCount: receipts.length, expenseVersion: expense.version };
}

/** The target's vendor for the typed vendor: by the source vendor's registration number first, then by name. */
async function targetVendorIdOf(deps: ReceiptDeps, expense: ExpenseRecord, target: Organization, at: Date): Promise<string | null> {
  if (!expense.vendor) return null;
  const source = expense.vendorId ? await deps.store.vendors.getById(expense.organizationId, expense.vendorId) : null;
  const details = source ? { ...(source.registrationNo ? { registrationNo: source.registrationNo } : {}), ...(source.phone ? { phone: source.phone } : {}), ...(source.email ? { email: source.email } : {}) } : undefined;
  return (await withResolvedVendor(deps.store, target.id, { vendor: expense.vendor }, details, at)).vendorId ?? null;
}

export async function moveExpense(deps: ReceiptDeps, actor: ReceiptActor, expenseId: string, targetProfileId: string, expectedVersion: number, options: ExpenseMoveOptions): Promise<ExpenseMoved> {
  const { organization } = actor;
  const { expense, target } = await gate(deps, actor, expenseId, targetProfileId, options.billingGate);
  if (expense.version !== expectedVersion) throw versionMismatch(expense.version);
  const receipts = await deps.store.expenseReceipts.listByExpense(organization.id, expense.id);
  const storage = receipts.length > 0 ? requireStorage(deps) : null;

  // Storage first, outside any transaction (ADR-228 D5): each copy under a key of its own, so removing it on a refusal
  // can never touch a live file. A failed copy removes the copies already made and throws (a 5xx).
  const receiptKeys: Record<string, string> = {};
  const removeCopies = () => Promise.all(Object.values(receiptKeys).map((key) => storage!.remove(key).catch(options.reportError)));
  try {
    for (const r of receipts) {
      const key = movedReceiptStorageKey(target.id, r.id, (options.nonce ?? moveNonce)());
      await storage!.copy(r.storageKey, key);
      receiptKeys[r.id] = key;
    }
  } catch (err) {
    await removeCopies();
    throw err;
  }

  // R3: a vendor made here for a move that then fails stays, as approve's does (TD).
  const plan = await planFor(deps, expense, target, options.lang, await targetVendorIdOf(deps, expense, target, actor.now)).catch(async (err: unknown) => {
    await removeCopies();
    throw err;
  });
  const changes = plan.changes as unknown as JsonObject[];
  const audit: AuditEventInput[] = [
    { organizationId: organization.id, actorType: 'USER', actorId: actor.userId, action: 'expense.moved_out', entityType: 'expense', entityId: expense.id, metadata: { toProfileId: target.id, receiptCount: receipts.length, changes }, requestId: actor.requestId },
    { organizationId: target.id, actorType: 'USER', actorId: actor.userId, action: 'expense.moved_in', entityType: 'expense', entityId: expense.id, metadata: { fromProfileId: organization.id, receiptCount: receipts.length, changes }, requestId: actor.requestId },
  ];
  const result = await deps.store.expenses
    .moveToProfile({ organizationId: organization.id, expenseId: expense.id, targetOrganizationId: target.id, expectedVersion, patch: plan.patch, receiptKeys, approvedCategoryId: plan.patch.categoryId ?? null, audit, at: actor.now })
    .catch(async (err: unknown) => {
      await removeCopies();
      throw err;
    });
  if (result.kind !== 'moved') {
    await removeCopies();
    if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such expense', { reason: 'EXPENSE_NOT_FOUND' });
    if (result.kind === 'receipt_not_ready') throw new ApiError('CONFLICT', 'A receipt on this expense has not finished uploading', { reason: 'RECEIPT_NOT_READY' });
    // Stale, or a receipt filed onto it since the copies (R1): the client reloads the preview.
    throw versionMismatch(result.currentVersion);
  }

  // After the commit, never a throw (ADR-228 D8): the expense is on the target whatever happens below.
  if (storage) for (const key of result.previousStorageKeys) await storage.remove(key).catch(options.reportError);
  await touchExpenseVendor(deps.store, result.expense, actor.now, learnedFromNew(result.expense));
  return { expense: result.expense, receipts: result.receipts.filter((r) => r.status === 'READY'), fromProfileId: organization.id, target, changes: plan.changes };
}
