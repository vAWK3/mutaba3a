import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  formatLocalDate,
  todayLocalISO,
  daysBetweenLocal,
  daysUntilDue,
  isReceivable,
  isOverdueReceivable,
  daysOverdue,
  isDueSoon,
  type ReceivableLike,
} from '../dates';

/** Build a receivable-shaped row. Defaults to unpaid income (a receivable). */
function tx(overrides: Partial<ReceivableLike> = {}): ReceivableLike {
  return { kind: 'income', status: 'unpaid', dueDate: undefined, ...overrides };
}

const TODAY = '2026-10-05';

describe('dates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatLocalDate', () => {
    it('formats from local calendar fields, zero-padded', () => {
      expect(formatLocalDate(new Date(2026, 0, 9))).toBe('2026-01-09');
      expect(formatLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31');
    });
  });

  describe('todayLocalISO', () => {
    it('returns the local date for an explicit now', () => {
      expect(todayLocalISO(new Date(2026, 9, 5, 13, 30))).toBe('2026-10-05');
    });

    // The core defect in MUT-17: toISOString() yields the UTC date, which is
    // the wrong calendar day for part of every day. These two cases are the
    // hours where the old helper was off by one.
    it('is the local date, not the UTC date, just after local midnight (UTC+n)', () => {
      // 2026-10-05T22:30:00Z is 2026-10-06 01:30 in Asia/Jerusalem (UTC+3).
      const instant = new Date('2026-10-05T22:30:00Z');
      const utcDate = instant.toISOString().split('T')[0];
      const local = todayLocalISO(instant);

      if (utcDate !== local) {
        // Only asserts in a UTC+n zone, where the two genuinely differ.
        expect(utcDate).toBe('2026-10-05');
        expect(local).toBe('2026-10-06');
      }
      expect(local).toBe(formatLocalDate(instant));
    });

    it('is the local date, not the UTC date, late in the evening (UTC-n)', () => {
      // 2026-10-06T00:30:00Z is 2026-10-05 20:30 in America/New_York (UTC-4).
      const instant = new Date('2026-10-06T00:30:00Z');
      const utcDate = instant.toISOString().split('T')[0];
      const local = todayLocalISO(instant);

      if (utcDate !== local) {
        expect(utcDate).toBe('2026-10-06');
        expect(local).toBe('2026-10-05');
      }
      expect(local).toBe(formatLocalDate(instant));
    });

    it('reads the clock when now is omitted', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 9, 5, 9, 0));
      expect(todayLocalISO()).toBe('2026-10-05');
    });
  });

  describe('daysBetweenLocal', () => {
    it('is 0 for the same date', () => {
      expect(daysBetweenLocal(TODAY, TODAY)).toBe(0);
    });

    it('is positive forwards and negative backwards', () => {
      expect(daysBetweenLocal('2026-10-05', '2026-10-12')).toBe(7);
      expect(daysBetweenLocal('2026-10-12', '2026-10-05')).toBe(-7);
    });

    it('spans months and years', () => {
      expect(daysBetweenLocal('2026-01-31', '2026-02-01')).toBe(1);
      expect(daysBetweenLocal('2026-12-31', '2027-01-01')).toBe(1);
      expect(daysBetweenLocal('2026-01-01', '2027-01-01')).toBe(365);
    });

    it('handles leap days', () => {
      expect(daysBetweenLocal('2024-02-28', '2024-03-01')).toBe(2);
      expect(daysBetweenLocal('2026-02-28', '2026-03-01')).toBe(1);
    });

    // Local Date subtraction would give 0.958 or 1.042 days here and truncate
    // to the wrong integer. dayIndex uses Date.UTC, so these stay exact.
    it('is exact across the Asia/Jerusalem DST transitions', () => {
      // Spring forward 2026-03-27 (23-hour local day).
      expect(daysBetweenLocal('2026-03-26', '2026-03-28')).toBe(2);
      expect(daysBetweenLocal('2026-03-27', '2026-03-28')).toBe(1);
      // Fall back 2026-10-25 (25-hour local day).
      expect(daysBetweenLocal('2026-10-24', '2026-10-26')).toBe(2);
      expect(daysBetweenLocal('2026-10-25', '2026-10-26')).toBe(1);
    });

    it('is exact across US DST transitions', () => {
      expect(daysBetweenLocal('2026-03-07', '2026-03-09')).toBe(2);
      expect(daysBetweenLocal('2026-10-31', '2026-11-02')).toBe(2);
    });
  });

  describe('daysUntilDue', () => {
    it('is 0 when due today', () => {
      expect(daysUntilDue(TODAY, TODAY)).toBe(0);
    });

    it('is positive for future and negative for past', () => {
      expect(daysUntilDue('2026-10-10', TODAY)).toBe(5);
      expect(daysUntilDue('2026-09-30', TODAY)).toBe(-5);
    });
  });

  describe('isReceivable', () => {
    it('is true only for unpaid income', () => {
      expect(isReceivable(tx())).toBe(true);
      expect(isReceivable(tx({ status: 'paid' }))).toBe(false);
      expect(isReceivable(tx({ kind: 'expense' }))).toBe(false);
      expect(isReceivable(tx({ kind: 'expense', status: 'paid' }))).toBe(false);
    });
  });

  describe('isOverdueReceivable', () => {
    // The five boundary cases MUT-17 requires.
    it('due yesterday is overdue', () => {
      expect(isOverdueReceivable(tx({ dueDate: '2026-10-04' }), TODAY)).toBe(true);
    });

    it('due today is NOT overdue', () => {
      expect(isOverdueReceivable(tx({ dueDate: TODAY }), TODAY)).toBe(false);
    });

    it('due tomorrow is not overdue', () => {
      expect(isOverdueReceivable(tx({ dueDate: '2026-10-06' }), TODAY)).toBe(false);
    });

    it('no due date is never overdue', () => {
      expect(isOverdueReceivable(tx({ dueDate: undefined }), TODAY)).toBe(false);
    });

    it('paid income past its due date is not overdue', () => {
      expect(
        isOverdueReceivable(tx({ status: 'paid', dueDate: '2026-01-01' }), TODAY)
      ).toBe(false);
    });

    it('expenses are never overdue receivables', () => {
      expect(
        isOverdueReceivable(tx({ kind: 'expense', dueDate: '2026-01-01' }), TODAY)
      ).toBe(false);
    });

    it('is correct across a year boundary', () => {
      expect(isOverdueReceivable(tx({ dueDate: '2025-12-31' }), '2026-01-01')).toBe(true);
      expect(isOverdueReceivable(tx({ dueDate: '2026-01-01' }), '2026-01-01')).toBe(false);
    });
  });

  describe('daysOverdue', () => {
    it('is undefined when not overdue', () => {
      expect(daysOverdue(tx({ dueDate: TODAY }), TODAY)).toBeUndefined();
      expect(daysOverdue(tx({ dueDate: '2026-10-06' }), TODAY)).toBeUndefined();
      expect(daysOverdue(tx({ dueDate: undefined }), TODAY)).toBeUndefined();
      expect(daysOverdue(tx({ status: 'paid', dueDate: '2026-01-01' }), TODAY)).toBeUndefined();
    });

    it('is 1 the day after the due date', () => {
      expect(daysOverdue(tx({ dueDate: '2026-10-04' }), TODAY)).toBe(1);
    });

    it('counts whole days, exact across DST', () => {
      expect(daysOverdue(tx({ dueDate: '2026-09-05' }), TODAY)).toBe(30);
      expect(daysOverdue(tx({ dueDate: '2026-03-26' }), '2026-03-28')).toBe(2);
      expect(daysOverdue(tx({ dueDate: '2026-10-24' }), '2026-10-26')).toBe(2);
    });

    it('is never 0 or negative when defined', () => {
      for (const dueDate of ['2026-10-04', '2026-09-05', '2025-01-01']) {
        expect(daysOverdue(tx({ dueDate }), TODAY)!).toBeGreaterThan(0);
      }
    });
  });

  describe('isDueSoon', () => {
    it('includes today and the last day of the window', () => {
      expect(isDueSoon(tx({ dueDate: TODAY }), TODAY)).toBe(true);
      expect(isDueSoon(tx({ dueDate: '2026-10-12' }), TODAY)).toBe(true);
    });

    it('excludes the day after the window', () => {
      expect(isDueSoon(tx({ dueDate: '2026-10-13' }), TODAY)).toBe(false);
    });

    it('excludes already-overdue items so they are not double-counted', () => {
      expect(isDueSoon(tx({ dueDate: '2026-10-04' }), TODAY)).toBe(false);
    });

    it('respects a custom window', () => {
      expect(isDueSoon(tx({ dueDate: '2026-10-08' }), TODAY, 3)).toBe(true);
      expect(isDueSoon(tx({ dueDate: '2026-10-09' }), TODAY, 3)).toBe(false);
    });

    it('ignores non-receivables and rows with no due date', () => {
      expect(isDueSoon(tx({ status: 'paid', dueDate: TODAY }), TODAY)).toBe(false);
      expect(isDueSoon(tx({ kind: 'expense', dueDate: TODAY }), TODAY)).toBe(false);
      expect(isDueSoon(tx({ dueDate: undefined }), TODAY)).toBe(false);
    });
  });

  // Overdue and due-soon must partition the receivables with due dates, so the
  // Home screen's two lists can never show the same row twice or drop one.
  describe('overdue and due-soon are mutually exclusive', () => {
    const dueDates = [
      '2026-09-01', '2026-10-04', TODAY, '2026-10-06', '2026-10-12', '2026-10-13', '2027-01-01',
    ];

    it.each(dueDates)('%s is never both overdue and due soon', (dueDate) => {
      const row = tx({ dueDate });
      expect(isOverdueReceivable(row, TODAY) && isDueSoon(row, TODAY)).toBe(false);
    });
  });
});
