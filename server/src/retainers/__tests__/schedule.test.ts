import { describe, expect, it } from 'vitest';
import { chargeDate, chargeMonths, validateRetainerSpec } from '../schedule.js';

describe('retainer schedule', () => {
  it('validates billing day, month format and ordering', () => {
    expect(validateRetainerSpec({ startMonth: '2026-10', billingDay: 1 })).toBeNull();
    expect(validateRetainerSpec({ startMonth: '2026-10', billingDay: 29 })).toEqual({ reason: 'BILLING_DAY_INVALID' });
    expect(validateRetainerSpec({ startMonth: '2026-13', billingDay: 1 })).toEqual({ reason: 'START_MONTH_INVALID' });
    expect(validateRetainerSpec({ startMonth: '2026-10', billingDay: 1, endMonth: '2026-09' })).toEqual({ reason: 'END_BEFORE_START' });
    expect(validateRetainerSpec({ startMonth: '2026-10', billingDay: 1, endMonth: '2026-10' })).toBeNull();
  });

  it('charge date is the billing day clamped into the month', () => {
    expect(chargeDate('2026-02', 28)).toBe('2026-02-28');
    expect(chargeDate('2026-10', 15)).toBe('2026-10-15');
  });

  it('generates one charge per service month whose charge date has arrived, bounded by end and cancel', () => {
    expect(chargeMonths({ startMonth: '2026-08', billingDay: 10 }, '2026-10-08')).toEqual(['2026-08', '2026-09']);
    expect(chargeMonths({ startMonth: '2026-08', billingDay: 1 }, '2026-10-08')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(chargeMonths({ startMonth: '2026-11', billingDay: 1 }, '2026-10-08')).toEqual([]);
    expect(chargeMonths({ startMonth: '2026-08', billingDay: 1, endMonth: '2026-09' }, '2026-10-08')).toEqual(['2026-08', '2026-09']);
    expect(chargeMonths({ startMonth: '2026-08', billingDay: 1, cancelEffectiveMonth: '2026-09', finalMonth: 'FULL' }, '2026-10-08')).toEqual(['2026-08', '2026-09']);
    expect(chargeMonths({ startMonth: '2026-08', billingDay: 1, cancelEffectiveMonth: '2026-09', finalMonth: 'WAIVE' }, '2026-10-08')).toEqual(['2026-08']);
  });

  it('is bounded to 120 months so a forgotten retainer cannot generate forever', () => {
    expect(chargeMonths({ startMonth: '2000-01', billingDay: 1 }, '2026-10-08')).toHaveLength(120);
  });

  it('PRORATE charges the cancellation month like FULL; the amount is the caller’s business', () => {
    const spec = { startMonth: '2026-10', billingDay: 1, cancelEffectiveMonth: '2026-11', finalMonth: 'PRORATE' as const };
    expect(chargeMonths(spec, '2027-03-01')).toEqual(['2026-10', '2026-11']);
    expect(chargeMonths({ ...spec, finalMonth: 'WAIVE' }, '2027-03-01')).toEqual(['2026-10']);
  });
});
