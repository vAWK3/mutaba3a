import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateIncomeRequest, type CreditRequest, type Payment, type SettleReceivableRequest } from '../api/client';
import { profileKey } from '../session/me';

/**
 * The portal's income hooks (MUT-133), beside expenseQueries.ts. Writes take
 * their Idempotency-Key from the caller's attempt (data/attemptKey.ts), never
 * one minted per click. On success every income figure under the profile is
 * refetched from the server: lists, the receivable itself and the summaries.
 * Nothing is written into the cache ahead of the server.
 */

function invalidateIncome(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  for (const key of ['receivables', 'payments', 'receivable', 'payment', 'paymentsForEntry', 'credits', 'summary'] as const) {
    void queryClient.invalidateQueries({ queryKey: profileKey(profileId, key) });
  }
}

/**
 * One receivable, read fresh each time a drawer opens: Record payment needs its current outstanding, and the
 * re-date drawer (MUT-224) the version it will send in If-Match. `enabled` lets one drawer call both this and
 * usePayment unconditionally and run only the one its kind needs.
 */
export function useReceivable(profileId: string, receivableId: string, enabled = true) {
  return useQuery({
    queryKey: profileKey(profileId, 'receivable', receivableId),
    queryFn: () => api.receivable(profileId, receivableId),
    staleTime: 0,
    enabled,
  });
}

/** MUT-224: one payment, read fresh when the re-date drawer opens (its version goes in If-Match). */
export function usePayment(profileId: string, paymentId: string, enabled = true) {
  return useQuery({
    queryKey: profileKey(profileId, 'payment', paymentId),
    queryFn: () => api.payment(profileId, paymentId),
    staleTime: 0,
    enabled,
  });
}

/** How many of a client's payments the Owed drawer scans for this entry's payment lines (eng review R4). */
export const ENTRY_PAYMENTS_SCAN_LIMIT = 50;

/**
 * MUT-224 (eng review R4): the payments applied to one Owed entry. The API can't list payments by receivable, so this
 * reads the client's first page and keeps those whose allocations name the entry. `complete` is false when that page
 * was full, so the drawer can offer "See payments" instead of claiming there are no others.
 */
export function usePaymentsForEntry(profileId: string, customerId: string, receivableId: string, enabled: boolean) {
  return useQuery({
    queryKey: profileKey(profileId, 'paymentsForEntry', receivableId),
    queryFn: async (): Promise<{ payments: Payment[]; complete: boolean }> => {
      const page = await api.payments(profileId, { customerId, limit: ENTRY_PAYMENTS_SCAN_LIMIT });
      const payments = page.items.filter((p) => p.status === 'POSTED' && p.allocations.some((a) => a.receivableId === receivableId));
      return { payments, complete: page.nextCursor === null };
    },
    enabled,
  });
}

/** MUT-453: what was credited off an Owed entry, newest first (its drawer's history). */
export function useReceivableCredits(profileId: string, receivableId: string, enabled: boolean) {
  return useQuery({
    queryKey: profileKey(profileId, 'credits', receivableId),
    queryFn: () => api.receivableCredits(profileId, receivableId),
    enabled,
  });
}

/** MUT-453: reverse a payment a person recorded; the Owed it paid reopens, so every income figure refetches. */
export function useReversePayment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, reason, idempotencyKey }: { paymentId: string; reason: string; idempotencyKey: string }) =>
      api.reversePayment(profileId, paymentId, { reason }, idempotencyKey),
    onSuccess: () => invalidateIncome(queryClient, profileId),
  });
}

/** MUT-453: reduce or cancel what is owed (a credit); Cancel is a credit of everything left. */
export function useCreditReceivable(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ receivableId, body, idempotencyKey }: { receivableId: string; body: CreditRequest; idempotencyKey: string }) =>
      api.creditReceivable(profileId, receivableId, body, idempotencyKey),
    onSuccess: () => invalidateIncome(queryClient, profileId),
  });
}

/** MUT-224: change an Owed entry's date at the version the drawer loaded. */
export function useRedateOwed(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ receivableId, occurredOn, version }: { receivableId: string; occurredOn: string; version: number }) =>
      api.redateIncome(profileId, receivableId, { occurredOn }, String(version)),
    onSuccess: () => invalidateIncome(queryClient, profileId),
  });
}

/** MUT-224: change a payment's received date at the version the drawer loaded. */
export function useRedatePayment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, receivedOn, version }: { paymentId: string; receivedOn: string; version: number }) =>
      api.redatePayment(profileId, paymentId, { receivedOn }, String(version)),
    onSuccess: () => invalidateIncome(queryClient, profileId),
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
