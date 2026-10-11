import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../lib/i18n/core';
import { DecimalAmount, formatDecimal, isZeroDecimal } from '../DecimalAmount';
import { formatDay, formatInstant, formatSize } from '../dates';

describe('formatDecimal', () => {
  it.each([
    ['1234.50', 'ILS', '₪1,234.50'],
    ['-0.01', 'EUR', '-€0.01'],
    ['1000000.00', 'USD', '$1,000,000.00'],
    ['0.10', 'ILS', '₪0.10'],
    ['9007199254740993.01', 'USD', '$9,007,199,254,740,993.01'],
  ] as const)('formats %s %s exactly in English', (value, currency, expected) => {
    expect(formatDecimal(value, currency, 'en')).toBe(expected);
  });

  it('formats in Arabic with the same digits the app uses', () => {
    expect(formatDecimal('1234.50', 'ILS', 'ar')).toContain('1,234.50');
  });

  it('refuses anything that is not a canonical decimal string', () => {
    expect(formatDecimal('1e3', 'USD', 'en')).toBe('—');
    expect(formatDecimal('', 'USD', 'en')).toBe('—');
    expect(formatDecimal('12,50', 'USD', 'en')).toBe('—');
  });

  it('knows every spelling of zero', () => {
    expect(['0', '0.00', '-0.00', '000.0'].every(isZeroDecimal)).toBe(true);
    expect(isZeroDecimal('0.01')).toBe(false);
  });
});

describe('DecimalAmount', () => {
  it('isolates the amount left-to-right inside right-to-left text', () => {
    render(
      <I18nProvider translations={{ en: {}, ar: {} }} language="ar" setLanguage={() => {}}>
        <p>
          المبلغ <DecimalAmount value="-15.00" currency="USD" />
        </p>
      </I18nProvider>,
    );
    const amount = screen.getByText(/15\.00/);
    expect(amount.tagName).toBe('BDI');
    expect(amount).toHaveAttribute('dir', 'ltr');
    expect(amount).toHaveClass('hp-amount-negative');
  });
});

describe('dates', () => {
  it('formats a calendar date as that day, whatever the zone', () => {
    expect(formatDay('2026-01-01', 'en')).toBe('Jan 1, 2026');
    expect(formatDay(null, 'en')).toBe('—');
    expect(formatDay('2026-1-1', 'en')).toBe('—');
  });

  it('formats an instant in the organization zone', () => {
    expect(formatInstant('2026-10-10T22:30:00Z', 'en', 'Asia/Jerusalem')).toBe('Oct 11, 2026');
    expect(formatInstant('2026-10-10T22:30:00Z', 'en', 'UTC')).toBe('Oct 10, 2026');
  });

  it('formats sizes for people', () => {
    expect(formatSize(2048, 'en')).toBe('2 kB');
    expect(formatSize(3 * 1024 * 1024 + 200_000, 'en')).toBe('3.2 MB');
  });
});
