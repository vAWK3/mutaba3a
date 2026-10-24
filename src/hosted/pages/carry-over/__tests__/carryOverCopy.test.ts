import { describe, expect, it } from 'vitest';
import en from '../../../i18n/en.json';
import ar from '../../../i18n/ar.json';
import { CHANGE_CODES, NOT_CARRIED_CODES } from '../../../local/carryOver/mapFreeAppBackup';

/** CarryOverDetails builds its keys from the report's codes: a code with no copy would show its raw key. */
describe('the carry-over summary copy', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s has a line for every code', (_language, dictionary) => {
    const { changed, notCarried } = dictionary.hosted.carryOver as { changed: Record<string, string>; notCarried: Record<string, string> };
    expect(CHANGE_CODES.filter((code) => !changed[code])).toEqual([]);
    expect(NOT_CARRIED_CODES.filter((code) => !notCarried[code])).toEqual([]);
  });
});
