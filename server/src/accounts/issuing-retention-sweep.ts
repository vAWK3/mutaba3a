import type { IsoDate } from '../dates.js';
import { retainedUntil, sweepCutoff } from '../issuing/retention.js';
import type { Logger } from '../logger.js';
import type { LedgerStore, RetainedIssuingProfile } from '../repositories/ports.js';

/**
 * MUT-644 (ADR-277 D3, amended 2026-11-25): deletes each of a closed profile's issued documents once its own 7 years
 * have passed (issuing/retention.ts), and the profile's own rows with its last document.
 * Run by the hourly account purge (accounts/purge-run.ts) and on demand by the operator
 * (`POST /admin/v1/issuing/retention/sweep`, `npm run issuing:retained -- sweep`). One profile at a time, each in its own
 * transaction (the store re-checks it is closed and which documents are due); one profile's failure never stops the run.
 * A dry run lists the profiles with something due and deletes nothing.
 */
export const MAX_RETENTION_SWEEPS_PER_RUN = 25;

export type RetentionSweepOutcome = 'swept' | 'would-sweep' | 'skipped' | 'failed';

export interface RetentionSweepRow {
  organizationId: string;
  outcome: RetentionSweepOutcome;
  /** Documents the profile held before this run. */
  documents: number;
  /** Documents this run deleted, and those still kept; null in a dry run or when the profile was skipped or failed. */
  deleted: number | null;
  remaining: number | null;
  oldestDocumentDate: IsoDate | null;
  newestDocumentDate: IsoDate | null;
  /** The first day its oldest document could go (null: the profile issued nothing, so nothing was kept). */
  nextSweepOn: IsoDate | null;
  /** The first day its last document, and with it the profile's own rows, could go. */
  retainedUntil: IsoDate | null;
}

/** When a closed profile's oldest document may go, and when its last may (with the profile's own rows). */
export function retentionDatesOf(profile: Pick<RetainedIssuingProfile, 'oldestDocumentDate' | 'newestDocumentDate'>): { nextSweepOn: IsoDate | null; retainedUntil: IsoDate | null } {
  return {
    nextSweepOn: profile.oldestDocumentDate === null ? null : retainedUntil(profile.oldestDocumentDate),
    retainedUntil: profile.newestDocumentDate === null ? null : retainedUntil(profile.newestDocumentDate),
  };
}

export interface RetentionSweepRun {
  dryRun: boolean;
  /** Profiles with something due, taken this run (at most the cap). */
  due: number;
  /** Profiles some of whose documents were deleted (in a dry run, would be). */
  swept: number;
  /** Documents deleted (0 in a dry run). */
  documentsDeleted: number;
  failed: number;
  /** More were due than the cap: the next run continues. */
  incomplete: boolean;
  rows: RetentionSweepRow[];
}

export interface RetentionSweepOptions {
  store: LedgerStore;
  logger: Logger;
  now: Date;
  dryRun: boolean;
  max?: number;
}

export async function runIssuingRetentionSweep({ store, logger, now, dryRun, max = MAX_RETENTION_SWEEPS_PER_RUN }: RetentionSweepOptions): Promise<RetentionSweepRun> {
  const cutoff = sweepCutoff(now);
  const found = await store.issuingRetention.listClosed({ dueBefore: cutoff }, max + 1);
  const due = found.slice(0, max);
  const run: RetentionSweepRun = { dryRun, due: due.length, swept: 0, documentsDeleted: 0, failed: 0, incomplete: found.length > max, rows: [] };
  for (const profile of due) {
    const row: RetentionSweepRow = {
      organizationId: profile.organizationId, outcome: 'would-sweep', documents: profile.documents, deleted: null, remaining: null,
      oldestDocumentDate: profile.oldestDocumentDate, newestDocumentDate: profile.newestDocumentDate, ...retentionDatesOf(profile),
    };
    if (!dryRun) await sweepOne(store, logger, row, cutoff, now);
    if (row.outcome === 'swept' || row.outcome === 'would-sweep') run.swept++;
    else if (row.outcome === 'failed') run.failed++;
    run.documentsDeleted += row.deleted ?? 0;
    run.rows.push(row);
  }
  logger.info({ dryRun, due: run.due, swept: run.swept, documentsDeleted: run.documentsDeleted, failed: run.failed, incomplete: run.incomplete }, 'issuing retention sweep');
  return run;
}

async function sweepOne(store: LedgerStore, logger: Logger, row: RetentionSweepRow, cutoff: IsoDate, now: Date): Promise<void> {
  const { organizationId } = row;
  try {
    const result = await store.issuingRetention.sweep(organizationId, cutoff, now);
    if (result.kind !== 'swept') {
      row.outcome = 'skipped';
      return;
    }
    Object.assign(row, { outcome: 'swept', deleted: result.documents, remaining: result.remaining });
    logger.info({ organizationId, documents: result.documents, remaining: result.remaining, profileRows: result.profileRows, rows: result.rows }, 'closed profile’s issued documents deleted after retention');
  } catch (err) {
    row.outcome = 'failed';
    logger.error({ err, organizationId }, 'issuing retention sweep failed');
  }
}
