import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { ApiError } from '../../api/client';
import { profileKey } from '../../session/me';
import { expenseKey } from '../expenseQueries';
import { expenseMoveErrorOf, useMoveExpense } from '../expenseMoveQueries';
import { receiptsKey } from '../receiptQueries';

/** MUT-589 (ADR-255): the expense move's data layer. */
afterEach(() => vi.unstubAllGlobals());

const P = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const E = 'e0000000-0000-4000-8000-000000000001';
const EXPENSE = { id: E, organizationId: B, amount: '1.00', currency: 'ILS', occurredOn: '2026-11-02', version: 4, receipts: [] };

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}
const invalidated = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));

describe('useMoveExpense (MUT-589)', () => {
  it('refreshes both profiles\' expenses, summaries and receipts, and drops the expense\'s cached page here', async () => {
    stubApi({ [`POST /v1/expenses/${E}/move`]: () => ok({ expense: EXPENSE, fromProfileId: P, changes: [] }) });
    const { queryClient, wrapper } = client();
    queryClient.setQueryData(expenseKey(P, E), { id: E });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMoveExpense(P), { wrapper });
    await act(() => result.current.mutateAsync({ expenseId: E, targetProfileId: B, expectedVersion: 3, idempotencyKey: 'k1' }));
    const keys = [P, B].flatMap((id) => [profileKey(id, 'expenses'), profileKey(id, 'summary', 'expenses'), receiptsKey(id, 'list'), receiptsKey(id, 'counts')]);
    expect(invalidated(spy)).toEqual(expect.arrayContaining(keys.map((k) => JSON.stringify(k))));
    expect(queryClient.getQueryData(expenseKey(P, E))).toBeUndefined();
  });

  it('a retry answered 404 EXPENSE_NOT_FOUND finds the expense on the target: the move happened (ADR-228 D8)', async () => {
    stubApi({ [`POST /v1/expenses/${E}/move`]: () => fail(404, 'NOT_FOUND', { reason: 'EXPENSE_NOT_FOUND' }), [`GET /v1/expenses/${E}`]: () => ok(EXPENSE) });
    const { wrapper } = client();
    const { result } = renderHook(() => useMoveExpense(P), { wrapper });
    const moved = await act(() => result.current.mutateAsync({ expenseId: E, targetProfileId: B, expectedVersion: 3, idempotencyKey: 'k1' }));
    expect(moved.expense.id).toBe(E);
  });

  it('maps every refusal to its message key', () => {
    const err = (status: number, code: ConstructorParameters<typeof ApiError>[1], reason?: string) => new ApiError(status, code, 'x', reason ? { reason } : undefined);
    expect(expenseMoveErrorOf(err(402, 'SUBSCRIPTION_LAPSED'))).toBe('lapsed');
    expect(expenseMoveErrorOf(err(404, 'NOT_FOUND', 'PROFILE_NOT_FOUND'))).toBe('noAccess');
    expect(expenseMoveErrorOf(err(403, 'READ_ONLY_PROFILE', 'NOT_OWNER'))).toBe('notOwner');
    expect(expenseMoveErrorOf(err(403, 'READ_ONLY_PROFILE', 'MALAFAT_PROFILE'))).toBe('malafat');
    expect(expenseMoveErrorOf(err(409, 'CONFLICT', 'VERSION_MISMATCH'))).toBe('changed');
    expect(expenseMoveErrorOf(err(409, 'CONFLICT', 'RECEIPT_NOT_READY'))).toBe('notReady');
    expect(expenseMoveErrorOf(err(404, 'NOT_FOUND', 'EXPENSE_NOT_FOUND'))).toBe('gone');
    expect(expenseMoveErrorOf(new Error('offline'))).toBe('failed');
  });
});
