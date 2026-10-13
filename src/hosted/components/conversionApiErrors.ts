import type { UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/client';
import type { ConversionFormValues } from './conversionFormSchema';

/**
 * Maps the MUT-161 error vocabulary onto the drawer, mirroring
 * expenseApiErrors.ts's shape. AMOUNT_INVALID carries which leg failed in
 * `details.field` ('amount' or 'toAmount') since a conversion has two
 * independently-validated amounts, unlike an expense's one.
 */
export interface ConversionErrorLabels {
  amountInvalid: string;
  toAmountInvalid: string;
  dateInvalid: string;
  sameCurrency: string;
  conflict: string;
  network: string;
}

function reasonOf(error: ApiError): string | undefined {
  const details = error.details as { reason?: unknown } | null;
  return typeof details?.reason === 'string' ? details.reason : undefined;
}

function fieldOf(error: ApiError): string | undefined {
  const details = error.details as { field?: unknown } | null;
  return typeof details?.field === 'string' ? details.field : undefined;
}

export function applyConversionApiError(
  error: unknown,
  setError: UseFormSetError<ConversionFormValues>,
  labels: ConversionErrorLabels,
  showToast: (message: string) => void,
): void {
  if (!(error instanceof ApiError)) {
    showToast(labels.network);
    return;
  }

  const reason = reasonOf(error);

  if (error.code === 'VALIDATION_FAILED') {
    switch (reason) {
      case 'AMOUNT_INVALID':
        if (fieldOf(error) === 'toAmount') setError('toAmount', { type: 'manual', message: labels.toAmountInvalid });
        else setError('fromAmount', { type: 'manual', message: labels.amountInvalid });
        return;
      case 'DATE_INVALID':
        setError('occurredAt', { type: 'manual', message: labels.dateInvalid });
        return;
      case 'SAME_CURRENCY':
        setError('toCurrency', { type: 'manual', message: labels.sameCurrency });
        return;
      default:
        showToast(labels.network);
        return;
    }
  }

  if (error.code === 'CONFLICT') {
    showToast(labels.conflict);
    return;
  }

  showToast(labels.network);
}
