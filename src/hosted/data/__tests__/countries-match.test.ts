import { describe, expect, it } from 'vitest';
import { countrySuggestions, foldCountryText, matchCountry } from '../countries';

/** MUT-702 Part B: the typed billing country, matched against our country list in Arabic and English. */
describe('matchCountry', () => {
  it('matches a full name in either language, whatever the case, hamza or «ال»', () => {
    expect(matchCountry('Israel')).toBe('IL');
    expect(matchCountry('  israel ')).toBe('IL');
    expect(matchCountry('فلسطين')).toBe('PS');
    expect(matchCountry('Palestine')).toBe('PS');
    expect(matchCountry('الأردن')).toBe('JO');
    expect(matchCountry('الاردن')).toBe('JO');
    expect(matchCountry('اردن')).toBe('JO');
    expect(matchCountry('Jordan')).toBe('JO');
    expect(matchCountry('JO')).toBe('JO');
  });

  it('a misspelling or a region that isn’t a country is no match', () => {
    expect(matchCountry('Isreal')).toBeNull();
    expect(matchCountry('الضفة')).toBeNull();
    expect(matchCountry('')).toBeNull();
    expect(matchCountry('فلس')).toBeNull();
  });
});

describe('countrySuggestions', () => {
  it('suggests from the first letters, the region first, in the reader’s language', () => {
    expect(countrySuggestions('فلس', 'ar').map((o) => o.code)).toEqual(['PS']);
    expect(countrySuggestions('isr', 'en')).toEqual([{ code: 'IL', name: 'Israel' }]);
    expect(countrySuggestions('isr', 'ar')[0]?.code).toBe('IL');
    expect(countrySuggestions('united', 'en').map((o) => o.code)).toEqual(expect.arrayContaining(['AE', 'GB', 'US']));
  });

  it('nothing for empty text, and nothing for text no name starts with', () => {
    expect(countrySuggestions('', 'en')).toEqual([]);
    expect(countrySuggestions('zzz', 'en')).toEqual([]);
  });

  it('folds Arabic forms', () => {
    expect(foldCountryText('الإمارات')).toBe(foldCountryText('امارات'));
  });
});
