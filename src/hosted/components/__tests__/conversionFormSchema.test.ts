import { describe, it, expect } from 'vitest';
import { conversionFormSchema, impliedRate } from '../conversionFormSchema';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
}

/**
 * Hosted conversion drawer schema (MUT-161) — mirrors the local app's own
 * conversionFormSchema.test.ts shape. MUT-194 (D7, closes TD-117): JOD joins
 * USD/ILS/EUR, and each leg's decimal places follow its own currency.
 */
function baseFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    fromAmount: '100',
    fromCurrency: 'USD',
    toAmount: '91.20',
    toCurrency: 'EUR',
    occurredAt: '2024-01-15',
    ...overrides,
  };
}

describe('hosted conversion drawer schema', () => {
  // The schema carries i18n keys, rendered with t() where they show (profileFormSchema's pattern), so Arabic readers get Arabic.
  it('reports a bad amount as the amountInvalid key, on each leg', () => {
    const from = conversionFormSchema.safeParse(baseFields({ fromAmount: '100.123' }));
    const to = conversionFormSchema.safeParse(baseFields({ toAmount: '91.123' }));
    const keyOf = (r: typeof from, path: string) => !r.success && r.error.issues.find((i) => i.path.join('.') === path)?.message;
    expect(keyOf(from, 'fromAmount')).toBe('hosted.conversions.errors.amountInvalid');
    expect(keyOf(to, 'toAmount')).toBe('hosted.conversions.errors.toAmountInvalid');
  });

  it('reports a missing amount or date as i18n keys that exist in both languages, not English text', () => {
    const result = conversionFormSchema.safeParse(baseFields({ fromAmount: '', toAmount: '', occurredAt: '' }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const byPath = Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
    expect(byPath.fromAmount).toBe('hosted.income.errors.amountRequired');
    expect(byPath.toAmount).toBe('hosted.income.errors.amountRequired');
    expect(byPath.occurredAt).toBe('hosted.conversions.errors.dateInvalid');
    for (const key of Object.values(byPath)) {
      expect(lookup(en, key), `en ${key}`).toBeTypeOf('string');
      expect(lookup(ar, key), `ar ${key}`).toBeTypeOf('string');
    }
  });

  it('accepts a valid two-currency conversion', () => {
    expect(conversionFormSchema.safeParse(baseFields()).success).toBe(true);
  });

  it('rejects a 3rd decimal place on either side', () => {
    const from = conversionFormSchema.safeParse(baseFields({ fromAmount: '100.123' }));
    expect(from.success).toBe(false);
    const to = conversionFormSchema.safeParse(baseFields({ toAmount: '91.123' }));
    expect(to.success).toBe(false);
  });

  // Positivity is not checked client-side, matching the hosted expense drawer's own
  // schema (expenseFormFieldsSchema.amount): the server's 422 AMOUNT_INVALID bounces
  // back through applyConversionApiError onto the right field instead.
  it('rejects a negative amount at the regex (no leading minus matches DECIMAL_AMOUNT)', () => {
    expect(conversionFormSchema.safeParse(baseFields({ toAmount: '-5.00' })).success).toBe(false);
  });

  it('rejects converting a currency to itself, on the toCurrency field', () => {
    const result = conversionFormSchema.safeParse(baseFields({ fromCurrency: 'USD', toCurrency: 'USD' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'toCurrency');
      expect(issue?.message).toBe('hosted.conversions.errors.sameCurrency');
    }
  });

  it('requires a date', () => {
    expect(conversionFormSchema.safeParse(baseFields({ occurredAt: '' })).success).toBe(false);
  });

  it('allows an optional note', () => {
    expect(conversionFormSchema.safeParse(baseFields({ notes: 'Moved savings for Q1 rent' })).success).toBe(true);
  });
});

describe('hosted conversion drawer schema: JOD and per-leg precision (MUT-194, D7)', () => {
  it('accepts JOD on either leg', () => {
    expect(conversionFormSchema.safeParse(baseFields({ fromCurrency: 'JOD', fromAmount: '70.9' })).success).toBe(true);
    expect(conversionFormSchema.safeParse(baseFields({ toCurrency: 'JOD', toAmount: '70.9' })).success).toBe(true);
  });

  it('accepts 3 decimals on a JOD leg and refuses 4', () => {
    expect(conversionFormSchema.safeParse(baseFields({ fromCurrency: 'JOD', fromAmount: '70.925' })).success).toBe(true);
    expect(conversionFormSchema.safeParse(baseFields({ toCurrency: 'JOD', toAmount: '70.925' })).success).toBe(true);
    const from = conversionFormSchema.safeParse(baseFields({ fromCurrency: 'JOD', fromAmount: '70.9251' }));
    expect(from.success).toBe(false);
    if (!from.success) expect(from.error.issues.map((i) => i.path.join('.'))).toEqual(['fromAmount']);
    const to = conversionFormSchema.safeParse(baseFields({ toCurrency: 'JOD', toAmount: '70.9251' }));
    expect(to.success).toBe(false);
    if (!to.success) expect(to.error.issues.map((i) => i.path.join('.'))).toEqual(['toAmount']);
  });

  it('precision follows each leg\'s own currency: USD with 3 decimals is refused even when the other leg is JOD', () => {
    const result = conversionFormSchema.safeParse(baseFields({ fromCurrency: 'USD', fromAmount: '100.125', toCurrency: 'JOD', toAmount: '70.925' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toEqual(['fromAmount']);
  });

  it('still refuses JOD to JOD', () => {
    const result = conversionFormSchema.safeParse(baseFields({ fromCurrency: 'JOD', toCurrency: 'JOD' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((i) => i.path.join('.') === 'toCurrency')).toBe(true);
  });

  it('computes an implied rate across a JOD leg', () => {
    expect(impliedRate('100', 'USD', '70.900', 'JOD')).toBeCloseTo(0.709, 5);
  });
});

describe('impliedRate', () => {
  it('computes the ratio from two decimal amounts', () => {
    expect(impliedRate('100', 'USD', '91.20', 'EUR')).toBeCloseTo(0.912, 5);
  });

  it('is null while either side is not yet parseable', () => {
    expect(impliedRate('', 'USD', '91.20', 'EUR')).toBeNull();
    expect(impliedRate('100', 'USD', '', 'EUR')).toBeNull();
  });

  it('is null for a non-positive source amount', () => {
    expect(impliedRate('0', 'USD', '91.20', 'EUR')).toBeNull();
  });
});
