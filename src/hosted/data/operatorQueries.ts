import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type OperatorAccountView, type OperatorSignupReviewList } from '../api/client';

/**
 * MUT-460: the operator console's reads. The waiting signups refetch when the window regains focus (design 18A), so a
 * tab left open from the digest shows who is waiting now.
 */
export const OPERATOR_SIGNUPS_KEY = ['operator', 'signup-reviews'] as const;

export function useOperatorSignups() {
  return useQuery({
    queryKey: OPERATOR_SIGNUPS_KEY,
    queryFn: ({ signal }) => api.operatorSignupReviews(signal),
    refetchOnWindowFocus: true,
  });
}

/** A decided signup leaves the list at once (design 8A); the list is read again behind it. */
export function dropSignup(queryClient: QueryClient, userId: string): void {
  queryClient.setQueryData<OperatorSignupReviewList>(OPERATOR_SIGNUPS_KEY, (list) => list && { ...list, data: list.data.filter((review) => review.userId !== userId) });
  void queryClient.invalidateQueries({ queryKey: OPERATOR_SIGNUPS_KEY });
}

/** MUT-461: the account search (exact email) and one account. Never the setup link: that lives in the mutation only (12A). */
export const operatorAccountSearchKey = (email: string) => ['operator', 'accounts', 'search', email] as const;
export const operatorAccountKey = (userId: string) => ['operator', 'accounts', userId] as const;

export function useOperatorAccountSearch(email: string) {
  return useQuery({
    queryKey: operatorAccountSearchKey(email),
    queryFn: ({ signal }) => api.operatorAccountSearch(email, signal),
    enabled: email.length > 0,
  });
}

export function useOperatorAccount(userId: string) {
  return useQuery({ queryKey: operatorAccountKey(userId), queryFn: ({ signal }) => api.operatorAccount(userId, signal), refetchOnWindowFocus: true });
}

/** After an action: the account as its answer left it, then read again behind it (counts, last sign-in). */
export function patchOperatorAccount(queryClient: QueryClient, userId: string, patch: Partial<OperatorAccountView['account']>): void {
  queryClient.setQueryData<OperatorAccountView>(operatorAccountKey(userId), (view) => view && { ...view, account: { ...view.account, ...patch } });
  void queryClient.invalidateQueries({ queryKey: operatorAccountKey(userId) });
}
