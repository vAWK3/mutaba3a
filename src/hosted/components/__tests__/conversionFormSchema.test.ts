import { describe, it, expect } from 'vitest';
import { conversionFormSchema, impliedRate } from '../conversionFormSchema';

/**
 * Hosted conversion drawer schema (MUT-161) — mirrors the local app's own
 * conversionFormSchema.test.ts shape, scoped to the portal's current
 * currency set (USD/ILS/EUR, no JOD yet — a pre-existing hosted gap this
 * ticket doesn't extend, matching the hosted expense drawer).
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
      expect(issue?.message).toBe('Choose a different currency to convert to');
    }
  });

  it('requires a date', () => {
    expect(conversionFormSchema.safeParse(baseFields({ occurredAt: '' })).success).toBe(false);
  });

  it('allows an optional note', () => {
    expect(conversionFormSchema.safeParse(baseFields({ notes: 'Moved savings for Q1 rent' })).success).toBe(true);
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
