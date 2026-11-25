import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_KEEP_NOTICE_VERSION,
  handsOverArchive,
  ISSUING_RETENTION_YEARS,
  israelDateOf,
  retainedUntil,
  retentionDateOf,
  sweepCutoff,
} from '../retention.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(day(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);

describe('MUT-644 retention (ADR-277 D1, as amended 2026-11-25)', () => {
  it('keeps each document 7 years from its own date: due the day after its 7th anniversary', () => {
    expect(ISSUING_RETENTION_YEARS).toBe(7);
    expect(retainedUntil('2026-11-22')).toBe('2033-11-23');
    expect(retainedUntil('2026-12-31')).toBe('2034-01-01');
    expect(retainedUntil('2026-01-01')).toBe('2033-01-02');
    // 29 February: the anniversary is 28 February in a common year (as Postgres adds years), so due 1 March.
    expect(retainedUntil('2028-02-29')).toBe('2035-03-01');
  });

  it('a document is due when its date is before the cutoff, exactly when today (UTC) has reached its retainedUntil', () => {
    // Every day over 9 years, leap days included: the cutoff and retainedUntil never disagree.
    for (let i = 0; i < 9 * 366; i++) {
      const date = addDays('2027-01-01', i);
      const ends = retainedUntil(date);
      expect(date < sweepCutoff(day(ends)), `${date} due on ${ends}`).toBe(true);
      expect(date < sweepCutoff(new Date(day(ends).getTime() - 1)), `${date} kept the day before ${ends}`).toBe(false);
    }
  });

  it('the cutoff reads the UTC day, so it is never early in Israel', () => {
    // 22:30 UTC on 22 Nov 2033 is already 23 Nov in Israel; the UTC day is still the 22nd, so a document of
    // 22 Nov 2026 is still kept; it goes at 00:00 UTC (02:00 in Israel), never before its day there.
    expect(sweepCutoff(new Date('2033-11-22T22:30:00Z'))).toBe('2026-11-22');
    expect('2026-11-22' < sweepCutoff(new Date('2033-11-22T22:30:00Z'))).toBe(false);
    expect('2026-11-22' < sweepCutoff(new Date('2033-11-23T00:00:00Z'))).toBe(true);
    // 29 February today (UTC): seven years back has no 29 February, so the cutoff rolls to 1 March.
    expect(sweepCutoff(new Date('2036-02-29T12:00:00Z'))).toBe('2029-03-01');
  });

  it('dates a cancellation in Israel, and a cancelled document counts from the later of the two', () => {
    expect(israelDateOf(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(israelDateOf(new Date('2026-12-31T12:00:00Z'))).toBe('2026-12-31');
    expect(retentionDateOf('2026-11-22', null)).toBe('2026-11-22');
    expect(retentionDateOf('2026-11-22', new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
    expect(retentionDateOf('2026-11-22', new Date('2026-11-21T10:00:00Z'))).toBe('2026-11-22');
  });

  it('an archive was handed over only when its export carried the 7-year keep notice and came first', () => {
    const at = new Date('2027-02-01T10:00:00Z');
    const exported = { action: 'ARCHIVE_EXPORTED' as const, metadata: { reference: 'SUP-1', noticeVersion: ARCHIVE_KEEP_NOTICE_VERSION }, createdAt: new Date('2027-01-31T10:00:00Z') };
    expect(handsOverArchive(exported, at)).toBe(true);
    expect(handsOverArchive({ ...exported, createdAt: at }, at)).toBe(true);
    expect(handsOverArchive({ ...exported, createdAt: new Date(at.getTime() + 1) }, at)).toBe(false);
    // Archives exported before the notice existed (1.138.0) never count.
    expect(handsOverArchive({ ...exported, metadata: { reference: 'SUP-1', documents: 2 } }, at)).toBe(false);
    expect(handsOverArchive({ ...exported, action: 'SWEPT' as const }, at)).toBe(false);
  });
});
