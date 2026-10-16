import { describe, it, expect } from 'vitest';
import en, { PARTS as EN_PARTS } from '../translations/en';
import ar, { PARTS as AR_PARTS } from '../translations/ar';
import { composeDictionary } from '../translations/compose';
import { parityProblems } from '../../../test/i18nParity';

/** Every JSON file on disk per language, by its basename. */
function filesOnDisk(glob: Record<string, unknown>): string[] {
  return Object.keys(glob).map((p) => p.split('/').pop()!.replace(/\.json$/, '')).sort();
}

const EN_FILES = filesOnDisk(import.meta.glob('../translations/en/*.json', { eager: true }));
const AR_FILES = filesOnDisk(import.meta.glob('../translations/ar/*.json', { eager: true }));

describe('composeDictionary', () => {
  it('joins the namespaces of every part', () => {
    expect(composeDictionary({ a: { one: { x: '1' } }, b: { two: { y: '2' } } })).toEqual({
      one: { x: '1' },
      two: { y: '2' },
    });
  });

  it('throws, naming both files, when two parts define the same namespace', () => {
    expect(() => composeDictionary({ common: { nav: {} }, shell: { nav: {} } })).toThrow(
      'Namespace "nav" is defined in both common.json and shell.json',
    );
  });
});

describe('app translation files (MUT-24)', () => {
  it.each([
    ['en', EN_PARTS, EN_FILES],
    ['ar', AR_PARTS, AR_FILES],
  ])('%s: every file on disk is composed into the dictionary', (_lang, parts, files) => {
    expect(Object.keys(parts).sort()).toEqual(files);
  });

  it('en and ar have the same files, each holding the same namespaces', () => {
    expect(AR_FILES).toEqual(EN_FILES);
    for (const file of Object.keys(EN_PARTS) as (keyof typeof EN_PARTS)[]) {
      expect(Object.keys(AR_PARTS[file]), file).toEqual(Object.keys(EN_PARTS[file]));
    }
  });

  it('en and ar are in parity: same keys, same {vars}, full plural forms', () => {
    expect(parityProblems(en, ar)).toEqual([]);
  });
});
