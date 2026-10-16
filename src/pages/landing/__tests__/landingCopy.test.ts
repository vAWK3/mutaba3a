import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';
import { CURRENCY_NAME_KEYS } from '../landingCopy';

type Tree = { [key: string]: string | Tree };

function leafKeys(tree: Tree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : leafKeys(value, `${prefix}${key}.`)
  );
}

describe('landing copy', () => {
  it('has the same landing keys in English and Arabic', () => {
    const enKeys = leafKeys((en as unknown as Tree).landing as Tree, 'landing.').sort();
    const arKeys = leafKeys((ar as unknown as Tree).landing as Tree, 'landing.').sort();
    expect(arKeys).toEqual(enKeys);
  });

  it('names every supported currency', () => {
    expect(Object.keys(CURRENCY_NAME_KEYS).sort()).toEqual(['EUR', 'ILS', 'JOD', 'USD']);
  });
});
