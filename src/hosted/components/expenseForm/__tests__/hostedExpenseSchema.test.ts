import { describe, it, expect } from 'vitest';
import { hostedExpenseSchema } from '../useHostedExpenseForm';
import en from '../../../i18n/en.json';
import ar from '../../../i18n/ar.json';

function lookup(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
}

const valid = {
  amount: '10',
  currency: 'USD',
  occurredAt: '2024-01-15',
  categoryId: 'cat-1',
  vatTreatment: '',
  vatRate: '',
  allocationNumber: '',
};

describe('hosted expense schema messages', () => {
  it('reports an empty amount as an i18n key that exists in en and ar', () => {
    const result = hostedExpenseSchema.safeParse({ ...valid, amount: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => i.path[0] === 'amount')?.message ?? '';
    expect(message).toBe('hosted.income.errors.amountRequired');
    expect(lookup(en, message)).toBeTypeOf('string');
    expect(lookup(ar, message)).toBeTypeOf('string');
  });

  it('reports a too-precise amount as an i18n key that exists in en and ar', () => {
    const result = hostedExpenseSchema.safeParse({ ...valid, amount: '10.123' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = result.error.issues.find((i) => i.path[0] === 'amount')?.message ?? '';
    expect(message).toBe('hosted.expenses.errors.amountInvalid');
    expect(lookup(en, message)).toBeTypeOf('string');
    expect(lookup(ar, message)).toBeTypeOf('string');
  });
});
