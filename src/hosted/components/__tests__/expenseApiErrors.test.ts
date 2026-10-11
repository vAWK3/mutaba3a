import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { applyExpenseApiError, type ExpenseErrorLabels } from '../expenseApiErrors';

const labels: ExpenseErrorLabels = {
  categoryArchived: 'category-archived',
  customerNotFound: 'customer-not-found',
  projectNotFound: 'project-not-found',
  projectCustomerMismatch: 'project-customer-mismatch',
  amountInvalid: 'amount-invalid',
  dateInvalid: 'date-invalid',
  conflict: 'conflict',
  network: 'network',
};

function validation(reason: string) {
  return new ApiError(422, 'VALIDATION_FAILED', 'm', { reason });
}

describe('applyExpenseApiError', () => {
  it.each([
    ['CATEGORY_NOT_FOUND', 'categoryId', 'category-archived'],
    ['CATEGORY_ARCHIVED', 'categoryId', 'category-archived'],
    ['CUSTOMER_NOT_FOUND', 'clientId', 'customer-not-found'],
    ['PROJECT_NOT_FOUND', 'projectId', 'project-not-found'],
    ['PROJECT_CUSTOMER_MISMATCH', 'projectId', 'project-customer-mismatch'],
    ['AMOUNT_INVALID', 'amount', 'amount-invalid'],
    ['DATE_INVALID', 'occurredAt', 'date-invalid'],
  ] as const)('maps %s onto the %s field', (reason, field, message) => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyExpenseApiError(validation(reason), setError, labels, showToast);
    expect(setError).toHaveBeenCalledWith(field, { type: 'manual', message });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('toasts an unrecognised validation reason rather than silently dropping it', () => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyExpenseApiError(validation('SOMETHING_NEW'), setError, labels, showToast);
    expect(setError).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('network');
  });

  it('toasts a 409 CONFLICT (stale If-Match) rather than a field error', () => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyExpenseApiError(new ApiError(409, 'CONFLICT', 'm', { reason: 'VERSION_MISMATCH' }), setError, labels, showToast);
    expect(setError).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('conflict');
  });

  it('toasts a network error', () => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyExpenseApiError(new ApiError(0, 'NETWORK', 'm'), setError, labels, showToast);
    expect(showToast).toHaveBeenCalledWith('network');
  });

  it('toasts a non-ApiError (e.g. a thrown programming error) rather than crashing', () => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyExpenseApiError(new Error('boom'), setError, labels, showToast);
    expect(setError).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('network');
  });
});
