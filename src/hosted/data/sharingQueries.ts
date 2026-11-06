import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  type AccountantGrant,
  type AccountantGrantList,
  type CreateShareLinkRequest,
  type ShareLink,
  type ShareLinkList,
} from '../api/client';
import { ME_KEY, profileKey } from '../session/me';

/**
 * MUT-561: the Sharing page's server state, under the profile's keys (`['p', id, …]`) so a profile switch or sign-out
 * drops it with the rest. No polling: lists refetch on window focus (React Query's default), which keeps "viewed" and
 * "opened" fresh enough. A share link's URL and PIN never enter the cache (D3): the create answer goes straight to the
 * done pane.
 */

export const accountantsKey = (profileId: string) => profileKey(profileId, 'accountants');
export const shareLinksKey = (profileId: string) => profileKey(profileId, 'shareLinks');
const revokeAccountantKey = (profileId: string) => ['revokeAccountant', profileId] as const;
const revokeShareLinkKey = (profileId: string) => ['revokeShareLink', profileId] as const;

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

/** A write the server refused because the page was stale (a limit, not an owner, gone): read the list and /v1/me again. */
export function refetchAfterRefusal(queryClient: QueryClient, listKey: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey: listKey });
  void queryClient.invalidateQueries({ queryKey: ME_KEY });
}

interface Listed<T> {
  items: T[];
}

const isListed = <T,>(value: unknown): value is Listed<T> => Array.isArray((value as Listed<T> | undefined)?.items);

/**
 * One optimistic list change per item (D11), safe when several run at once: the change applies to the list as it is
 * now; a failure undoes only that item's change, in the list as it is then (never a snapshot that would bring back an
 * item another request already took out); the list is read again only once the last change of its kind has settled,
 * so an early answer never overwrites a later change still in flight. A 404 is no failure: it was already gone.
 */
function useOptimisticItem<T extends { id: string }>(options: {
  queryKey: readonly unknown[];
  mutationKey: readonly unknown[];
  mutationFn: (item: T) => Promise<unknown>;
  apply: (items: T[], item: T) => T[];
  undo: (items: T[], item: T, index: number) => T[];
}) {
  const queryClient = useQueryClient();
  const { queryKey, mutationKey } = options;
  const update = (change: (items: T[]) => T[]) =>
    queryClient.setQueryData(queryKey, (current: unknown) => (isListed<T>(current) ? { ...current, items: change(current.items) } : current));
  return useMutation({
    mutationKey,
    mutationFn: options.mutationFn,
    onMutate: async (item: T) => {
      await queryClient.cancelQueries({ queryKey });
      const current = queryClient.getQueryData(queryKey);
      const index = isListed<T>(current) ? current.items.findIndex((it) => it.id === item.id) : -1;
      update((items) => options.apply(items, item));
      return { index };
    },
    onError: (error, item, context) => {
      if (error instanceof ApiError && error.status === 404) return;
      update((items) => options.undo(items, item, context?.index ?? -1));
    },
    onSettled: () => {
      // This mutation still counts as running while it settles: read the list only when it is the last one.
      if (queryClient.isMutating({ mutationKey }) <= 1) void queryClient.invalidateQueries({ queryKey });
    },
  });
}

/** Put `item` back at `index` (or the end), unless the list has it already. */
function reinsert<T extends { id: string }>(items: T[], item: T, index: number): T[] {
  if (items.some((it) => it.id === item.id)) return items;
  const at = index < 0 || index > items.length ? items.length : index;
  return [...items.slice(0, at), item, ...items.slice(at)];
}

/** Stop access or cancel an invite: the row leaves at once and comes back alone if the server says no. */
export function useRevokeAccountant(profileId: string) {
  return useOptimisticItem<AccountantGrant>({
    queryKey: accountantsKey(profileId),
    mutationKey: revokeAccountantKey(profileId),
    mutationFn: (grant) => api.revokeAccountant(profileId, grant.id),
    apply: (items, grant) => items.filter((it) => it.id !== grant.id),
    undo: (items, grant, index) => reinsert(items, grant, index),
  });
}

// ---- Share links (MUT-560) ------------------------------------------------------------------------------------------

/** `off`: the server answers 404 (SHARE_LINKS off): the Links column hides itself and Accountants takes the page. */
export type ShareLinksState = { off: true } | ({ off: false } & ShareLinkList);

export function useShareLinks(profileId: string) {
  return useQuery({
    queryKey: shareLinksKey(profileId),
    queryFn: async ({ signal }): Promise<ShareLinksState> => {
      try {
        return { off: false, ...(await api.listShareLinks(profileId, signal)) };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return { off: true };
        throw error;
      }
    },
  });
}

/** Make a link. The answer (with its URL) goes to the done pane only; the list is read again, which never has it. */
export function useCreateShareLink(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShareLinkRequest) => api.createShareLink(profileId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: shareLinksKey(profileId) }),
  });
}

/** Turn off: the row reads Ended at once (the server keeps it listed for a day, OW5) and goes back if refused. */
export function useRevokeShareLink(profileId: string) {
  return useOptimisticItem<ShareLink>({
    queryKey: shareLinksKey(profileId),
    mutationKey: revokeShareLinkKey(profileId),
    mutationFn: (link) => api.revokeShareLink(profileId, link.id),
    apply: (items, link) => items.map((it) => (it.id === link.id ? { ...it, status: 'revoked', endedAt: new Date().toISOString() } : it)),
    undo: (items, link) => items.map((it) => (it.id === link.id ? link : it)),
  });
}
