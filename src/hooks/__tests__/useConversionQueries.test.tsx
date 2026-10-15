import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { db } from '../../db/database';
import { useConversions, useCreateConversion, useDeleteConversion, useUpdateConversion } from '../useConversionQueries';

// MUT-217: the Conversions list is keyed ['conversions', filters], so every write
// has to refresh that prefix too, not only the transaction queries.

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderConversions() {
  return renderHook(
    () => ({
      list: useConversions({ profileId: 'bp-1' }),
      create: useCreateConversion(),
      update: useUpdateConversion(),
      remove: useDeleteConversion(),
    }),
    { wrapper: wrapper() },
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('conversion writes refresh the Conversions list (MUT-217)', () => {
  it('shows a logged conversion, its edit and its delete without a reload', async () => {
    const { result } = renderConversions();
    await waitFor(() => expect(result.current.list.data).toEqual([]));

    let id = '';
    await act(async () => {
      const created = await result.current.create.mutateAsync({
        profileId: 'bp-1', amountMinor: 10000, currency: 'USD', toAmountMinor: 36500, toCurrency: 'ILS', occurredAt: '2026-10-01',
      });
      id = created.id;
    });
    await waitFor(() => expect(result.current.list.data?.map((t) => t.id)).toEqual([id]));

    await act(async () => {
      await result.current.update.mutateAsync({ id, data: { toAmountMinor: 37000 } });
    });
    await waitFor(() => expect(result.current.list.data?.[0]?.toAmountMinor).toBe(37000));

    await act(async () => {
      await result.current.remove.mutateAsync(id);
    });
    await waitFor(() => expect(result.current.list.data).toEqual([]));
  });
});
