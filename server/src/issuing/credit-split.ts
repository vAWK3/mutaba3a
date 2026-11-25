/**
 * MUT-643 (D1–D3): a credit note against a document whose Owed it owns may reach past what is still owed into what the
 * client already paid. Pure; both stores ask these.
 *
 *  - the cap: the original's gross less the credit notes already on it (AC2)
 *  - the split: what is still owed is credited first; the rest is the paid part
 *  - the release: the paid part comes off the Owed's live allocations, newest first (createdAt, then id), so a later
 *    credit note on the same invoice releases in a stable order
 */

export interface LiveAllocation {
  id: string;
  paymentId: string;
  amountMinor: bigint;
  createdAt: Date;
}

export interface CreditSplit {
  owedPartMinor: bigint;
  paidPartMinor: bigint;
}

export interface PlannedRelease {
  allocation: LiveAllocation;
  releaseMinor: bigint;
}

export function creditCap(originalGrossMinor: bigint, creditedByNotesMinor: bigint): bigint {
  const cap = originalGrossMinor - creditedByNotesMinor;
  return cap > 0n ? cap : 0n;
}

export function splitCredit(owed: { grossMinor: bigint; paidMinor: bigint; creditedMinor: bigint }, creditMinor: bigint): CreditSplit {
  const outstanding = owed.grossMinor - owed.paidMinor - owed.creditedMinor;
  const owedPartMinor = creditMinor < outstanding ? creditMinor : outstanding;
  const paidPartMinor = creditMinor - owedPartMinor;
  if (paidPartMinor > owed.paidMinor) throw new Error('a credit note may not credit more than the Owed was paid (the cap is checked first)');
  return { owedPartMinor, paidPartMinor };
}

export function planRelease(allocations: readonly LiveAllocation[], paidPartMinor: bigint): PlannedRelease[] {
  const newestFirst = [...allocations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const plan: PlannedRelease[] = [];
  let left = paidPartMinor;
  for (const allocation of newestFirst) {
    if (left <= 0n) break;
    const releaseMinor = allocation.amountMinor < left ? allocation.amountMinor : left;
    plan.push({ allocation, releaseMinor });
    left -= releaseMinor;
  }
  if (left > 0n) throw new Error('the Owed\'s live allocations hold less than the paid part');
  return plan;
}
