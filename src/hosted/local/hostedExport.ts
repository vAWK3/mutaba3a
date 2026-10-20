import { HOSTED_EXPORT_ORIGIN, SNAPSHOT_FIELDS } from '../../../server/src/records-file/codec.js';
import type { LocalSnapshotMaps } from '../../../server/src/repositories/memory.js';
import type { ExpenseReceiptRecord } from '../../../server/src/repositories/ports.js';
import type { ExportHostedRecords, RecordsExportTransport } from '../session/recordsExportContract.js';
import { LOCAL_FORMAT_VERSION } from './migrations/index.js';
import { zipRecordsArchive } from './recordsArchive.js';
import { decodeRecordsFile, encodeRecordsFile } from './recordsFile.js';

/**
 * "Download my records", signed in (MUT-325, ADR-156): each chosen profile's
 * records file from the server, merged into one, and every receipt's bytes,
 * zipped by local mode's own `zipRecordsArchive` — so the file is the one
 * local mode writes and restores, by construction. The portal reaches it
 * through `@mut/records-export` (session/recordsExportContract.ts), loaded
 * only when the person presses Download.
 *
 * Long exports stay correct rather than fast: a rate limit is waited out,
 * a receipt that fails twice or arrives the wrong size is left out and
 * counted (Restore says so too), and Cancel aborts whatever is in flight.
 */

/** Four at a time: enough to hide each request's latency, few enough to stay well inside the session's rate limit. */
const RECEIPT_CONCURRENCY = 4;
/** A receipt is tried this many times (rate-limit waits aside) before it is left out. */
const RECEIPT_ATTEMPTS = 2;
/** Waiting out a rate limit is not a failure, but a server that never stops refusing is. */
const MAX_RATE_LIMIT_WAITS = 10;
const MS_PER_SECOND = 1000;
const DEFAULT_RETRY_AFTER_SECONDS = 5;

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export const exportHostedRecords: ExportHostedRecords = async (options) => {
  const { profileIds, signal, onProgress, transport, sleep = abortableSleep, now = () => new Date(), concurrency = RECEIPT_CONCURRENCY } = options;
  const waitingOutLimits = <T>(run: () => Promise<T>) => withRateLimitWaits(run, sleep, signal);

  const merged = emptyMaps();
  for (const [index, profileId] of profileIds.entries()) {
    onProgress?.({ phase: 'records', done: index, total: profileIds.length });
    const text = await waitingOutLimits(async () => (await transport.records(profileId, signal)).text());
    // Decoded here, before anything is saved: a cut-off or newer file is refused now, not on someone's restore.
    mergeInto(merged, decodeRecordsFile(text).maps);
  }

  const receipts = [...merged.expReceipts.values()].filter((r) => r.status === 'READY' && !r.deletedAt && r.storageKey);
  const files: Array<{ key: string; bytes: ArrayBuffer }> = [];
  let done = 0;
  let missingReceipts = 0;
  onProgress?.({ phase: 'receipts', done, total: receipts.length });
  await eachConcurrently(receipts, concurrency, async (receipt) => {
    const bytes = await fetchReceipt(receipt, transport, waitingOutLimits, signal);
    if (bytes) files.push({ key: receipt.storageKey, bytes });
    else missingReceipts += 1;
    done += 1;
    onProgress?.({ phase: 'receipts', done, total: receipts.length });
  });

  signal?.throwIfAborted();
  const recordsJson = encodeRecordsFile({ formatVersion: LOCAL_FORMAT_VERSION, stateVersion: 0, savedAt: now(), maps: merged }, HOSTED_EXPORT_ORIGIN);
  return { blob: await zipRecordsArchive({ recordsJson, files }), missingReceipts };
};

/** The receipt's bytes, or null when it can't be had: two failed tries, or not the size its receipt says. */
async function fetchReceipt(receipt: ExpenseReceiptRecord, transport: RecordsExportTransport, waitingOutLimits: <T>(run: () => Promise<T>) => Promise<T>, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  for (let attempt = 1; attempt <= RECEIPT_ATTEMPTS; attempt++) {
    try {
      const bytes = await waitingOutLimits(async () => (await transport.receipt(receipt.organizationId, receipt.id, signal)).arrayBuffer());
      return bytes.byteLength === receipt.sizeBytes ? bytes : null;
    } catch (error) {
      if (isAbort(error, signal)) throw error;
    }
  }
  return null;
}

async function withRateLimitWaits<T>(run: () => Promise<T>, sleep: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<T> {
  for (let waits = 0; ; waits++) {
    try {
      return await run();
    } catch (error) {
      const limited = rateLimited(error);
      if (limited === null || waits >= MAX_RATE_LIMIT_WAITS) throw error;
      await sleep((limited ?? DEFAULT_RETRY_AFTER_SECONDS) * MS_PER_SECOND, signal);
    }
  }
}

/**
 * A 429 from the portal's `send()`: its ApiError, read by shape (this chunk doesn't import the portal's client).
 * The seconds to wait (undefined when the server named none), or null for any other error.
 */
function rateLimited(error: unknown): number | undefined | null {
  const e = error as { code?: unknown; retryAfterSeconds?: unknown } | null;
  if (e?.code !== 'RATE_LIMITED') return null;
  return typeof e.retryAfterSeconds === 'number' ? e.retryAfterSeconds : undefined;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

async function eachConcurrently<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function emptyMaps(): LocalSnapshotMaps {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((field) => [field, new Map()])) as unknown as LocalSnapshotMaps;
}

/** Each profile's file names the same person and inbox; a later copy of a row replaces an identical earlier one. */
function mergeInto(target: LocalSnapshotMaps, source: LocalSnapshotMaps): void {
  for (const field of SNAPSHOT_FIELDS) {
    const into = target[field] as Map<unknown, unknown>;
    for (const [key, value] of source[field] as Map<unknown, unknown>) into.set(key, value);
  }
}
