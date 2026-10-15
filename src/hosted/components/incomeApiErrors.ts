import { ApiError, apiErrorReason } from '../api/client';

/**
 * Maps the income/settle error vocabulary (MUT-65, MUT-61) onto the drawers,
 * in applyExpenseApiError's shape: a reason with a clear field owner becomes an
 * inline error there, everything else a toast. Messages are i18n keys. A
 * READ_ONLY_PROFILE (a stale UI: the profile changed under the page) reuses
 * the hosted-portal.md §7.4 sentence for the profile's writer of record.
 *
 * The reason comes from the shared apiErrorReason (MUT-183 R3); fieldOf is
 * still a local copy of conversionApiErrors' helper (TD-125).
 */

export interface FieldError {
  field: string;
  key: string;
  params?: Record<string, string>;
}

export interface MappedError {
  /** Inline errors to set on the form. */
  fields: FieldError[];
  /** A toast message key, when the error has no field owner. */
  toast?: string;
  /** The drawer should re-read the receivable (settle only). */
  reread?: boolean;
}

function fieldOf(error: ApiError): string | undefined {
  const details = error.details as { field?: unknown } | null;
  return typeof details?.field === 'string' ? details.field : undefined;
}

function readOnlyToast(error: ApiError): string {
  const writer = (error.details as { writerOfRecord?: unknown } | null)?.writerOfRecord;
  return writer === 'MALAFAT' ? 'hosted.readOnly.malafat' : 'hosted.readOnly.none';
}

function nonValidation(error: unknown): MappedError | null {
  if (!(error instanceof ApiError) || error.code === 'NETWORK') return { fields: [], toast: 'hosted.income.errors.network' };
  if (error.code === 'READ_ONLY_PROFILE') return { fields: [], toast: readOnlyToast(error) };
  return null;
}

const CUSTOMER_REASONS: Record<string, string> = {
  CUSTOMER_REQUIRED_FOR_OWED: 'hosted.income.errors.clientRequiredOwed',
  CUSTOMER_REQUIRED: 'hosted.income.errors.clientRequired',
  CUSTOMER_NOT_LINKED: 'hosted.income.errors.clientRequired',
  CUSTOMER_NOT_FOUND: 'hosted.income.errors.clientNotFound',
  PROJECT_CUSTOMER_MISMATCH: 'hosted.income.errors.matterMismatch',
};

export function mapIncomeError(error: unknown): MappedError {
  const early = nonValidation(error);
  if (early) return early;
  const apiError = error as ApiError;
  const reason = apiErrorReason(apiError);
  if (apiError.code === 'VALIDATION_FAILED') {
    if (reason === 'AMOUNT_INVALID') return { fields: [{ field: 'amount', key: 'hosted.income.errors.amountInvalid' }] };
    if (reason === 'DATE_INVALID') {
      return { fields: [{ field: fieldOf(apiError) === 'dueDate' ? 'dueDate' : 'occurredOn', key: 'hosted.income.errors.dateFuture' }] };
    }
    if (reason && CUSTOMER_REASONS[reason]) return { fields: [{ field: 'customerId', key: CUSTOMER_REASONS[reason] }] };
    if (reason === 'PROJECT_NOT_FOUND') return { fields: [{ field: 'projectId', key: 'hosted.income.errors.matterNotFound' }] };
  }
  return { fields: [], toast: 'hosted.income.errors.saveFailed' };
}

export function mapSettleError(error: unknown): MappedError {
  const early = nonValidation(error);
  if (early) return early;
  const apiError = error as ApiError;
  const reason = apiErrorReason(apiError);
  if (apiError.code === 'VALIDATION_FAILED') {
    if (reason === 'AMOUNT_INVALID') return { fields: [{ field: 'amount', key: 'hosted.income.errors.amountInvalid' }] };
    if (reason === 'ALLOCATION_EXCEEDS_OUTSTANDING') {
      const outstanding = (apiError.details as { outstanding?: unknown } | null)?.outstanding;
      return {
        fields: [{ field: 'amount', key: 'hosted.settle.errors.exceedsNow', params: { outstanding: typeof outstanding === 'string' ? outstanding : '' } }],
        reread: true,
      };
    }
    if (reason === 'DATE_INVALID') return { fields: [{ field: 'paidAt', key: 'hosted.income.errors.dateFuture' }] };
    if (reason === 'RECEIVABLE_NOT_OPEN') return { fields: [], toast: 'hosted.settle.errors.gone', reread: true };
  }
  if (apiError.code === 'NOT_FOUND') return { fields: [], toast: 'hosted.settle.errors.gone', reread: true };
  if (apiError.code === 'CONFLICT') return { fields: [], toast: 'hosted.settle.errors.changed', reread: true };
  return { fields: [], toast: 'hosted.income.errors.saveFailed' };
}

/**
 * MUT-224: the re-date drawers' errors. A refused date is inline under the date; a stale version (409) or a row that
 * went away (404) re-reads, so the drawer refills or says it's gone; anything else is a toast.
 */
export function mapRedateError(error: unknown): MappedError {
  const early = nonValidation(error);
  if (early) return early;
  const apiError = error as ApiError;
  if (apiError.code === 'VALIDATION_FAILED' && apiErrorReason(apiError) === 'DATE_INVALID') return { fields: [{ field: 'date', key: 'hosted.income.errors.dateFuture' }] };
  if (apiError.code === 'CONFLICT') return { fields: [], toast: 'hosted.redate.conflict', reread: true };
  if (apiError.code === 'NOT_FOUND') return { fields: [], reread: true };
  return { fields: [], toast: 'hosted.income.errors.saveFailed' };
}
