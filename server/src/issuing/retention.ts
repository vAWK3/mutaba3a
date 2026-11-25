import type { IsoDate } from '../dates.js';

/**
 * MUT-644 (ADR-277 D1): how long a closed profile's issued documents are kept. Pure; the sweep (accounts/purge-run.ts)
 * and the operator's listing use it, and both stores compare against `sweepCutoff`.
 *
 * Kept 7 full years after the end of the calendar (tax) year of the profile's newest document, then deleted: the
 * rows may go from 1 January of the 8th year after it. The year is read in UTC: UTC midnight on 1 January is already
 * 02:00 in Israel, so the sweep is never early there.
 *
 * Open for the lawyer: whether the start date is right, and how erasure requests meet the duty to keep records.
 */
export const ISSUING_RETENTION_YEARS = 7;

/** The first day the rows may be deleted, or null when the profile issued nothing (nothing to keep). */
export function retentionEndsOn(newestDocumentDate: IsoDate | null): IsoDate | null {
  if (newestDocumentDate === null) return null;
  const year = Number(newestDocumentDate.slice(0, 4));
  return `${year + ISSUING_RETENTION_YEARS + 1}-01-01`;
}

/** A closed profile whose newest document is dated before this day is due now. */
export function sweepCutoff(now: Date): IsoDate {
  return `${now.getUTCFullYear() - ISSUING_RETENTION_YEARS}-01-01`;
}

const ISRAEL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

/** A cancellation's date, as the business saw it (its documents are dated in Israel). */
export function israelDateOf(at: Date): IsoDate {
  return ISRAEL_DAY.format(at);
}

/** What a SWEPT event records (D5): counts and dates, never a name or an address. Both stores write the same. */
export function retentionSweepMetadata(held: { documents: number; cancellations: number; newestDocumentDate: IsoDate | null }, rows: number): { documents: number; cancellations: number; rows: number; newestDocumentDate: IsoDate | null; retainedUntil: IsoDate | null } {
  return { documents: held.documents, cancellations: held.cancellations, rows, newestDocumentDate: held.newestDocumentDate, retainedUntil: retentionEndsOn(held.newestDocumentDate) };
}
