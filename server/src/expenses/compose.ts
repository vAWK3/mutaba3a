import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, parseAmount, validationError } from '../agreements/compose.js';
import type { IsoDate } from '../dates.js';
import type { ApiError } from '../errors.js';
import type { Currency } from '../money.js';
import { ForeignKeyViolation } from '../repositories/memory.js';
import type { CreateExpenseInput, ExpenseRecord, LedgerStore, UpdateExpensePatch } from '../repositories/ports.js';
import type { VendorDetails } from '../schemas.js';

/**
 * Expense rules shared by the routes (MUT-42 brief §3 D6, §10). Pure except
 * for the lookups that check a link or a category belongs to the profile.
 */

/** Audit entity types of the expenses domain; GET /v1/audit (Malafat's key) never lists them. */
export const EXPENSE_ENTITY_TYPES = ['expense', 'expense_receipt', 'expense_category', 'expense_group'] as const;

export const MAX_RECEIPTS_PER_EXPENSE = 10;

/** The one refusal for a full expense, from the MUT-44 routes and the library's filing (MUT-389) alike. */
export function tooManyReceipts(): ApiError {
  return validationError('TOO_MANY_RECEIPTS', `An expense holds at most ${MAX_RECEIPTS_PER_EXPENSE} receipts`);
}

/** An expense amount: canonical, in the currency's digits, greater than zero. */
export function parseExpenseAmount(text: string, currency: Currency): bigint {
  const minor = parseAmount(text, currency);
  if (minor <= 0n) throw validationError('AMOUNT_INVALID', 'An expense amount must be greater than zero', { field: 'amount' });
  return minor;
}

/** A valid date, nothing more: also parses the list and summary `from`/`to` filters, which must reach old rows (MUT-227). */
export function expenseDate(value: string): IsoDate {
  return assertIsoDate(value, 'occurredOn');
}

/**
 * The date an expense is recorded or moved to: valid, not more than ten years back (MUT-227) and not more than ten
 * years ahead (MUT-392, eng review D4). An expense may be dated ahead (a bill you'll pay in three days); a typo year is
 * refused. Filing uses this too, so it refuses exactly where a direct create does.
 */
export function expenseOccurredOn(value: string, today: IsoDate): IsoDate {
  const date = expenseDate(value);
  assertNotAbsurdDate(date, today, 'occurredOn');
  assertNotTooOld(date, today, 'occurredOn');
  return date;
}

export interface Links {
  customerId: string | null;
  projectId: string | null;
}

/**
 * A client and matter link inside the profile. A project alone brings its
 * customer; both must agree. Archived ones may be linked (an old expense on a
 * closed matter). The currency is never compared: an ILS fee on a USD matter
 * stays ILS.
 */
export async function resolveLinks(store: LedgerStore, organizationId: string, requested: Links): Promise<Links> {
  if (requested.projectId) {
    const project = await store.projects.getById(organizationId, requested.projectId);
    if (!project) throw validationError('PROJECT_NOT_FOUND', 'No such project in this profile', { field: 'projectId' });
    if (requested.customerId && requested.customerId !== project.customerId) {
      throw validationError('PROJECT_CUSTOMER_MISMATCH', 'The project belongs to another client', { field: 'customerId' });
    }
    return { customerId: project.customerId, projectId: project.id };
  }
  if (requested.customerId) {
    const customer = await store.customers.getById(organizationId, requested.customerId);
    if (!customer) throw validationError('CUSTOMER_NOT_FOUND', 'No such client in this profile', { field: 'customerId' });
    return { customerId: customer.id, projectId: null };
  }
  return { customerId: null, projectId: null };
}

/** The links a PATCH asks for, merged with the row's: a new project brings its own client unless one is named. */
export function requestedLinks(existing: ExpenseRecord, body: { customerId?: string | null | undefined; projectId?: string | null | undefined }): Links | null {
  if (body.customerId === undefined && body.projectId === undefined) return null;
  const projectId = body.projectId !== undefined ? body.projectId : existing.projectId;
  const customerId = body.customerId !== undefined ? body.customerId : body.projectId ? null : existing.customerId;
  return { customerId, projectId };
}

/**
 * MUT-182 R17: changing a profile's type deletes its categories, so one can
 * vanish between `assertCategoryChoosable` and the write that names it. The
 * foreign key catches it; answer exactly as the check would have, not 500.
 */
export async function withCategoryForeignKey<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof ForeignKeyViolation && err.constraint.includes('categoryId')) {
      throw validationError('CATEGORY_NOT_FOUND', 'No such category in this profile', { field: 'categoryId' });
    }
    throw err;
  }
}

/** A category chosen for an expense must be the profile's and not archived. */
export async function assertCategoryChoosable(store: LedgerStore, organizationId: string, categoryId: string): Promise<void> {
  const category = await store.expenseCategories.getById(organizationId, categoryId);
  if (!category) throw validationError('CATEGORY_NOT_FOUND', 'No such category in this profile', { field: 'categoryId' });
  if (category.archivedAt) throw validationError('CATEGORY_ARCHIVED', 'This category is archived; choose another or restore it', { field: 'categoryId' });
}

/** The fields a create body carries: POST /v1/expenses and MUT-255's receipt approval take the same ones. */
export interface ExpenseCreateBody {
  occurredOn: string;
  amount: string;
  currency: Currency;
  title?: string | undefined;
  vendor?: string | undefined;
  categoryId?: string | undefined;
  customerId?: string | undefined;
  projectId?: string | undefined;
  notes?: string | undefined;
}

/**
 * Every check a new expense passes before it is written, and the row it becomes (MUT-255 review R6): the date floor,
 * the amount in the currency's digits, links inside the profile, a choosable category. Shared so approving a receipt
 * refuses exactly where recording an expense does.
 */
export async function prepareExpenseCreate(store: LedgerStore, organizationId: string, createdByUserId: string, today: IsoDate, body: ExpenseCreateBody): Promise<CreateExpenseInput> {
  const occurredOn = expenseOccurredOn(body.occurredOn, today);
  const amountMinor = parseExpenseAmount(body.amount, body.currency);
  const links = await resolveLinks(store, organizationId, { customerId: body.customerId ?? null, projectId: body.projectId ?? null });
  if (body.categoryId) await assertCategoryChoosable(store, organizationId, body.categoryId);
  return { organizationId, occurredOn, amountMinor, currency: body.currency, title: body.title ?? null, vendor: body.vendor ?? null, categoryId: body.categoryId ?? null, ...links, notes: body.notes ?? null, createdByUserId };
}

/**
 * The patch fields a PATCH body sets. A resent, unchanged `occurredOn` is left out rather than re-checked: the portal
 * sends the date on every save, and a row already older than MUT-227's floor must stay editable.
 *
 * MUT-272 (ADR-096), the conversion rule (ADR-075) on an expense:
 *
 *   currency sent ──▶ amount must be sent too ── else 422 AMOUNT_REQUIRED (field amount), even if unchanged
 *   amount sent ────▶ parsed in the merged currency's digits (a JOD row keeps 3; "1.234" in USD is refused)
 *
 * A currency never travels alone because the stored minor units depend on it: ILS → JOD without the amount
 * would silently rescale the money.
 */
export function expensePatch(existing: ExpenseRecord, today: IsoDate, body: { occurredOn?: string | undefined; amount?: string | undefined; currency?: Currency | undefined; title?: string | null | undefined; vendor?: string | null | undefined; categoryId?: string | null | undefined; notes?: string | null | undefined }): UpdateExpensePatch {
  if (body.currency !== undefined && body.amount === undefined) {
    throw validationError('AMOUNT_REQUIRED', 'currency can only change together with amount', { field: 'amount' });
  }
  const currency = body.currency ?? (existing.currency as Currency);
  const patch: UpdateExpensePatch = {};
  if (body.occurredOn !== undefined && body.occurredOn !== existing.occurredOn) patch.occurredOn = expenseOccurredOn(body.occurredOn, today);
  if (body.amount !== undefined) patch.amountMinor = parseExpenseAmount(body.amount, currency);
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.title !== undefined) patch.title = body.title;
  if (body.vendor !== undefined) patch.vendor = body.vendor;
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.notes !== undefined) patch.notes = body.notes;
  return patch;
}

/**
 * MUT-254 (ADR-183, A2): the vendor link a write carries. Runs after every other check, so a refused request has
 * created nothing it didn't need. A typed vendor resolves to the profile's vendor (exact keys only, decision V1),
 * created on first sight; `null` (or a name that normalises to nothing) unlinks; absent (a PATCH that leaves the vendor
 * alone) changes nothing. `details` (a receipt reader's number, phone, email) only help the match and fill what the
 * vendor lacks. A vendor made for a write that then fails stays: it is still right, and harmless.
 */
export async function withResolvedVendor<T extends { vendor?: string | null }>(store: LedgerStore, organizationId: string, input: T, details: VendorDetails | undefined, at: Date): Promise<T & { vendorId?: string | null }> {
  if (input.vendor === undefined) return input;
  if (input.vendor === null) return { ...input, vendorId: null };
  const vendor = await store.vendors.resolve({ organizationId, name: input.vendor, registrationNo: details?.registrationNo ?? null, phone: details?.phone ?? null, email: details?.email ?? null }, at);
  return { ...input, vendorId: vendor?.id ?? null };
}

/**
 * MUT-254 (A2/A3): after the write committed, the expense's vendor was just used, and its category becomes the
 * vendor's default (never the automatic Other: `touch` skips it). Only when the write named the vendor or the
 * category; a write touching neither leaves the vendor's default alone.
 *
 * Best effort: the expense is already saved, so a failed touch (a lock wait behind a profile type change) must not
 * answer 5xx. That would release the Idempotency-Key and a retry would record the expense twice. A missed touch
 * only leaves the vendor's last use and default as they were; the next write sets them.
 */
export async function touchExpenseVendor(store: LedgerStore, expense: ExpenseRecord, at: Date): Promise<void> {
  if (!expense.vendorId) return;
  try {
    await store.vendors.touch(expense.organizationId, expense.vendorId, { categoryId: expense.categoryId }, at);
  } catch {
    // Nothing to undo: see above.
  }
}
