import { describe, it, expect } from 'vitest';
import { schema } from '../conversionFormSchema';

/**
 * Schema-level tests for ConversionDrawer's two independent amount/currency
 * pairs (MUT-141) -- mirrors ExpenseDrawer.schema.test.ts's approach of
 * testing the zod schema directly rather than a full component render,
 * since the real boundary for this logic is the schema's superRefine.
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

describe('ConversionDrawer amount/currency schema', () => {
  it('accepts a valid two-currency conversion', () => {
    const result = schema.safeParse(baseFields());
    expect(result.success).toBe(true);
  });

  it('accepts a JOD amount with 3 decimal places on the from side', () => {
    const result = schema.safeParse(baseFields({ fromCurrency: 'JOD', fromAmount: '100.123' }));
    expect(result.success).toBe(true);
  });

  it('accepts a JOD amount with 3 decimal places on the to side', () => {
    const result = schema.safeParse(baseFields({ toCurrency: 'JOD', toAmount: '100.123' }));
    expect(result.success).toBe(true);
  });

  it('rejects a 4th decimal place on the from side even when the to side is valid', () => {
    const result = schema.safeParse(baseFields({ fromAmount: '100.1234' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAmount');
      expect(issue?.message).toBe('Amount is invalid');
    }
  });

  it('rejects a 3rd decimal place on the to side for a non-JOD currency even when the from side is valid', () => {
    const result = schema.safeParse(baseFields({ toAmount: '91.123' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'toAmount');
      expect(issue?.message).toBe('Amount is invalid');
    }
  });

  it('rejects a non-positive from-amount', () => {
    const result = schema.safeParse(baseFields({ fromAmount: '0' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'fromAmount');
      expect(issue?.message).toBe('Amount must be positive');
    }
  });

  it('rejects a non-positive to-amount', () => {
    const result = schema.safeParse(baseFields({ toAmount: '-5' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'toAmount');
      expect(issue?.message).toBe('Amount must be positive');
    }
  });

  it('rejects converting a currency to itself', () => {
    const result = schema.safeParse(baseFields({ fromCurrency: 'USD', toCurrency: 'USD' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'toCurrency');
      expect(issue?.message).toBe('Choose a different currency to convert to');
    }
  });

  it('requires a date', () => {
    const result = schema.safeParse(baseFields({ occurredAt: '' }));
    expect(result.success).toBe(false);
  });

  it('allows an optional note', () => {
    const result = schema.safeParse(baseFields({ notes: 'Moved savings for Q1 rent' }));
    expect(result.success).toBe(true);
  });
});
