import { describe, expect, it } from 'vitest';
import { ISSUING_RETENTION_YEARS, israelDateOf, retentionEndsOn, sweepCutoff } from '../retention.js';

describe('MUT-644 retention (ADR-277 D1)', () => {
  it('keeps 7 full years after the end of the newest document’s calendar year', () => {
    expect(ISSUING_RETENTION_YEARS).toBe(7);
    expect(retentionEndsOn('2026-11-22')).toBe('2034-01-01');
    expect(retentionEndsOn('2026-01-01')).toBe('2034-01-01');
    expect(retentionEndsOn('2026-12-31')).toBe('2034-01-01');
  });

  it('has nothing to keep when the profile issued nothing', () => {
    expect(retentionEndsOn(null)).toBeNull();
  });

  it('the cutoff: a newest document dated before it is due now (UTC year, never early in Israel)', () => {
    // 31 Dec 2033 23:59 UTC is already 1 Jan 2034 in Israel, but the 2026 documents are not due until UTC says 2034.
    expect(sweepCutoff(new Date('2033-12-31T23:59:59Z'))).toBe('2026-01-01');
    expect(sweepCutoff(new Date('2034-01-01T00:00:00Z'))).toBe('2027-01-01');
    // Consistency: due exactly when now has reached retentionEndsOn.
    const newest = '2026-06-30';
    const ends = Date.parse(`${retentionEndsOn(newest)}T00:00:00Z`);
    expect(newest < sweepCutoff(new Date(ends))).toBe(true);
    expect(newest < sweepCutoff(new Date(ends - 1))).toBe(false);
  });

  it('dates a cancellation in Israel', () => {
    expect(israelDateOf(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(israelDateOf(new Date('2026-12-31T12:00:00Z'))).toBe('2026-12-31');
  });
});
