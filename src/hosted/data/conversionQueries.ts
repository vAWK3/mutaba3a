import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Conversion, type CreateConversionRequest } from '../api/client';
import { useCursorList } from './queries';
import { profileKey } from '../session/me';
import type { ConversionFilters } from './filters';

/**
 * The portal's conversion query and mutation hooks (MUT-161), mirroring
 * expenseQueries.ts's shape. Create + read only — no update/delete, unlike
 * expenses: a logging mistake is corrected with a new entry, not an edit.
 */

const PAGE_LIMIT = 50;
const STALE_MS = 30_000;

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
    queryKey: profileKey(profileId, 'conversion', conversionId),
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
    mutationFn: (body: CreateConversionRequest) => api.createConversion(profileId, body, crypto.randomUUID()),
    onSuccess: () => invalidateConversions(queryClient, profileId),
  });
}
