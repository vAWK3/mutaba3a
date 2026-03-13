import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectMonthFromFile,
  getCurrentMonthKey,
  parseMonthKey,
  formatMonthKey,
  getRecentMonthKeys,
  isPastMonth,
  isCurrentMonth,
  getNextMonthKey,
  getPreviousMonthKey,
} from '../monthDetection';

describe('monthDetection', () => {
  describe('detectMonthFromFile', () => {
    it('should detect month from file lastModified', () => {
      const file = new File(['content'], 'test.pdf', {
        lastModified: new Date('2024-06-15T12:00:00Z').getTime(),
      });
      expect(detectMonthFromFile(file)).toBe('2024-06');
    });

    it('should pad single digit months', () => {
      const file = new File(['content'], 'test.pdf', {
        lastModified: new Date('2024-01-05T12:00:00Z').getTime(),
      });
      expect(detectMonthFromFile(file)).toBe('2024-01');
    });
  });

  describe('getCurrentMonthKey', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return current month key', () => {
      expect(getCurrentMonthKey()).toBe('2024-06');
    });
  });

  describe('parseMonthKey', () => {
    it('should parse year and month', () => {
      const result = parseMonthKey('2024-06');
      expect(result.year).toBe(2024);
      expect(result.month).toBe(6);
    });

    it('should handle January', () => {
      const result = parseMonthKey('2024-01');
      expect(result.year).toBe(2024);
      expect(result.month).toBe(1);
    });

    it('should handle December', () => {
      const result = parseMonthKey('2024-12');
      expect(result.year).toBe(2024);
      expect(result.month).toBe(12);
    });
  });

  describe('formatMonthKey', () => {
    it('should format in English by default', () => {
      const result = formatMonthKey('2024-06', 'en');
      expect(result).toContain('June');
      expect(result).toContain('2024');
    });

    it('should format January correctly', () => {
      const result = formatMonthKey('2024-01', 'en');
      expect(result).toContain('January');
      expect(result).toContain('2024');
    });

    it('should format December correctly', () => {
      const result = formatMonthKey('2024-12', 'en');
      expect(result).toContain('December');
    });
  });

  describe('getRecentMonthKeys', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return last 12 months by default', () => {
      const months = getRecentMonthKeys();
      expect(months).toHaveLength(12);
      expect(months[0]).toBe('2024-06');
      expect(months[11]).toBe('2023-07');
    });

    it('should return specified number of months', () => {
      const months = getRecentMonthKeys(3);
      expect(months).toHaveLength(3);
      expect(months[0]).toBe('2024-06');
      expect(months[1]).toBe('2024-05');
      expect(months[2]).toBe('2024-04');
    });

    it('should handle year boundary', () => {
      vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));
      const months = getRecentMonthKeys(4);
      expect(months).toEqual(['2024-02', '2024-01', '2023-12', '2023-11']);
    });
  });

  describe('isPastMonth', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for past months', () => {
      expect(isPastMonth('2024-05')).toBe(true);
      expect(isPastMonth('2023-12')).toBe(true);
    });

    it('should return false for current month', () => {
      expect(isPastMonth('2024-06')).toBe(false);
    });

    it('should return false for future months', () => {
      expect(isPastMonth('2024-07')).toBe(false);
      expect(isPastMonth('2025-01')).toBe(false);
    });
  });

  describe('isCurrentMonth', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return true for current month', () => {
      expect(isCurrentMonth('2024-06')).toBe(true);
    });

    it('should return false for other months', () => {
      expect(isCurrentMonth('2024-05')).toBe(false);
      expect(isCurrentMonth('2024-07')).toBe(false);
    });
  });

  describe('getNextMonthKey', () => {
    it('should return next month', () => {
      expect(getNextMonthKey('2024-06')).toBe('2024-07');
    });

    it('should handle year boundary', () => {
      expect(getNextMonthKey('2024-12')).toBe('2025-01');
    });

    it('should handle January', () => {
      expect(getNextMonthKey('2024-01')).toBe('2024-02');
    });
  });

  describe('getPreviousMonthKey', () => {
    it('should return previous month', () => {
      expect(getPreviousMonthKey('2024-06')).toBe('2024-05');
    });

    it('should handle year boundary', () => {
      expect(getPreviousMonthKey('2024-01')).toBe('2023-12');
    });

    it('should handle December', () => {
      expect(getPreviousMonthKey('2024-12')).toBe('2024-11');
    });
  });
});
