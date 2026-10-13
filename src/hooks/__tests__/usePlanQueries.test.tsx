import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  usePlan,
  usePlanAssumption,
  usePlanDefaultScenario,
  usePlanScenario,
  usePlanCategorySummary,
} from '../usePlanQueries';
import { getRepositories } from '../../db';

// The plan hooks resolve their repositories through getRepositories() (MUT-47),
// so the barrel is mocked. Only the lookups exercised below are faked.
vi.mock('../../db', () => {
  const base = {
    plans: { get: vi.fn() },
    planAssumptions: { get: vi.fn(), getCategorySummary: vi.fn() },
    planScenarios: { get: vi.fn(), getDefault: vi.fn() },
  };
  return { getRepositories: () => ({ base }) };
});

const { plans, planAssumptions, planScenarios } = getRepositories().base;

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

// TD-028: each lookup resolves `undefined` when the row is missing. TanStack
// Query v5 rejects `undefined` as query data (the query enters `error` state
// and logs "Query data cannot be undefined"), so each hook must normalise the
// absence to `null` and succeed. `usePlanDefaultScenario` is the one that
// legitimately has no row yet (a plan whose scenarios were never seeded).
const lookups = [
  { name: 'usePlan', hook: usePlan, get: () => plans.get as MockedGet },
  { name: 'usePlanAssumption', hook: usePlanAssumption, get: () => planAssumptions.get as MockedGet },
  { name: 'usePlanScenario', hook: usePlanScenario, get: () => planScenarios.get as MockedGet },
  { name: 'usePlanDefaultScenario', hook: usePlanDefaultScenario, get: () => planScenarios.getDefault as MockedGet },
] as const;

describe.each(lookups)('$name', ({ hook, get }) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row when it exists', async () => {
    const row = { id: 'row-1', name: 'Existing' };
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

describe('usePlanCategorySummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('summarises through the injected repositories in the plan currency', async () => {
    const summary = { revenue: { count: 1, totalMinor: 500 } };
    (plans.get as MockedGet).mockResolvedValue({ id: 'plan-1', currency: 'ILS' });
    (planAssumptions.getCategorySummary as MockedGet).mockResolvedValue(summary);

    const { result } = renderHook(() => usePlanCategorySummary('plan-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(summary);
    expect(planAssumptions.getCategorySummary).toHaveBeenCalledWith('plan-1', 'ILS');
  });
});
