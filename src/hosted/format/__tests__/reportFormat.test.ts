import { describe, expect, it } from 'vitest';
import { formatPeriod, formatReportDay, formatSigned } from '../reportFormat';

/** MUT-448: a Glance business line carries its sign; zero carries none, and a loss uses U+2212. */

describe('formatSigned', () => {
  it('signs gains and losses in whole units', () => {
    expect(formatSigned(904000, 'ILS', 'en')).toBe('+₪9,040');
    expect(formatSigned(-310050, 'ILS', 'en')).toBe('−₪3,101');
    expect(formatSigned(0, 'ILS', 'en')).toBe('₪0');
  });

  it('never shows a sign for an amount that rounds to zero', () => {
    expect(formatSigned(-40, 'ILS', 'en')).toBe('₪0');
  });

  it('keeps the sign in Arabic', () => {
    expect(formatSigned(-310000, 'ILS', 'ar')).toContain('−');
    expect(formatSigned(310000, 'ILS', 'ar')).toContain('+');
  });
});

describe('Arabic month names in Reports (AC6)', () => {
  it('are Levantine, with Latin digits', () => {
    expect(formatPeriod('month', { from: '2026-10-01', to: '2026-10-31' }, 'ar')).toBe('تشرين الأول 2026');
    expect(formatPeriod('month', { from: '2026-02-01', to: '2026-02-28' }, 'ar')).toBe('شباط 2026');
  });
});

describe('formatReportDay (AC6, review)', () => {
  it('writes the rate day as formatDay does in English, and Levantine in Arabic', () => {
    expect(formatReportDay('2026-10-23', 'en')).toBe('Oct 23, 2026');
    expect(formatReportDay('2026-10-23', 'ar')).toContain('تشرين الأول');
  });
});

