import { describe, expect, it } from 'vitest';
import { incomeStatusOf } from '../allocation-state.js';

/** MUT-270 (D5): the status a received payment reads as, on /v1/income, inbox filing and the entries feed alike. */
describe('incomeStatusOf', () => {
  const payment = (allocatedMinor: bigint, status: 'POSTED' | 'REVERSED' = 'POSTED') => ({ amountMinor: 10_000n, allocatedMinor, status });

  it('reads a posted payment by how much Malafat has applied', () => {
    expect(incomeStatusOf(payment(0n))).toBe('unallocated');
    expect(incomeStatusOf(payment(2_500n))).toBe('partial');
    expect(incomeStatusOf(payment(10_000n))).toBe('allocated');
  });

  it('reads a reversed payment as reversed, whatever its allocations were', () => {
    // A reversal zeroes allocatedMinor (ports.ts), so allocationStateOf alone would call it unallocated.
    expect(incomeStatusOf(payment(0n, 'REVERSED'))).toBe('reversed');
  });
});
