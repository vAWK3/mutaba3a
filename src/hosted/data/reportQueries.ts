import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api, ApiError, type ActivitySummary, type HostedProfile, type OrganizationSummary } from '../api/client';
import { profileKey } from '../session/me';
import { everyPage } from './queries';
import type { Range } from './reports';

/**
 * Reports' reads (MUT-175, D1/D4). One activity request per profile in view,
 * each cached per (profile, range, bucket); every profile keeps its own status,
 * so one slow or failing profile never blanks the others (D4). While a new
 * period or scope loads, that profile's last report stays on screen, dimmed
 * (DR5): `keepPreviousData` can't do this inside `useQueries` (a new key is a
 * new observer with no previous data), so the placeholder is read from the
 * cache instead.
 */

const STALE_MS = 30_000;
const DIRECTORY_LIMIT = 200;

export type LoadStatus = 'loading' | 'ready' | 'failed' | 'forbidden';

export interface ProfileLoad<T> {
  profile: HostedProfile;
  status: LoadStatus;
  data: T | undefined;
  error: unknown;
  /** True while showing an earlier answer as a placeholder. */
  stale: boolean;
  retry: () => void;
}

/** Under the profile's summaries: an income save refreshes them all, and an expense save refreshes this one too. */
export function activityKey(profileId: string, range: Range, bucket: 'day' | 'month') {
  return profileKey(profileId, 'summary', 'activity', range.from, range.to, bucket);
}

const activityPrefix = (profileId: string) => profileKey(profileId, 'summary', 'activity');

/** This profile's most recently loaded report with the same bucket shape: the dimmed placeholder (DR5). */
function lastActivityOf(queryClient: QueryClient, profileId: string, bucket: 'day' | 'month'): ActivitySummary | undefined {
  const cached = queryClient
    .getQueryCache()
    .findAll({ queryKey: activityPrefix(profileId) })
    .filter((q) => q.state.data && (q.state.data as ActivitySummary).bucket === bucket)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  return cached[0]?.state.data as ActivitySummary | undefined;
}

interface Settled<T> {
  status: LoadStatus;
  data: T | undefined;
  error: unknown;
  stale: boolean;
}

function settle<T>(query: UseQueryResult<T>): Settled<T> {
  const status: LoadStatus = query.isError ? (query.error instanceof ApiError && query.error.status === 403 ? 'forbidden' : 'failed') : query.isPending ? 'loading' : 'ready';
  return { status, data: query.isError ? undefined : query.data, error: query.error, stale: query.isPlaceholderData };
}

/** A stable `combine` (an inline one re-runs every render and defeats structural sharing). */
function combineSettled<T>(results: UseQueryResult<T>[]): Settled<T>[] {
  return results.map(settle);
}

function useLoads<T>(profiles: readonly HostedProfile[], settled: Settled<T>[], keyOf: (profileId: string) => readonly unknown[]): ProfileLoad<T>[] {
  const queryClient = useQueryClient();
  return useMemo(() => settled.map((s, i) => ({ ...s, profile: profiles[i]!, retry: () => void queryClient.refetchQueries({ queryKey: keyOf(profiles[i]!.id) }) })), [settled, profiles, queryClient, keyOf]);
}

/** The activity of each profile, in the profiles' order. */
export function useReportActivity(profiles: readonly HostedProfile[], range: Range, bucket: 'day' | 'month', enabled = true): ProfileLoad<ActivitySummary>[] {
  const queryClient = useQueryClient();
  const settled = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: activityKey(profile.id, range, bucket),
      queryFn: () => api.activitySummary(profile.id, { from: range.from, to: range.to, bucket }),
      staleTime: STALE_MS,
      placeholderData: () => lastActivityOf(queryClient, profile.id, bucket),
      enabled,
    })),
    combine: combineSettled<ActivitySummary>,
  });
  const keyOf = useCallback((id: string) => activityKey(id, { from: range.from, to: range.to }, bucket), [range.from, range.to, bucket]);
  return useLoads(profiles, settled, keyOf);
}

const organizationKey = (profileId: string) => profileKey(profileId, 'summary', 'organization');

/** Each profile's organization summary (Owed now, DR2): the same cache entries Overview reads. */
export function useOwedSummaries(profiles: readonly HostedProfile[]): ProfileLoad<OrganizationSummary>[] {
  const settled = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: organizationKey(profile.id),
      queryFn: () => api.organizationSummary(profile.id),
      staleTime: STALE_MS,
    })),
    combine: combineSettled<OrganizationSummary>,
  });
  return useLoads(profiles, settled, organizationKey);
}

export interface NameDirectory {
  categories: ReadonlyMap<string, string>;
  clients: ReadonlyMap<string, string>;
}

export interface NameDirectories {
  byProfile: ReadonlyMap<string, NameDirectory>;
  /** Every directory answered (or failed): insights wait for names, never naming "—" (review). */
  settled: boolean;
}

type CategoriesPage = Awaited<ReturnType<typeof api.expenseCategories>>;
type Clients = Awaited<ReturnType<typeof everyPage<{ id: string; name: string }>>>;

/**
 * Category (archived included) and client names per profile, for rows that
 * carry only ids. A name that has not loaded yet is left to the caller's
 * fallback, never a reason to wait.
 */
export function useNameDirectories(profiles: readonly HostedProfile[]): NameDirectories {
  const categories = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'expense-categories', 'with-archived'),
      queryFn: () => api.expenseCategories(profile.id, { includeArchived: 'true' }),
      staleTime: STALE_MS,
    })),
    combine: useCallback((results: UseQueryResult<CategoriesPage>[]) => results.map((r) => ({ data: r.data, settled: !r.isPending })), []),
  });
  const clients = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'directory', 'customers'),
      queryFn: () => everyPage((cursor) => api.customers(profile.id, { limit: DIRECTORY_LIMIT, cursor })),
      staleTime: STALE_MS,
    })),
    combine: useCallback((results: UseQueryResult<Clients>[]) => results.map((r) => ({ data: r.data, settled: !r.isPending })), []),
  });
  return useMemo(
    () => ({
      byProfile: new Map(
        profiles.map((profile, index) => [
          profile.id,
          {
            categories: new Map((categories[index]?.data?.items ?? []).map((c) => [c.id, c.name])),
            clients: new Map((clients[index]?.data ?? []).map((c) => [c.id, c.name])),
          },
        ]),
      ),
      settled: [...categories, ...clients].every((r) => r.settled),
    }),
    [profiles, categories, clients],
  );
}
