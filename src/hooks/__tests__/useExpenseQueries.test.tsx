import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useExpense, useRecurringRule, useUpdateRecurringRule } from '../useExpenseQueries';
import { getRepositories } from '../../db';

// The by-id hooks resolve their repositories through getRepositories(), so the
// fakes are handed back from there. Only `get` is exercised here.
vi.mock('../../db', () => {
  const base = {
    expenses: { get: vi.fn() },
    recurringRules: { get: vi.fn(), update: vi.fn() },
  };
  return { getRepositories: () => ({ base, synced: {} }) };
});

const { base } = getRepositories();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

type MockedGet = ReturnType<typeof vi.fn>;

// TD-028: every repository `get(id)` resolves `undefined` for a deleted row.
// TanStack Query v5 rejects `undefined` as query data (the query enters
// `error` state and logs "Query data cannot be undefined"), so each hook must
// normalise the absence to `null` and succeed.
const byIdHooks = [
  { name: 'useExpense', hook: useExpense, get: () => base.expenses.get as MockedGet },
  { name: 'useRecurringRule', hook: useRecurringRule, get: () => base.recurringRules.get as MockedGet },
] as const;

describe.each(byIdHooks)('$name', ({ hook, get }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row when it exists', async () => {
    const row = { id: 'row-1', title: 'Existing' };
    get().mockResolvedValue(row);

    const { result } = renderHook(() => hook('row-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(row);
    expect(get()).toHaveBeenCalledWith('row-1');
  });

  it('does not fetch when the id is empty', () => {
    renderHook(() => hook(''), { wrapper: createWrapper() });

    expect(get()).not.toHaveBeenCalled();
  });

  it('resolves to null with no console error when the row is missing', async () => {
    get().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => hook('row-gone'), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

// MUT-87: a rule edited from a Needs attention row's ⋯ menu (Edit rule) must
// refresh that row; the due and virtual occurrences are computed from the rule.
describe('useUpdateRecurringRule', () => {
  it('refreshes the occurrence lists computed from the rule', async () => {
    (base.recurringRules.update as MockedGet).mockResolvedValue(undefined);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateRecurringRule(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'rule-1', data: { amountMinor: 9000 } });
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(['dueOccurrences']);
    expect(keys).toContainEqual(['virtualOccurrences']);
  });
});
