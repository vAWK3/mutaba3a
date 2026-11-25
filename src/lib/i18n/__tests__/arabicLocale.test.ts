import { describe, it, expect } from 'vitest';
import { ARABIC_LOCALE, getLocale } from '../core';

// MUT-587: every Arabic date names its month the Levantine way, with Latin digits.
const GREGORIAN_ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

describe('getLocale (MUT-587)', () => {
  it('gives Arabic the Levantine locale with Latin digits, English en-US', () => {
    expect(getLocale('ar')).toBe(ARABIC_LOCALE);
    expect(ARABIC_LOCALE).toBe('ar-PS-u-nu-latn');
    expect(getLocale('en')).toBe('en-US');
  });

  it('names January كانون الثاني, never a Gregorian Arabic month, with Latin digits', () => {
    const long = new Intl.DateTimeFormat(getLocale('ar'), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date('2026-01-15T00:00:00Z'));
    expect(long).toContain('كانون الثاني');
    expect(long).toContain('2026');
    for (const month of GREGORIAN_ARABIC_MONTHS) expect(long).not.toContain(month);
  });

  it('every month of the year reads Levantine', () => {
    const format = new Intl.DateTimeFormat(getLocale('ar'), { month: 'long', timeZone: 'UTC' });
    const names = Array.from({ length: 12 }, (_, m) => format.format(new Date(Date.UTC(2026, m, 1))));
    expect(names).toEqual(['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول']);
  });

  it('keeps numeric dates numeric (Basel, keep numbers)', () => {
    const medium = (locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-11-07T00:00:00Z'));
    expect(medium(getLocale('ar'))).toBe(medium('ar'));
    expect(medium(getLocale('ar')).replace(/\u200f/g, '')).toBe('07/11/2026');
  });

  it('leaves amounts as they were under plain ar', () => {
    const amount = (locale: string) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'ILS' }).format(1234.5);
    expect(amount(getLocale('ar'))).toBe(amount('ar'));
  });
});
