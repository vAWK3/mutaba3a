import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api, type Verdict } from '../../api/client';
import { profileKey } from '../../session/me';
import { useVerdict, verdictKey, verdictQueryOptions, VERDICT_STALE_MS } from '../verdictQueries';

/** MUT-448: the Glance's read (eng D4, D7, D9). */

afterEach(() => vi.restoreAllMocks());

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('verdictQueryOptions', () => {
  it('asks with no dates on the default view, and with the range otherwise, each under its own key', async () => {
    const spy = vi.spyOn(api, 'verdict').mockResolvedValue({} as Verdict);
    await verdictQueryOptions('current').queryFn();
    expect(spy).toHaveBeenLastCalledWith({});
    await verdictQueryOptions({ from: '2026-09-01', to: '2026-09-30' }).queryFn();
    expect(spy).toHaveBeenLastCalledWith({ from: '2026-09-01', to: '2026-09-30' });
    expect(verdictKey('current')).toEqual(['verdict', 'current']);
    expect(verdictKey({ from: '2026-09-01', to: '2026-09-30' })).toEqual(['verdict', '2026-09-01', '2026-09-30']);
  });

  it('refetches on every visit and is fresh for 10 s, so tab switches don’t re-read every profile', () => {
    const options = verdictQueryOptions('current');
    expect(options.refetchOnMount).toBe('always');
    expect(options.staleTime).toBe(VERDICT_STALE_MS);
    expect(VERDICT_STALE_MS).toBe(10_000);
  });

  it('is not under any profile’s keys, so it never waits on a save’s invalidation', () => {
    expect(verdictKey('current')[0]).not.toBe(profileKey('p')[0]);
  });
});

describe('useVerdict', () => {
  it('reads nothing while disabled (every profile locked, D7)', () => {
    const spy = vi.spyOn(api, 'verdict');
    renderHook(() => useVerdict('current', false), { wrapper: wrapper(new QueryClient()) });
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the shown verdict, dimmed, while the next period loads', async () => {
    let resolveNext: (v: Verdict) => void = () => {};
    vi.spyOn(api, 'verdict')
      .mockResolvedValueOnce({ from: '2026-10-01' } as Verdict)
      .mockImplementationOnce(() => new Promise<Verdict>((resolve) => (resolveNext = resolve)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ range }) => useVerdict(range), { wrapper: wrapper(client), initialProps: { range: 'current' as const } as { range: 'current' | { from: string; to: string } } });
    await waitFor(() => expect(result.current.query.data?.from).toBe('2026-10-01'));
    expect(result.current.dimmed).toBe(false);
    rerender({ range: { from: '2026-09-01', to: '2026-09-30' } });
    await waitFor(() => expect(result.current.dimmed).toBe(true));
    expect(result.current.query.data?.from).toBe('2026-10-01');
    await act(async () => resolveNext({ from: '2026-09-01' } as Verdict));
    await waitFor(() => expect(result.current.dimmed).toBe(false));
    expect(result.current.query.data?.from).toBe('2026-09-01');
  });
});
