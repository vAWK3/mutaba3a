import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLocaleFromLanguage,
  formatAmount,
  formatAmountShort,
  parseAmountToMinor,
  parseCurrencyInput,
  formatCurrencyInput,
  formatDate,
  formatDateShort,
  formatDateCompact,
  formatRelativeDate,
  getDaysUntil,
  getDateRangePreset,
  cn,
  generateId,
  todayISO,
  nowISO,
  copyToClipboard,
} from '../utils';

describe('utils', () => {
  describe('getLocaleFromLanguage', () => {
    it('should return ar for Arabic', () => {
      expect(getLocaleFromLanguage('ar')).toBe('ar');
    });

    it('should return en-US for English', () => {
      expect(getLocaleFromLanguage('en')).toBe('en-US');
    });
  });

  describe('formatAmount', () => {
    it('should format USD amount correctly', () => {
      expect(formatAmount(10000, 'USD')).toBe('$100');
      expect(formatAmount(10050, 'USD')).toBe('$100.5'); // Intl drops trailing zeros
      expect(formatAmount(1000000, 'USD')).toBe('$10,000');
    });

    it('should format ILS amount correctly', () => {
      expect(formatAmount(10000, 'ILS')).toBe('₪100');
      expect(formatAmount(10050, 'ILS')).toBe('₪100.5'); // Intl drops trailing zeros
    });

    it('should handle zero amount', () => {
      expect(formatAmount(0, 'USD')).toBe('$0');
    });

    it('should handle negative amounts', () => {
      expect(formatAmount(-10000, 'USD')).toBe('-$100');
    });

    it('should use locale for formatting', () => {
      const result = formatAmount(10000, 'USD', 'ar');
      // Arabic locale should format differently
      expect(result).toContain('100');
    });
  });

  describe('formatAmountShort', () => {
    it('should format small amounts without abbreviation', () => {
      expect(formatAmountShort(10000, 'USD')).toBe('$100');
      expect(formatAmountShort(99900, 'USD')).toBe('$999');
    });

    it('should format thousands with K', () => {
      expect(formatAmountShort(100000, 'USD')).toBe('$1.0K');
      expect(formatAmountShort(150000, 'USD')).toBe('$1.5K');
      expect(formatAmountShort(990000, 'USD')).toBe('$9.9K');
      expect(formatAmountShort(999000, 'USD')).toBe('$10.0K'); // 9.99K rounds up
    });

    it('should format millions with M', () => {
      expect(formatAmountShort(100000000, 'USD')).toBe('$1.0M');
      expect(formatAmountShort(150000000, 'USD')).toBe('$1.5M');
    });

    it('should use ILS symbol', () => {
      expect(formatAmountShort(10000, 'ILS')).toBe('₪100');
      expect(formatAmountShort(100000, 'ILS')).toBe('₪1.0K');
    });
  });

  describe('parseAmountToMinor', () => {
    it('should parse clean numbers', () => {
      expect(parseAmountToMinor('100')).toBe(10000);
      expect(parseAmountToMinor('100.50')).toBe(10050);
      expect(parseAmountToMinor('1000.00')).toBe(100000);
    });

    it('should strip non-numeric characters', () => {
      expect(parseAmountToMinor('$100')).toBe(10000);
      expect(parseAmountToMinor('₪100.50')).toBe(10050);
    });

    it('should handle negative amounts', () => {
      expect(parseAmountToMinor('-100')).toBe(-10000);
    });

    it('should return 0 for invalid input', () => {
      expect(parseAmountToMinor('abc')).toBe(0);
      expect(parseAmountToMinor('')).toBe(0);
    });

    it('should round fractional cents', () => {
      expect(parseAmountToMinor('100.999')).toBe(10100);
      expect(parseAmountToMinor('100.001')).toBe(10000);
    });
  });

  describe('parseCurrencyInput', () => {
    it('should parse clean numbers', () => {
      expect(parseCurrencyInput('100')).toBe(10000);
      expect(parseCurrencyInput('100.50')).toBe(10050);
    });

    it('should strip currency symbols', () => {
      expect(parseCurrencyInput('$100')).toBe(10000);
      expect(parseCurrencyInput('₪100')).toBe(10000);
    });

    it('should handle empty input', () => {
      expect(parseCurrencyInput('')).toBe(0);
    });

    it('should handle negative values', () => {
      expect(parseCurrencyInput('-50')).toBe(-5000);
    });
  });

  describe('formatCurrencyInput', () => {
    it('should pass through clean numbers', () => {
      expect(formatCurrencyInput('100')).toBe('100');
      expect(formatCurrencyInput('100.50')).toBe('100.50');
    });

    it('should strip non-numeric characters', () => {
      expect(formatCurrencyInput('$100')).toBe('100');
      expect(formatCurrencyInput('abc123')).toBe('123');
    });

    it('should limit decimal places to 2', () => {
      expect(formatCurrencyInput('100.999')).toBe('100.99');
      expect(formatCurrencyInput('100.12345')).toBe('100.12');
    });

    it('should handle multiple decimal points', () => {
      expect(formatCurrencyInput('100.50.25')).toBe('100.50');
    });

    it('should preserve partial input', () => {
      expect(formatCurrencyInput('.')).toBe('.');
      expect(formatCurrencyInput('-')).toBe('-');
    });
  });

  describe('formatDate', () => {
    it('should format date in en-US locale', () => {
      const result = formatDate('2024-01-15T10:30:00Z', 'en-US');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/2024/);
    });

    it('should format date in Arabic locale', () => {
      const result = formatDate('2024-01-15T10:30:00Z', 'ar');
      // Arabic should use different month names
      expect(result).toBeTruthy();
    });
  });

  describe('formatDateShort', () => {
    it('should format without year', () => {
      const result = formatDateShort('2024-01-15T10:30:00Z', 'en-US');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).not.toMatch(/2024/);
    });
  });

  describe('formatDateCompact', () => {
    it('should format as DD/MM/YYYY', () => {
      const result = formatDateCompact('2024-01-15T10:30:00Z');
      expect(result).toBe('15/01/2024');
    });

    it('should pad single digits', () => {
      const result = formatDateCompact('2024-03-05T10:30:00Z');
      expect(result).toBe('05/03/2024');
    });
  });

  describe('formatRelativeDate', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return Today for current date', () => {
      expect(formatRelativeDate('2024-06-15T10:00:00Z')).toBe('Today');
    });

    it('should return Yesterday for yesterday', () => {
      expect(formatRelativeDate('2024-06-14T10:00:00Z')).toBe('Yesterday');
    });

    it('should return days ago for recent dates', () => {
      expect(formatRelativeDate('2024-06-12T10:00:00Z')).toBe('3 days ago');
    });

    it('should return weeks ago for older dates', () => {
      expect(formatRelativeDate('2024-06-01T10:00:00Z')).toBe('2 weeks ago');
    });

    it('should return months ago for much older dates', () => {
      expect(formatRelativeDate('2024-03-15T10:00:00Z')).toBe('3 months ago');
    });

    it('should return years ago for dates over a year old', () => {
      expect(formatRelativeDate('2022-06-15T10:00:00Z')).toBe('2 years ago');
    });

    it('should use translation function if provided', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2024-06-15T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.today');
    });

    it('should call translation function for yesterday', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2024-06-14T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.yesterday');
    });

    it('should call translation function for days ago', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2024-06-12T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.daysAgo', { days: 3 });
    });

    it('should call translation function for weeks ago', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2024-06-01T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.weeksAgo', { weeks: 2 });
    });

    it('should call translation function for months ago', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2024-03-15T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.monthsAgo', { months: 3 });
    });

    it('should call translation function for years ago', () => {
      const mockT = vi.fn().mockReturnValue('translated');
      formatRelativeDate('2022-06-15T10:00:00Z', mockT);
      expect(mockT).toHaveBeenCalledWith('time.yearsAgo', { years: 2 });
    });
  });

  describe('getDaysUntil', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return 0 for today', () => {
      expect(getDaysUntil('2024-06-15')).toBe(0);
    });

    it('should return positive for future dates', () => {
      expect(getDaysUntil('2024-06-20')).toBe(5);
    });

    it('should return negative for past dates', () => {
      expect(getDaysUntil('2024-06-10')).toBe(-5);
    });
  });

  describe('getDateRangePreset', () => {
    it('should return this-month range', () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();

      const result = getDateRangePreset('this-month');
      expect(result.dateFrom).toBe(`${year}-${month}-01`);
      expect(result.dateTo).toBe(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    });

    it('should return last-month range', () => {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = lastMonth.getFullYear();
      const month = String(lastMonth.getMonth() + 1).padStart(2, '0');
      const lastDay = new Date(year, lastMonth.getMonth() + 1, 0).getDate();

      const result = getDateRangePreset('last-month');
      expect(result.dateFrom).toBe(`${year}-${month}-01`);
      expect(result.dateTo).toBe(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    });

    it('should return this-year range', () => {
      const now = new Date();
      const year = now.getFullYear();

      const result = getDateRangePreset('this-year');
      expect(result.dateFrom).toBe(`${year}-01-01`);
      expect(result.dateTo).toBe(`${year}-12-31`);
    });

    it('should return all range', () => {
      const result = getDateRangePreset('all');
      expect(result.dateFrom).toBe('2000-01-01');
      expect(result.dateTo).toBe('2100-12-31');
    });
  });

  describe('cn', () => {
    it('should join class names', () => {
      expect(cn('class1', 'class2')).toBe('class1 class2');
    });

    it('should filter falsy values', () => {
      expect(cn('class1', false, 'class2', null, undefined, '')).toBe('class1 class2');
    });

    it('should return empty string for no valid classes', () => {
      expect(cn(false, null, undefined)).toBe('');
    });
  });

  describe('generateId', () => {
    it('should generate a UUID', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('todayISO', () => {
    it('should return today in ISO date format', () => {
      const result = todayISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Should match today
      const today = new Date().toISOString().split('T')[0];
      expect(result).toBe(today);
    });
  });

  describe('nowISO', () => {
    it('should return current timestamp in ISO format', () => {
      const result = nowISO();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      // Should be close to now
      const now = new Date().toISOString();
      expect(result.substring(0, 16)).toBe(now.substring(0, 16));
    });
  });

  describe('copyToClipboard', () => {
    it('should copy text using clipboard API', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      const result = await copyToClipboard('test text');
      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith('test text');
    });

    it('should return false on failure', async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error('fail'));
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      const result = await copyToClipboard('test text');
      expect(result).toBe(false);
    });

    it('should use fallback when clipboard API is unavailable', async () => {
      // Remove clipboard API
      Object.assign(navigator, { clipboard: undefined });

      // Mock document methods for fallback
      const mockTextarea = {
        value: '',
        style: {} as CSSStyleDeclaration,
        select: vi.fn(),
      };
      const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockTextarea as unknown as HTMLTextAreaElement);
      const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextarea as unknown as HTMLTextAreaElement);
      const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextarea as unknown as HTMLTextAreaElement);
      // Define execCommand on document if it doesn't exist
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).execCommand = vi.fn().mockReturnValue(true);

      const result = await copyToClipboard('fallback test');

      expect(result).toBe(true);
      expect(createElementSpy).toHaveBeenCalledWith('textarea');
      expect(mockTextarea.select).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((document as any).execCommand).toHaveBeenCalledWith('copy');
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      // Cleanup
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it('should return false when fallback execCommand fails', async () => {
      // Remove clipboard API
      Object.assign(navigator, { clipboard: undefined });

      // Mock document methods for fallback
      const mockTextarea = {
        value: '',
        style: {} as CSSStyleDeclaration,
        select: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockTextarea as unknown as HTMLTextAreaElement);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextarea as unknown as HTMLTextAreaElement);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextarea as unknown as HTMLTextAreaElement);
      // Define execCommand on document if it doesn't exist
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).execCommand = vi.fn().mockReturnValue(false);

      const result = await copyToClipboard('fallback test');

      expect(result).toBe(false);

      // Cleanup
      vi.restoreAllMocks();
    });
  });
});
