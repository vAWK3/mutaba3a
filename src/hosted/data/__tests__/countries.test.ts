import { describe, expect, it } from 'vitest';
import { BILLING_COUNTRY_CODES, countryOptions } from '../countries';

/** MUT-362 (design review DR11, DR13): the billing-country list for the Subscribe step. */

describe('countryOptions', () => {
  it('starts with Israel, Palestine, Jordan and the Gulf, then the rest by name', () => {
    const codes = countryOptions('en').map((o) => o.code);
    expect(codes.slice(0, 9)).toEqual(['IL', 'PS', 'JO', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM']);
    const rest = countryOptions('en').slice(9).map((o) => o.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('names Palestine فلسطين / Palestine (DR13), every other country by Intl', () => {
    expect(countryOptions('ar').find((o) => o.code === 'PS')?.name).toBe('فلسطين');
    expect(countryOptions('en').find((o) => o.code === 'PS')?.name).toBe('Palestine');
    expect(countryOptions('en').find((o) => o.code === 'IL')?.name).toBe('Israel');
    expect(countryOptions('ar').find((o) => o.code === 'JO')?.name).toBe(new Intl.DisplayNames(['ar'], { type: 'region' }).of('JO'));
  });

  it('lists every code once, all ISO 3166-1 alpha-2', () => {
    expect(new Set(BILLING_COUNTRY_CODES).size).toBe(BILLING_COUNTRY_CODES.length);
    expect(BILLING_COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(BILLING_COUNTRY_CODES.length).toBeGreaterThan(240);
  });
});
