import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFxRate, fxQueryKeys } from '../useFxRate';
import * as fxModule from '../../lib/fx';

// Mock the fx module
vi.mock('../../lib/fx', () => ({
  fetchLiveFxRate: vi.fn(),
  getCachedFxRate: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
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

describe('useFxRate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fxModule.getCachedFxRate as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful rate fetch', () => {
    it('should return rate from live API', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.75,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.rate).toBe(3.75);
      expect(result.current.source).toBe('api');
      expect(result.current.rateDate).toBe('2026-03-13');
      expect(result.current.lastUpdated).toBe('2026-03-13T12:00:00Z');
      expect(result.current.isError).toBe(false);
    });

    it('should use default currencies (USD to ILS)', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.75,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      renderHook(() => useFxRate(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(fxModule.fetchLiveFxRate).toHaveBeenCalledWith('USD', 'ILS');
      });
    });

    it('should support EUR to USD conversion', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 1.08,
        base: 'EUR',
        quote: 'USD',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('EUR', 'USD'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.rate).toBe(1.08);
      });
    });
  });

  describe('cached data', () => {
    it('should use cached rate as placeholder', async () => {
      (fxModule.getCachedFxRate as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        rate: 3.70,
        date: '2026-03-12',
        fetchedAt: '2026-03-12T12:00:00Z',
      });
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.75,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      // Initially may show cached
      await waitFor(() => {
        expect(result.current.rate).toBe(3.75);
      });
    });
  });

  describe('error handling', () => {
    it('should handle fetch error', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      // The hook might not immediately show error due to retry config
      // Wait for loading to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      }, { timeout: 5000 });

      // After all retries fail, rate should be null
      expect(result.current.rate).toBeNull();
    });

    it('should return null rate when rate is zero', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 0,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.rate).toBeNull();
    });

    it('should return null rate when rate is negative', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: -1,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.rate).toBeNull();
    });
  });

  describe('loading state', () => {
    it('should indicate loading while fetching', () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('source handling', () => {
    it('should return source as none when no data', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.source).toBe('none');
    });

    it('should return cached source when using cache', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.70,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-12',
        source: 'cached',
        fetchedAt: '2026-03-12T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.source).toBe('cached');
      });
    });
  });

  describe('null handling', () => {
    it('should return null for rateDate when no date in response', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.75,
        base: 'USD',
        quote: 'ILS',
        source: 'api',
        fetchedAt: '2026-03-13T12:00:00Z',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.rateDate).toBeNull();
      });
    });

    it('should return null for lastUpdated when no fetchedAt in response', async () => {
      (fxModule.fetchLiveFxRate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        rate: 3.75,
        base: 'USD',
        quote: 'ILS',
        date: '2026-03-13',
        source: 'api',
      });

      const { result } = renderHook(() => useFxRate('USD', 'ILS'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.lastUpdated).toBeNull();
      });
    });
  });
});

describe('fxQueryKeys', () => {
  it('should generate correct query key for rate', () => {
    const key = fxQueryKeys.rate('USD', 'ILS');
    expect(key).toEqual(['fxRate', 'USD', 'ILS']);
  });

  it('should generate different keys for different currency pairs', () => {
    const key1 = fxQueryKeys.rate('USD', 'ILS');
    const key2 = fxQueryKeys.rate('EUR', 'USD');
    expect(key1).not.toEqual(key2);
  });
});
