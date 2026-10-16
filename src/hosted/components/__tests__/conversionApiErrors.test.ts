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

describe('applyConversionApiError (MUT-24 §C)', () => {
  const run = (error: unknown) => {
    const setError = vi.fn();
    const showToast = vi.fn();
    applyConversionApiError(error, setError, labels, showToast);
    return { setError, showToast };
  };
  const invalid = (details: Record<string, unknown>) => new ApiError(422, 'VALIDATION_FAILED', 'm', details);

  it('puts a bad amount under the leg the server names', () => {
    expect(run(invalid({ reason: 'AMOUNT_INVALID', field: 'toAmount' })).setError).toHaveBeenCalledWith('toAmount', { type: 'manual', message: 'to-amount-invalid' });
    expect(run(invalid({ reason: 'AMOUNT_INVALID' })).setError).toHaveBeenCalledWith('fromAmount', { type: 'manual', message: 'amount-invalid' });
    expect(run(invalid({ reason: 'AMOUNT_INVALID', field: 42 })).setError).toHaveBeenCalledWith('fromAmount', { type: 'manual', message: 'amount-invalid' });
  });

  it('puts a same-currency conversion on the target currency', () => {
    expect(run(invalid({ reason: 'SAME_CURRENCY' })).setError).toHaveBeenCalledWith('toCurrency', { type: 'manual', message: 'same-currency' });
  });

  it.each([
    ['an unknown validation reason', invalid({ reason: 'SOMETHING_NEW' }), 'network'],
    ['a validation error with no details', new ApiError(422, 'VALIDATION_FAILED', 'm', null), 'network'],
    ['a conflict', new ApiError(409, 'CONFLICT', 'm', null), 'conflict'],
    ['any other API error', new ApiError(500, 'UNKNOWN', 'm', null), 'network'],
    ['a non-API failure', new TypeError('fetch failed'), 'network'],
  ] as const)('toasts %s', (_label, error, message) => {
    const { setError, showToast } = run(error);
    expect(showToast).toHaveBeenCalledWith(message);
    expect(setError).not.toHaveBeenCalled();
  });
});
