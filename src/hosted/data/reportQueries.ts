import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { api, ApiError, type ActivitySummary, type HostedProfile, type OrganizationSummary } from '../api/client';
import { profileKey } from '../session/me';
import type { Range } from './reports';

/**
 * Reports' reads (MUT-175, D1/D4). One activity request per profile in view,
 * each cached per (profile, range, bucket); every profile keeps its own status,
 * so one slow or failing profile never blanks the others (D4). While a new
 * period or scope loads, the previous answer stays on screen, dimmed (DR5).
 */

const STALE_MS = 30_000;

export type LoadStatus = 'loading' | 'ready' | 'failed' | 'forbidden';

export interface ProfileLoad<T> {
  profile: HostedProfile;
  status: LoadStatus;
  data: T | undefined;
  /** True while showing the previous range's answer as a placeholder. */
  stale: boolean;
  retry: () => void;
}

export function activityKey(profileId: string, range: Range, bucket: 'day' | 'month') {
  return profileKey(profileId, 'activity', range.from, range.to, bucket);
}

function statusOf(query: { isPending: boolean; isError: boolean; error: unknown }): LoadStatus {
  if (query.isError) return query.error instanceof ApiError && query.error.status === 403 ? 'forbidden' : 'failed';
  return query.isPending ? 'loading' : 'ready';
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
    combine: (results) =>
      results.map((query, index) => ({
        profile: profiles[index]!,
        status: statusOf(query),
        data: query.isError ? undefined : query.data,
        stale: query.isPlaceholderData,
        retry: () => void query.refetch(),
      })),
  });
}

/** Each profile's organization summary (Owed now, DR2): the same cache entries Overview reads. */
export function useOwedSummaries(profiles: readonly HostedProfile[], enabled = true): ProfileLoad<OrganizationSummary>[] {
  return useQueries({
    queries: profiles.map((profile) => ({
      queryKey: profileKey(profile.id, 'summary', 'organization'),
      queryFn: () => api.organizationSummary(profile.id),
      staleTime: STALE_MS,
      enabled,
    })),
    combine: (results) =>
      results.map((query, index) => ({ profile: profiles[index]!, status: statusOf(query), data: query.isError ? undefined : query.data, stale: false, retry: () => void query.refetch() })),
  });
}
