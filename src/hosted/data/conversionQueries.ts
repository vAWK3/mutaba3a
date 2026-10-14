import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Conversion, type CreateConversionRequest, type UpdateConversionRequest } from '../api/client';
import { useCursorList } from './queries';
import { profileKey } from '../session/me';
import type { ConversionFilters } from './filters';

/**
 * The portal's conversion query and mutation hooks (MUT-161), mirroring
 * expenseQueries.ts's shape. MUT-194 (ADR-075) adds update and delete.
 */

const PAGE_LIMIT = 50;
const STALE_MS = 30_000;

/** The one conversion's query key: the drawer invalidates it on a 409 to refetch the latest version (MUT-194 D6). */
export const conversionKey = (profileId: string, conversionId: string) => profileKey(profileId, 'conversion', conversionId);

export function useConversions(profileId: string, filters: ConversionFilters) {
  const key = { currency: filters.currency, from: filters.from, to: filters.to, anchor: filters.anchor };
  // The anchor starts the first page only (MUT-91); later pages follow its nextCursor.
  const { anchor, ...listFilters } = key;
  return useCursorList<Conversion>(profileKey(profileId, 'conversions', key), (cursor) =>
    api.conversions(profileId, { limit: PAGE_LIMIT, ...listFilters, ...(cursor ? { cursor } : { anchor }) }),
  );
}

export function useConversion(profileId: string, conversionId: string) {
  return useQuery({
    queryKey: conversionKey(profileId, conversionId),
    queryFn: () => api.conversion(profileId, conversionId),
    enabled: Boolean(conversionId),
    staleTime: STALE_MS,
  });
}

function invalidateConversions(queryClient: ReturnType<typeof useQueryClient>, profileId: string) {
  queryClient.invalidateQueries({ queryKey: profileKey(profileId, 'conversions') });
}

export function useCreateConversion(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // MUT-133 D5: attempt-scoped key, as in useCreateExpense.
    mutationFn: ({ body, idempotencyKey }: { body: CreateConversionRequest; idempotencyKey: string }) => api.createConversion(profileId, body, idempotencyKey),
    onSuccess: () => invalidateConversions(queryClient, profileId),
  });
}

export function useUpdateConversion(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ conversionId, body, version }: { conversionId: string; body: UpdateConversionRequest; version: string }) =>
      api.updateConversion(profileId, conversionId, body, version),
    onSuccess: (_result: Conversion, { conversionId }) => {
      invalidateConversions(queryClient, profileId);
      queryClient.invalidateQueries({ queryKey: conversionKey(profileId, conversionId) });
    },
  });
}

export function useDeleteConversion(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversionId: string) => api.deleteConversion(profileId, conversionId),
    onSuccess: () => invalidateConversions(queryClient, profileId),
  });
}
