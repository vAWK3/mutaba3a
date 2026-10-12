import { describe, it, expect } from 'vitest';
import en from '../translations/en.json';
import ar from '../translations/ar.json';

// MUT-83: the clients index's muted rows and /income's client-scope chip
const TEXT_KEYS = ['income.clientScope.none', 'income.clientScope.archived', 'income.clientScope.clear'] as const;
const PLURAL_KEYS = ['clients.index.bucket.noClient', 'clients.index.bucket.archivedClients'] as const;
const FORMS = { en: ['one', 'other'], ar: ['zero', 'one', 'two', 'few', 'many', 'other'] } as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('owed-index i18n keys', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('%s has every text key', (_locale, dict) => {
    for (const key of TEXT_KEYS) {
      const value = lookup(dict, key);
      expect(typeof value, key).toBe('string');
      expect(String(value).trim().length, key).toBeGreaterThan(0);
    }
    expect(lookup(dict, 'income.clientScope.clear')).toContain('{name}');
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('%s has every plural form of the row labels', (locale, dict) => {
    for (const key of PLURAL_KEYS) {
      for (const form of FORMS[locale]) {
        const value = lookup(dict, `${key}.${form}`);
        expect(typeof value, `${key}.${form}`).toBe('string');
        expect(String(value).trim().length, `${key}.${form}`).toBeGreaterThan(0);
      }
    }
  });
});
