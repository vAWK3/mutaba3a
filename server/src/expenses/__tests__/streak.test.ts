import { describe, expect, it } from 'vitest';
import { computeStreak, loggedAtOf, zonedMidnightUtc } from '../streak.js';

/** MUT-339: a personal profile's logging streak, from its distinct logged days (newest first). */
describe('computeStreak', () => {
  const tz = 'Asia/Amman';

  it('nothing logged: no streak, nothing to explain', () => {
    expect(computeStreak([], '2026-10-23', tz)).toEqual({ current: 0, startedOn: null, lastLoggedOn: null, aliveUntil: null, previous: null });
  });

  it('only today: 1, alive until the end of tomorrow', () => {
    const s = computeStreak(['2026-10-23'], '2026-10-23', tz);
    expect(s).toMatchObject({ current: 1, startedOn: '2026-10-23', lastLoggedOn: '2026-10-23' });
    expect(s.aliveUntil).toBe(zonedMidnightUtc('2026-10-25', tz).toISOString());
  });

  it('yesterday but not yet today still counts (D3)', () => {
    expect(computeStreak(['2026-10-22', '2026-10-21', '2026-10-20'], '2026-10-23', tz)).toMatchObject({ current: 3, startedOn: '2026-10-20', lastLoggedOn: '2026-10-22' });
  });

  it('a whole day missed ends it; the run before is the previous', () => {
    const s = computeStreak(['2026-10-23', '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17'], '2026-10-23', tz);
    expect(s).toMatchObject({ current: 1, startedOn: '2026-10-23', previous: { days: 4, lastDay: '2026-10-20' } });
  });

  it('nothing for two days: current 0, the ended run is previous', () => {
    const s = computeStreak(['2026-10-20', '2026-10-19', '2026-10-18'], '2026-10-23', tz);
    expect(s).toMatchObject({ current: 0, startedOn: null, lastLoggedOn: '2026-10-20', previous: { days: 3, lastDay: '2026-10-20' } });
  });

  it('a previous run under 3 days, or one that ended over 7 days ago, is not reported', () => {
    expect(computeStreak(['2026-10-20', '2026-10-19'], '2026-10-23', tz).previous).toBeNull();
    expect(computeStreak(['2026-10-10', '2026-10-09', '2026-10-08'], '2026-10-23', tz).previous).toBeNull();
  });
});

describe('zonedMidnightUtc', () => {
  it('is 00:00 in the zone, as a UTC instant, across a DST change', () => {
    expect(zonedMidnightUtc('2026-10-23', 'Asia/Amman').toISOString()).toBe('2026-10-22T21:00:00.000Z');
    expect(zonedMidnightUtc('2026-03-29', 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedMidnightUtc('2026-03-30', 'Europe/London').toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });
});

describe('loggedAtOf (S4)', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  it('takes the phone’s capturedAt within the last 48 hours', () => {
    expect(loggedAtOf('2026-10-22T21:50:00Z', now).toISOString()).toBe('2026-10-22T21:50:00.000Z');
  });
  it('clamps older to now − 48 h and future to now; none is now', () => {
    expect(loggedAtOf('2026-10-01T00:00:00Z', now).toISOString()).toBe('2026-10-21T12:00:00.000Z');
    expect(loggedAtOf('2026-10-24T00:00:00Z', now).toISOString()).toBe(now.toISOString());
    expect(loggedAtOf(undefined, now)).toBe(now);
  });
});
