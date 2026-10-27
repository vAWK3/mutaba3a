import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, type OperatorAccountView, type OperatorFirmRequestList, type OperatorSignupReviewList } from '../api/client';

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

/** MUT-462 (14A): an account's billing grants, newest first. */
export const operatorBillingGrantsKey = (userId: string) => ['operator', 'accounts', userId, 'billing-grants'] as const;

export function useOperatorBillingGrants(userId: string) {
  return useQuery({ queryKey: operatorBillingGrantsKey(userId), queryFn: ({ signal }) => api.operatorBillingGrants(userId, signal) });
}

/** After a grant or a revoke: the grants and the account (its profiles' billing) are read again. */
export function refreshOperatorBilling(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: operatorBillingGrantsKey(userId) });
  void queryClient.invalidateQueries({ queryKey: operatorAccountKey(userId), exact: true });
}

/** MUT-462 (16A): the pending firm requests, oldest first, read again when the window regains focus (as Signups). */
export const OPERATOR_FIRM_REQUESTS_KEY = ['operator', 'firm-requests'] as const;
export const operatorFirmRequestKey = (organizationId: string) => [...OPERATOR_FIRM_REQUESTS_KEY, organizationId] as const;

export function useOperatorFirmRequests() {
  return useQuery({ queryKey: OPERATOR_FIRM_REQUESTS_KEY, queryFn: ({ signal }) => api.operatorFirmRequests(signal), refetchOnWindowFocus: true });
}

/** One request with its members, read when Enable opens the owner picker. */
export function useOperatorFirmRequest(organizationId: string) {
  return useQuery({ queryKey: operatorFirmRequestKey(organizationId), queryFn: ({ signal }) => api.operatorFirmRequest(organizationId, signal), retry: false });
}

/** A decided request leaves the list at once; the list is read again behind it. */
export function dropFirmRequest(queryClient: QueryClient, organizationId: string): void {
  queryClient.setQueryData<OperatorFirmRequestList>(OPERATOR_FIRM_REQUESTS_KEY, (list) => list && { ...list, data: list.data.filter((r) => r.organizationId !== organizationId) });
  queryClient.removeQueries({ queryKey: operatorFirmRequestKey(organizationId) });
  void queryClient.invalidateQueries({ queryKey: OPERATOR_FIRM_REQUESTS_KEY, exact: true });
}
