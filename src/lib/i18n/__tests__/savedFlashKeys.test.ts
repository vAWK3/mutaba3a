import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';

// MUT-81: the after-save message (not-visible path) and the Show action.
const KEYS = [
  'savedFlash.saved',
  'savedFlash.incomeSaved',
  'savedFlash.incomeSavedNoClient',
  'savedFlash.paymentSaved',
  'savedFlash.paymentSavedNoClient',
  'savedFlash.show',
] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('Saved-flash i18n keys', () => {
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

  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s keeps the {client} placeholder', (_locale, dict) => {
    expect(lookup(dict, 'savedFlash.incomeSaved')).toContain('{client}');
    expect(lookup(dict, 'savedFlash.paymentSaved')).toContain('{client}');
  });
});
