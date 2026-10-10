import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  incomeQueryKeys,
  useIncome,
  useIncomeById,
  useReceivables,
  useCreateIncome,
  useUpdateIncome,
  useDeleteIncome,
  useMarkIncomePaid,
} from '../useIncomeQueries';
import { getRepositories } from '../../db';

// Mock the database. The hook resolves repositories through getRepositories(),
// so the fakes are handed back from there rather than exported individually.
// Assertions below still target the same two repository objects.
vi.mock('../../db', () => {
  const base = {
    transactions: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
      markPaid: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      getOverviewTotals: vi.fn(),
      getAttentionReceivables: vi.fn(),
    },
  };
  // Payment-related mutations go through the op-capturing decorator, not the
  // base repository. Keeping them separate here preserves that distinction.
  const synced = {
    transactions: {
      markPaid: vi.fn(),
      recordPartialPayment: vi.fn(),
    },
  };
  const repositories = { base, synced };
  return { getRepositories: () => repositories };
});

const transactionRepo = getRepositories().base.transactions;
const syncedTransactionRepo = getRepositories().synced.transactions;

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

describe('incomeQueryKeys', () => {
  it('should generate income key with filters', () => {
    const key = incomeQueryKeys.income({ profileId: 'profile-1', status: 'paid' });
    expect(key).toEqual(['income', { profileId: 'profile-1', status: 'paid' }]);
  });

  it('should generate incomeById key', () => {
    const key = incomeQueryKeys.incomeById('income-1');
    expect(key).toEqual(['income', 'income-1']);
  });

  it('should generate receivables key', () => {
    const key = incomeQueryKeys.receivables({ profileId: 'profile-1' });
    expect(key).toEqual(['receivables', { profileId: 'profile-1' }]);
  });

  it('should generate overviewTotals key', () => {
    const key = incomeQueryKeys.overviewTotals('2026-03-01', '2026-03-31', 'USD', 'profile-1');
    expect(key).toEqual(['incomeOverviewTotals', {
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      currency: 'USD',
      profileId: 'profile-1',
    }]);
  });

  it('should generate attentionReceivables key', () => {
    const key = incomeQueryKeys.attentionReceivables('USD', 'profile-1');
    expect(key).toEqual(['incomeAttentionReceivables', { currency: 'USD', profileId: 'profile-1' }]);
  });
});

describe('useIncome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch income transactions', async () => {
    const mockIncomes = [
      { id: 'tx-1', kind: 'income', title: 'Payment', amountMinor: 100000 },
    ];
    (transactionRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncomes);

    const { result } = renderHook(
      () => useIncome({ profileId: 'profile-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockIncomes);
    expect(transactionRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'income',
        profileId: 'profile-1',
      })
    );
  });

  it('should filter by date range', async () => {
    (transactionRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { result } = renderHook(
      () => useIncome({
        profileId: 'profile-1',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(transactionRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
      })
    );
  });

  it('should filter by status', async () => {
    (transactionRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { result } = renderHook(
      () => useIncome({ profileId: 'profile-1', status: 'unpaid' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(transactionRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'unpaid',
      })
    );
  });

  it('should filter by currency', async () => {
    (transactionRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { result } = renderHook(
      () => useIncome({ profileId: 'profile-1', currency: 'USD' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(transactionRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'USD',
      })
    );
  });
});

describe('useIncomeById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch income by id', async () => {
    const mockIncome = { id: 'tx-1', kind: 'income', title: 'Payment' };
    (transactionRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncome);

    const { result } = renderHook(
      () => useIncomeById('tx-1'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockIncome);
    expect(transactionRepo.get).toHaveBeenCalledWith('tx-1');
  });

  // TD-028: the repository resolves `undefined` for a deleted row, which
  // TanStack Query v5 treats as a failed fetch. The hook must normalise it.
  it('resolves to null with no console error when the row is missing', async () => {
    (transactionRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(
        () => useIncomeById('tx-gone'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('should not fetch when id is undefined', () => {
    renderHook(
      () => useIncomeById(undefined),
      { wrapper: createWrapper() }
    );

    expect(transactionRepo.get).not.toHaveBeenCalled();
  });
});

describe('useReceivables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch receivables (unpaid income)', async () => {
    const mockReceivables = [
      { id: 'tx-1', kind: 'income', status: 'unpaid', amountMinor: 50000 },
    ];
    (transactionRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockReceivables);

    const { result } = renderHook(
      () => useReceivables({ profileId: 'profile-1' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockReceivables);
  });
});

describe('Mutation Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useCreateIncome', () => {
    it('should create income transaction', async () => {
      const mockIncome = { id: 'tx-new', kind: 'income' };
      (transactionRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncome);

      const { result } = renderHook(
        () => useCreateIncome(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          profileId: 'profile-1',
          title: 'New Payment',
          amountMinor: 100000,
          currency: 'USD',
          status: 'paid',
          occurredAt: '2026-03-15',
          kind: 'income',
        });
      });

      expect(transactionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'income',
          title: 'New Payment',
        })
      );
    });
  });

  describe('useUpdateIncome', () => {
    it('should update income transaction', async () => {
      const mockIncome = { id: 'tx-1', title: 'Updated' };
      (transactionRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (transactionRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncome);

      const { result } = renderHook(
        () => useUpdateIncome(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          id: 'tx-1',
          data: { title: 'Updated' },
        });
      });

      expect(transactionRepo.update).toHaveBeenCalledWith('tx-1', { title: 'Updated' });
    });
  });

  describe('useDeleteIncome', () => {
    it('should soft delete income', async () => {
      (transactionRepo.softDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useDeleteIncome(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('tx-1');
      });

      expect(transactionRepo.softDelete).toHaveBeenCalledWith('tx-1');
    });
  });

  describe('useMarkIncomePaid', () => {
    it('should mark income as paid', async () => {
      const mockIncome = { id: 'tx-1', status: 'paid' };
      (syncedTransactionRepo.markPaid as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncome);

      const { result } = renderHook(
        () => useMarkIncomePaid(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('tx-1');
      });

      expect(syncedTransactionRepo.markPaid).toHaveBeenCalledWith('tx-1');
    });

    /**
     * The Overview KPI strip and attention feed read money-event keys derived
     * from this very transaction. Until MUT-6 QA nothing invalidated them, so
     * the home page kept pre-payment numbers after every write.
     */
    it('should invalidate the derived money-event views', async () => {
      (syncedTransactionRepo.markPaid as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'tx-1' });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useMarkIncomePaid(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await act(async () => {
        await result.current.mutateAsync('tx-1');
      });

      const invalidated = invalidateQueries.mock.calls.map(
        ([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]
      );

      expect(invalidated).toEqual(
        expect.arrayContaining(['moneyMonthKPIsBoth', 'moneyGuidance', 'moneyEvents'])
      );
    });
  });
});
