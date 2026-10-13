import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useRetainer,
  useRetainerSummary,
  useMarkProjectedIncomeMissed,
  useUpdateDueStates,
  useRetainerMatchSuggestions,
  useAllRetainerMatchSuggestions,
  useMatchTransaction,
  useUnmatchTransaction,
} from '../useRetainerQueries';
import { getRepositories } from '../../db';

// The hooks resolve their repositories through getRepositories(), so the db
// barrel is mocked. Only the methods exercised below are faked.
vi.mock('../../db', () => {
  const base = {
    retainerAgreements: { get: vi.fn(), getSummary: vi.fn() },
    projectedIncome: {
      markMissed: vi.fn(),
      refreshDueStates: vi.fn(),
      getMatchSuggestions: vi.fn(),
      getAllMatchSuggestions: vi.fn(),
      match: vi.fn(),
      unmatch: vi.fn(),
    },
  };
  return { getRepositories: () => ({ base, synced: {} }) };
});

const retainerRepo = getRepositories().base.retainerAgreements;
const projectedIncome = getRepositories().base.projectedIncome;
type Mocked = ReturnType<typeof vi.fn>;

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

describe('useRetainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the retainer when it exists', async () => {
    const retainer = { id: 'ret-1', title: 'Monthly retainer' };
    (retainerRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(retainer);

    const { result } = renderHook(() => useRetainer('ret-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(retainer);
    expect(retainerRepo.get).toHaveBeenCalledWith('ret-1');
  });

  it('does not fetch when the id is empty', () => {
    renderHook(() => useRetainer(''), { wrapper: createWrapper() });

    expect(retainerRepo.get).not.toHaveBeenCalled();
  });

  // TD-028: the repository resolves `undefined` for a deleted row, which
  // TanStack Query v5 treats as a failed fetch. The hook must normalise it.
  it('resolves to null with no console error when the retainer is missing', async () => {
    (retainerRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useRetainer('ret-gone'), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

// MUT-47 (D3): retainer matching, due states, mark missed and the summary
// are repository methods now; no hook imports retainerRepository directly.
describe('retainer hooks resolve through the provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useRetainerSummary reads retainerAgreements.getSummary', async () => {
    const summary = { activeCount: 1 };
    (retainerRepo.getSummary as Mocked).mockResolvedValue(summary);

    const { result } = renderHook(() => useRetainerSummary('p-1', 'USD'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(summary);
    expect(retainerRepo.getSummary).toHaveBeenCalledWith('p-1', 'USD');
  });

  it('useRetainerMatchSuggestions and useAllRetainerMatchSuggestions read projectedIncome', async () => {
    (projectedIncome.getMatchSuggestions as Mocked).mockResolvedValue([]);
    (projectedIncome.getAllMatchSuggestions as Mocked).mockResolvedValue([]);

    const one = renderHook(() => useRetainerMatchSuggestions('tx-1'), { wrapper: createWrapper() });
    const all = renderHook(() => useAllRetainerMatchSuggestions(), { wrapper: createWrapper() });

    await waitFor(() => expect(one.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));
    expect(projectedIncome.getMatchSuggestions).toHaveBeenCalledWith('tx-1');
    expect(projectedIncome.getAllMatchSuggestions).toHaveBeenCalled();
  });

  it('the mutations call markMissed, refreshDueStates, match and unmatch', async () => {
    for (const fn of ['markMissed', 'refreshDueStates', 'match', 'unmatch'] as const) {
      (projectedIncome[fn] as Mocked).mockResolvedValue(undefined);
    }
    const wrapper = createWrapper();
    const missed = renderHook(() => useMarkProjectedIncomeMissed(), { wrapper });
    const due = renderHook(() => useUpdateDueStates(), { wrapper });
    const match = renderHook(() => useMatchTransaction(), { wrapper });
    const unmatch = renderHook(() => useUnmatchTransaction(), { wrapper });

    await missed.result.current.mutateAsync('pi-1');
    await due.result.current.mutateAsync();
    await match.result.current.mutateAsync({ projectedIncomeId: 'pi-1', transactionId: 'tx-1' });
    await unmatch.result.current.mutateAsync({ projectedIncomeId: 'pi-1', transactionId: 'tx-1' });

    expect(projectedIncome.markMissed).toHaveBeenCalledWith('pi-1');
    expect(projectedIncome.refreshDueStates).toHaveBeenCalled();
    expect(projectedIncome.match).toHaveBeenCalledWith('pi-1', 'tx-1');
    expect(projectedIncome.unmatch).toHaveBeenCalledWith('pi-1', 'tx-1');
  });
});
