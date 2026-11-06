import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { monthRange, periodLabel, resolveAsOf } from '../range.js';

/** MUT-314 test group 1: whole calendar months, at most 24, never past the current month; `asOf` within the last day. */
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).details as { reason: string };
  }
  throw new Error('expected a refusal');
};

describe('monthRange (MUT-314)', () => {
  it.each([
    ['2026-10', '2026-10', '2026-10-01', '2026-10-31'],
    ['2026-09', '2026-09', '2026-09-01', '2026-09-30'],
    ['2026-02', '2026-02', '2026-02-01', '2026-02-28'],
    ['2024-02', '2024-02', '2024-02-01', '2024-02-29'],
    ['2026-01', '2026-11', '2026-01-01', '2026-11-30'],
  ])('%s … %s is %s … %s, inclusive', (from, to, first, last) => {
    expect(monthRange({ from, to }, '2026-11-06')).toEqual({ from: first, to: last });
  });

  it('24 months pass, 25 are refused (PERIOD_RANGE)', () => {
    expect(monthRange({ from: '2024-12', to: '2026-11' }, '2026-11-06')).toEqual({ from: '2024-12-01', to: '2026-11-30' });
    expect(refused(() => monthRange({ from: '2024-11', to: '2026-11' }, '2026-11-06')).reason).toBe('PERIOD_RANGE');
  });

  it('refuses a future month, a reversed range and a malformed month', () => {
    expect(refused(() => monthRange({ from: '2026-11', to: '2026-12' }, '2026-11-30')).reason).toBe('PERIOD_RANGE');
    expect(refused(() => monthRange({ from: '2026-10', to: '2026-09' }, '2026-11-06')).reason).toBe('PERIOD_RANGE');
    for (const bad of ['2026-13', '2026-1', '26-10', '2026-10-01', '']) expect(refused(() => monthRange({ from: bad, to: '2026-10' }, '2026-11-06')).reason).toBe('PERIOD_RANGE');
  });

  it('“the current month” is the profile’s: on Dec 1 at 00:30 in Jerusalem, December is allowed', () => {
    // The caller passes todayIn(profile timezone): 2026-11-30T22:30Z is already 2026-12-01 in Asia/Jerusalem.
    expect(monthRange({ from: '2026-12', to: '2026-12' }, '2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(refused(() => monthRange({ from: '2026-12', to: '2026-12' }, '2026-11-30')).reason).toBe('PERIOD_RANGE');
  });
});

describe('resolveAsOf (MUT-314)', () => {
  const now = new Date('2026-11-06T09:00:00Z');
  it('defaults to now; takes a moment in the last 24 hours', () => {
    expect(resolveAsOf(undefined, now)).toEqual(now);
    expect(resolveAsOf('2026-11-05T09:00:00.000Z', now)).toEqual(new Date('2026-11-05T09:00:00Z'));
  });
  it('refuses the future, more than 24 hours back, and a non-timestamp (AS_OF)', () => {
    expect(refused(() => resolveAsOf('2026-11-06T09:00:01Z', now)).reason).toBe('AS_OF');
    expect(refused(() => resolveAsOf('2026-11-05T08:59:59Z', now)).reason).toBe('AS_OF');
    expect(refused(() => resolveAsOf('yesterday', now)).reason).toBe('AS_OF');
  });
});

describe('periodLabel (MUT-314, D24)', () => {
  it('one month, a span, and a whole-profile link', () => {
    expect(periodLabel({ from: '2026-10-01', to: '2026-10-31' })).toBe('2026-10');
    expect(periodLabel({ from: '2026-08-01', to: '2026-10-31' })).toBe('2026-08_2026-10');
    expect(periodLabel({ from: null, to: '2026-11-06' })).toBe('to_2026-11');
  });
});
