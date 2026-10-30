import { todayFor } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import { assertCategoryChoosable, expenseOccurredOn, resolveLinks, touchExpenseVendor, withCategoryForeignKey, withResolvedVendor } from '../expenses/compose.js';
import { NO_EXPENSE_VAT } from '../expenses/vat.js';
import type { CreateExpenseInput, ExpenseRecord, InboxEntryRecord, LedgerStore, Organization } from '../repositories/ports.js';
import type { VendorDetails } from '../schemas.js';
import { assertFilableCurrency, assertKind } from './compose.js';

/**
 * MUT-437 (D11/D18): filing an inbox entry as an expense, shared by POST /v1/inbox/{entryId}/file-as-expense and the
 * agent's `file_inbox_entry`. Two steps so a caller can put its own check between them (the agent's look-alike check,
 * D17): `prepareInboxExpenseFiling` runs every destination-side rule and writes nothing, so a refusal never consumes
 * the entry; `commitInboxExpenseFiling` resolves the vendor, creates the expense and removes the entry in one
 * transaction, then audits. Relational, so it lives here and not in the pure `compose.ts`.
 */
export interface InboxExpenseFilingBody {
  categoryId?: string | undefined;
  vendor?: string | undefined;
  vendorDetails?: VendorDetails | undefined;
  title?: string | undefined;
  customerId?: string | undefined;
  projectId?: string | undefined;
}

export interface PreparedInboxExpenseFiling {
  organization: Organization;
  userId: string;
  entry: InboxEntryRecord;
  expense: CreateExpenseInput;
  vendorDetails: VendorDetails | undefined;
}

export async function prepareInboxExpenseFiling(
  store: LedgerStore,
  params: { organization: Organization; userId: string; entry: InboxEntryRecord; body: InboxExpenseFilingBody; now: Date },
): Promise<PreparedInboxExpenseFiling> {
  const { organization, userId, entry, body, now } = params;
  assertKind(entry, 'EXPENSE');
  assertFilableCurrency(entry);
  // POST /v1/expenses' own date rule (MUT-227 floor, MUT-392 ceiling), so filing is refused exactly where a direct
  // create is, not more.
  expenseOccurredOn(entry.occurredOn, todayFor(organization, now));
  const links = await resolveLinks(store, organization.id, { customerId: body.customerId ?? null, projectId: body.projectId ?? null });
  if (body.categoryId) await assertCategoryChoosable(store, organization.id, body.categoryId);
  return {
    organization,
    userId,
    entry,
    vendorDetails: body.vendorDetails,
    expense: {
      organizationId: organization.id,
      occurredOn: entry.occurredOn,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      title: body.title ?? null,
      vendor: body.vendor ?? null,
      categoryId: body.categoryId ?? null,
      ...links,
      notes: entry.note,
      createdByUserId: userId,
      // MUT-436 (review R6): the entry's source stays with the expense it becomes, so its marker survives filing.
      ...(entry.captureSource ? { captureSource: entry.captureSource } : {}),
      // MUT-302: filing records no VAT (an inbox entry has none to carry).
      ...NO_EXPENSE_VAT,
    },
  };
}

export async function commitInboxExpenseFiling(
  store: LedgerStore,
  prepared: PreparedInboxExpenseFiling,
  params: { now: Date; requestId: string; auditMetadata?: Record<string, unknown> },
): Promise<ExpenseRecord> {
  const { organization, userId, entry } = prepared;
  const { now } = params;
  // MUT-254: after every check, so a refusal never creates a vendor it didn't need (A2).
  const expense = await withResolvedVendor(store, organization.id, prepared.expense, prepared.vendorDetails, now);
  const filed = await withCategoryForeignKey(() => store.inboxEntries.fileAsExpense({ userId, inboxEntryId: entry.id, kind: 'EXPENSE', expense }, now));
  if (filed.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such inbox entry');
  await touchExpenseVendor(store, filed.expense, now);

  await store.audit.append({
    organizationId: organization.id,
    actorType: 'USER',
    actorId: userId,
    action: 'expense.created',
    entityType: 'expense',
    entityId: filed.expense.id,
    metadata: {
      currency: filed.expense.currency,
      occurredOn: filed.expense.occurredOn,
      filedFromInbox: true,
      ...(entry.captureSource ? { captureSource: entry.captureSource } : {}),
      ...params.auditMetadata,
    },
    requestId: params.requestId,
  });
  return filed.expense;
}
