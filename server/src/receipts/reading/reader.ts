import type { AttachmentStorage } from '../../attachments/storage.js';
import { hasFeature } from '../../features.js';
import type { Logger } from '../../logger.js';
import type { ExpenseReceiptRecord, FinishReadOutcome, LedgerStore, ReceiptReadRequest, ReceiptSuggestion } from '../../repositories/ports.js';
import { extractReceipt } from '../extract/extract.js';
import { fillAbsent, isCompleteSuggestion } from '../extract/merge.js';
import { OcrReadError, scrubbed, type OcrClient, type OcrReadErrorCode } from '../ocr-client.js';
import type { ReadDispatcher } from './dispatcher.js';

/** R10 #10: longer than Cloud Tasks' 60 s dispatch deadline, so a read still running is never claimed twice. */
export const READ_LEASE_MS = 90_000;
/** A receipt is tried this many times, then FAILED (`exhausted`); the person types the fields, as before. */
export const MAX_READ_ATTEMPTS = 3;
/**
 * R10 #6: or once this long has passed since its first claim, whatever the attempts. Never before a reader has
 * claimed it: a backlog that waits for a reader (a slow queue, a paused sweep) is tried before it is given up on.
 */
export const READ_GIVE_UP_MS = 30 * 60_000;
/** Receipts one sweep looks at; the next sweep (5 min) takes the rest. */
export const SWEEP_BATCH = 100;
/** How many times a read merges again after the person edited the receipt under it. */
const STALE_RETRIES = 3;

/** What the read job answers for one receipt. `retry` is the only one Cloud Tasks should retry (a 503). */
export type ReadJobStatus = 'done' | 'skipped' | 'failed' | 'busy' | 'none' | 'retry';

export interface SweepSummary {
  enqueued: number;
  failed: number;
  enqueueErrors: number;
}

/** What `complete` needs from the reader: whether to read, and a best-effort ask. */
export interface ReceiptReadTrigger {
  decide(receipt: ExpenseReceiptRecord): Promise<ReceiptReadRequest | null>;
  requested(receipt: ExpenseReceiptRecord, now: Date): Promise<void>;
}

export interface ReceiptReader extends ReceiptReadTrigger {
  readOne(receiptId: string): Promise<ReadJobStatus>;
  sweep(): Promise<SweepSummary>;
  backlog(userId: string): Promise<number>;
}

export interface ReceiptReaderOptions {
  /** The unguarded store: the job and the feature check act for no principal. */
  store: LedgerStore;
  storage: AttachmentStorage;
  ocr: OcrClient;
  dispatcher: ReadDispatcher;
  logger: Logger;
  now: () => Date;
}

/** The reader version a server read stamps when it added a field (MUT-441 plan, "Merge rule"). */
export function serverReaderVersion(engine: string): string {
  return `server-ocr-${engine}-1`;
}

/**
 * MUT-441: the server reads a receipt. Every log line here carries ids, codes, counts and timings, never a word the
 * receipt says (AC5); OCR and extraction failures arrive as `OcrReadError` with a fixed message (R10 #3).
 */
export function createReceiptReader(options: ReceiptReaderOptions): ReceiptReader {
  const { store, storage, ocr, dispatcher, logger, now } = options;
  const receipts = store.expenseReceipts;

  async function holdsGrant(receipt: ExpenseReceiptRecord): Promise<boolean> {
    return receipt.uploadedByUserId !== null && (await hasFeature(store, receipt.uploadedByUserId, 'receipt_reading'));
  }

  /** D3 and F5: a receipt reads only for an uploader who holds the grant; one whose uploader is gone never reads. */
  async function decide(receipt: ExpenseReceiptRecord): Promise<ReceiptReadRequest | null> {
    if (receipt.uploadedByUserId === null) return 'SKIPPED';
    if (!(await holdsGrant(receipt))) return null;
    return isCompleteSuggestion(receipt.suggested) ? 'SKIPPED' : 'PENDING';
  }

  /** Best effort (R10 #5): PENDING is already saved, so a failed ask only waits for the sweep. */
  async function enqueue(receiptId: string, attempt: number): Promise<boolean> {
    try {
      await dispatcher.enqueue(receiptId, attempt);
      return true;
    } catch {
      logger.warn({ receiptId, code: 'read_enqueue_failed' }, 'receipt read not queued; the sweep will');
      return false;
    }
  }

  async function requested(receipt: ExpenseReceiptRecord, at: Date): Promise<void> {
    if (receipt.readStatus !== 'PENDING' || (receipt.readLeaseUntil && receipt.readLeaseUntil >= at)) return;
    await enqueue(receipt.id, receipt.readAttempts ?? 0);
  }

  function exhausted(receipt: ExpenseReceiptRecord, at: Date, attemptsDone: number): boolean {
    if (attemptsDone >= MAX_READ_ATTEMPTS) return true;
    const firstClaim = receipt.readFirstClaimedAt;
    return (receipt.readAttempts ?? 0) > 0 && firstClaim !== null && firstClaim !== undefined && at.getTime() - firstClaim.getTime() > READ_GIVE_UP_MS;
  }

  /** MUT-254: a registration no. that names a saved vendor gives its name, unless the stored suggestion has one. */
  async function withVendor(receipt: ExpenseReceiptRecord, read: ReceiptSuggestion): Promise<ReceiptSuggestion> {
    const registration = receipt.suggested?.registrationNo?.value ?? read.registrationNo?.value;
    if (!registration || receipt.suggested?.vendorName) return read;
    const vendor = await scrubbed('store_failed', () => store.vendors.findByRegistration(receipt.organizationId, registration));
    return vendor ? { ...read, vendorName: { value: vendor.canonicalName, source: 'vendor', confidence: 1 } } : read;
  }

  /** Every write of a read's outcome: a store error here may echo the suggestion it was given, so only a code leaves. */
  function finishRead(receiptId: string, version: number, outcome: FinishReadOutcome) {
    return scrubbed('store_failed', () => receipts.finishRead(receiptId, version, outcome));
  }

  async function finish(receiptId: string, version: number, outcome: FinishReadOutcome): Promise<ReadJobStatus> {
    const result = await finishRead(receiptId, version, outcome);
    if (result.kind === 'saved') return outcome.status === 'DONE' ? 'done' : outcome.status === 'FAILED' ? 'failed' : 'skipped';
    if (result.kind === 'skipped') return 'skipped';
    return 'none';
  }

  /**
   * Fill-absent onto what is stored now; a person's edit in between means merging again onto theirs. The vendor is
   * looked up on the profile the receipt is on now (MUT-503: it may have moved during the read).
   */
  async function save(claimed: ExpenseReceiptRecord, raw: ReceiptSuggestion): Promise<{ status: ReadJobStatus; added: number }> {
    let current = claimed;
    for (let i = 0; i < STALE_RETRIES; i += 1) {
      const read = await withVendor(current, raw);
      const { merged, added } = fillAbsent(current.suggested, read);
      const outcome: FinishReadOutcome = added.length > 0 ? { status: 'DONE', suggested: merged } : isCompleteSuggestion(current.suggested) ? { status: 'SKIPPED' } : { status: 'DONE' };
      const result = await finishRead(current.id, current.version, outcome);
      if (result.kind === 'stale') {
        current = result.record;
        continue;
      }
      if (result.kind === 'saved') return { status: outcome.status === 'DONE' ? 'done' : 'skipped', added: outcome.status === 'DONE' ? added.length : 0 };
      return { status: result.kind === 'skipped' ? 'skipped' : 'none', added: 0 };
    }
    await scrubbed('store_failed', () => receipts.releaseRead(claimed.id));
    return { status: 'retry', added: 0 };
  }

  async function readFile(receipt: ExpenseReceiptRecord): Promise<{ read: ReceiptSuggestion; lines: number }> {
    const body = await scrubbed('unavailable', () => storage.read(receipt.storageKey));
    if (!body) throw new OcrReadError('missing');
    const result = await ocr.read({ body, contentType: receipt.mimeType, hint: receipt.captureHint === 'SCANNED' ? 'scanned' : 'photo' });
    const read = await scrubbed('extract_failed', () => extractReceipt({ lines: result.lines, pdfText: result.pdfText }, { readerVersion: serverReaderVersion(result.engine) }));
    return { read, lines: result.lines.length };
  }

  /**
   * Part B of R10 #3: whatever escapes a read (the claim, a terminal write, the release) leaves as
   * `OcrReadError('store_failed')`, so the route's error handler logs and reports a fixed message with no `cause`.
   */
  function readOne(receiptId: string): Promise<ReadJobStatus> {
    return scrubbed('store_failed', () => readOneUnscrubbed(receiptId));
  }

  async function readOneUnscrubbed(receiptId: string): Promise<ReadJobStatus> {
    const started = Date.now();
    const at = now();
    const claim = await receipts.claimRead(receiptId, at, READ_LEASE_MS);
    if (claim.kind !== 'claimed') {
      logger.info({ receiptId, status: claim.kind }, 'receipt read not claimed');
      return claim.kind;
    }
    const receipt = claim.record;
    const attempts = receipt.readAttempts ?? 1;
    const done = (status: ReadJobStatus, extra: { code?: OcrReadErrorCode | 'exhausted' | 'moved'; lines?: number; added?: number } = {}) => {
      logger.info({ receiptId, status, attempts, durationMs: Date.now() - started, ...extra }, 'receipt read');
      return status;
    };
    if (receipt.deletedAt || receipt.filingStatus === 'FILED') return done(await finish(receiptId, receipt.version, { status: 'SKIPPED' }));
    // This claim was one more than the limit allows (a Cloud Tasks retry after three tries), or it waited too long.
    if (exhausted(receipt, at, attempts - 1)) return done(await finish(receiptId, receipt.version, { status: 'FAILED', failReason: 'exhausted' }), { code: 'exhausted' });
    // The grant was taken away, or the uploader left, since the receipt was queued.
    if (!(await holdsGrant(receipt)) || isCompleteSuggestion(receipt.suggested)) return done(await finish(receiptId, receipt.version, { status: 'SKIPPED' }));
    try {
      const { read, lines } = await readFile(receipt);
      const saved = await save(receipt, read);
      return done(saved.status, { lines, added: saved.added });
    } catch (err) {
      const failure = err instanceof OcrReadError ? err : new OcrReadError('unavailable');
      // MUT-503 (D6): the receipt moved to another profile since the claim and its old file is gone. Not missing:
      // the lease and the try go back, and the retry reads the file at its new key.
      if (failure.code === 'missing' && (await scrubbed('store_failed', () => receipts.releaseMovedRead(receiptId, receipt.storageKey)))) return done('retry', { code: 'moved' });
      if (failure.terminal) return done(await finish(receiptId, receipt.version, { status: 'FAILED', failReason: failure.code }), { code: failure.code });
      await scrubbed('store_failed', () => receipts.releaseRead(receiptId));
      return done('retry', { code: failure.code });
    }
  }

  /** R10 #7: the sweep never reads; it asks again (named tasks drop duplicates) or gives up on the exhausted. */
  function sweep(): Promise<SweepSummary> {
    return scrubbed('store_failed', sweepUnscrubbed);
  }

  async function sweepUnscrubbed(): Promise<SweepSummary> {
    const at = now();
    const summary: SweepSummary = { enqueued: 0, failed: 0, enqueueErrors: 0 };
    for (const receipt of await receipts.listPendingForSweep(at, SWEEP_BATCH)) {
      if (exhausted(receipt, at, receipt.readAttempts ?? 0)) {
        if ((await finish(receipt.id, receipt.version, { status: 'FAILED', failReason: 'exhausted' })) === 'failed') summary.failed += 1;
      } else if (await enqueue(receipt.id, receipt.readAttempts ?? 0)) summary.enqueued += 1;
      else summary.enqueueErrors += 1;
    }
    logger.info({ ...summary }, 'receipt read sweep');
    return summary;
  }

  /** R5: at grant time, the person's To-review receipts that were never read are asked for once. Idempotent. */
  async function backlog(userId: string): Promise<number> {
    const ids = await receipts.markBacklogPending({ userId }, now());
    for (const id of ids) await enqueue(id, 0);
    logger.info({ userId, queued: ids.length }, 'receipt read backlog');
    return ids.length;
  }

  return { decide, requested, readOne, sweep, backlog };
}
