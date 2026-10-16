import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';

// MUT-86: the Record payment drawer's new strings exist in both locales, and
// the one its single primary button replaced is gone from both.
const KEYS = [
  'transactions.partialPayment.titleLeft',
  'transactions.partialPayment.paidInFull',
  'transactions.partialPayment.stillOwed',
  'transactions.partialPayment.addNote',
] as const;

const REMOVED = ['transactions.partialPayment.markFullyPaid'] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('payment drawer i18n keys', () => {
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

  it('keeps the {amount} placeholder in both locales', () => {
    for (const dict of [en, ar]) {
      expect(lookup(dict, 'transactions.partialPayment.titleLeft')).toContain('{amount}');
      expect(lookup(dict, 'transactions.partialPayment.stillOwed')).toContain('{amount}');
    }
  });

  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s no longer has the removed keys', (_locale, dict) => {
    for (const key of REMOVED) {
      expect(lookup(dict, key), key).toBeUndefined();
    }
  });
});
