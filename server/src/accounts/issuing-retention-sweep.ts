import type { IsoDate } from '../dates.js';
import { retentionEndsOn, sweepCutoff } from '../issuing/retention.js';
import type { Logger } from '../logger.js';
import type { LedgerStore } from '../repositories/ports.js';

/**
 * MUT-644 (ADR-277 D3): deletes closed profiles' issued documents once their 7 years have passed (issuing/retention.ts).
 * Run by the hourly account purge (accounts/purge-run.ts) and on demand by the operator
 * (`POST /admin/v1/issuing/retention/sweep`, `npm run issuing:retained -- sweep`). One profile at a time, each in its own
 * transaction (the store re-checks it is closed and due); one profile's failure never stops the run. A dry run lists
 * what is due and deletes nothing.
 */
export const MAX_RETENTION_SWEEPS_PER_RUN = 25;

export type RetentionSweepOutcome = 'swept' | 'would-sweep' | 'skipped' | 'failed';

export interface RetentionSweepRow {
  organizationId: string;
  outcome: RetentionSweepOutcome;
  documents: number;
  newestDocumentDate: IsoDate | null;
  /** The first day the rows could be deleted (null: the profile issued nothing, so nothing was kept). */
  retainedUntil: IsoDate | null;
}

export interface RetentionSweepRun {
  dryRun: boolean;
  /** Due profiles taken this run (at most the cap). */
  due: number;
  /** Deleted (in a dry run, would be). */
  swept: number;
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
  const found = await store.issuingRetention.listClosed({ newestBefore: cutoff }, max + 1);
  const due = found.slice(0, max);
  const run: RetentionSweepRun = { dryRun, due: due.length, swept: 0, failed: 0, incomplete: found.length > max, rows: [] };
  for (const profile of due) {
    const row: RetentionSweepRow = { organizationId: profile.organizationId, outcome: 'would-sweep', documents: profile.documents, newestDocumentDate: profile.newestDocumentDate, retainedUntil: retentionEndsOn(profile.newestDocumentDate) };
    if (!dryRun) row.outcome = await sweepOne(store, logger, profile.organizationId, cutoff, now);
    if (row.outcome === 'swept' || row.outcome === 'would-sweep') run.swept++;
    else if (row.outcome === 'failed') run.failed++;
    run.rows.push(row);
  }
  logger.info({ dryRun, due: run.due, swept: run.swept, failed: run.failed, incomplete: run.incomplete }, 'issuing retention sweep');
  return run;
}

async function sweepOne(store: LedgerStore, logger: Logger, organizationId: string, cutoff: IsoDate, now: Date): Promise<RetentionSweepOutcome> {
  try {
    const result = await store.issuingRetention.sweep(organizationId, cutoff, now);
    if (result.kind !== 'swept') return 'skipped';
    logger.info({ organizationId, documents: result.documents, rows: result.rows }, 'closed profile’s issued documents deleted after retention');
    return 'swept';
  } catch (err) {
    logger.error({ err, organizationId }, 'issuing retention sweep failed');
    return 'failed';
  }
}
