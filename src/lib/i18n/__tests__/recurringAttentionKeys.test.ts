import { describe, it, expect } from 'vitest';
import en from '../translations/en.json';
import ar from '../translations/ar.json';

// MUT-87: the Expenses Needs attention rows, their ⋯ menu and the mark-paid drawer
const BASE = 'expenses.recurring.attention';

/** Plain strings and the placeholders each must keep in both locales. */
const STRINGS: Record<string, readonly string[]> = {
  'perPeriod.monthly': ['{amount}'],
  'perPeriod.yearly': ['{amount}'],
  notMarked: ['{months}'],
  actionsFor: ['{title}'],
  hint: [],
  amountFor: ['{month}'],
  skipMonth: ['{month}'],
  snoozeMonth: ['{month}'],
  snoozeWhat: ['{months}'],
  snoozeAfterToday: [],
  quickPicks: [],
  back: [],
  total: [],
  markPaidNone: [],
};

/** Counted strings: CLDR plural objects. English needs one + other, Arabic all six. */
const PLURALS: Record<string, readonly string[]> = {
  markPaidCount: ['{count}'],
  skipAll: [],
  snoozeAll: [],
  confirmSkipAll: ['{title}', '{months}'],
};

const EN_FORMS = ['one', 'other'] as const;
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('Needs attention i18n keys (MUT-87, T29)', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ])('%s has every string, keeping its placeholders', (_locale, dict) => {
    for (const [key, placeholders] of Object.entries(STRINGS)) {
      const value = lookup(dict, `${BASE}.${key}`);
      expect(typeof value, key).toBe('string');
      expect(String(value).trim().length, key).toBeGreaterThan(0);
      for (const placeholder of placeholders) expect(value, key).toContain(placeholder);
    }
  });

  it.each([
    ['en', en, EN_FORMS],
    ['ar', ar, AR_FORMS],
  ] as const)('%s has every plural form of every counted string', (_locale, dict, forms) => {
    for (const [key, placeholders] of Object.entries(PLURALS)) {
      const value = lookup(dict, `${BASE}.${key}`) as Record<string, string> | undefined;
      expect(value, key).toBeTypeOf('object');
      for (const form of forms) {
        const text = value?.[form];
        expect(typeof text, `${key}.${form}`).toBe('string');
        expect(String(text).trim().length, `${key}.${form}`).toBeGreaterThan(0);
        for (const placeholder of placeholders) {
          // A form that names the number in words ("one payment") may drop {count}
          if (placeholder === '{count}' && ['zero', 'one', 'two'].includes(form)) continue;
          expect(text, `${key}.${form}`).toContain(placeholder);
        }
      }
    }
  });

  it('keeps {count} in the English "other" forms that show a number', () => {
    expect(lookup(en, `${BASE}.skipAll.other`)).toContain('{count}');
    expect(lookup(en, `${BASE}.snoozeAll.other`)).toContain('{count}');
  });
});
