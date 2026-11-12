import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, apiErrorReason, type MoveExpenseResponse } from '../api/client';
import { profileKey } from '../session/me';
import { expenseKey, invalidateExpenses } from './expenseQueries';
import { invalidateReceipts } from './receiptQueries';

/**
 * MUT-589 (ADR-255): moving a saved expense, with its receipts, to another of the person's profiles. The preview is
 * read when a profile is chosen (the move's own gates, so a refusal shows before Move); the move refreshes both
 * profiles' expenses, summaries, groups and receipts.
 */

export const expenseMovePreviewKey = (profileId: string, expenseId: string, targetProfileId: string) => profileKey(profileId, 'expense', expenseId, 'move-preview', targetProfileId);

export function useExpenseMovePreview(profileId: string, expenseId: string, targetProfileId: string | null) {
  return useQuery({
    queryKey: expenseMovePreviewKey(profileId, expenseId, targetProfileId ?? ''),
    queryFn: ({ signal }) => api.expenseMovePreview(profileId, expenseId, targetProfileId!, signal),
    enabled: targetProfileId !== null,
    // Always the target as it is now: the person is about to confirm against it.
    staleTime: 0,
    retry: false,
  });
}

/** What a refused preview or move tells the person, in the drawer's banner. */
export type ExpenseMoveErrorKey = 'lapsed' | 'noAccess' | 'notOwner' | 'malafat' | 'changed' | 'notReady' | 'gone' | 'failed';

export function expenseMoveErrorOf(error: unknown): ExpenseMoveErrorKey {
  if (!(error instanceof ApiError)) return 'failed';
  const reason = apiErrorReason(error);
  if (error.code === 'SUBSCRIPTION_LAPSED') return 'lapsed';
  if (reason === 'PROFILE_NOT_FOUND') return 'noAccess';
  if (reason === 'NOT_OWNER') return 'notOwner';
  if (reason === 'MALAFAT_PROFILE') return 'malafat';
  if (reason === 'VERSION_MISMATCH') return 'changed';
  if (reason === 'RECEIPT_NOT_READY') return 'notReady';
  if (error.status === 404) return 'gone';
  return 'failed';
}

/** ADR-228 D8 again: the expense is gone from here (404) or a first attempt is still running; its target settles it. */
function maybeMoved(error: unknown): boolean {
  return error instanceof ApiError && (apiErrorReason(error) === 'EXPENSE_NOT_FOUND' || error.code === 'OPERATION_IN_PROGRESS');
}

export interface MoveExpenseInput {
  expenseId: string;
  targetProfileId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export function useMoveExpense(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ expenseId, targetProfileId, expectedVersion, idempotencyKey }: MoveExpenseInput): Promise<MoveExpenseResponse> => {
      try {
        return await api.moveExpense(profileId, expenseId, targetProfileId, expectedVersion, idempotencyKey);
      } catch (error) {
        if (!maybeMoved(error)) throw error;
        const there = await api.expense(targetProfileId, expenseId).catch(() => null);
        if (!there) throw error;
        return { expense: there, fromProfileId: profileId, changes: [] };
      }
    },
    onSuccess: (_result, { expenseId, targetProfileId }) => {
      queryClient.removeQueries({ queryKey: expenseKey(profileId, expenseId) });
      for (const id of [profileId, targetProfileId]) {
        invalidateExpenses(queryClient, id);
        invalidateReceipts(queryClient, id);
      }
      // The Glance reads every profile (MUT-448); it refetches on its next visit anyway.
      void queryClient.invalidateQueries({ queryKey: ['verdict'] });
    },
  });
}
