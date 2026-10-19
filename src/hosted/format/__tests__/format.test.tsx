import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../../lib/i18n/core';
import { DecimalAmount, formatDecimal, isZeroDecimal } from '../DecimalAmount';
import { formatDay, formatInstant, formatSize, MONEY_DATE_FLOOR_DAYS, moneyDateFloor, todayInZone, todayLocalISO } from '../dates';

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
  // MUT-109: a plain <bdi> (dir=auto). The Arabic string's leading RLM resolves it right to left,
  // the order Arabic amounts have always had on screen; dir="ltr" would flip them.
  it('isolates the amount in a plain <bdi> inside right-to-left text', () => {
    render(
      <I18nProvider translations={{ en: {}, ar: {} }} language="ar" setLanguage={() => {}}>
        <p>
          المبلغ <DecimalAmount value="-15.00" currency="USD" />
        </p>
      </I18nProvider>,
    );
    const amount = screen.getByText(/15\.00/);
    expect(amount.tagName).toBe('BDI');
    expect(amount).not.toHaveAttribute('dir');
    expect(amount.textContent?.startsWith('\u200F')).toBe(true);
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

  // MUT-227 (ADR-086): the earliest date the server takes, shown by the re-date drawer.
  it('puts the money-date floor 3660 calendar days before the profile today', () => {
    expect(MONEY_DATE_FLOOR_DAYS).toBe(3660);
    expect(moneyDateFloor('2026-10-16')).toBe('2016-10-08');
    expect(moneyDateFloor('2026-03-01')).toBe('2016-02-22');
    expect(moneyDateFloor('2024-02-29')).toBe('2014-02-21');
    expect(moneyDateFloor('2036-01-01')).toBe('2025-12-24');
  });

  it('shows a dash for a missing or unreadable instant', () => {
    expect(formatInstant(null, 'en', 'UTC')).toBe('—');
    expect(formatInstant('', 'en', 'UTC')).toBe('—');
    expect(formatInstant('not a date', 'en', 'UTC')).toBe('—');
  });

  it('formats sizes for people', () => {
    expect(formatSize(2048, 'en')).toBe('2 kB');
    expect(formatSize(3 * 1024 * 1024 + 200_000, 'en')).toBe('3.2 MB');
  });
});

describe('todayInZone (MUT-133 R3)', () => {
  // 2026-10-13T22:30Z is already the 14th in Jerusalem (UTC+3) and still the 13th in New York (UTC-4).
  const instant = new Date('2026-10-13T22:30:00Z');

  it('reads the calendar day in a zone ahead of UTC', () => {
    expect(todayInZone('Asia/Jerusalem', instant)).toBe('2026-10-14');
  });

  it('reads the calendar day in a zone behind UTC', () => {
    expect(todayInZone('America/New_York', instant)).toBe('2026-10-13');
  });

  it('turns over exactly at local midnight', () => {
    expect(todayInZone('Asia/Jerusalem', new Date('2026-10-13T20:59:59Z'))).toBe('2026-10-13');
    expect(todayInZone('Asia/Jerusalem', new Date('2026-10-13T21:00:00Z'))).toBe('2026-10-14');
  });

  it('falls back to the browser calendar for a zone Intl does not know', () => {
    expect(todayInZone('Not/AZone', instant)).toBe(todayLocalISO(instant));
  });
});
