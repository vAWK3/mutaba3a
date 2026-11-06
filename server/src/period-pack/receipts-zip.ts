import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { AttachmentStorage } from '../attachments/storage.js';
import { formatMoney, type Currency } from '../money.js';
import { INDEX_COLUMNS, headersOf } from './columns.js';
import { csvDocument, type CsvCell } from './csv.js';
import type { PeriodReceipt, PeriodRows } from './rows.js';

/**
 * MUT-314 (ADR-248, D8, D10): the receipts zip, streamed. Receipts go one at a time, in Ref order, as
 * `receipts/<Ref>-<n>.<ext>` (STORE: they are compressed already), each read from the bucket a chunk at a time; then
 * `index.csv` (DEFLATE) is written last, so its Status column is exact; then the central directory.
 *
 * - A receipt that can't be opened (null, a throw, or no first chunk within the idle limit) is skipped and listed
 *   `missing`; the rest of the zip is whole, and one error is logged per zip with the count.
 * - A receipt that fails after its first bytes went out can't be taken back: the stream errors, the central directory
 *   is never written, and the client sees a broken download rather than a zip that looks whole.
 * - `return()` (the client went away) cancels the bucket read in flight and terminates the zip.
 * Memory: one bucket chunk plus fflate's buffer, whatever the zip's size. No ZIP64: the 500 MiB cap keeps it far below.
 */
export const ZIP_MIME = 'application/zip';
export const RECEIPT_IDLE_MS = 30_000;

export interface ReceiptsZipOptions {
  storage: Pick<AttachmentStorage, 'read'>;
  onMissing(count: number): void;
  idleMs?: number;
}

class IdleTimeout extends Error {
  constructor() {
    super('receipt read went idle');
  }
}

function withIdle<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new IdleTimeout()), ms)));
  return Promise.race([promise, idle]).finally(() => clearTimeout(timer));
}

interface Planned {
  receipt: PeriodReceipt;
  ref: string;
  date: string;
  vendor: string | null;
  currency: string;
  amount: string;
  rowId: string;
  status: 'ok' | 'missing';
}

export function receiptsZip(rows: PeriodRows, options: ReceiptsZipOptions): AsyncIterator<Uint8Array> {
  const idleMs = options.idleMs ?? RECEIPT_IDLE_MS;
  const planned: Planned[] = rows.expenses.flatMap((line) =>
    line.receipts.map((receipt) => ({
      receipt,
      ref: line.ref,
      date: line.record.occurredOn,
      vendor: line.vendor,
      currency: line.record.currency,
      amount: formatMoney({ minor: line.record.amountMinor, currency: line.record.currency as Currency }),
      rowId: line.record.id,
      status: 'ok' as const,
    })),
  );
  const queue: Uint8Array[] = [];
  let failure: unknown = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else queue.push(chunk);
  });
  let next = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let entry: ZipPassThrough | null = null;
  let finished = false;
  let cancelled = false;

  function writeIndex(): void {
    const lines: CsvCell[][] = [
      headersOf(INDEX_COLUMNS, rows.lang),
      ...planned.map((p): CsvCell[] => [{ text: p.receipt.path }, { text: p.ref }, { raw: p.date }, { text: p.vendor ?? '' }, { raw: p.currency }, { raw: p.amount }, { raw: p.status }, { raw: p.rowId }]),
    ];
    const index = new ZipDeflate('index.csv', { level: 6 });
    zip.add(index);
    index.push(strToU8(csvDocument(lines)), true);
    zip.end();
    const missing = planned.filter((p) => p.status === 'missing').length;
    if (missing > 0) options.onMissing(missing);
    finished = true;
  }

  /** Opens the next receipt; a missing one is marked and skipped. The entry starts only with its first chunk. */
  async function open(item: Planned): Promise<void> {
    try {
      const stream = await withIdle(options.storage.read(item.receipt.storageKey), idleMs);
      if (!stream) throw new Error('no such object');
      const opened = stream.getReader();
      reader = opened;
      const first = await withIdle(opened.read(), idleMs);
      entry = new ZipPassThrough(item.receipt.path);
      entry.mtime = item.receipt.createdAt;
      zip.add(entry);
      if (first.done) finishEntry();
      else entry.push(first.value);
    } catch {
      if (cancelled) return;
      item.status = 'missing';
      void reader?.cancel().catch(() => undefined);
      reader = null;
      entry = null;
    }
  }

  function finishEntry(): void {
    entry?.push(new Uint8Array(0), true);
    entry = null;
    reader = null;
  }

  async function step(): Promise<void> {
    if (reader && entry) {
      const chunk = await withIdle(reader.read(), idleMs);
      if (chunk.done) finishEntry();
      else entry.push(chunk.value);
      return;
    }
    const item = planned[next];
    if (item) {
      next += 1;
      await open(item);
      return;
    }
    writeIndex();
  }

  return {
    async next(): Promise<IteratorResult<Uint8Array>> {
      while (queue.length === 0) {
        if (failure) throw failure;
        if (cancelled || finished) return { done: true, value: undefined };
        await step();
      }
      return { done: false, value: queue.shift()! };
    },
    async return(): Promise<IteratorResult<Uint8Array>> {
      cancelled = true;
      await reader?.cancel().catch(() => undefined);
      zip.terminate();
      queue.length = 0;
      return { done: true, value: undefined };
    },
  };
}
