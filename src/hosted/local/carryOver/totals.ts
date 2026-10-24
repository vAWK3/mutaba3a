import type { LocalSnapshotMaps } from '../../../../server/src/repositories/memory.js';
import { bigintToDecimal } from './money';
import type { FreeAppBackup } from './freeAppBackup';
import { groupBy, paymentsOf, sourceKey, type CarryOverPlan } from './mapFreeAppBackup';

/**
 * The carry-over's totals gate (MUT-291 §3.4, R3, E4). Two sides, never
 * derived from each other:
 *
 *  - `freeAppTotals` sums the free app's own rows, the ones the replay says
 *    arrived, by their own amounts (each row counted once);
 *  - `snapshotTotals` sums the records the replay created.
 *
 * They must be equal, per profile and per currency, before anything is
 * written. Outstanding is also cross-checked against the throwaway app's
 * `GET /v1/summaries/organization`, the figure the person's screens show.
 */

export interface CurrencyTotals {
  /** Money received: settled Owed and Received entries. */
  paid: bigint;
  /** Owed less what was settled. */
  outstanding: bigint;
  expenses: bigint;
  convertedOut: bigint;
  convertedIn: bigint;
}

/** Totals per profile key (a plan ref, or a profile id), then per currency. */
export type Totals = Map<string, Map<string, CurrencyTotals>>;

const ZERO = (): CurrencyTotals => ({ paid: 0n, outstanding: 0n, expenses: 0n, convertedOut: 0n, convertedIn: 0n });

function slot(totals: Totals, profile: string, currency: string): CurrencyTotals {
  let byCurrency = totals.get(profile);
  if (!byCurrency) totals.set(profile, (byCurrency = new Map()));
  let entry = byCurrency.get(currency);
  if (!entry) byCurrency.set(currency, (entry = ZERO()));
  return entry;
}

/** What the free app holds, for the rows that arrived; keyed by the plan's profile refs. */
export function freeAppTotals(backup: FreeAppBackup, plan: CarryOverPlan, carried: ReadonlySet<string>): Totals {
  const { transactions, paymentRecords, expenses } = backup.tables;
  const tx = new Map(transactions.map((t) => [t.id, t]));
  const expense = new Map(expenses.map((e) => [e.id, e]));
  const paymentAmount = new Map<string, number>();
  const records = groupBy(paymentRecords, (r) => r.transactionId);
  for (const t of transactions) if (t.kind === 'income') for (const p of paymentsOf(t, records.get(t.id) ?? [])) paymentAmount.set(sourceKey(p.source), p.amountMinor);

  const totals: Totals = new Map();
  const counted = new Set<string>();
  for (const op of plan.ops) {
    const key = sourceKey(op.source);
    if (!carried.has(key) || counted.has(key) || !op.profile) continue;
    counted.add(key);
    switch (op.op) {
      case 'owed':
        slot(totals, op.profile, op.currency).outstanding += BigInt(tx.get(op.source.id)!.amountMinor);
        break;
      case 'settle': {
        const entry = slot(totals, op.profile, op.currency);
        const paid = BigInt(paymentAmount.get(key)!);
        entry.paid += paid;
        entry.outstanding -= paid;
        break;
      }
      case 'received':
        slot(totals, op.profile, op.currency).paid += BigInt(paymentAmount.get(key)!);
        break;
      case 'expense': {
        const row = op.source.table === 'expenses' ? expense.get(op.source.id)! : tx.get(op.source.id)!;
        slot(totals, op.profile, op.currency).expenses += BigInt(row.amountMinor);
        break;
      }
      case 'conversion': {
        const row = tx.get(op.source.id)!;
        slot(totals, op.profile, op.currency).convertedOut += BigInt(row.amountMinor);
        slot(totals, op.profile, op.toCurrency).convertedIn += BigInt(row.toAmountMinor!);
        break;
      }
    }
  }
  return totals;
}

/** What the replayed store holds; keyed by profile id. `countingOn`, when given, leaves out an Owed dated after it, as the summary does (MUT-392). */
export function snapshotTotals(maps: LocalSnapshotMaps, countingOn?: string): Totals {
  const totals: Totals = new Map();
  for (const r of maps.recs.values()) {
    if (r.deletedAt || (countingOn && r.postingDate > countingOn)) continue;
    slot(totals, r.organizationId, r.currency).outstanding += r.grossMinor - r.paidMinor - r.creditedMinor;
  }
  for (const p of maps.pays.values()) if (p.status === 'POSTED') slot(totals, p.organizationId, p.currency).paid += p.amountMinor;
  for (const e of maps.exps.values()) if (!e.deletedAt) slot(totals, e.organizationId, e.currency).expenses += e.amountMinor;
  for (const c of maps.convs.values()) {
    if (c.deletedAt) continue;
    slot(totals, c.organizationId, c.currency).convertedOut += c.amountMinor;
    slot(totals, c.organizationId, c.toCurrency).convertedIn += c.toAmountMinor;
  }
  return totals;
}

/** `expected`'s profile refs re-keyed by the ids the replay gave them. */
export function byProfileId(expected: Totals, profileIds: ReadonlyMap<string, string>): Totals {
  return new Map([...expected].map(([ref, byCurrency]) => [profileIds.get(ref) ?? ref, byCurrency]));
}

export interface TotalsMismatch {
  profile: string;
  currency: string;
  field: keyof CurrencyTotals;
  expected: bigint;
  /** What the records hold; null when the figure came from the summary route (see `reported`). */
  actual: bigint | null;
  /** The summary route's own figure, as it answered (or its HTTP status when it didn't). */
  reported?: string;
}

/** Every figure that differs; a currency or profile with nothing but zeros on one side counts as zero. */
export function compareTotals(expected: Totals, actual: Totals): TotalsMismatch[] {
  const mismatches: TotalsMismatch[] = [];
  const profiles = new Set([...expected.keys(), ...actual.keys()]);
  for (const profile of profiles) {
    const currencies = new Set([...(expected.get(profile)?.keys() ?? []), ...(actual.get(profile)?.keys() ?? [])]);
    for (const currency of currencies) {
      const e = expected.get(profile)?.get(currency) ?? ZERO();
      const a = actual.get(profile)?.get(currency) ?? ZERO();
      for (const field of Object.keys(e) as Array<keyof CurrencyTotals>) if (e[field] !== a[field]) mismatches.push({ profile, currency, field, expected: e[field], actual: a[field] });
    }
  }
  return mismatches;
}

/** All profiles together, per currency, as decimal strings: what the summary screen shows and `done` reports. */
export function totalsByCurrency(totals: Totals): Record<string, Record<keyof CurrencyTotals, string>> {
  const sum = new Map<string, CurrencyTotals>();
  for (const byCurrency of totals.values()) {
    for (const [currency, t] of byCurrency) {
      const entry = sum.get(currency) ?? ZERO();
      for (const field of Object.keys(t) as Array<keyof CurrencyTotals>) entry[field] += t[field];
      sum.set(currency, entry);
    }
  }
  return Object.fromEntries(
    [...sum].sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => [currency, Object.fromEntries((Object.keys(t) as Array<keyof CurrencyTotals>).map((field) => [field, bigintToDecimal(t[field], currency)])) as Record<keyof CurrencyTotals, string>]),
  );
}

