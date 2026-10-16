import { describe, it, expect } from 'vitest';
import en from '../en.json';
import ar from '../ar.json';
import appEn from '../../../lib/i18n/translations/en';
import appAr from '../../../lib/i18n/translations/ar';
import { parityProblems } from '../../../test/i18nParity';

/** hosted-portal.md §7.7, checked by the shared `parityProblems` (src/test/i18nParity.ts). */

describe('hosted i18n', () => {
  it('has en/ar parity across the whole portal dictionary', () => {
    expect(parityProblems(en, ar)).toEqual([]);
  });

  it('carries only the app `common` keys its reused components need, with the app’s exact wording', () => {
    for (const [portal, app] of [
      [en.common, appEn.common],
      [ar.common, appAr.common],
    ] as const) {
      for (const [key, value] of Object.entries(portal)) {
        expect(value, `common.${key}`).toBe((app as Record<string, string>)[key]);
      }
    }
  });

  it('has only `common` and `hosted` at the top level', () => {
    expect(Object.keys(en).sort()).toEqual(['common', 'hosted']);
  });
});
