import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useExpense, useRecurringRule } from '../useExpenseQueries';
import { getRepositories } from '../../db';

// The by-id hooks resolve their repositories through getRepositories(), so the
// fakes are handed back from there. Only `get` is exercised here.
vi.mock('../../db', () => {
  const base = {
    expenses: { get: vi.fn() },
    recurringRules: { get: vi.fn() },
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
