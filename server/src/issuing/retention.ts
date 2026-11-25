import type { IsoDate } from '../dates.js';
import type { IssuingRetentionEventRecord, JsonObject } from '../repositories/ports.js';

/**
 * MUT-644 (ADR-277 D1, amended 2026-11-25 by Basel, MUT-644 comment 13504): how long a closed profile's issued
 * documents are kept. Pure; the sweep (accounts/issuing-retention-sweep.ts), the operator's listing and archive, and
 * both stores use it.
 *
 * Each document is kept 7 years from its own date (`documentDate`; a cancelled payment request from its
 * cancellation's Israel date when that is later), then deleted on its own: through its 7th anniversary, gone from the
 * next day (`retainedUntil`). A 29 February document's anniversary in a common year is 28 February, as Postgres adds
 * years. The profile's own rows (business details, logos, counters) go with its last document.
 *
 * "Today" is the UTC day: UTC midnight is already 02:00 or 03:00 in Israel, so nothing is ever deleted before its day
 * there.
 */
export const ISSUING_RETENTION_YEARS = 7;

/**
 * The 7-year keep notice in the archive's README (D6 as amended). An erasure may shorten the 7 years only after an
 * archive carrying it was exported; the export's log entry records this version. Bump it when the notice's wording
 * changes in substance.
 */
export const ARCHIVE_KEEP_NOTICE_VERSION = 1;

const DAY_MS = 86_400_000;

const isoOf = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

function partsOf(date: IsoDate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** The first day a document dated `date` (its retention date) may be deleted: the day after its 7th anniversary. */
export function retainedUntil(date: IsoDate): IsoDate {
  const [y, m, d] = partsOf(date);
  const year = y + ISSUING_RETENTION_YEARS;
  const lastOfMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return isoOf(Date.UTC(year, m - 1, Math.min(d, lastOfMonth)) + DAY_MS);
}

/**
 * A document whose retention date is before this day is due now. Seven years before today's UTC day, rolled forward
 * when that day does not exist (29 February → 1 March), which is exactly when `retainedUntil` has been reached.
 */
export function sweepCutoff(now: Date): IsoDate {
  return isoOf(Date.UTC(now.getUTCFullYear() - ISSUING_RETENTION_YEARS, now.getUTCMonth(), now.getUTCDate()));
}

const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

/** A cancellation's date, as the business saw it (its documents are dated in Israel). */
export function israelDateOf(at: Date): IsoDate {
  return ISRAEL_DAY.format(at);
}

/** The date a document's 7 years count from: its own date, or its cancellation's Israel date when that is later. */
export function retentionDateOf(documentDate: IsoDate, cancelledAt: Date | null): IsoDate {
  if (!cancelledAt) return documentDate;
  const cancelled = israelDateOf(cancelledAt);
  return cancelled > documentDate ? cancelled : documentDate;
}

/** What a SWEPT event records (D5): counts and dates, never a name or an address. Both stores write the same. */
export function retentionSweepMetadata(swept: { documents: number; cancellations: number; oldest: IsoDate | null; newest: IsoDate | null }, rows: number, remaining: number, profileRows: boolean): JsonObject {
  return { documents: swept.documents, cancellations: swept.cancellations, rows, remaining, oldestDocumentDate: swept.oldest, newestDocumentDate: swept.newest, profileRows };
}

/**
 * Whether this retention-log entry hands the former owner their archive, so that an erasure may shorten the 7 years
 * (D7): an exported archive that carried the keep notice, logged no later than the erasure.
 */
export function handsOverArchive(event: Pick<IssuingRetentionEventRecord, 'action' | 'metadata' | 'createdAt'>, at: Date): boolean {
  const version = event.metadata.noticeVersion;
  return event.action === 'ARCHIVE_EXPORTED' && typeof version === 'number' && version >= 1 && event.createdAt.getTime() <= at.getTime();
}
