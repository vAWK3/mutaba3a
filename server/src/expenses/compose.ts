import { assertIsoDate, parseAmount, validationError } from '../agreements/compose.js';
import type { IsoDate } from '../dates.js';
import type { Currency } from '../money.js';
import type { ExpenseRecord, LedgerStore, UpdateExpensePatch } from '../repositories/ports.js';

/**
 * Expense rules shared by the routes (MUT-42 brief §3 D6, §10). Pure except
 * for the lookups that check a link or a category belongs to the profile.
 */

/** Audit entity types of the expenses domain; GET /v1/audit (Malafat's key) never lists them. */
export const EXPENSE_ENTITY_TYPES = ['expense', 'expense_receipt', 'expense_category'] as const;

export const MAX_RECEIPTS_PER_EXPENSE = 10;

/** An expense amount: canonical, in the currency's digits, greater than zero. */
export function parseExpenseAmount(text: string, currency: Currency): bigint {
  const minor = parseAmount(text, currency);
  if (minor <= 0n) throw validationError('AMOUNT_INVALID', 'An expense amount must be greater than zero', { field: 'amount' });
  return minor;
}

export function expenseDate(value: string): IsoDate {
  return assertIsoDate(value, 'occurredOn');
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

/** A category chosen for an expense must be the profile's and not archived. */
export async function assertCategoryChoosable(store: LedgerStore, organizationId: string, categoryId: string): Promise<void> {
  const category = await store.expenseCategories.getById(organizationId, categoryId);
  if (!category) throw validationError('CATEGORY_NOT_FOUND', 'No such category in this profile', { field: 'categoryId' });
  if (category.archivedAt) throw validationError('CATEGORY_ARCHIVED', 'This category is archived; choose another or restore it', { field: 'categoryId' });
}

/** The patch fields a PATCH body sets, amount parsed in the row's own currency. */
export function expensePatch(existing: ExpenseRecord, body: { occurredOn?: string | undefined; amount?: string | undefined; title?: string | null | undefined; vendor?: string | null | undefined; categoryId?: string | null | undefined; notes?: string | null | undefined }): UpdateExpensePatch {
  const patch: UpdateExpensePatch = {};
  if (body.occurredOn !== undefined) patch.occurredOn = expenseDate(body.occurredOn);
  if (body.amount !== undefined) patch.amountMinor = parseExpenseAmount(body.amount, existing.currency as Currency);
  if (body.title !== undefined) patch.title = body.title;
  if (body.vendor !== undefined) patch.vendor = body.vendor;
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId;
  if (body.notes !== undefined) patch.notes = body.notes;
  return patch;
}
