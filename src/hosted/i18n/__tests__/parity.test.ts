import { describe, it, expect } from 'vitest';
import en from '../en.json';
import ar from '../ar.json';
import { parityProblems } from '../../../test/i18nParity';

/** hosted-portal.md §7.7, checked by the shared `parityProblems` (src/test/i18nParity.ts). */

describe('hosted i18n', () => {
  it('has en/ar parity across the whole portal dictionary', () => {
    expect(parityProblems(en, ar)).toEqual([]);
  });

  it('has only `common` and `hosted` at the top level', () => {
    expect(Object.keys(en).sort()).toEqual(['common', 'hosted']);
  });
});
