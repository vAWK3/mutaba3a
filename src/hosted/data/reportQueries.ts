import { useMemo, useRef } from 'react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { api, ApiError, type ActivitySummary, type HostedProfile, type OrganizationSummary } from '../api/client';
import { profileKey } from '../session/me';
import { everyPage } from './queries';
import type { Range } from './reports';

/**
 * Reports' reads (MUT-175, D1/D4). One activity request per profile in view,
 * each cached per (profile, range, bucket); every profile keeps its own status,
 * so one slow or failing profile never blanks the others (D4). While a new
 * period or scope loads, the previous answer stays on screen, dimmed (DR5).
 */

const STALE_MS = 30_000;
const DIRECTORY_LIMIT = 200;

export type LoadStatus = 'loading' | 'ready' | 'failed' | 'forbidden';

export interface ProfileLoad<T> {
  profile: HostedProfile;
  status: LoadStatus;
  data: T | undefined;
  error: unknown;
  /** True while showing the previous range's answer as a placeholder. */
  stale: boolean;
  retry: () => void;
}

export function activityKey(profileId: string, range: Range, bucket: 'day' | 'month') {
  return profileKey(profileId, 'activity', range.from, range.to, bucket);
}

interface QueryLike<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  isPlaceholderData: boolean;
  refetch: () => unknown;
}

function statusOf(query: { isPending: boolean; isError: boolean; error: unknown }): LoadStatus {
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'forbidden' : 'failed';
  return query.isPending ? 'loading' : 'ready';
}

function loadOf<T>(profile: HostedProfile, query: QueryLike<T>): ProfileLoad<T> {
  return { profile, status: statusOf(query), data: query.isError ? undefined : query.data, error: query.error, stale: query.isPlaceholderData, retry: () => void query.refetch() };
}

/** The activity of each profile, in the profiles' order. */
export function useReportActivity(profiles: readonly HostedProfile[], range: Range, bucket: 'day' | 'month', enabled = true): ProfileLoad<ActivitySummary>[] {
  return useQueries({
    queries: profiles.map((profile) => ({
      queryKey: activityKey(profile.id, range, bucket),
      queryFn: () => api.activitySummary(profile.id, { from: range.from, to: range.to, bucket }),
      staleTime: STALE_MS,
      placeholderData: keepPreviousData,
      enabled,
    })),
    combine: (results) => results.map((query, index) => loadOf(profiles[index]!, query)),
  });
}

/** Each profile's organization summary (Owed now, DR2): the same cache entries Overview reads. */
export function useOwedSummaries(profiles: readonly HostedProfile[]): ProfileLoad<OrganizationSummary>[] {
  return useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'summary', 'organization'),
      queryFn: () => api.organizationSummary(profile.id),
      staleTime: STALE_MS,
    })),
    combine: (results) => results.map((query, index) => loadOf(profiles[index]!, query)),
  });
}

export interface NameDirectory {
  categories: ReadonlyMap<string, string>;
  clients: ReadonlyMap<string, string>;
}

/**
 * Category and client names per profile, for rows that carry only ids. Same
 * cache entries as the Expenses page and the client directory. A name that has
 * not loaded yet is left to the caller's fallback, never a reason to wait.
 */
export function useNameDirectories(profiles: readonly HostedProfile[]): ReadonlyMap<string, NameDirectory> {
  const categories = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'expense-categories'),
      queryFn: () => api.expenseCategories(profile.id),
      staleTime: STALE_MS,
    })),
  });
  const clients = useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'directory', 'customers'),
      queryFn: () => everyPage((cursor) => api.customers(profile.id, { limit: DIRECTORY_LIMIT, cursor })),
      staleTime: STALE_MS,
    })),
  });
  // A new map only when an answer changes, so the rows built from it are not rebuilt every render
  const version = [...profiles.map((p) => p.id), ...categories.map((q) => q.dataUpdatedAt), ...clients.map((q) => q.dataUpdatedAt)].join();
  const latest = useRef({ categories, clients, profiles });
  latest.current = { categories, clients, profiles };
  return useMemo(() => {
    const now = latest.current;
    return new Map(
      now.profiles.map((profile, index) => [
        profile.id,
        {
          categories: new Map((now.categories[index]?.data?.items ?? []).map((c) => [c.id, c.name])),
          clients: new Map((now.clients[index]?.data ?? []).map((c) => [c.id, c.name])),
        },
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the answers' contents
  }, [version]);
}
