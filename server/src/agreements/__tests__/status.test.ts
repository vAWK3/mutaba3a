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

describe('credits (M4)', () => {
  const base = { voided: false, posted: true, dueDate: '2026-10-31', grossMinor: 1000n, today: '2026-10-08' };
  it('count towards settlement but never read as a partial payment', () => {
    expect(itemStatus({ ...base, paidMinor: 0n, creditedMinor: 400n })).toBe('DUE');
    expect(itemStatus({ ...base, paidMinor: 0n, creditedMinor: 1000n })).toBe('PAID');
    expect(itemStatus({ ...base, paidMinor: 600n, creditedMinor: 400n })).toBe('PAID');
    expect(itemStatus({ ...base, paidMinor: 100n, creditedMinor: 400n })).toBe('PARTIALLY_PAID');
    expect(itemStatus({ ...base, paidMinor: 0n, creditedMinor: 400n, today: '2026-11-01' })).toBe('OVERDUE');
  });
});
