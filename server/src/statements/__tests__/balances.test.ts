import { describe, expect, it } from 'vitest';
import { customerBalances } from '../balances.js';
import type { LedgerEntry } from '../lines.js';

const e = (customerId: string | null, currency: string, debitMinor: bigint, creditMinor: bigint) => ({ customerId, currency, debitMinor, creditMinor }) as unknown as LedgerEntry;

describe('customerBalances (MUT-664)', () => {
  it('sums each client per currency, never across currencies, and skips money with no client', () => {
    const rows = customerBalances([e('a', 'ILS', 340_000n, 0n), e('a', 'ILS', 0n, 140_000n), e('a', 'USD', 30_000n, 0n), e(null, 'ILS', 0n, 99n), e('b', 'ILS', 0n, 20_000n)]);
    expect(rows).toEqual([
      { customerId: 'a', currency: 'ILS', balanceMinor: 200_000n },
      { customerId: 'a', currency: 'USD', balanceMinor: 30_000n },
      { customerId: 'b', currency: 'ILS', balanceMinor: -20_000n },
    ]);
  });
});
