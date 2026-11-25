import { normalizeIdentifier } from '../receipts/extract/buyer.js';
import { READ_FIELDS, type SuggestionField } from '../receipts/extract/merge.js';
import { BUYER_MEMORY_RECEIPTS, organizationBuyerIds, SERVER_READER_GENERATION, serverReaderGeneration } from '../receipts/reading/reader.js';
import type { LedgerStore, ReceiptSuggestion, SuggestionSource } from '../repositories/ports.js';

/**
 * MUT-514 (D11, reversed by Basel 2026-11-03: "Keep the fixed command"): ask the server to read again the To-review
 * receipts an older server reader filled, so a fixed reader replaces what the old one got wrong.
 *
 *   DATABASE_URL=… npm run receipts:reread -- --reader-below 2            # dry run: lists, writes nothing
 *   DATABASE_URL=… npm run receipts:reread -- --reader-below 2 --apply    # resets them; the 5-minute sweep reads them
 *   DATABASE_URL=… npm run receipts:reread -- --reader-below 4 --mime application/pdf   # only PDFs (MUT-590)
 *
 * A receipt qualifies while it is READY, live, To review and unapproved, its suggestion was stamped by a server
 * reader of a generation below `--reader-below`, it is not being read now, and its uploader still has an account
 * (else the sweep would only skip it). Only the fields the server read (`ocr`, `pdf-text`) are
 * dropped; a QR or vendor-list field stays. A receipt a client filled after the server read (its suggestion then
 * carries the client's reader version, `phone-1`) is not picked: nothing says which reader filled its fields. The read
 * state starts afresh (PENDING, no attempts, no first claim), so
 * the 30-minute give-up clock of the first read can't fail it. Run it only once every instance runs the new reader:
 * an old one would read it again with the old rules (before-release.md). Output: ids, field names and sources, never
 * a value a receipt says.
 *
 *   DATABASE_URL=… npm run receipts:reread -- --buyer-contacts            # MUT-630: report only, writes nothing
 *
 * MUT-630 (plan item 11): filing a receipt copies the reader's phone and email onto a vendor that has none, so an
 * older reader's buyer contact may sit on vendors. `--buyer-contacts` lists the vendors on every profile,
 * and their To-review receipts, whose phone or email is one of the profile's learned buyer identifiers: ids and field
 * names only. It clears nothing: run it after the `--reader-below 5 --apply` re-read (which re-reads those receipts
 * and teaches the buyer emails), and a listed vendor's detail is changed only with Basel's OK.
 *
 *   DATABASE_URL=… npm run receipts:reread -- --backlog --apply           # MUT-659: once, after the deploy
 *
 * MUT-659 (Basel, 2026-11-22): reading is for everyone, no longer a per-person grant. `--backlog` asks, once, for every
 * To-review receipt that was never read (its uploader never held the old grant); the 5-minute sweep reads them. It
 * writes, so it runs only with --apply. Idempotent: a second run finds them asked for already.
 */

/** What a server read fills: the fields a re-read drops and reads again. */
const SERVER_SOURCES: readonly SuggestionSource[] = ['ocr', 'pdf-text'];

export interface RereadPlanItem {
  id: string;
  organizationId: string;
  readerVersion: string;
  /** Every field the suggestion holds now, with its source. */
  fields: Array<{ field: SuggestionField; source: SuggestionSource }>;
  /** The fields the re-read drops (server-read, and a vendor-list name looked up by a server-read registration no.). */
  cleared: SuggestionField[];
}

export interface RereadResult {
  planned: RereadPlanItem[];
  /** Receipts that qualified but whose uploader left (the sweep would skip them). */
  noUploader: string[];
  /** Applied: the receipts reset (a receipt edited meanwhile is left as it is). */
  reset: string[];
}

function fieldsOf(suggestion: ReceiptSuggestion): RereadPlanItem['fields'] {
  return READ_FIELDS.flatMap((field) => {
    const value = suggestion[field];
    return value ? [{ field, source: value.source }] : [];
  });
}

/**
 * The suggestion without its server-read fields: null when nothing else is left. A vendor-list name goes with the
 * server-read registration no. it was looked up by (the read job never replaces a stored name). What is kept carries
 * the current reader's version, so a re-read that rightly adds nothing is not picked again.
 */
export function withoutServerFields(suggestion: ReceiptSuggestion): ReceiptSuggestion | null {
  const serverRead = (source: SuggestionSource) => SERVER_SOURCES.includes(source);
  const dropsRegistration = suggestion.registrationNo !== undefined && serverRead(suggestion.registrationNo.source);
  const kept = Object.fromEntries(READ_FIELDS.flatMap((field) => {
    const value = suggestion[field];
    return value && !serverRead(value.source) && !(dropsRegistration && value.source === 'vendor') ? [[field, value]] : [];
  }));
  const readerVersion = suggestion.readerVersion.replace(/-\d+$/, `-${SERVER_READER_GENERATION}`);
  return Object.keys(kept).length > 0 ? ({ readerVersion, ...kept } as ReceiptSuggestion) : null;
}

/** `mimeType`: only receipts of that file type (MUT-590 D3: a reader change that only reads PDFs differently). */
export async function rereadReceipts(store: LedgerStore, options: { readerBelow: number; mimeType?: string | undefined; apply: boolean; now: Date }): Promise<RereadResult> {
  if (options.readerBelow > SERVER_READER_GENERATION) throw new Error(`--reader-below ${options.readerBelow} is above the current reader (generation ${SERVER_READER_GENERATION})`);
  const result: RereadResult = { planned: [], noUploader: [], reset: [] };
  for (const receipt of await store.expenseReceipts.listServerReadToReview()) {
    const suggestion = receipt.suggested;
    const generation = suggestion ? serverReaderGeneration(suggestion.readerVersion) : null;
    if (!suggestion || generation === null || generation >= options.readerBelow) continue;
    if (options.mimeType !== undefined && receipt.mimeType !== options.mimeType) continue;
    if (receipt.uploadedByUserId === null) {
      result.noUploader.push(receipt.id);
      continue;
    }
    const fields = fieldsOf(suggestion);
    const kept = withoutServerFields(suggestion);
    const cleared = fields.filter((f) => kept?.[f.field] === undefined).map((f) => f.field);
    result.planned.push({ id: receipt.id, organizationId: receipt.organizationId, readerVersion: suggestion.readerVersion, fields, cleared });
    if (!options.apply) continue;
    if (!(await store.expenseReceipts.resetForReread(receipt.id, receipt.version, kept, options.now))) continue;
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

/** MUT-630: a vendor or a To-review receipt carrying a buyer's phone or email. Ids and field names, never a value. */
export interface BuyerContactItem {
  kind: 'vendor' | 'receipt';
  id: string;
  organizationId: string;
  fields: Array<'phone' | 'email'>;
}

/** How many vendors per profile the report reads (a pilot profile has dozens). */
const VENDORS_PER_PROFILE = 10_000;

function buyerFields(learned: ReadonlySet<string>, contact: { phone: string | null | undefined; email: string | null | undefined }): BuyerContactItem['fields'] {
  const fields: BuyerContactItem['fields'] = [];
  if (contact.phone && learned.has(normalizeIdentifier(contact.phone))) fields.push('phone');
  if (contact.email && learned.has(normalizeIdentifier(contact.email))) fields.push('email');
  return fields;
}

/**
 * MUT-630 (plan item 11): every vendor, and every To-review receipt among the latest BUYER_MEMORY_RECEIPTS, on any
 * profile (MUT-659: every profile's receipts are read), whose phone or email is one of that profile's learned buyer
 * identifiers (what the read job would never fill now). Reads only.
 */
export async function buyerContactReport(store: LedgerStore): Promise<BuyerContactItem[]> {
  const items: BuyerContactItem[] = [];
  for (const organizationId of (await store.organizations.list()).map((o) => o.id).sort()) {
    const learned = new Set(await organizationBuyerIds(store, organizationId));
    if (learned.size === 0) continue;
    for (const { vendor } of await store.vendors.search(organizationId, '', VENDORS_PER_PROFILE)) {
      const fields = buyerFields(learned, vendor);
      if (fields.length) items.push({ kind: 'vendor', id: vendor.id, organizationId, fields });
    }
    const toReview = await store.expenseReceipts.list(organizationId, { filingStatus: 'TO_REVIEW' }, { limit: BUYER_MEMORY_RECEIPTS, cursor: null });
    for (const receipt of toReview.items) {
      const fields = buyerFields(learned, { phone: receipt.suggested?.phone?.value, email: receipt.suggested?.email?.value });
      if (fields.length) items.push({ kind: 'receipt', id: receipt.id, organizationId, fields });
    }
  }
  return items;
}

/** MUT-659: every never-read To-review receipt with an uploader becomes PENDING for the sweep. Returns the ids moved. */
export async function queueReadBacklog(store: LedgerStore, now: Date): Promise<string[]> {
  return store.expenseReceipts.markBacklogPending({}, now);
}

function parseArgs(argv: readonly string[]): { readerBelow: number; mimeType?: string; apply: boolean } | null {
  const at = argv.indexOf('--reader-below');
  const readerBelow = at >= 0 ? Number(argv[at + 1]) : Number.NaN;
  const mimeAt = argv.indexOf('--mime');
  const mimeType = mimeAt >= 0 ? argv[mimeAt + 1] : undefined;
  if (mimeAt >= 0 && !mimeType?.includes('/')) return null;
  if (!(Number.isInteger(readerBelow) && readerBelow > 1 && readerBelow <= SERVER_READER_GENERATION)) return null;
  return { readerBelow, ...(mimeType ? { mimeType } : {}), apply: argv.includes('--apply') };
}

const isMain = process.argv[1]?.endsWith('receipts-reread.ts') || process.argv[1]?.endsWith('receipts-reread.js');
if (isMain) {
  const url = process.env.DATABASE_URL;
  const argv = process.argv.slice(2);
  const contacts = argv.includes('--buyer-contacts');
  const backlog = argv.includes('--backlog');
  const args = contacts || backlog ? null : parseArgs(argv);
  if (!url || (contacts && argv.includes('--apply')) || (backlog && !argv.includes('--apply')) || (!contacts && !backlog && !args)) {
    console.error(
      [
        `usage: DATABASE_URL=… npm run receipts:reread -- --reader-below <2..${SERVER_READER_GENERATION}> [--mime <type>] [--apply]`,
        '       DATABASE_URL=… npm run receipts:reread -- --buyer-contacts   (MUT-630: report only; it never clears)',
        '       DATABASE_URL=… npm run receipts:reread -- --backlog --apply  (MUT-659: ask once for every never-read To-review receipt)',
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
    if (backlog) {
      const ids = await queueReadBacklog(store, new Date());
      console.log(`receipts-reread --backlog: ${ids.length} never-read To-review receipts asked for; the sweep reads them`);
    } else if (contacts) {
      const items = await buyerContactReport(store);
      for (const item of items) console.log(`${item.kind} ${item.id} org ${item.organizationId}: ${item.fields.join(' ')} matches a learned buyer identifier`);
      console.log(`receipts-reread --buyer-contacts: ${items.length} found; nothing written (a vendor's detail changes only with Basel's OK)`);
    } else if (args) {
      const r = await rereadReceipts(store, { ...args, now: new Date() });
      for (const item of r.planned) {
        const fields = item.fields.map((f) => `${f.field}(${f.source})`).join(' ');
        console.log(`${item.id} org ${item.organizationId} ${item.readerVersion}: ${fields || '—'}; drops ${item.cleared.join(' ') || '—'}`);
      }
      for (const id of r.noUploader) console.log(`${id}: skipped, its uploader left`);
      console.log(args.apply ? `receipts-reread: ${r.reset.length} of ${r.planned.length} reset for the sweep to read` : `receipts-reread (dry run): ${r.planned.length} would be read again; nothing written`);
    }
  } finally {
    await store.disconnect();
  }
}
