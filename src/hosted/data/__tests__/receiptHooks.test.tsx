import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { expenseKey } from '../expenseQueries';
import { ApiError } from '../../api/client';
import { moveErrorOf, receiptKey, receiptsKey, useAddReceipt, useMoveReceipt } from '../receiptQueries';

afterEach(() => vi.unstubAllGlobals());

const P = '11111111-1111-4111-8111-111111111111';
const E = 'e0000000-0000-4000-8000-000000000001';
const R = 'b0000000-0000-4000-8000-000000000001';
const base = `/v1/expenses/${E}/receipts`;
const file = new File(['%PDF'], 'taxi.pdf', { type: 'application/pdf' });
const started = () => ok({ receipt: { id: R }, upload: { url: `https://storage.googleapis.com/b/${R}`, method: 'PUT', headers: {}, expiresAt: '2099-01-01T00:00:00Z' } }, 201);

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, wrapper };
}

/** The keys a call to invalidateQueries named, as JSON, so the assertion reads like the cache. */
function invalidated(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls.map(([filters]) => JSON.stringify((filters as { queryKey: unknown }).queryKey));
}

describe('useAddReceipt (MUT-491 R2)', () => {
  it('refreshes the expense and the Receipts tab after a receipt lands', async () => {
    stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: () => new Response(null, { status: 200 }), [`POST ${base}/${R}/complete`]: () => ok({ id: R, status: 'READY' }) });
    const { queryClient, wrapper } = client();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAddReceipt(P, E), { wrapper });
    await act(() => result.current.mutateAsync(file));
    expect(invalidated(spy)).toEqual(expect.arrayContaining([expenseKey(P, E), receiptsKey(P, 'list'), receiptsKey(P, 'counts')].map((k) => JSON.stringify(k))));
  });

  it('refreshes after a failure too: a complete whose answer was lost may have landed', async () => {
    stubApi({ [`POST ${base}`]: started, [`PUT /b/${R}`]: () => new Response(null, { status: 200 }), [`POST ${base}/${R}/complete`]: () => fail(502, 'UNKNOWN') });
    const { queryClient, wrapper } = client();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAddReceipt(P, E), { wrapper });
    await act(() => result.current.mutateAsync(file).catch(() => undefined));
    expect(invalidated(spy)).toContain(JSON.stringify(expenseKey(P, E)));
  });
});

describe('useMoveReceipt (MUT-503)', () => {
  const B = '22222222-2222-4222-8222-222222222222';
  const moved = () => ok({ receipt: { id: R, organizationId: B }, fromProfileId: P });

  it('refreshes both profiles\' receipts and drops the receipt\'s cached page on this profile', async () => {
    stubApi({ [`POST /v1/receipts/${R}/move`]: moved });
    const { queryClient, wrapper } = client();
    queryClient.setQueryData(receiptKey(P, R), { id: R });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMoveReceipt(P), { wrapper });
    await act(() => result.current.mutateAsync({ receiptId: R, targetProfileId: B, idempotencyKey: 'k1' }));
    expect(invalidated(spy)).toEqual(expect.arrayContaining([receiptsKey(P, 'list'), receiptsKey(P, 'counts'), receiptsKey(B, 'list'), receiptsKey(B, 'counts')].map((k) => JSON.stringify(k))));
    expect(queryClient.getQueryData(receiptKey(P, R))).toBeUndefined();
  });

  it('D8: a 404 whose receipt is found on the other profile is a success; one found nowhere stays a failure', async () => {
    stubApi({ [`POST /v1/receipts/${R}/move`]: () => fail(404, 'NOT_FOUND', { reason: 'RECEIPT_NOT_FOUND' }), [`GET /v1/receipts/${R}`]: () => ok({ id: R, organizationId: B }) });
    const { wrapper } = client();
    const { result } = renderHook(() => useMoveReceipt(P), { wrapper });
    await expect(act(() => result.current.mutateAsync({ receiptId: R, targetProfileId: B, idempotencyKey: 'k2' }))).resolves.toMatchObject({ fromProfileId: P });

    stubApi({ [`POST /v1/receipts/${R}/move`]: () => fail(404, 'NOT_FOUND', { reason: 'RECEIPT_NOT_FOUND' }), [`GET /v1/receipts/${R}`]: () => fail(404, 'NOT_FOUND') });
    const second = renderHook(() => useMoveReceipt(P), { wrapper: client().wrapper });
    await expect(act(() => second.result.current.mutateAsync({ receiptId: R, targetProfileId: B, idempotencyKey: 'k3' }))).rejects.toBeInstanceOf(ApiError);
  });
});

describe('moveErrorOf (MUT-503)', () => {
  it.each([
    [new ApiError(402, 'SUBSCRIPTION_LAPSED', 'x'), 'lapsed'],
    [new ApiError(404, 'NOT_FOUND', 'x', { reason: 'PROFILE_NOT_FOUND' }), 'noAccess'],
    [new ApiError(409, 'CONFLICT', 'x', { reason: 'RECEIPT_ALREADY_FILED' }), 'alreadyFiled'],
    [new ApiError(409, 'CONFLICT', 'x', { reason: 'RECEIPT_FILE_MISSING' }), 'fileMissing'],
    [new ApiError(422, 'VALIDATION_FAILED', 'x', { reason: 'ATTACHMENT_NOT_READY' }), 'notReady'],
    [new ApiError(404, 'NOT_FOUND', 'x', { reason: 'RECEIPT_NOT_FOUND' }), 'gone'],
    [new ApiError(500, 'INTERNAL', 'x'), 'failed'],
    [new TypeError('Failed to fetch'), 'failed'],
  ])('%s → %s', (error, key) => {
    expect(moveErrorOf(error)).toBe(key);
  });
});
