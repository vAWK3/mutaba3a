/**
 * Hook for fetching and managing FX rates
 * Uses TanStack Query for caching and refetching
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLiveFxRate, getCachedFxRate, type FxSource } from '../lib/fx';
import type { Currency } from '../types';

export interface UseFxRateResult {
  /** Exchange rate (how many quote currency per 1 base currency) */
  rate: number | null;
  /** Source of the rate: live API, cached, or unavailable */
  source: FxSource;
  /** Whether the rate is currently being fetched */
  isLoading: boolean;
  /** Whether there was an error fetching the rate */
  isError: boolean;
  /** Date the rate is effective for (from API) */
  rateDate: string | null;
  /** Timestamp when the rate was fetched */
  lastUpdated: string | null;
  /** Function to manually refresh the rate */
  refetch: () => void;
}

// Query key for FX rates
export const fxQueryKeys = {
  rate: (base: Currency, quote: Currency) => ['fxRate', base, quote] as const,
};

/**
 * Hook to get FX rate between two currencies
 * Default: USD to ILS
 */
export function useFxRate(
  base: Currency = 'USD',
  quote: Currency = 'ILS'
): UseFxRateResult {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: fxQueryKeys.rate(base, quote),
    queryFn: () => fetchLiveFxRate(base, quote),
    staleTime: 4 * 60 * 60 * 1000, // 4 hours
    gcTime: 24 * 60 * 60 * 1000, // 24 hours - keep in cache
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 2,
    retryDelay: 1000,
    // Use cached data as placeholder while fetching
    placeholderData: () => {
      const cached = getCachedFxRate(base, quote);
      if (cached) {
        return {
          rate: cached.rate,
          base,
          quote,
          date: cached.date,
          source: 'cached' as const,
          fetchedAt: cached.fetchedAt,
        };
      }
      return undefined;
    },
  });

  const handleRefetch = () => {
    // Invalidate and refetch
    queryClient.invalidateQueries({ queryKey: fxQueryKeys.rate(base, quote) });
    refetch();
  };

  return {
    rate: data?.rate && data.rate > 0 ? data.rate : null,
    source: data?.source ?? 'none',
    isLoading,
    isError,
    rateDate: data?.date || null,
    lastUpdated: data?.fetchedAt || null,
    refetch: handleRefetch,
  };
}
