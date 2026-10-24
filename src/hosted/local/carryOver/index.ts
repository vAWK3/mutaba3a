import type { LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import type { StoredFile } from '../blobStore.js';
import type { StoredSnapshot } from '../migrations/index.js';
import { parseFreeAppBackup, type FreeAppBackup } from './freeAppBackup';
import { mapFreeAppBackup, type CarryOverReport, type MapOptions } from './mapFreeAppBackup';
import { replayCarryOver, type ReplayOptions, type ReplayResult } from './replay';
import { bigintToDecimal } from './money';
import { byProfileId, compareTotals, freeAppTotals, snapshotTotals, totalsByCurrency, type TotalsMismatch } from './totals';

/**
 * The free app's backup, ready to land on this device (MUT-291 §3.3–§3.4):
 * parsed, mapped, replayed through a throwaway local app, and checked. Nothing
 * here writes to this device; `applyRestore` does that, after the person
 * confirms, with exactly `snapshot` and `files`.
 */

export interface PreparedCarryOver {
  snapshot: Omit<StoredSnapshot, 'stateVersion'>;
  files: Array<{ key: string } & StoredFile>;
  report: CarryOverReport;
  /** What arrived, per kind, for the summary and the `done` message. */
  counts: CarryOverCounts;
  /** Per currency, all profiles together, as decimal strings. */
  totals: Record<string, Record<string, string>>;
}

export interface CarryOverCounts {
  businesses: number;
  clients: number;
  projects: number;
  income: number;
  payments: number;
  expenses: number;
  receipts: number;
  conversions: number;
}

/** The replay doesn't add up (E4): a bug, never the person's data, so nothing is offered. */
export class CarryOverCheckFailed extends Error {
  constructor(readonly mismatches: TotalsMismatch[]) {
    super(`carry-over totals don't match (${mismatches.length})`);
    this.name = 'CarryOverCheckFailed';
  }
}

export type PrepareOptions = Pick<ReplayOptions, 'now' | 'locale' | 'onProgress' | 'yieldToBrowser'> & MapOptions;

export async function prepareFreeAppCarryOver(text: string, options: PrepareOptions): Promise<PreparedCarryOver> {
  return prepareFromBackup(parseFreeAppBackup(text), options);
}

export async function prepareFromBackup(backup: FreeAppBackup, options: PrepareOptions): Promise<PreparedCarryOver> {
  const plan = mapFreeAppBackup(backup, { timezone: options.timezone, labels: options.labels });
  const result = await replayCarryOver(plan, options);
  const mismatches = [...checkCarriedTotals(backup, plan, result), ...(await crossCheckOutstanding(result))];
  if (mismatches.length > 0) throw new CarryOverCheckFailed(mismatches);
  return { snapshot: result.snapshot, files: result.files, report: result.report, counts: countsOf(result.snapshot.maps), totals: totalsByCurrency(snapshotTotals(result.snapshot.maps)) };
}

/** R3: the free app's own rows that arrived, against the records the replay made, per profile and currency. */
export function checkCarriedTotals(backup: FreeAppBackup, plan: ReturnType<typeof mapFreeAppBackup>, result: Pick<ReplayResult, 'carried' | 'profileIds' | 'snapshot'>): TotalsMismatch[] {
  return compareTotals(byProfileId(freeAppTotals(backup, plan, result.carried), result.profileIds), snapshotTotals(result.snapshot.maps));
}

/** R3: each profile's outstanding as the organization summary reports it (what the screens show), against the records. */
async function crossCheckOutstanding(result: ReplayResult): Promise<TotalsMismatch[]> {
  const mismatches: TotalsMismatch[] = [];
  for (const profileId of result.profileIds.values()) {
    const response = await result.request('GET', '/v1/summaries/organization', profileId);
    if (!response.ok) {
      mismatches.push({ profile: profileId, currency: '*', field: 'outstanding', expected: 0n, actual: -1n });
      continue;
    }
    const summary = (await response.json()) as { asOf: string; currencies: Array<{ currency: string; outstanding: string }> };
    const records = snapshotTotals(result.snapshot.maps, summary.asOf).get(profileId) ?? new Map();
    const currencies = new Set([...records.keys(), ...summary.currencies.map((c) => c.currency)]);
    for (const currency of currencies) {
      const fromRecords = bigintToDecimal(records.get(currency)?.outstanding ?? 0n, currency);
      const fromSummary = summary.currencies.find((c) => c.currency === currency)?.outstanding ?? bigintToDecimal(0n, currency);
      if (fromRecords !== fromSummary) mismatches.push({ profile: profileId, currency, field: 'outstanding', expected: records.get(currency)?.outstanding ?? 0n, actual: -1n });
    }
  }
  return mismatches;
}

export function countsOf(maps: LocalSnapshotMaps): CarryOverCounts {
  const live = <T extends { deletedAt?: Date | null }>(m: Map<string, T>) => [...m.values()].filter((r) => !r.deletedAt).length;
  return {
    businesses: [...maps.orgs.values()].filter((o) => !o.personalOwnerUserId).length,
    clients: maps.custs.size,
    projects: maps.projs.size,
    income: live(maps.recs),
    payments: [...maps.pays.values()].filter((p) => p.status === 'POSTED').length,
    expenses: live(maps.exps),
    receipts: [...maps.expReceipts.values()].filter((r) => !r.deletedAt && r.status === 'READY').length,
    conversions: live(maps.convs),
  };
}
