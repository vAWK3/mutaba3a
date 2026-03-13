import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useTransactionActions } from '../useTransactionActions';
import * as storesModule from '../../lib/stores';
import * as useQueriesModule from '../useQueries';

// Mock the stores
vi.mock('../../lib/stores', () => ({
  useDrawerStore: vi.fn(),
}));

// Mock useQueries
vi.mock('../useQueries', () => ({
  useMarkTransactionPaid: vi.fn(),
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

describe('useTransactionActions', () => {
  const mockOpenTransactionDrawer = vi.fn();
  const mockMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (storesModule.useDrawerStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      openTransactionDrawer: mockOpenTransactionDrawer,
    });

    (useQueriesModule.useMarkTransactionPaid as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isLoading: false,
      isError: false,
    });
  });

  describe('handleRowClick', () => {
    it('should open transaction drawer in edit mode', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleRowClick('tx-123');
      });

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        transactionId: 'tx-123',
      });
    });
  });

  describe('handleMarkPaid', () => {
    it('should call mutateAsync with transaction ID', async () => {
      mockMutateAsync.mockResolvedValue({});

      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      const mockEvent = {
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      await act(async () => {
        await result.current.handleMarkPaid(mockEvent, 'tx-456');
      });

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
      expect(mockMutateAsync).toHaveBeenCalledWith('tx-456');
    });

    it('should stop event propagation', async () => {
      mockMutateAsync.mockResolvedValue({});

      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      const mockEvent = {
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent;

      await act(async () => {
        await result.current.handleMarkPaid(mockEvent, 'tx-789');
      });

      expect(mockEvent.stopPropagation).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleCreate', () => {
    it('should open transaction drawer in create mode without prefill', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleCreate();
      });

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'create',
      });
    });

    it('should open transaction drawer with client prefill', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleCreate({ clientId: 'client-123' });
      });

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'create',
        clientId: 'client-123',
      });
    });

    it('should open transaction drawer with project prefill', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleCreate({ projectId: 'project-456' });
      });

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'create',
        projectId: 'project-456',
      });
    });

    it('should open transaction drawer with both client and project prefill', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleCreate({
          clientId: 'client-123',
          projectId: 'project-456',
        });
      });

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'create',
        clientId: 'client-123',
        projectId: 'project-456',
      });
    });
  });

  describe('markPaidMutation', () => {
    it('should expose the mutation object', () => {
      const { result } = renderHook(() => useTransactionActions(), {
        wrapper: createWrapper(),
      });

      expect(result.current.markPaidMutation).toBeDefined();
      expect(result.current.markPaidMutation.mutateAsync).toBe(mockMutateAsync);
    });
  });
});
