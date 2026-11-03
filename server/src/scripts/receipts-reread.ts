import { hasFeature } from '../features.js';
import { SUGGESTION_FIELDS, type SuggestionField } from '../receipts/extract/merge.js';
import { serverReaderGeneration } from '../receipts/reading/reader.js';
import type { LedgerStore, ReceiptSuggestion, SuggestionSource } from '../repositories/ports.js';

/**
 * MUT-514 (D11, reversed by Basel 2026-11-03: "Keep the fixed command"): ask the server to read again the To-review
 * receipts an older server reader filled, so a fixed reader replaces what the old one got wrong.
 *
 *   DATABASE_URL=… npm run receipts:reread -- --reader-below 2            # dry run: lists, writes nothing
 *   DATABASE_URL=… npm run receipts:reread -- --reader-below 2 --apply    # resets them; the 5-minute sweep reads them
 *
 * A receipt qualifies while it is READY, live, To review and unapproved, its suggestion was stamped by a server
 * reader of a generation below `--reader-below`, it is not being read now, and its uploader still holds
 * `receipt_reading` (else the sweep would only skip it). Only the fields the server read (`ocr`, `pdf-text`) are
 * dropped; a QR or vendor-list field stays. A receipt a client filled after the server read (its suggestion then
 * carries the client's reader version, `phone-1`) is not picked: nothing says which reader filled its fields. The read
 * state starts afresh (PENDING, no attempts, no first claim), so
 * the 30-minute give-up clock of the first read can't fail it. Run it only once every instance runs the new reader:
 * an old one would read it again with the old rules (before-release.md). Output: ids, field names and sources, never
 * a value a receipt says.
 */

/** What a server read fills: the fields a re-read drops and reads again. */
const SERVER_SOURCES: readonly SuggestionSource[] = ['ocr', 'pdf-text'];

export interface RereadPlanItem {
  id: string;
  organizationId: string;
  readerVersion: string;
  /** Every field the suggestion holds now, with its source. */
  fields: Array<{ field: SuggestionField; source: SuggestionSource }>;
  /** The fields the re-read drops (server-read). */
  cleared: SuggestionField[];
}

export interface RereadResult {
  planned: RereadPlanItem[];
  /** Receipts that qualified but whose uploader no longer holds the grant (or left). */
  noGrant: string[];
  /** Applied: the receipts reset (a receipt edited meanwhile is left as it is). */
  reset: string[];
}

function fieldsOf(suggestion: ReceiptSuggestion): RereadPlanItem['fields'] {
  return SUGGESTION_FIELDS.flatMap((field) => {
    const value = suggestion[field];
    return value ? [{ field, source: value.source }] : [];
  });
}

/** The suggestion without its server-read fields: null when nothing else is left. */
export function withoutServerFields(suggestion: ReceiptSuggestion): ReceiptSuggestion | null {
  const kept = Object.fromEntries(SUGGESTION_FIELDS.flatMap((field) => {
    const value = suggestion[field];
    return value && !SERVER_SOURCES.includes(value.source) ? [[field, value]] : [];
  }));
  return Object.keys(kept).length > 0 ? ({ readerVersion: suggestion.readerVersion, ...kept } as ReceiptSuggestion) : null;
}

export async function rereadReceipts(store: LedgerStore, options: { readerBelow: number; apply: boolean; now: Date }): Promise<RereadResult> {
  const result: RereadResult = { planned: [], noGrant: [], reset: [] };
  for (const receipt of await store.expenseReceipts.listServerReadToReview()) {
    const suggestion = receipt.suggested;
    const generation = suggestion ? serverReaderGeneration(suggestion.readerVersion) : null;
    if (!suggestion || generation === null || generation >= options.readerBelow) continue;
    if (receipt.uploadedByUserId === null || !(await hasFeature(store, receipt.uploadedByUserId, 'receipt_reading'))) {
      result.noGrant.push(receipt.id);
      continue;
    }
    const fields = fieldsOf(suggestion);
    const cleared = fields.filter((f) => SERVER_SOURCES.includes(f.source)).map((f) => f.field);
    result.planned.push({ id: receipt.id, organizationId: receipt.organizationId, readerVersion: suggestion.readerVersion, fields, cleared });
    if (!options.apply) continue;
    if (!(await store.expenseReceipts.resetForReread(receipt.id, receipt.version, withoutServerFields(suggestion), options.now))) continue;
    result.reset.push(receipt.id);
    await store.audit.append({
      organizationId: receipt.organizationId,
      actorType: 'ADMIN',
      actorId: null,
      action: 'expense_receipt.reread_requested',
      entityType: 'expense_receipt',
      entityId: receipt.id,
      metadata: { readerVersion: suggestion.readerVersion, readerBelow: options.readerBelow, cleared },
      requestId: null,
    });
  }
  return result;
}

function parseArgs(argv: readonly string[]): { readerBelow: number; apply: boolean } | null {
  const at = argv.indexOf('--reader-below');
  const readerBelow = at >= 0 ? Number(argv[at + 1]) : Number.NaN;
  return Number.isInteger(readerBelow) && readerBelow > 1 ? { readerBelow, apply: argv.includes('--apply') } : null;
}

const isMain = process.argv[1]?.endsWith('receipts-reread.ts') || process.argv[1]?.endsWith('receipts-reread.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  const args = parseArgs(process.argv.slice(2));
  if (!url || !args) {
    console.error(
      [
        'usage: DATABASE_URL=… npm run receipts:reread -- --reader-below <generation ≥ 2> [--apply]',
        'Re-reads To-review, unapproved receipts a server reader older than the generation filled (dry run without --apply).',
        'Only receipts whose suggestion still carries the server reader version are picked; one a client filled last is not.',
        'Run it only once every API instance runs the new reader.',
      ].join('\n'),
    );
    process.exit(2);
  }
  const { PrismaLedgerStore } = await import('../repositories/prisma.js');
  const store = PrismaLedgerStore.connect(url);
  try {
    const r = await rereadReceipts(store, { ...args, now: new Date() });
    for (const item of r.planned) {
      const fields = item.fields.map((f) => `${f.field}(${f.source})`).join(' ');
      console.log(`${item.id} org ${item.organizationId} ${item.readerVersion}: ${fields || '—'}; drops ${item.cleared.join(' ') || '—'}`);
    }
    for (const id of r.noGrant) console.log(`${id}: skipped, its uploader no longer holds receipt_reading`);
    console.log(args.apply ? `receipts-reread: ${r.reset.length} of ${r.planned.length} reset for the sweep to read` : `receipts-reread (dry run): ${r.planned.length} would be read again; nothing written`);
  } finally {
    await store.disconnect();
  }
}
