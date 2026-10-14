import type { UseFormSetError } from 'react-hook-form';
import { ApiError, apiErrorReason } from '../api/client';
import type { HostedExpenseFormValues } from './ExpenseDrawer';

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
  conflict: string;
  network: string;
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
      case 'DATE_INVALID':
        setError('occurredAt', { type: 'manual', message: labels.dateInvalid });
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
