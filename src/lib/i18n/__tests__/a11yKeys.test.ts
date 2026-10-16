import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';

// TD-009: the accessible names added for the axe fixes exist in both locales
const KEYS = [
  'common.actions',
  'common.close',
  'filters.period',
  'filters.periodFrom',
  'filters.periodTo',
  'settings.profile.actionsFor',
] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('accessible-name i18n keys', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s has every key as non-empty text', (_locale, dict) => {
    for (const key of KEYS) {
      const value = lookup(dict, key);
      expect(typeof value, key).toBe('string');
      expect(String(value).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps the {name} placeholder in both locales', () => {
    expect(lookup(en, 'settings.profile.actionsFor')).toContain('{name}');
    expect(lookup(ar, 'settings.profile.actionsFor')).toContain('{name}');
  });
});
