import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Schemas } from '../api/client';
import { CLIENT_BOOKS_KEY } from './clientBooksQueries';
import { profileKey } from '../session/me';

/**
 * MUT-783 (MUT-782, ADR-343): the VAT period reads and writes. The server answers 404 on every route while
 * VAT_PERIOD_REMINDERS is off, and 403 NOT_OWNER to a member who is not an owner; both mean "nothing to show", so the
 * reads answer `null` and the screens draw nothing, never an error.
 */
const STALE_MS = 5 * 60_000;

/** The client's latest announced period, or null (none yet, switched off, or not the owner). */
export function useCurrentVatPeriod(profileId: string, enabled: boolean) {
  return useQuery({
    queryKey: profileKey(profileId, 'vatPeriod'),
    enabled,
    staleTime: STALE_MS,
    queryFn: async ({ signal }): Promise<Schemas['VatPeriodView'] | null> => {
      try {
        return (await api.currentVatPeriod(profileId, signal)).period;
      } catch (error) {
        if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return null;
        throw error;
      }
    },
  });
}

/** All my clients' VAT state, or null while the feature is off (the desk then has no VAT column). */
export const CLIENT_VAT_KEY = [...CLIENT_BOOKS_KEY, 'vatPeriods'] as const;
export function useClientVatPeriods() {
  return useQuery({
    queryKey: CLIENT_VAT_KEY,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<Schemas['ClientVatPeriodsResponse'] | null> => {
      try {
        return await api.clientVatPeriods(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/** "All receipts sent": the answer is the period as it now stands, put straight into the cache. */
export function useMarkVatPeriodDone(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (periodKey: string) => api.markVatPeriodDone(profileId, periodKey),
    onSuccess: (period) => queryClient.setQueryData(profileKey(profileId, 'vatPeriod'), period),
  });
}

export function useSetClientVatPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, kind }: { profileId: string; kind: Schemas['VatPeriodKind'] }) => api.setClientVatPeriod(profileId, kind),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CLIENT_VAT_KEY }),
  });
}

export function useReviewVatPeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, periodKey, decision, note }: { profileId: string; periodKey: string; decision: 'CONFIRMED' | 'MORE_NEEDED'; note?: string }) =>
      api.reviewVatPeriod(profileId, periodKey, { decision, ...(note ? { note } : {}) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CLIENT_VAT_KEY }),
  });
}
