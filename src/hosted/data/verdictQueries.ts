import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Verdict } from '../api/client';
import type { Range } from './reports';

/**
 * The Glance's one read (MUT-448). The key is not under any profile, so no save's invalidation reaches it; instead it
 * refetches on every visit, and on focus once the answer is 10 s old (eng D3 → D9: each read posts due items and reads
 * every profile, ≈6N+1, TD-264). The default view asks with no dates so the server picks this month in its base
 * timezone (D4). While a new period loads, the last verdict stays on screen, dimmed.
 */

export const VERDICT_STALE_MS = 10_000;

/** `'current'`: this month as the server counts it. */
export type VerdictRange = 'current' | Range;

export function verdictKey(range: VerdictRange) {
  return range === 'current' ? (['verdict', 'current'] as const) : (['verdict', range.from, range.to] as const);
}

export function verdictQueryOptions(range: VerdictRange, enabled = true) {
  return {
    queryKey: verdictKey(range),
    queryFn: (): Promise<Verdict> => api.verdict(range === 'current' ? {} : { from: range.from, to: range.to }),
    staleTime: VERDICT_STALE_MS,
    refetchOnMount: 'always' as const,
    placeholderData: keepPreviousData,
    enabled,
  };
}

export function useVerdict(range: VerdictRange, enabled = true) {
  const query = useQuery(verdictQueryOptions(range, enabled));
  // A refetch on return keeps real data (not a placeholder), so the dim follows the fetch itself (eng OV4)
  return { query, dimmed: query.isFetching && !query.isPending };
}
