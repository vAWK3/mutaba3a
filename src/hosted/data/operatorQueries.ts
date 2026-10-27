import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type OperatorSignupReviewList } from '../api/client';

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
