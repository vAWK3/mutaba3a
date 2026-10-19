import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getLocaleFromLanguage,
  currencyExponent,
  formatAmount,
  formatAmountShort,
  parseAmountToMinor,
  parseAmountInput,
  amountInputCurrency,
  parseCurrencyInput,
  formatCurrencyInput,
  formatDate,
  formatPaymentDate,
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
  isolate,
  isolateAmount,
} from '../utils';

describe('utils', () => {
  describe('isolate', () => {
    it('wraps text in a first-strong isolate (U+2068 ... U+2069)', () => {
      expect(isolate('$500')).toBe('⁨$500⁩');
    });

    it('does not force a strong right-to-left string to render left-to-right', () => {
      // FSI takes direction from the first strong character inside it, unlike
      // the LRI this helper replaces (MUT-81 eng review D4/D5), which always
      // forced left-to-right. An Arabic client name is exactly the case that
      // migration exists for: it must not come out reversed.
      const arabicName = 'شركة الأثاث';
      const isolated = isolate(arabicName);
      expect(isolated.startsWith('⁦')).toBe(false); // not the old LRI
      expect(isolated).toBe(`⁨${arabicName}⁩`);
    });
  });

  describe('isolateAmount (MUT-110)', () => {
    it('wraps text in a left-to-right isolate (U+2066 ... U+2069)', () => {
      expect(isolateAmount('$500')).toBe('⁦$500⁩');
    });

    it('keeps an Arabic-formatted amount reading left-to-right despite its leading RLM', () => {
      // Intl.NumberFormat('ar', {style:'currency'}) prepends U+200F RLM, a
      // strong RTL character. The shared isolate() (FSI) would resolve this
      // right-to-left -- exactly the MUT-110 bug -- because FSI takes its
      // direction from the first strong character inside it. LRI always
      // forces left-to-right regardless of what's inside, which is what an
      // amount (unlike a name) needs.
      const arabicAmount = '‏7,550 US$';
      const isolated = isolateAmount(arabicAmount);
      expect(isolated.startsWith('⁨')).toBe(false); // not FSI
      expect(isolated).toBe(`⁦${arabicAmount}⁩`);
    });
  });

  describe('getLocaleFromLanguage', () => {
    it('should return ar for Arabic', () => {
      expect(getLocaleFromLanguage('ar')).toBe('ar');
    });

    it('should return en-US for English', () => {
      expect(getLocaleFromLanguage('en')).toBe('en-US');
    });
  });

  describe('currencyExponent', () => {
    it('returns 2 for USD/ILS/EUR and 3 for JOD', () => {
      expect(currencyExponent('USD')).toBe(2);
      expect(currencyExponent('ILS')).toBe(2);
      expect(currencyExponent('EUR')).toBe(2);
      expect(currencyExponent('JOD')).toBe(3);
    });

    it('returns 2 for the Gulf dirham/riyal currencies and 3 for the Gulf dinars (MUT-281)', () => {
      expect(currencyExponent('AED')).toBe(2);
      expect(currencyExponent('SAR')).toBe(2);
      expect(currencyExponent('QAR')).toBe(2);
      expect(currencyExponent('BHD')).toBe(3);
      expect(currencyExponent('OMR')).toBe(3);
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

    it('formats JOD at 3 decimal places (fils) instead of 2', () => {
      // Intl separates the ISO code from the amount with a non-breaking space (U+00A0)
      expect(formatAmount(100000, 'JOD')).toBe('JOD 100');
      expect(formatAmount(100123, 'JOD')).toBe('JOD 100.123');
      expect(formatAmount(1, 'JOD')).toBe('JOD 0.001');
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
      expect(parseAmountToMinor('100', 'USD')).toBe(10000);
      expect(parseAmountToMinor('100.50', 'USD')).toBe(10050);
      expect(parseAmountToMinor('1000.00', 'USD')).toBe(100000);
    });

    it('should strip non-numeric characters', () => {
      expect(parseAmountToMinor('$100', 'USD')).toBe(10000);
      expect(parseAmountToMinor('₪100.50', 'ILS')).toBe(10050);
    });

    it('should handle negative amounts', () => {
      expect(parseAmountToMinor('-100', 'USD')).toBe(-10000);
    });

    it('should return 0 for invalid input', () => {
      expect(parseAmountToMinor('abc', 'USD')).toBe(0);
      expect(parseAmountToMinor('', 'USD')).toBe(0);
    });

    it('should round fractional cents', () => {
      expect(parseAmountToMinor('100.999', 'USD')).toBe(10100);
      expect(parseAmountToMinor('100.001', 'USD')).toBe(10000);
    });

    it('parses JOD at 3 decimals (fils) instead of rounding to 2 — the exact bug class this ticket fixes', () => {
      expect(parseAmountToMinor('100.123', 'JOD')).toBe(100123);
      expect(parseAmountToMinor('100.9995', 'JOD')).toBe(101000); // rounds the 4th digit, keeps 3
      expect(parseAmountToMinor('100.0001', 'JOD')).toBe(100000);
    });
  });

  describe('parseAmountInput', () => {
    it.each([
      ['1200', 120000],
      ['1,200.50', 120050],
      ['0.5', 50],
      ['.5', 50],
      ['5.', 500],
      ['007', 700],
      ['12,345,678', 1234567800],
      ['\u0661\u0662\u0660\u0660', 120000],
      ['\u0661\u066C\u0662\u0660\u0660\u066B\u0665\u0660', 120050],
      ['\u06F1\u06F2\u06F0\u06F0', 120000],
      [' $ 1,200 ', 120000],
      ['\u20AA100', 10000],
      ['100 USD', 10000],
      ['usd 100', 10000],
      ['US$1,200', 120000],
      ['\u200F\u0661\u0660\u0660', 10000],
      ['\u2068100\u2069', 10000],
      ['\u202B100\u202C', 10000],
      ['\u20661,200\u2069 USD', 120000],
      ['1 200', 120000],
      ['1\u00A0200', 120000],
      ['1\u202F200.50', 120050],
      ['-50', -5000],
      ['0.29', 29],
      ['1.01', 101],
    ])('parses %j as %i minor units', (input, expected) => {
      expect(parseAmountInput(input, { currency: 'USD' })).toBe(expected);
    });

    it.each([
      // ambiguous: a comma or space that is not a thousands separator is never guessed at
      '12,5',
      '1.200,50',
      '1,2,3',
      '1.2.3',
      '0,500',
      '100 50',
      '1 2 3',
      // letters other than a currency code are never stripped
      '12a5',
      '2k',
      '1.5k',
      '50%',
      '5 \u0623\u0644\u0641',
      '10O',
      '1e3',
      // more than two decimals is ambiguous for money
      '1.005',
      '100.999',
      // beyond safe integer minor units
      '9'.repeat(400),
      '99999999999999999',
      '',
      '   ',
      'abc',
      '-',
      '.',
      '$',
      // one currency token at most, and only the ones an entry can be in
      '$100 ILS',
      '$100 USD',
      '\u00A3100',
      '100 GBP',
      // longer than any amount anyone types
      '1'.padStart(65, '0'),
    ])('rejects %j', (input) => {
      expect(parseAmountInput(input, { currency: 'USD' })).toBeNull();
    });

    it('reads a long run of spaces before stray text in linear time', () => {
      const pasted = '1' + ' '.repeat(50_000) + 'x';
      const started = performance.now();
      expect(parseAmountInput(pasted, { currency: 'USD' })).toBeNull();
      expect(performance.now() - started).toBeLessThan(100);
    });

    it('rounds extra decimals half-up on the string, never through float math, when asked to', () => {
      expect(parseAmountInput('100.999', { currency: 'USD', maxDecimals: Infinity })).toBe(10100);
      expect(parseAmountInput('1.005', { currency: 'USD', maxDecimals: Infinity })).toBe(101);
      expect(parseAmountInput('0.285', { currency: 'USD', maxDecimals: Infinity })).toBe(29);
      expect(parseAmountInput('100.001', { currency: 'USD', maxDecimals: Infinity })).toBe(10000);
    });

    it('accepts up to 3 decimals for JOD and rejects a 4th, where USD/ILS/EUR cap at 2', () => {
      expect(parseAmountInput('100.123', { currency: 'JOD' })).toBe(100123);
      expect(parseAmountInput('100', { currency: 'JOD' })).toBe(100000);
      expect(parseAmountInput('100.1234', { currency: 'JOD' })).toBeNull();
      // the exact regression this ticket exists to prevent: USD stays capped at 2
      // decimals even though the arithmetic is now exponent-driven, not hardcoded
      expect(parseAmountInput('100.123', { currency: 'USD' })).toBeNull();
    });

    it('rounds extra JOD decimals half-up to 3 places when asked to, mirroring the USD 2-place case', () => {
      expect(parseAmountInput('100.9995', { currency: 'JOD', maxDecimals: Infinity })).toBe(101000);
      expect(parseAmountInput('100.0001', { currency: 'JOD', maxDecimals: Infinity })).toBe(100000);
    });

    it('accepts up to 3 decimals for BHD/OMR and rejects a 4th, where AED/SAR/QAR cap at 2 (MUT-281)', () => {
      expect(parseAmountInput('12.345', { currency: 'BHD' })).toBe(12345);
      expect(parseAmountInput('12.3456', { currency: 'BHD' })).toBeNull();
      expect(parseAmountInput('12.345', { currency: 'OMR' })).toBe(12345);
      expect(parseAmountInput('12.3456', { currency: 'OMR' })).toBeNull();
      expect(parseAmountInput('100.50', { currency: 'AED' })).toBe(10050);
      expect(parseAmountInput('100.505', { currency: 'AED' })).toBeNull();
      expect(parseAmountInput('100.50', { currency: 'SAR' })).toBe(10050);
      expect(parseAmountInput('100.50', { currency: 'QAR' })).toBe(10050);
    });
  });

  describe('amountInputCurrency', () => {
    it.each([
      ['$100', 'USD'],
      ['US$1,200', 'USD'],
      ['100 usd', 'USD'],
      ['\u20AA100', 'ILS'],
      ['100 NIS', 'ILS'],
      ['ils 5', 'ILS'],
      ['\u20AC5', 'EUR'],
      ['5 EUR', 'EUR'],
      ['5 JOD', 'JOD'],
      ['jod 5', 'JOD'],
      ['5 AED', 'AED'],
      ['aed 5', 'AED'],
      ['5 SAR', 'SAR'],
      ['5 QAR', 'QAR'],
      ['5 BHD', 'BHD'],
      ['5 OMR', 'OMR'],
    ])('reads the currency %j names as %s', (input, currency) => {
      expect(amountInputCurrency(input)).toBe(currency);
    });

    it.each(['100', '1,200.50', '', 'abc', '$100 ILS'])('names no currency in %j', (input) => {
      expect(amountInputCurrency(input)).toBeUndefined();
    });
  });

  describe('Arabic-Indic digits in the lenient parsers', () => {
    it('parseAmountToMinor and parseCurrencyInput read Arabic-Indic digits', () => {
      expect(parseAmountToMinor('١٢٠٠', 'USD')).toBe(120000);
      expect(parseCurrencyInput('١٬٢٠٠٫٥٠', 'USD')).toBe(120050);
    });

    it('formatCurrencyInput converts Arabic-Indic digits and separators as you type', () => {
      expect(formatCurrencyInput('١٢.٥')).toBe('12.5');
      expect(formatCurrencyInput('١٢٫٥')).toBe('12.5');
      expect(formatCurrencyInput('۱۲۰۰')).toBe('1200');
    });
  });

  describe('parseCurrencyInput', () => {
    it('should parse clean numbers', () => {
      expect(parseCurrencyInput('100', 'USD')).toBe(10000);
      expect(parseCurrencyInput('100.50', 'USD')).toBe(10050);
    });

    it('should strip currency symbols', () => {
      expect(parseCurrencyInput('$100', 'USD')).toBe(10000);
      expect(parseCurrencyInput('₪100', 'ILS')).toBe(10000);
    });

    it('should handle empty input', () => {
      expect(parseCurrencyInput('', 'USD')).toBe(0);
    });

    it('should handle negative values', () => {
      expect(parseCurrencyInput('-50', 'USD')).toBe(-5000);
    });

    it('parses JOD at 3 decimals instead of 2', () => {
      expect(parseCurrencyInput('100.123', 'JOD')).toBe(100123);
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

  // MUT-169 (D7): every edit saves paidAt date-only. new Date('YYYY-MM-DD') is
  // UTC midnight, which west of UTC is the evening before.
  describe('formatPaymentDate', () => {
    function inTimeZone(timeZone: string, fn: () => void) {
      const savedTz = process.env.TZ;
      process.env.TZ = timeZone;
      try {
        fn();
      } finally {
        if (savedTz === undefined) delete process.env.TZ;
        else process.env.TZ = savedTz;
      }
    }

    it('shows a date-only payment on its own day west of UTC', () => {
      inTimeZone('America/New_York', () => {
        expect(formatPaymentDate('2026-10-13', 'en-US')).toBe('Oct 13, 2026');
      });
    });

    it("shows a timestamped payment on its local day", () => {
      inTimeZone('Asia/Jerusalem', () => {
        expect(formatPaymentDate('2026-10-13T22:30:00.000Z', 'en-US')).toBe('Oct 14, 2026');
      });
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

  // MUT-92 F7: counts go through Intl.RelativeTimeFormat, so they follow
  // CLDR plural rules ("1 week ago"; all six Arabic forms), not one template.
  describe('formatRelativeDate', () => {
    const NOW = new Date('2024-06-15T12:00:00Z');
    const t = vi.fn((key: string) => `[${key}]`);
    const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses the time.today and time.yesterday keys for 0 and 1 days', () => {
      expect(formatRelativeDate('2024-06-15T10:00:00Z', t, 'en-US')).toBe('[time.today]');
      expect(formatRelativeDate('2024-06-14T10:00:00Z', t, 'ar')).toBe('[time.yesterday]');
    });

    it.each([
      [3, '3 days ago'],
      [7, '1 week ago'],
      [14, '2 weeks ago'],
      [45, '1 month ago'],
      [92, '3 months ago'],
      [400, '1 year ago'],
      [731, '2 years ago'],
    ])('EN: %i days → "%s"', (days, expected) => {
      expect(formatRelativeDate(daysBefore(days), t, 'en-US')).toBe(expected);
    });

    it('AR: picks the one, two, few and many forms', () => {
      const relative = new Intl.RelativeTimeFormat('ar', { numeric: 'always' });
      const cases = [
        [7, relative.format(-1, 'week')], // one
        [14, relative.format(-2, 'week')], // two
        [21, relative.format(-3, 'week')], // few
        [335, relative.format(-11, 'month')], // many
      ] as const;

      const results = cases.map(([days]) => formatRelativeDate(daysBefore(days), t, 'ar'));

      expect(results).toEqual(cases.map(([, expected]) => expected));
      expect(new Set(results).size).toBe(cases.length);
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
      // Should match today's *local* calendar date. Comparing with
      // toISOString() (UTC) failed every night between local midnight and
      // the UTC rollover (00:00–03:00 in Asia/Jerusalem).
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
