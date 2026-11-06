import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AccountantGrant, AccountantGrantList, ShareLink } from '../../api/client';
import { ORG_B, fail, ok, stubApi } from '../../__tests__/harness';
import { accountantsKey, shareLinksKey, useRevokeAccountant, useRevokeShareLink, useShareLinks } from '../sharingQueries';

/**
 * MUT-561 review fix (a): optimistic revokes that run at once. A failure puts back only its own row, into the list as
 * it is then; the list is read again only after the last one settles. Share links: a 404 list is "off", not an error.
 */

const grant = (id: string): AccountantGrant => ({ id, email: `${id}@x.co`, name: null, status: 'active', invitedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-15T00:00:00Z', acceptedAt: '2026-10-02T00:00:00Z', lastViewedAt: null });
const A = grant('a');
const B = grant('b');
const C = grant('c');

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

afterEach(() => vi.unstubAllGlobals());

describe('useRevokeAccountant, two at once', () => {
  it('B fails while A succeeds: A stays gone, B comes back in its place, and the list is read once, at the end', async () => {
    let answerA!: () => void;
    let answerB!: () => void;
    stubApi({
      [`DELETE /v1/profiles/${ORG_B}/accountants/a`]: () => new Promise((resolve) => (answerA = () => resolve(new Response(null, { status: 204 })))),
      [`DELETE /v1/profiles/${ORG_B}/accountants/b`]: () => new Promise((resolve) => (answerB = () => resolve(fail(500, 'INTERNAL')))),
      [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [B, C], limit: 5 }),
    });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData<AccountantGrantList>(accountantsKey(ORG_B), { items: [A, B, C], limit: 5 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const reads = () => invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(accountantsKey(ORG_B))).length;
    const { result } = renderHook(() => ({ one: useRevokeAccountant(ORG_B), two: useRevokeAccountant(ORG_B) }), { wrapper });
    const ids = () => queryClient.getQueryData<AccountantGrantList>(accountantsKey(ORG_B))?.items.map((g) => g.id);

    act(() => {
      result.current.one.mutate(A);
      result.current.two.mutate(B);
    });
    await waitFor(() => expect(ids()).toEqual(['c']));
    await waitFor(() => expect(answerA).toBeTypeOf('function'));
    await waitFor(() => expect(answerB).toBeTypeOf('function'));

    await act(async () => answerB());
    await waitFor(() => expect(result.current.two.isError).toBe(true));
    expect(ids()).toEqual(['b', 'c']);
    expect(reads()).toBe(0);

    await act(async () => answerA());
    await waitFor(() => expect(result.current.one.isSuccess).toBe(true));
    expect(reads()).toBe(1);
    expect(ids()).toEqual(['b', 'c']);
  });

  it('a 404 counts as done: the row stays gone', async () => {
    stubApi({ [`DELETE /v1/profiles/${ORG_B}/accountants/a`]: () => fail(404, 'NOT_FOUND'), [`GET /v1/profiles/${ORG_B}/accountants`]: () => ok({ items: [B], limit: 5 }) });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData<AccountantGrantList>(accountantsKey(ORG_B), { items: [A, B], limit: 5 });
    const { result } = renderHook(() => useRevokeAccountant(ORG_B), { wrapper });
    await act(async () => result.current.mutateAsync(A).catch(() => undefined));
    expect(queryClient.getQueryData<AccountantGrantList>(accountantsKey(ORG_B))?.items.map((g) => g.id)).toEqual(['b']);
  });
});

const link = (id: string, status: ShareLink['status'] = 'active'): ShareLink => ({
  id,
  period: 'LAST_3_MONTHS',
  from: '2026-08-01',
  to: '2026-10-31',
  createdAt: '2026-11-06T09:00:00Z',
  expiresAt: '2026-11-13T09:00:00Z',
  lastOpenedAt: null,
  status,
  endedAt: null,
  viewers: 0,
  maxViewers: 3,
  createdByName: 'Nour Haddad',
});

describe('share links', () => {
  it('a 404 list is off, not an error', async () => {
    stubApi({ [`GET /v1/profiles/${ORG_B}/share-links`]: () => fail(404, 'NOT_FOUND') });
    const { wrapper } = setup();
    const { result } = renderHook(() => useShareLinks(ORG_B), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ off: true }));
    expect(result.current.isError).toBe(false);
  });

  it('turning one off marks it ended at once and restores it if refused', async () => {
    let refuse!: () => void;
    stubApi({ [`DELETE /v1/profiles/${ORG_B}/share-links/l1`]: () => new Promise((resolve) => (refuse = () => resolve(fail(500, 'INTERNAL')))), [`GET /v1/profiles/${ORG_B}/share-links`]: () => ok({ items: [link('l1')], limit: 3 }) });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(shareLinksKey(ORG_B), { off: false, items: [link('l1')], limit: 3 });
    const { result } = renderHook(() => useRevokeShareLink(ORG_B), { wrapper });
    const status = () => (queryClient.getQueryData(shareLinksKey(ORG_B)) as { items: ShareLink[] }).items[0].status;
    act(() => result.current.mutate(link('l1')));
    await waitFor(() => expect(status()).toBe('revoked'));
    await waitFor(() => expect(refuse).toBeTypeOf('function'));
    await act(async () => refuse());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(status()).toBe('active');
  });
});
