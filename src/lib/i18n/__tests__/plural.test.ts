import { describe, it, expect } from 'vitest';
import { createTranslator } from '../core';
import { pluralKey, createPluralTranslator } from '../plural';

const DICT = {
  en: { mins: { one: '{count} minute', other: '{count} minutes' }, onlyOther: { other: '{count} things' } },
  ar: {
    mins: {
      zero: 'لا دقائق',
      one: 'دقيقة واحدة',
      two: 'دقيقتان',
      few: '{count} دقائق',
      many: '{count} دقيقة',
      other: '{count} دقيقة',
    },
  },
};

describe('pluralKey', () => {
  it.each([
    ['en', 1, 'one'],
    ['en', 0, 'other'],
    ['en', 3, 'other'],
    ['ar', 0, 'zero'],
    ['ar', 1, 'one'],
    ['ar', 2, 'two'],
    ['ar', 3, 'few'],
    ['ar', 11, 'many'],
    ['ar', 100, 'other'],
  ] as const)('%s %d → %s', (lang, count, category) => {
    expect(pluralKey(lang, count)).toBe(category);
  });
});

describe('tp', () => {
  it('selects the CLDR form and interpolates {count}', () => {
    const tpEn = createPluralTranslator(createTranslator(DICT.en, 'en'), 'en');
    expect(tpEn('mins', 1)).toBe('1 minute');
    expect(tpEn('mins', 3)).toBe('3 minutes');
    const tpAr = createPluralTranslator(createTranslator(DICT.ar, 'ar'), 'ar');
    expect(tpAr('mins', 2)).toBe('دقيقتان');
    expect(tpAr('mins', 3)).toBe('3 دقائق');
    expect(tpAr('mins', 11)).toBe('11 دقيقة');
  });

  it('falls back to "other" when the form is missing', () => {
    const tpEn = createPluralTranslator(createTranslator(DICT.en, 'en'), 'en');
    expect(tpEn('onlyOther', 1)).toBe('1 things');
  });

  it('passes extra vars through alongside count', () => {
    const t = createTranslator({ x: { one: '{count} for {who}', other: '{count} for {who}' } }, 'en');
    expect(createPluralTranslator(t, 'en')('x', 1, { who: 'Nour' })).toBe('1 for Nour');
  });
});
