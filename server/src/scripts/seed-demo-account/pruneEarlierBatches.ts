import { sessionClaimKey } from '../../idempotency.js';
import type { SeedApiClient } from './apiClient.js';
import { buildFixtures } from './fixtures.js';
import { datedWrites } from './keys.js';

/**
 * Removes the batches this seed wrote on earlier days (QA data pile-up, 2026-11-14).
 *
 * A day's batch is keyed by its dates, so a run on a later day writes a new one beside the old. Before writing
 * today's, this finds the earlier ones by the only record of what the seed itself wrote: the server's stored
 * idempotency claims. For each earlier day it rebuilds that day's exact keys (keys.ts), hashes them the way the
 * server claims a session's keys (`sessionClaimKey`), and reads the stored responses, which name the rows created.
 * A row anyone else made (a QA flow, the person) was never claimed under a seed key, so it can't be found here.
 *
 * Reading the claims needs the server's database (`SeedClaims`); every removal goes through the API, as the person
 * would undo it: a settle's payment reversed first, then the Owed voided or the Received capture undone, then the
 * expense deleted. Each call is safe to repeat, so a batch pruned before is just confirmed gone again.
 */

/** Read-only views of the server's database, for finding what the seed wrote. */
export interface SeedClaims {
  /** The stored, completed responses of the given claim keys on one profile: claim key → response body. */
  find(organizationId: string, claimKeys: string[]): Promise<Map<string, unknown>>;
  /**
   * Which of `ids` are still live on the profile: a payment still POSTED, an Owed (receivable) not voided, an
   * expense not deleted. A batch pruned on an earlier run is then skipped instead of undone again every run.
   */
  live(organizationId: string, ids: string[]): Promise<Set<string>>;
}

export interface PruneResult {
  /** Earlier-day seed writes found (income, settles and expenses together). */
  writes: number;
  payments: number;
  income: number;
  expenses: number;
}

/** How far back to look for earlier batches. A gap between runs longer than this would leave its batch behind. */
export const PRUNE_LOOKBACK_DAYS = 120;

export const PRUNE_REVERSAL_REASON = 'Demo seed: replaced by a newer batch';

export async function pruneEarlierBatches(args: {
  client: SeedApiClient;
  claims: SeedClaims;
  organizationId: string;
  userId: string;
  now: Date;
  lookbackDays?: number;
}): Promise<PruneResult> {
  const { client, claims, organizationId, userId, now } = args;
  const lookback = args.lookbackDays ?? PRUNE_LOOKBACK_DAYS;
  const today = new Set(datedWrites(buildFixtures(now)).map((w) => w.key));

  const kindOf = new Map<string, 'income' | 'settle' | 'expense'>();
  for (let daysAgo = 1; daysAgo <= lookback; daysAgo++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - daysAgo);
    for (const write of datedWrites(buildFixtures(day))) {
      if (!today.has(write.key)) kindOf.set(sessionClaimKey(userId, write.key), write.kind);
    }
  }

  const found = await claims.find(organizationId, [...kindOf.keys()]);
  const payments = new Set<string>();
  const income = new Set<string>();
  const expenses = new Set<string>();
  for (const [claimKey, body] of found) {
    const kind = kindOf.get(claimKey);
    if (kind === 'settle') {
      const id = (body as { payment?: { id?: unknown } } | null)?.payment?.id;
      if (typeof id === 'string') payments.add(id);
      continue;
    }
    const row = body as { id?: unknown } | null;
    if (typeof row?.id !== 'string') continue;
    (kind === 'income' ? income : expenses).add(row.id);
  }

  const live = await claims.live(organizationId, [...payments, ...income, ...expenses]);
  const still = (ids: Set<string>) => [...ids].filter((id) => live.has(id));
  const [livePayments, liveIncome, liveExpenses] = [still(payments), still(income), still(expenses)];

  // A settle's payment first: an Owed with money on it can't be voided (409 ALREADY_SETTLED).
  for (const id of livePayments) await client.reversePayment(id, PRUNE_REVERSAL_REASON, `seed-prune-reverse-${id}`);
  for (const id of liveIncome) await client.undoIncome(id);
  for (const id of liveExpenses) await client.deleteExpense(id);

  return { writes: found.size, payments: livePayments.length, income: liveIncome.length, expenses: liveExpenses.length };
}
