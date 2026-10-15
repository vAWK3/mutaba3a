import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { assertNotAbsurdDate, assertNotTooOld, DAYS_IN_FUTURE_LIMIT, DAYS_IN_PAST_LIMIT } from '../compose.js';

/** MUT-227: the ten-year floor on money dates, and the `bound` both ends of the range now report. */

const today = '2026-10-12';
const floor = '2016-10-04'; // today − 3660 days

function detailsOf(fn: () => void): Record<string, unknown> {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return (err as ApiError).details as Record<string, unknown>;
  }
  return expect.unreachable('expected a DATE_INVALID');
}

describe('assertNotTooOld (MUT-227)', () => {
  it('is 3660 days, the same span as the ceiling', () => {
    expect(DAYS_IN_PAST_LIMIT).toBe(3660);
    expect(DAYS_IN_PAST_LIMIT).toBe(DAYS_IN_FUTURE_LIMIT);
  });

  it('accepts the floor day itself and anything later', () => {
    expect(() => assertNotTooOld(floor, today, 'occurredOn')).not.toThrow();
    expect(() => assertNotTooOld(today, today, 'occurredOn')).not.toThrow();
  });

  it('refuses the day before the floor, naming the field and the past bound', () => {
    expect(detailsOf(() => assertNotTooOld('2016-10-03', today, 'occurredOn'))).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
  });

  it('refuses a typo year like 0001-01-01', () => {
    expect(detailsOf(() => assertNotTooOld('0001-01-01', today, 'receivedOn'))).toMatchObject({ field: 'receivedOn', bound: 'past' });
  });

  it('says what is wrong in the message', () => {
    try {
      assertNotTooOld('2006-10-12', today, 'paidAt');
    } catch (err) {
      expect((err as ApiError).message).toBe('paidAt is more than ten years ago');
    }
  });
});

describe('assertNotAbsurdDate reports the future bound (MUT-227)', () => {
  it('refuses a date more than ten years ahead with bound future', () => {
    expect(detailsOf(() => assertNotAbsurdDate('2036-10-30', today, 'receivedOn'))).toEqual({ reason: 'DATE_INVALID', field: 'receivedOn', bound: 'future' });
  });
});
