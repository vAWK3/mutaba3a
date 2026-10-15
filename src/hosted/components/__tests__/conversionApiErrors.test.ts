import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { applyConversionApiError, type ConversionErrorLabels } from '../conversionApiErrors';

const labels: ConversionErrorLabels = {
  amountInvalid: 'amount-invalid',
  toAmountInvalid: 'to-amount-invalid',
  dateInvalid: 'date-invalid',
  dateTooOld: 'date-too-old',
  sameCurrency: 'same-currency',
  conflict: 'conflict',
  network: 'network',
};

const dateInvalid = (details: Record<string, unknown>) => new ApiError(422, 'VALIDATION_FAILED', 'm', { reason: 'DATE_INVALID', field: 'occurredOn', ...details });

describe('applyConversionApiError dates (MUT-227)', () => {
  it.each([
    ['the past bound', { bound: 'past' }, 'date-too-old'],
    ['the future bound', { bound: 'future' }, 'date-invalid'],
    ['no bound (an older server, or a malformed date)', {}, 'date-invalid'],
  ] as const)('maps %s onto the date field', (_label, details, message) => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyConversionApiError(dateInvalid(details), setError, labels, showToast);
    expect(setError).toHaveBeenCalledWith('occurredAt', { type: 'manual', message });
    expect(showToast).not.toHaveBeenCalled();
  });
});
