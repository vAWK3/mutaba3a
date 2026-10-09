import { describe, expect, it } from 'vitest';
import { paymentNumber, paymentYear } from '../numbering.js';
import { allocationSnapshot, paymentPreviewToken } from '../preview-token.js';

describe('payment numbers', () => {
  it('formats PAY-YYYY-NNNN and keeps counting past four digits', () => {
    expect(paymentNumber(2026, 1)).toBe('PAY-2026-0001');
    expect(paymentNumber(2026, 99)).toBe('PAY-2026-0099');
    expect(paymentNumber(2026, 10000)).toBe('PAY-2026-10000');
    expect(() => paymentNumber(2026, 0)).toThrow();
  });

  it('takes the year from the received-on calendar date (already in the organization timezone)', () => {
    expect(paymentYear('2026-12-31')).toBe(2026);
    expect(paymentYear('2027-01-01')).toBe(2027);
    expect(() => paymentYear('soon')).toThrow();
  });
});

describe('allocation preview token', () => {
  const body = { customerId: 'c', currency: 'ILS', amount: '100.00', allocations: [] };
  const snapshot = [{ id: 'r2', version: 1 }, { id: 'r1', version: 3 }];

  it('is stable across snapshot order and changes with the body, the organization or any eligible version', () => {
    const base = paymentPreviewToken('org', body, snapshot);
    expect(paymentPreviewToken('org', body, [...snapshot].reverse())).toBe(base);
    expect(paymentPreviewToken('org2', body, snapshot)).not.toBe(base);
    expect(paymentPreviewToken('org', { ...body, amount: '100.01' }, snapshot)).not.toBe(base);
    expect(paymentPreviewToken('org', body, [{ id: 'r2', version: 2 }, { id: 'r1', version: 3 }])).not.toBe(base);
    expect(paymentPreviewToken('org', body, [{ id: 'r1', version: 3 }])).not.toBe(base);
  });

  it('snapshots sort by id so the token does not depend on list order', () => {
    expect(allocationSnapshot(snapshot)).toEqual([['r1', 3], ['r2', 1]]);
  });
});
