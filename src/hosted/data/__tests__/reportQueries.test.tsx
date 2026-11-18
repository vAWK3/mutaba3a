import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActivitySummary, HostedProfile } from '../../api/client';
import { profileKey } from '../../session/me';
import { activityKey, useReportActivity } from '../reportQueries';
import { expenseCategoriesKey } from '../expenseQueries';

/** MUT-175: a save anywhere refreshes Reports (found by @portal.reports.signed-out: an income save left it on first run). */

describe('activityKey', () => {
  it('sits under the profile’s summaries, so every save that refreshes the summaries refreshes Reports', async () => {
    const client = new QueryClient();
    const key = activityKey('p1', { from: '2026-10-01', to: '2026-10-31' }, 'day');
    client.setQueryData(key, { stale: false });
    // incomeQueries' invalidateIncome refreshes profileKey(id, 'summary'); expense saves refresh profileKey(id, 'summary', 'activity')
    await client.invalidateQueries({ queryKey: profileKey('p1', 'summary') });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, { stale: false });
    await client.invalidateQueries({ queryKey: profileKey('p1', 'summary', 'activity') });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

/** MUT-464: seeded category names follow the portal language, so a language switch must not reuse the other one's list. */
describe('expenseCategoriesKey', () => {
  it('differs by language and archived, and sits under the profile’s categories', async () => {
    expect(expenseCategoriesKey('p1', 'ar')).not.toEqual(expenseCategoriesKey('p1', 'en'));
    expect(expenseCategoriesKey('p1', 'en', true)).not.toEqual(expenseCategoriesKey('p1', 'en'));
    const client = new QueryClient();
    for (const key of [expenseCategoriesKey('p1', 'ar'), expenseCategoriesKey('p1', 'en', true)]) {
      client.setQueryData(key, { items: [] });
      await client.invalidateQueries({ queryKey: profileKey('p1', 'expense-categories') });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});

/**
 * MUTABA3A-WEB-9: Reports crashed ("undefined is not an object (evaluating 's.id')") when the profiles in view changed,
 * e.g. switching "all profiles" off. useQueries re-runs a stable `combine` only when its committed result changes, so
 * the render that drops a profile still got the old, longer list and paired it with `profiles[i]` = undefined.
 */
describe('useReportActivity when the profiles in view change', () => {
  const A = { id: 'pa', name: 'A' } as unknown as HostedProfile;
  const B = { id: 'pb', name: 'B' } as unknown as HostedProfile;
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const summary = (id: string) => ({ bucket: 'day', of: id }) as unknown as ActivitySummary;

  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    for (const p of [A, B]) queryClient.setQueryData(activityKey(p.id, range, 'day'), summary(p.id));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    return { wrapper };
  }

  it('pairs every load with its own profile on every render, when one is dropped, swapped or added', () => {
    const { wrapper } = setup();
    const seen: { want: string[]; got: (string | undefined)[]; data: (string | undefined)[] }[] = [];
    const { rerender } = renderHook(
      ({ profiles }: { profiles: HostedProfile[] }) => {
        const loads = useReportActivity(profiles, range, 'day');
        seen.push({ want: profiles.map((p) => p.id), got: loads.map((l) => l.profile?.id), data: loads.map((l) => (l.data as unknown as { of: string } | undefined)?.of) });
        return loads;
      },
      { wrapper, initialProps: { profiles: [A, B] } },
    );
    rerender({ profiles: [A] });
    rerender({ profiles: [B] });
    rerender({ profiles: [B, A] });
    for (const render of seen) {
      expect(render.got).toEqual(render.want);
      render.data.forEach((of, i) => of !== undefined && expect(of).toBe(render.want[i]));
    }
  });
});
