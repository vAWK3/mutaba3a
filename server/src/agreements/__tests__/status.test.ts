import { describe, expect, it } from 'vitest';
import { itemStatus } from '../status.js';

describe('itemStatus', () => {
  const today = '2026-10-08';
  const base = { voided: false, posted: true, dueDate: '2026-10-20', grossMinor: 1000n, paidMinor: 0n, today };

  it.each([
    [{ ...base, voided: true }, 'VOID'],
    [{ ...base, posted: false }, 'PENDING'],
    [{ ...base }, 'DUE'],
    [{ ...base, dueDate: today }, 'DUE'],
    [{ ...base, dueDate: '2026-10-07' }, 'OVERDUE'],
    [{ ...base, paidMinor: 400n }, 'PARTIALLY_PAID'],
    [{ ...base, paidMinor: 400n, dueDate: '2026-10-07' }, 'OVERDUE'],
    [{ ...base, paidMinor: 1000n, dueDate: '2026-10-07' }, 'PAID'],
    [{ ...base, paidMinor: 1200n }, 'PAID'],
    [{ ...base, posted: false, voided: true }, 'VOID'],
  ] as const)('%o → %s', (input, expected) => {
    expect(itemStatus(input)).toBe(expected);
  });
});
