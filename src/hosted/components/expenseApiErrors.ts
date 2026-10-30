import type { UseFormSetError } from 'react-hook-form';
import { ApiError, apiErrorBound, apiErrorReason } from '../api/client';
import { VAT_RATE_INVALID, type HostedExpenseFormValues } from './expenseForm/useHostedExpenseForm';

/**
 * Maps the MUT-42 error vocabulary onto the drawer (MUT-44 design brief §6a
 * point 2): a code with a clear field owner becomes an inline error there;
 * everything else (a stale version, the network) becomes a toast. Both
 * `409 CONFLICT` and `422 VALIDATION_FAILED` carry the specific reason in
 * `details.reason`, not in `error.code` itself.
 */
export interface ExpenseErrorLabels {
  categoryArchived: string;
  customerNotFound: string;
  projectNotFound: string;
  projectCustomerMismatch: string;
  amountInvalid: string;
  dateInvalid: string;
  /** MUT-227: the server's ten-year floor (details.bound past). */
  dateTooOld: string;
  /** MUT-392: the server's ten-year ceiling (details.bound future). */
  dateTooFar: string;
  conflict: string;
  network: string;
  /** MUT-361: the lapse gate refused the write (the profile went read-only under the page). */
  lapsed: string;
}

export function applyExpenseApiError(
  error: unknown,
  setError: UseFormSetError<HostedExpenseFormValues>,
  labels: ExpenseErrorLabels,
  showToast: (message: string) => void,
): void {
  if (!(error instanceof ApiError)) {
    showToast(labels.network);
    return;
  }

  if (error.code === 'SUBSCRIPTION_LAPSED') {
    showToast(labels.lapsed);
    return;
  }

  const reason = apiErrorReason(error);

  if (error.code === 'VALIDATION_FAILED') {
    switch (reason) {
      case 'CATEGORY_NOT_FOUND':
      case 'CATEGORY_ARCHIVED':
        setError('categoryId', { type: 'manual', message: labels.categoryArchived });
        return;
      case 'CUSTOMER_NOT_FOUND':
        setError('clientId', { type: 'manual', message: labels.customerNotFound });
        return;
      case 'PROJECT_NOT_FOUND':
        setError('projectId', { type: 'manual', message: labels.projectNotFound });
        return;
      case 'PROJECT_CUSTOMER_MISMATCH':
        setError('projectId', { type: 'manual', message: labels.projectCustomerMismatch });
        return;
      case 'AMOUNT_INVALID':
        setError('amount', { type: 'manual', message: labels.amountInvalid });
        return;
      case 'VAT_RATE_INVALID':
        // MUT-302: the VAT row words its own rate errors from the code (it opens to show it).
        setError('vatRate', { type: 'manual', message: VAT_RATE_INVALID });
        return;
      case 'DATE_INVALID':
        setError('occurredAt', { type: 'manual', message: dateMessage(apiErrorBound(error), labels) });
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

function dateMessage(bound: ReturnType<typeof apiErrorBound>, labels: ExpenseErrorLabels): string {
  if (bound === 'past') return labels.dateTooOld;
  return bound === 'future' ? labels.dateTooFar : labels.dateInvalid;
}
