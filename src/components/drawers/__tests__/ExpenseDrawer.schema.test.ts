import { describe, it, expect } from 'vitest';
import { schema } from '../expenseDrawerFormSchema';

/**
 * Schema-level tests for ExpenseDrawer's amount/currency cross-field
 * validation (MUT-140) -- ExpenseDrawer's amount field previously had no
 * format/precision check at all (just non-empty), unlike IncomeDrawer's.
 * Tested directly against the zod schema, not a full component render --
 * ExpenseDrawer has no existing component test harness, and the real
 * boundary for this logic is the schema's superRefine, not the DOM.
 */
function baseFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    expenseType: 'onetime',
    profileId: 'p1',
    amount: '100',
    currency: 'USD',
    occurredAt: '2024-01-15',
    categoryId: 'c1',
    ...overrides,
  };
}

describe('ExpenseDrawer amount/currency schema', () => {
  it('accepts a JOD amount with 3 decimal places', () => {
    const result = schema.safeParse(baseFields({ currency: 'JOD', amount: '100.123' }));
    expect(result.success).toBe(true);
  });

  it('rejects a JOD amount with a 4th decimal place', () => {
    const result = schema.safeParse(baseFields({ currency: 'JOD', amount: '100.1234' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'amount');
      expect(issue?.message).toBe('Amount is invalid');
    }
  });

  it('rejects a USD amount with a 3rd decimal place', () => {
    const result = schema.safeParse(baseFields({ currency: 'USD', amount: '100.123' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'amount');
      expect(issue?.message).toBe('Amount is invalid');
    }
  });

  it('accepts a USD amount with 2 decimal places', () => {
    const result = schema.safeParse(baseFields({ currency: 'USD', amount: '100.12' }));
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive amount for any currency', () => {
    const result = schema.safeParse(baseFields({ currency: 'JOD', amount: '0' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'amount');
      expect(issue?.message).toBe('Amount must be positive');
    }
  });

  it('still enforces the recurring-type cross-field checks (regression)', () => {
    const result = schema.safeParse(baseFields({ expenseType: 'recurring' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('title');
      expect(paths).toContain('frequency');
      expect(paths).toContain('startDate');
      expect(paths).toContain('endMode');
    }
  });
});
