import { describe, it, expect } from 'vitest';
import { schema } from '../incomeFormSchema';

/**
 * Schema-level tests for the amount/currency cross-field validation
 * (MUT-140). Tested directly against the zod schema rather than a full
 * component render -- the real boundary for this logic is the schema's
 * superRefine, not the DOM.
 */
function baseFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    incomeStatus: 'earned',
    profileId: 'p1',
    amount: '100',
    currency: 'USD',
    occurredAt: '2024-01-15',
    ...overrides,
  };
}

describe('IncomeDrawer amount/currency schema', () => {
  it('accepts a JOD amount with 3 decimal places', () => {
    const result = schema.safeParse(baseFields({ currency: 'JOD', amount: '100.123' }));
    expect(result.success).toBe(true);
  });

  it('rejects a JOD amount with a 4th decimal place', () => {
    const result = schema.safeParse(baseFields({ currency: 'JOD', amount: '100.1234' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'amount');
      expect(issue?.message).toBe('validation.amountInvalid');
    }
  });

  it('rejects a USD amount with a 3rd decimal place, unaffected by JOD support', () => {
    const result = schema.safeParse(baseFields({ currency: 'USD', amount: '100.123' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'amount');
      expect(issue?.message).toBe('validation.amountInvalid');
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
      expect(issue?.message).toBe('validation.amountPositive');
    }
  });
});
