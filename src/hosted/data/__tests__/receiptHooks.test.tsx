import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fail, ok, stubApi } from '../../__tests__/harness';
import { expenseKey } from '../expenseQueries';
import { receiptsKey, useAddReceipt } from '../receiptQueries';

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
