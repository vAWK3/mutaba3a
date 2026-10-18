import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ORG_A, ok, stubApi } from '../../__tests__/harness';
import type { Expense, ExpenseGroupSummary } from '../../api/client';
import { profileKey } from '../../session/me';
import { fxRatesKey, groupsKey, loadAllExpenses, sendMark, useGroupMarks } from '../expenseGroupQueries';
import { useUpdateExpense } from '../expenseQueries';

afterEach(() => vi.unstubAllGlobals());

const G = 'g0000000-0000-4000-8000-000000000001';

const row = (id: string, occurredOn: string, amount = '10.000'): Expense =>
  ({ id, occurredOn, amount, currency: 'JOD', categoryId: null, title: id }) as Expense;

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

const summary = (total: string, count: number): ExpenseGroupSummary => ({
  groupId: G,
  seriesFrom: '2026-10-03',
  seriesTo: '2026-10-07',
  currencies: count === 0 ? [] : [{ currency: 'JOD', total, count, byCategory: [{ categoryId: null, total, count }], byCustomer: [], byDay: [{ date: '2026-10-05', position: 'in', total, count }] }],
});

describe('loadAllExpenses', () => {
  it('follows every cursor at the 200 limit and lists oldest first', async () => {
    const api = stubApi({
      'GET /v1/expenses': ({ url }) =>
        url.searchParams.get('cursor')
          ? ok({ items: [row('a', '2026-10-03')], nextCursor: null })
          : ok({ items: [row('c', '2026-10-07'), row('b', '2026-10-05')], nextCursor: 'next' }),
    });
    const rows = await loadAllExpenses(ORG_A, { groupId: G, groupMembership: 'member' });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(api.calls.map((c) => [c.url.searchParams.get('limit'), c.url.searchParams.get('groupId'), c.url.searchParams.get('cursor')])).toEqual([
      ['200', G, null],
      ['200', G, 'next'],
    ]);
  });
});

describe('sendMark', () => {
  it('sends one expense’s marks in order, even when the first is slow or fails', async () => {
    let releaseFirst: (r: Response) => void = () => {};
    const seen: string[] = [];
    stubApi({
      [`PUT /v1/expense-groups/${G}/expenses/e1`]: () => {
        seen.push('PUT');
        return new Promise<Response>((resolve) => (releaseFirst = resolve));
      },
      [`DELETE /v1/expense-groups/${G}/expenses/e1`]: () => {
        seen.push('DELETE');
        return new Response(null, { status: 204 });
      },
    });
    const first = sendMark(ORG_A, G, 'e1', 'leaveOut');
    const second = sendMark(ORG_A, G, 'e1', 'bringBack');
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(['PUT']);
    releaseFirst(new Response(JSON.stringify({ error: { code: 'NETWORK' } }), { status: 500 }));
    await expect(first).rejects.toBeTruthy();
    await second;
    expect(seen).toEqual(['PUT', 'DELETE']);
  });
});

describe('useGroupMarks', () => {
  it('shows a leave-out at once and never counts it twice when the summary refetch lands first', async () => {
    let served = summary('30.000', 3);
    const api = stubApi({
      [`PUT /v1/expense-groups/${G}/expenses/e1`]: () => ok({}),
      [`GET /v1/expense-groups/${G}/summary`]: () => ok(served),
    });
    const { queryClient, wrapper } = client();
    const summaryKey = groupsKey(ORG_A, 'group', G, 'summary');
    queryClient.setQueryData(summaryKey, summary('30.000', 3));
    const before = queryClient.getQueryState(summaryKey)!.dataUpdatedAt;
    const { result } = renderHook(() => useGroupMarks(ORG_A, G), { wrapper });

    let pending!: Promise<boolean>;
    served = summary('20.000', 2);
    act(() => {
      pending = result.current.act('leaveOut', row('e1', '2026-10-05'));
    });
    expect(result.current.summary(summary('30.000', 3), before).currencies[0]!.total).toBe('20.000');
    await act(async () => {
      expect(await pending).toBe(true);
    });
    expect(api.count(`PUT /v1/expense-groups/${G}/expenses/e1`)).toBe(1);
    // The refetch (newer than the settled mark) already carries the leave-out: shown as served, not taken off again.
    expect(result.current.summary(summary('20.000', 2), Date.now() + 1).currencies[0]!.total).toBe('20.000');
    // Members not refetched yet: the row overlay still holds.
    expect(result.current.rows([row('e1', '2026-10-05')], [], before).excluded.map((r) => r.id)).toEqual(['e1']);
  });

  it('puts the row back and says so when the server refuses', async () => {
    stubApi({ [`PUT /v1/expense-groups/${G}/expenses/e1`]: () => ok({ error: { code: 'NOT_FOUND', message: 'x' } }, 404) });
    const { wrapper } = client();
    const { result } = renderHook(() => useGroupMarks(ORG_A, G), { wrapper });
    let outcome = true;
    await act(async () => {
      outcome = await result.current.act('leaveOut', row('e1', '2026-10-05'));
    });
    expect(outcome).toBe(false);
    expect(result.current.rows([row('e1', '2026-10-05')], [], 0).members.map((r) => r.id)).toEqual(['e1']);
  });
});

describe('invalidation', () => {
  it('refetches every group read after an expense edit, and keeps FX rates outside that root', async () => {
    stubApi({ 'PATCH /v1/expenses/e1': () => ok(row('e1', '2026-10-05')) });
    const { queryClient, wrapper } = client();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateExpense(ORG_A), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ expenseId: 'e1', body: { amount: '1.000' }, version: '1' });
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: groupsKey(ORG_A) }));
    expect(fxRatesKey(ORG_A, 'ILS').slice(0, 3)).not.toEqual(groupsKey(ORG_A));
    expect(fxRatesKey(ORG_A, 'ILS')).toEqual(profileKey(ORG_A, 'fx-rates', 'ILS'));
  });
});
