import type { LedgerEntry } from './lines.js';

/**
 * MUT-664 (for MUT-663's Clients list): each client's balance per currency, the closing balance of their whole
 * statement with no period: the ledger lines summed (charges debit, credits and payments credit, a reversal debit).
 * Negative means the client is in credit (D15). Money with no client has no balance here. Pure.
 */
export interface CustomerBalance {
  customerId: string;
  currency: string;
  balanceMinor: bigint;
}

export function customerBalances(entries: readonly LedgerEntry[]): CustomerBalance[] {
  const sums = new Map<string, CustomerBalance>();
  for (const e of entries) {
    if (e.customerId === null) continue;
    const key = `${e.customerId}|${e.currency}`;
    const row = sums.get(key) ?? { customerId: e.customerId, currency: e.currency, balanceMinor: 0n };
    row.balanceMinor += e.debitMinor - e.creditMinor;
    sums.set(key, row);
  }
  return [...sums.values()].sort((a, b) => a.customerId.localeCompare(b.customerId) || a.currency.localeCompare(b.currency));
}
