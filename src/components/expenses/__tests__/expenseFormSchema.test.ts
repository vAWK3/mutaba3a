import { describe, it, expect } from 'vitest';
import { expenseFormFieldsSchema, DECIMAL_AMOUNT } from '../expenseFormSchema';

const valid = {
  amount: '12.50',
  currency: 'USD' as const,
  occurredAt: '2026-10-11',
  categoryId: 'cat-1',
};

describe('expenseFormFieldsSchema', () => {
  it('accepts the minimal valid shape', () => {
    expect(expenseFormFieldsSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts optional title/notes when provided', () => {
    const result = expenseFormFieldsSchema.safeParse({ ...valid, title: 'Taxi', notes: 'Client visit' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty amount', () => {
    const result = expenseFormFieldsSchema.safeParse({ ...valid, amount: '' });
    expect(result.success).toBe(false);
  });

  it('does not reject a non-decimal amount string by itself (local behavior, unchanged)', () => {
    // The base schema only checks non-empty — same as local's existing validation.
    // Decimal-shape enforcement is layered on by the hosted-specific schema, not here.
    const result = expenseFormFieldsSchema.safeParse({ ...valid, amount: 'abc' });
    expect(result.success).toBe(true);
  });

  it('rejects a missing category', () => {
    const result = expenseFormFieldsSchema.safeParse({ ...valid, categoryId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown currency', () => {
    const result = expenseFormFieldsSchema.safeParse({ ...valid, currency: 'GBP' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing date', () => {
    const result = expenseFormFieldsSchema.safeParse({ ...valid, occurredAt: '' });
    expect(result.success).toBe(false);
  });
});

describe('DECIMAL_AMOUNT', () => {
  it.each(['0.5', '12', '12.50', '0', '100.1'])('accepts %s', (value) => {
    expect(DECIMAL_AMOUNT.test(value)).toBe(true);
  });

  it.each(['abc', '-1', '1.999', '', '1.', '.5'])('rejects %s', (value) => {
    expect(DECIMAL_AMOUNT.test(value)).toBe(false);
  });
});
