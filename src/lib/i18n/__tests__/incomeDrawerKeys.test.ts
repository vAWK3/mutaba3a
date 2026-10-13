import { describe, it, expect } from 'vitest';
import en from '../translations/en.json';
import ar from '../translations/ar.json';

// MUT-5: the income drawer's fast path must be fully translated in both locales
const KEYS = [
  'drawer.income.titleLabel',
  'drawer.income.titlePlaceholder',
  'drawer.income.statusLabel',
  'drawer.income.moreDetails',
  'drawer.income.lessDetails',
  'drawer.income.paymentsRecordedHint',
  'drawer.income.currencyLockedHint',
  'drawer.income.savePaymentsChanged',
  'drawer.income.saveFailed',
  'drawer.income.paymentsLoadFailed',
  'drawer.income.paymentsRetry',
  'drawer.income.chooseBusinessFirst',
  'drawer.income.lastPayment',
  'drawer.income.saveBeforePayment',
  'transactions.partialPayment.loadFailed',
  'transactions.partialPayment.choosePayment',
  'validation.amountInvalid',
  'validation.amountPositive',
  'validation.amountBelowRecorded',
  'validation.clientNotPicked',
  'validation.amountCurrencyMismatch',
] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('income drawer i18n keys', () => {
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

  // MUT-169: the last-payment line names its date
  it('keeps the {date} placeholder in both locales', () => {
    for (const dict of [en, ar]) expect(lookup(dict, 'drawer.income.lastPayment')).toContain('{date}');
  });

  it('keeps the {amount} placeholder in both locales', () => {
    expect(lookup(en, 'validation.amountBelowRecorded')).toContain('{amount}');
    expect(lookup(ar, 'validation.amountBelowRecorded')).toContain('{amount}');
  });

  it('keeps the {typed} and {currency} placeholders in both locales', () => {
    for (const dict of [en, ar]) {
      expect(lookup(dict, 'validation.amountCurrencyMismatch')).toContain('{typed}');
      expect(lookup(dict, 'validation.amountCurrencyMismatch')).toContain('{currency}');
    }
  });
});
