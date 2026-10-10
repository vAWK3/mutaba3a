import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useRetainer } from '../useRetainerQueries';
import { getRepositories } from '../../db';

// The hook resolves its repository through getRepositories(); only `get` is
// exercised here.
vi.mock('../../db', () => {
  const base = {
    retainerAgreements: { get: vi.fn() },
  };
  return { getRepositories: () => ({ base, synced: {} }) };
});

const retainerRepo = getRepositories().base.retainerAgreements;

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
