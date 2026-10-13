import { describe, it, expect } from 'vitest';
import en from '../translations/en.json';
import ar from '../translations/ar.json';

// MUT-92: the craft-fix bundle's string changes, checked in EN and AR.

const LOCALES = [
  ['en', en],
  ['ar', ar],
] as const;

/** Keys the bundle retired: the UI no longer renders them in either language. */
const REMOVED_KEYS = [
  // F5: provenance, not notes, so the Payments table stopped printing them
  'clients.profile.payments.recordedOnEntry',
  'transactions.partialPayment.migratedNote',
] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

function allValues(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (node && typeof node === 'object') return Object.values(node).flatMap(allValues);
  return [];
}

describe('craft-fix i18n keys (MUT-92)', () => {
  it.each(LOCALES)('%s never calls the product "Mini CRM" (F9)', (_locale, dict) => {
    for (const value of allValues(dict)) {
      expect(value).not.toMatch(/mini[\s-]?crm/i);
    }
  });

  it('names the product in About in both languages (F9)', () => {
    expect(lookup(en, 'settings.about.name')).toBe('Mutaba3a');
    expect(lookup(ar, 'settings.about.name')).toBe('متابعة');
  });

  it.each(LOCALES)('%s no longer carries the retired keys', (_locale, dict) => {
    for (const key of REMOVED_KEYS) {
      expect(lookup(dict, key), key).toBeUndefined();
    }
  });
});
