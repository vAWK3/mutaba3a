import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type AccountantGrant, type AccountantGrantList } from '../api/client';
import { profileKey } from '../session/me';

/**
 * MUT-561: the Sharing page's server state, under the profile's keys (`['p', id, 'accountants']`) so a profile switch
 * or sign-out drops it with the rest. No polling: the list refetches on window focus (React Query's default), which
 * keeps "viewed" fresh enough. The Links column's queries come with MUT-560 (slice B).
 */

export const accountantsKey = (profileId: string) => profileKey(profileId, 'accountants');

export function useAccountants(profileId: string) {
  return useQuery({
    queryKey: accountantsKey(profileId),
    queryFn: ({ signal }) => api.listAccountants(profileId, signal),
  });
}

/** Today's list with `grant` in it: an expired invite to the same address is replaced, anything else appended. */
export function withGrant(list: AccountantGrantList | undefined, grant: AccountantGrant): AccountantGrantList | undefined {
  if (!list) return list;
  const same = (item: AccountantGrant) => item.id === grant.id || item.email.toLowerCase() === grant.email.toLowerCase();
  return { ...list, items: [...list.items.filter((item) => !same(item)), grant] };
}

/** Invite (or invite again): the new pending row goes into the list at once, then the list is read again. */
export function useInviteAccountant(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; locale: 'en' | 'ar' }) => api.inviteAccountant(profileId, body),
    onSuccess: (grant) => {
      queryClient.setQueryData<AccountantGrantList>(accountantsKey(profileId), (current) => withGrant(current, grant));
      void queryClient.invalidateQueries({ queryKey: accountantsKey(profileId) });
    },
  });
}

/**
 * Stop access or cancel an invite (D11): the row leaves at once; a failure puts the list back as it was. A 404 is no
 * failure: the grant was already stopped (elsewhere, or the accountant left), so the row stays gone.
 */
export function useRevokeAccountant(profileId: string) {
  const queryClient = useQueryClient();
  const key = accountantsKey(profileId);
  return useMutation({
    mutationFn: (grant: AccountantGrant) => api.revokeAccountant(profileId, grant.id),
    onMutate: async (grant) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<AccountantGrantList>(key);
      queryClient.setQueryData<AccountantGrantList>(key, (current) => current && { ...current, items: current.items.filter((item) => item.id !== grant.id) });
      return { before };
    },
    onError: (error, _grant, context) => {
      const gone = error instanceof ApiError && error.status === 404;
      if (!gone && context?.before) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}
