import { describe, expect, it } from 'vitest';
import { feedBoundsOf, isInRange, resolveShareLinkPeriod, shareLinkRangeAt } from '../period.js';

/**
 * MUT-560 test group 1: the period, pure. Basel's decision (2026-11-06): "last N months" is the last N COMPLETE calendar
 * months before the creation day, in the profile's timezone; "whole profile" is everything up to and including it.
 */
describe('resolveShareLinkPeriod (MUT-560)', () => {
  it.each([
    ['LAST_1_MONTH', '2026-11-06', '2026-10-01', '2026-10-31'],
    ['LAST_2_MONTHS', '2026-11-06', '2026-09-01', '2026-10-31'],
    ['LAST_3_MONTHS', '2026-11-06', '2026-08-01', '2026-10-31'],
    // Created on the 1st: the month just begun is not complete, so it is never included.
    ['LAST_1_MONTH', '2026-11-01', '2026-10-01', '2026-10-31'],
    // Created on the last day of a month: still only complete months before it.
    ['LAST_1_MONTH', '2026-10-31', '2026-09-01', '2026-09-30'],
  ] as const)('%s created %s is %s … %s', (period, today, from, to) => {
    expect(resolveShareLinkPeriod(period, today)).toEqual({ from, to });
  });

  it('crosses the year boundary', () => {
    expect(resolveShareLinkPeriod('LAST_1_MONTH', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(resolveShareLinkPeriod('LAST_3_MONTHS', '2027-02-10')).toEqual({ from: '2026-11-01', to: '2027-01-31' });
    expect(resolveShareLinkPeriod('LAST_2_MONTHS', '2027-01-01')).toEqual({ from: '2026-11-01', to: '2026-12-31' });
  });

  it('ends February on its own last day, leap years included', () => {
    expect(resolveShareLinkPeriod('LAST_1_MONTH', '2028-03-31')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolveShareLinkPeriod('LAST_1_MONTH', '2027-03-31')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('the whole profile is everything up to and including the creation day', () => {
    expect(resolveShareLinkPeriod('WHOLE_PROFILE', '2026-11-06')).toEqual({ from: null, to: '2026-11-06' });
  });
});

describe('shareLinkRangeAt: the creation day is the profile’s own (MUT-560)', () => {
  it('00:30 on the 1st in Jerusalem is still the 31st in UTC: the profile’s day decides', () => {
    // 2026-11-01 00:30 in Asia/Jerusalem (UTC+2 in November) is 2026-10-31 22:30 UTC.
    const at = new Date('2026-10-31T22:30:00Z');
    expect(shareLinkRangeAt('LAST_1_MONTH', 'Asia/Jerusalem', at)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(shareLinkRangeAt('LAST_1_MONTH', 'UTC', at)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(shareLinkRangeAt('WHOLE_PROFILE', 'Asia/Jerusalem', at)).toEqual({ from: null, to: '2026-11-01' });
    expect(shareLinkRangeAt('WHOLE_PROFILE', 'UTC', at)).toEqual({ from: null, to: '2026-10-31' });
  });

  it('a year boundary at local midnight', () => {
    // 2027-01-01 00:30 in Jerusalem = 2026-12-31 22:30 UTC.
    expect(shareLinkRangeAt('LAST_1_MONTH', 'Asia/Jerusalem', new Date('2026-12-31T22:30:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('feedBoundsOf and isInRange (MUT-560)', () => {
  it('the feed’s upper bound is exclusive: the day after `to`', () => {
    expect(feedBoundsOf({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ occurredFrom: '2026-10-01', occurredBefore: '2026-11-01' });
    expect(feedBoundsOf({ from: null, to: '2026-12-31' })).toEqual({ occurredBefore: '2027-01-01' });
  });

  it('includes both ends and nothing outside', () => {
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(['2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01'].map((d) => isInRange(d, range))).toEqual([false, true, true, false]);
    expect(isInRange('2001-01-01', { from: null, to: '2026-11-06' })).toBe(true);
    expect(isInRange('2026-11-07', { from: null, to: '2026-11-06' })).toBe(false);
  });
});
