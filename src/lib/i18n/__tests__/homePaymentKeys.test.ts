import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';

// MUT-82: the Undo toast after a payment recorded from Home, and its failure
// message, exist in both locales with their placeholders.
const KEYS = ['overview.paymentRecorded', 'overview.paymentRecordedNoClient', 'overview.undoFailed'] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('Home payment i18n keys', () => {
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
  ])('%s keeps the placeholders', (_locale, dict) => {
    expect(lookup(dict, 'overview.paymentRecorded')).toContain('{amount}');
    expect(lookup(dict, 'overview.paymentRecorded')).toContain('{client}');
    expect(lookup(dict, 'overview.paymentRecordedNoClient')).toContain('{amount}');
  });
});
