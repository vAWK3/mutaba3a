import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type UsagePeopleFilter } from '../api/client';

/**
 * MUT-735 (ADR-281): Operator › Usage's reads. Every key names its month (`this` for the server's current month), so a
 * month switch reads again and Back shows the month it left.
 */
const monthKey = (month: string | undefined) => month ?? 'this';

export const operatorUsageOverviewKey = (month: string | undefined) => ['operator', 'usage', 'overview', monthKey(month)] as const;
export const operatorUsagePeopleKey = (month: string | undefined, filter: UsagePeopleFilter | undefined) => ['operator', 'usage', 'people', monthKey(month), filter ?? 'all'] as const;
export const OPERATOR_USAGE_ROUTES_KEY = ['operator', 'usage', 'routes'] as const;
export const operatorAccountUsageKey = (userId: string) => ['operator', 'accounts', userId, 'usage'] as const;

export function useOperatorUsageOverview(month: string | undefined) {
  return useQuery({ queryKey: operatorUsageOverviewKey(month), queryFn: ({ signal }) => api.operatorUsageOverview(month, signal), placeholderData: keepPreviousData });
}

/** The payers, 50 at a time ("Load more"). */
export function useOperatorUsagePeople(month: string | undefined, filter: UsagePeopleFilter | undefined) {
  return useInfiniteQuery({
    queryKey: operatorUsagePeopleKey(month, filter),
    queryFn: ({ pageParam, signal }) => api.operatorUsagePeople({ month, filter, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function useOperatorUsageRoutes() {
  return useQuery({ queryKey: OPERATOR_USAGE_ROUTES_KEY, queryFn: ({ signal }) => api.operatorUsageRoutes(signal) });
}

export function useOperatorAccountUsage(userId: string) {
  return useQuery({ queryKey: operatorAccountUsageKey(userId), queryFn: ({ signal }) => api.operatorAccountUsage(userId, signal) });
}
