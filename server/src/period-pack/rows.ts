import { displayCategoryNames } from '../expenses/presets.js';
import { moneyDateOf } from '../entries/merge.js';
import type { EntryRow, ExpenseRecord, LedgerStore, Organization, PaymentRecord, PeriodBounds, PeriodReceiptRecord } from '../repositories/ports.js';
import { addDays } from '../dates.js';
import type { Lang } from './columns.js';
import type { PeriodRange } from './range.js';

/**
 * MUT-314 (ADR-248): a period's rows, collected once per download, the same way for both downloads, so the report and
 * the receipts zip agree (D22). The one place Refs and receipt file names are made (red flag 2).
 *
 * - Rows: the entries feed (expenses and received payments only, MUT-560's `kinds`), by money date, a page at a time.
 *   Live rows by the feed's rules; reversed payments are left out (not money received, as the link's summary does);
 *   rows logged after `asOf` are left out of both downloads.
 * - Refs number rows oldest first within the period: money date, then createdAt, then id. E0001… and I0001….
 * - Receipts: READY, live, uploaded at or before `asOf`, on the period's expenses; `<Ref>-<n>.<ext>`, n by upload
 *   order within the row, the extension from the MIME type (D19).
 * - Names: categories in the download's language (MUT-464), clients, projects, vendors (canonical when linked, else as
 *   typed) and who logged each row, in one batch.
 */
export const FEED_PAGE = 200;
const RECEIPT_BATCH = 500;

export interface PeriodReceipt extends PeriodReceiptRecord {
  /** `E0001-1.pdf` */
  name: string;
  /** `receipts/E0001-1.pdf`, its path in the zip. */
  path: string;
}

export interface ExpenseLine {
  ref: string;
  record: ExpenseRecord;
  vendor: string | null;
  category: string | null;
  client: string | null;
  project: string | null;
  loggedBy: string | null;
  receipts: PeriodReceipt[];
}

export interface IncomeLine {
  ref: string;
  record: PaymentRecord;
  client: string | null;
  project: string | null;
  loggedBy: string | null;
}

/**
 * Review (MUT-314): what a download collects. The report reads both kinds and every name; the receipts zip reads
 * expenses and vendor names only. A link's files leave out who logged a row and every id (`forLink`).
 */
export interface CollectOptions {
  scope: 'report' | 'receipts';
  forLink: boolean;
}

export interface PeriodRows {
  organization: Organization;
  range: PeriodRange;
  asOf: Date;
  lang: Lang;
  forLink: boolean;
  expenses: ExpenseLine[];
  income: IncomeLine[];
}

const RECEIPT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/tiff': 'tiff',
};

/** A receipt's extension, from its MIME type only, never the uploader's file name (D19). */
export function receiptExtension(mimeType: string): string {
  return RECEIPT_EXTENSIONS[mimeType.toLowerCase()] ?? 'bin';
}

export function refOf(prefix: 'E' | 'I', index: number): string {
  return `${prefix}${String(index + 1).padStart(4, '0')}`;
}

/** The entries feed's bounds for a range. */
export function boundsOf(range: PeriodRange): PeriodBounds {
  return { ...(range.from !== null && { occurredFrom: range.from }), occurredBefore: addDays(range.to, 1) };
}

function oldestFirst(a: EntryRow, b: EntryRow): number {
  const day = moneyDateOf(a).localeCompare(moneyDateOf(b));
  if (day !== 0) return day;
  const at = a.record.createdAt.getTime() - b.record.createdAt.getTime();
  return at !== 0 ? at : a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0;
}

export async function collectRows(store: LedgerStore, organization: Organization, range: PeriodRange, asOf: Date, lang: Lang, options: CollectOptions): Promise<PeriodRows> {
  const report = options.scope === 'report';
  const expenses: ExpenseRecord[] = [];
  const payments: PaymentRecord[] = [];
  const logged = (at: Date) => at.getTime() <= asOf.getTime();
  let cursor = null;
  do {
    const page = await store.entries.list([organization.id], { limit: FEED_PAGE, order: 'occurredOn', kinds: report ? ['expense', 'payment'] : ['expense'], cursor, ...boundsOf(range) });
    for (const row of page.items) {
      if (row.kind === 'expense' && logged(row.record.createdAt)) expenses.push(row.record);
      if (row.kind === 'payment' && row.record.status === 'POSTED' && logged(row.record.createdAt)) payments.push(row.record);
    }
    cursor = page.nextCursor;
  } while (cursor);
  const sortedExpenses = expenses.map((record) => ({ kind: 'expense' as const, record })).sort(oldestFirst).map((r) => r.record);
  const sortedPayments = payments.map((record) => ({ kind: 'payment' as const, record })).sort(oldestFirst).map((r) => r.record);

  const receipts = await receiptsOf(store, organization.id, sortedExpenses, asOf);
  const names = await namesOf(store, organization.id, sortedExpenses, sortedPayments, lang, report);

  const expenseLines = sortedExpenses.map((record, i): ExpenseLine => {
    const ref = refOf('E', i);
    return {
      ref,
      record,
      vendor: (record.vendorId ? names.vendors.get(record.vendorId) : undefined) ?? record.vendor,
      category: record.categoryId ? (names.categories.get(record.categoryId) ?? null) : null,
      client: record.customerId ? (names.customers.get(record.customerId) ?? null) : null,
      project: record.projectId ? (names.projects.get(record.projectId) ?? null) : null,
      loggedBy: record.createdByUserId ? (names.users.get(record.createdByUserId) ?? null) : null,
      receipts: (receipts.get(record.id) ?? []).map((r, n) => {
        const name = `${ref}-${n + 1}.${receiptExtension(r.mimeType)}`;
        return { ...r, name, path: `receipts/${name}` };
      }),
    };
  });
  const incomeLines = sortedPayments.map(
    (record, i): IncomeLine => ({
      ref: refOf('I', i),
      record,
      client: record.customerId ? (names.customers.get(record.customerId) ?? null) : null,
      project: record.projectId ? (names.projects.get(record.projectId) ?? null) : null,
      loggedBy: record.createdByUserId ? (names.users.get(record.createdByUserId) ?? null) : null,
    }),
  );
  return { organization, range, asOf, lang, forLink: options.forLink, expenses: expenseLines, income: incomeLines };
}

/** Receipts per expense id, oldest upload first, in batches (one query each). */
async function receiptsOf(store: LedgerStore, organizationId: string, expenses: readonly ExpenseRecord[], asOf: Date): Promise<Map<string, PeriodReceiptRecord[]>> {
  const byExpense = new Map<string, PeriodReceiptRecord[]>();
  for (let i = 0; i < expenses.length; i += RECEIPT_BATCH) {
    const batch = expenses.slice(i, i + RECEIPT_BATCH).map((e) => e.id);
    for (const r of await store.expenseReceipts.listReadyByExpenseIds(organizationId, batch)) {
      if (r.createdAt.getTime() > asOf.getTime()) continue;
      byExpense.set(r.expenseId, [...(byExpense.get(r.expenseId) ?? []), r]);
    }
  }
  for (const list of byExpense.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return byExpense;
}

/** Every name the report writes; for the receipts zip (`all` false) only the vendors its index names. */
async function namesOf(store: LedgerStore, organizationId: string, expenses: readonly ExpenseRecord[], payments: readonly PaymentRecord[], lang: Lang, all: boolean) {
  const customers = new Set<string>();
  const projects = new Set<string>();
  const vendors = new Set<string>();
  const users = new Set<string>();
  const categoryIds = new Set<string>();
  const add = (set: Set<string>, id: string | null) => void (id && set.add(id));
  for (const e of expenses) {
    add(vendors, e.vendorId);
    if (!all) continue;
    add(customers, e.customerId);
    add(projects, e.projectId);
    add(users, e.createdByUserId);
    add(categoryIds, e.categoryId);
  }
  for (const p of payments) {
    add(customers, p.customerId);
    add(projects, p.projectId);
    add(users, p.createdByUserId);
  }
  const [batch, categories] = await Promise.all([
    store.periodPack.names(organizationId, { customers, projects, vendors, users }),
    categoryIds.size ? store.expenseCategories.list(organizationId, { includeArchived: true }) : Promise.resolve([]),
  ]);
  return { ...batch, categories: new Map(displayCategoryNames(categories, lang).map((c) => [c.id, c.name] as const)) };
}
