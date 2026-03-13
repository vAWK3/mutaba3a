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
import { transactionRepo } from '../../db';

// Mock the database
vi.mock('../../db', () => ({
  transactionRepo: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    markPaid: vi.fn(),
  },
}));

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
      (transactionRepo.markPaid as ReturnType<typeof vi.fn>).mockResolvedValue(mockIncome);

      const { result } = renderHook(
        () => useMarkIncomePaid(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('tx-1');
      });

      expect(transactionRepo.markPaid).toHaveBeenCalledWith('tx-1');
    });
  });
});
