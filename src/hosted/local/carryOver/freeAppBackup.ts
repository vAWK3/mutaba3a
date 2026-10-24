import { z } from 'zod';

/**
 * The free web app's full backup (`serializeAllTables`, src/db/backup.ts),
 * read as untrusted input (MUT-291 §3.3). Written here rather than imported
 * from src/types: the portal never imports the local data layer, and MUT-292
 * deletes it. Only the fields the carry-over maps are checked; extra fields
 * and tables pass through. A table that is missing reads as empty.
 *
 * Never name the old database's library in this chunk: `HOSTED_RULES` refuses
 * the word in the portal bundle (R4). It is the "free app backup" here.
 */

/** The free app's schema version when this was written; a newer backup is refused (a test pins it to the app's own). */
export const FREE_APP_BACKUP_MAX_VERSION = 24;

const id = z.string().min(1);
const iso = z.string().min(1);
const minor = z.number().int();
const text = z.string().optional();
const optionalId = z.string().optional();

const profile = z.object({ id, name: z.string(), defaultCurrency: z.string(), isDefault: z.boolean().optional(), createdAt: iso.optional(), archivedAt: text, logoDataUrl: text, primaryColor: text, email: text, phone: text, nameEn: text });
const client = z.object({ id, name: z.string(), email: text, phone: text, notes: text, profileId: optionalId, archivedAt: text });
const project = z.object({ id, name: z.string(), clientId: optionalId, field: text, notes: text, profileId: optionalId, archivedAt: text });
const category = z.object({ id, kind: z.string(), name: z.string() });
const transaction = z.object({
  id,
  kind: z.string(),
  status: z.string(),
  title: text,
  clientId: optionalId,
  projectId: optionalId,
  categoryId: optionalId,
  amountMinor: minor,
  currency: z.string(),
  toCurrency: text,
  toAmountMinor: minor.optional(),
  occurredAt: iso,
  dueDate: text,
  paidAt: text,
  notes: text,
  receivedAmountMinor: minor.optional(),
  profileId: optionalId,
  deletedAt: text,
  archivedAt: text,
  needsReview: z.boolean().optional(),
  linkedDocumentId: text,
});
const paymentRecord = z.object({ id, transactionId: id, amountMinor: minor, paidAt: iso, notes: text, deletedAt: text });
const expense = z.object({ id, profileId: id, title: text, vendor: text, vendorId: optionalId, clientId: optionalId, projectId: optionalId, categoryId: optionalId, amountMinor: minor, currency: z.string(), occurredAt: iso, notes: text, recurringRuleId: optionalId, deletedAt: text });
const expenseCategory = z.object({ id, profileId: id, name: z.string(), color: text });
const vendor = z.object({ id, profileId: id, canonicalName: z.string() });
const receipt = z.object({ id, profileId: id, expenseId: optionalId, fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int().nonnegative(), data: z.string() });

/** The tables carried as records, and the row schema each row must pass to be carried. */
const ROW_SCHEMAS = {
  businessProfiles: profile,
  clients: client,
  projects: project,
  categories: category,
  transactions: transaction,
  paymentRecords: paymentRecord,
  expenses: expense,
  expenseCategories: expenseCategory,
  vendors: vendor,
  receipts: receipt,
} as const;

/** Tables with no home in the API: only counted, for "Not carried". */
export const COUNTED_TABLES = ['recurringRules', 'recurringOccurrences', 'documents', 'engagements', 'monthCloseStatuses'] as const;

type RowTable = keyof typeof ROW_SCHEMAS;
export type FreeAppTables = { [T in RowTable]: Array<z.infer<(typeof ROW_SCHEMAS)[T]>> };
export type CountedTable = (typeof COUNTED_TABLES)[number];

export interface FreeAppBackup {
  version: number;
  timestamp: string | null;
  tables: FreeAppTables;
  /** Rows of a counted table, per table (recurring rules, documents …), never carried. */
  counted: Record<CountedTable, number>;
  /** Rows that didn't have the shape a record needs, per table; listed as not carried, never dropped silently. */
  malformed: Partial<Record<RowTable, number>>;
}

export type FreeAppProfile = z.infer<typeof profile>;
export type FreeAppClient = z.infer<typeof client>;
export type FreeAppProject = z.infer<typeof project>;
export type FreeAppCategory = z.infer<typeof category>;
export type FreeAppTransaction = z.infer<typeof transaction>;
export type FreeAppPaymentRecord = z.infer<typeof paymentRecord>;
export type FreeAppExpense = z.infer<typeof expense>;
export type FreeAppExpenseCategory = z.infer<typeof expenseCategory>;
export type FreeAppVendor = z.infer<typeof vendor>;
export type FreeAppReceipt = z.infer<typeof receipt>;

export type FreeAppBackupRefusal = 'not-a-backup' | 'too-new';

export class FreeAppBackupRefused extends Error {
  constructor(readonly reason: FreeAppBackupRefusal) {
    super(`free app backup refused: ${reason}`);
    this.name = 'FreeAppBackupRefused';
  }
}

/** True for anything shaped like a free-app backup (`version` and a `tables` object), before it is checked in full. */
export function looksLikeFreeAppBackup(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === 'number' && record.tables !== null && typeof record.tables === 'object' && !Array.isArray(record.tables);
}

/** Parses and checks a free-app backup's text; throws `FreeAppBackupRefused`, never anything else. */
export function parseFreeAppBackup(text: string): FreeAppBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FreeAppBackupRefused('not-a-backup');
  }
  return parseFreeAppBackupValue(raw);
}

export function parseFreeAppBackupValue(raw: unknown): FreeAppBackup {
  if (!looksLikeFreeAppBackup(raw)) throw new FreeAppBackupRefused('not-a-backup');
  const record = raw as { version: number; timestamp?: unknown; tables: Record<string, unknown> };
  if (!Number.isInteger(record.version) || record.version < 1) throw new FreeAppBackupRefused('not-a-backup');
  if (record.version > FREE_APP_BACKUP_MAX_VERSION) throw new FreeAppBackupRefused('too-new');

  const tables = {} as Record<RowTable, unknown[]>;
  const malformed: FreeAppBackup['malformed'] = {};
  for (const table of Object.keys(ROW_SCHEMAS) as RowTable[]) {
    const rows = listOf(record.tables[table]);
    const good: unknown[] = [];
    for (const row of rows) {
      const parsed = ROW_SCHEMAS[table].safeParse(row);
      if (parsed.success) good.push(parsed.data);
      else malformed[table] = (malformed[table] ?? 0) + 1;
    }
    tables[table] = good;
  }
  const counted = Object.fromEntries(COUNTED_TABLES.map((table) => [table, listOf(record.tables[table]).length])) as Record<CountedTable, number>;
  return { version: record.version, timestamp: typeof record.timestamp === 'string' ? record.timestamp : null, tables: tables as FreeAppTables, counted, malformed };
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
