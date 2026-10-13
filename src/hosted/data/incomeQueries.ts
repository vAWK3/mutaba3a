import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateIncomeRequest, type SettleReceivableRequest } from '../api/client';
import { profileKey } from '../session/me';

/**
 * The portal's income hooks (MUT-133), beside expenseQueries.ts. Writes take
 * their Idempotency-Key from the caller's attempt (data/attemptKey.ts), never
 * one minted per click. On success every income figure under the profile is
 * refetched from the server: lists, the receivable itself and the summaries.
 * Nothing is written into the cache ahead of the server.
 */

function invalidateIncome(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  for (const key of ['receivables', 'payments', 'receivable', 'summary'] as const) {
    void queryClient.invalidateQueries({ queryKey: profileKey(profileId, key) });
  }
}

/** One receivable, read fresh each time the Record payment drawer opens (its outstanding must be current). */
export function useReceivable(profileId: string, receivableId: string) {
  return useQuery({
    queryKey: profileKey(profileId, 'receivable', receivableId),
    queryFn: () => api.receivable(profileId, receivableId),
    staleTime: 0,
  });
}

export function useCreateIncome(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateIncomeRequest; idempotencyKey: string }) => api.createIncome(profileId, body, idempotencyKey),
    onSuccess: () => invalidateIncome(queryClient, profileId),
  });
}

/** The settle mutation's key, so the drawer's footer can tell a save is in flight. */
export const settleMutationKey = (profileId: string) => profileKey(profileId, 'settle');

export function useSettleReceivable(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: settleMutationKey(profileId),
    mutationFn: ({ receivableId, body, idempotencyKey }: { receivableId: string; body: SettleReceivableRequest; idempotencyKey: string }) =>
      api.settleReceivable(profileId, receivableId, body, idempotencyKey),
    onSuccess: () => invalidateIncome(queryClient, profileId),
  });
}
