/**
 * Unified mutation wrapper that provides automatic toast feedback
 * for success and error states across all mutation hooks.
 */

import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useToastStore } from '../lib/toastStore';

export interface MutationWithFeedbackOptions<TData, TError, TVariables> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successMessage?: string;
  errorMessage?: string;
  invalidateKeys?: QueryKey[];
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: TError) => void;
}

export function useMutationWithFeedback<TData = unknown, TError = Error, TVariables = void>({
  mutationFn,
  successMessage,
  errorMessage,
  invalidateKeys,
  onSuccess,
  onError,
}: MutationWithFeedbackOptions<TData, TError, TVariables>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      if (invalidateKeys) {
        invalidateKeys.forEach(key =>
          queryClient.invalidateQueries({ queryKey: key })
        );
      }
      if (successMessage) {
        try {
          const { addToast } = useToastStore.getState();
          addToast({ message: successMessage, type: 'success', duration: 3000 });
        } catch { /* never crash the mutation */ }
      }
      onSuccess?.(data, variables);
    },
    onError: (error: TError) => {
      try {
        const message = getErrorMessage(error, errorMessage);
        const { addToast } = useToastStore.getState();
        addToast({ message, type: 'error', duration: 5000 });
      } catch {
        // Toast store error should never crash the mutation
      }
      onError?.(error);
    },
  });
}

/**
 * Wraps raw useMutation options with automatic error toast.
 * Used by expense/retainer/recurring hooks that need the full useMutation API.
 * Preserves all original options and types, only adds onError handling.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withErrorToast<T extends Record<string, any>>(opts: T): T {
  const originalOnError = opts.onError;
  return {
    ...opts,
    onError: (error: unknown, ...rest: unknown[]) => {
      try {
        const message = getErrorMessage(error);
        const { addToast } = useToastStore.getState();
        addToast({ message, type: 'error', duration: 5000 });
      } catch { /* never crash */ }
      originalOnError?.(error, ...rest);
    },
  };
}

function getErrorMessage(error: unknown, fallback?: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: string }).message;
    // TransactionLockedError: make it user-friendly
    if (msg.includes('locked by document')) {
      const docMatch = msg.match(/document\s+(\S+)/);
      return docMatch
        ? `Transaction is locked by document ${docMatch[1]}. Unlock the document first.`
        : 'Transaction is locked. Unlock the linked document first.';
    }
    // PartialPaymentError: already has good messages
    if (msg.includes('Payment amount') || msg.includes('Partial payments') || msg.includes('already fully paid')) {
      return msg;
    }
  }
  return fallback || 'Operation failed. Please try again.';
}
