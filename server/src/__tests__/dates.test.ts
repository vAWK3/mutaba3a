import { describe, expect, it } from 'vitest';
import { addDays, addMonths, clampDay, compareIsoDates, dueDateFor, endOfMonth, isIsoDate, isValidTimezone, monthOf, todayIn } from '../dates.js';

describe('dates', () => {
  it('todayIn follows the organization timezone, not the process', () => {
    const instant = new Date('2026-10-08T22:30:00Z'); // 01:30 next day in Jerusalem (UTC+3)
    expect(todayIn('UTC', instant)).toBe('2026-10-08');
    expect(todayIn('Asia/Jerusalem', instant)).toBe('2026-10-09');
    expect(todayIn('Pacific/Auckland', instant)).toBe('2026-10-09');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-10-08');
  });

  it('validates timezones and ISO dates', () => {
    expect(isValidTimezone('Asia/Jerusalem')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('08/10/2026')).toBe(false);
  });

  it('compares and adds days across month and year ends', () => {
    expect(compareIsoDates('2026-10-08', '2026-10-09')).toBe(-1);
    expect(compareIsoDates('2026-10-08', '2026-10-08')).toBe(0);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('month helpers: end of month, add months, clamp billing day', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
    expect(monthOf('2026-10-08')).toBe('2026-10');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(clampDay('2026-02', 28)).toBe('2026-02-28');
    expect(clampDay('2026-04', 1)).toBe('2026-04-01');
  });

  it('due dates from payment terms: end of month by default', () => {
    expect(dueDateFor('2026-10-08', 'IMMEDIATE')).toBe('2026-10-08');
    expect(dueDateFor('2026-10-08', 'EOM')).toBe('2026-10-31');
    expect(dueDateFor('2026-10-08', 'EOM_15')).toBe('2026-11-15');
    expect(dueDateFor('2026-10-08', 'EOM_30')).toBe('2026-11-30');
    expect(dueDateFor('2026-10-08', 'EOM_45')).toBe('2026-12-15');
    expect(dueDateFor('2026-10-08', 'EOM_60')).toBe('2026-12-30');
    expect(dueDateFor('2026-01-31', 'EOM')).toBe('2026-01-31');
  });
});
