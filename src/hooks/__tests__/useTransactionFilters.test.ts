import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransactionFilters } from '../useTransactionFilters';

describe('useTransactionFilters', () => {
  describe('initialization', () => {
    it('should initialize with default preset "all"', () => {
      const { result } = renderHook(() => useTransactionFilters());

      expect(result.current.dateRange.dateFrom).toBe('2000-01-01');
      expect(result.current.dateRange.dateTo).toBe('2100-12-31');
    });

    it('should initialize with custom default preset', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ defaultPreset: 'this-year' })
      );

      const year = new Date().getFullYear();
      expect(result.current.dateRange.dateFrom).toBe(`${year}-01-01`);
      expect(result.current.dateRange.dateTo).toBe(`${year}-12-31`);
    });

    it('should initialize with undefined filters', () => {
      const { result } = renderHook(() => useTransactionFilters());

      expect(result.current.currency).toBeUndefined();
      expect(result.current.typeFilter).toBeUndefined();
      expect(result.current.statusFilter).toBeUndefined();
      expect(result.current.search).toBe('');
    });
  });

  describe('setters', () => {
    it('should update date range', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setDateRange({
          dateFrom: '2024-01-01',
          dateTo: '2024-12-31',
        });
      });

      expect(result.current.dateRange.dateFrom).toBe('2024-01-01');
      expect(result.current.dateRange.dateTo).toBe('2024-12-31');
    });

    it('should update currency', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setCurrency('USD');
      });

      expect(result.current.currency).toBe('USD');
    });

    it('should update type filter', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setTypeFilter('income');
      });

      expect(result.current.typeFilter).toBe('income');
    });

    it('should update status filter', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setStatusFilter('paid');
      });

      expect(result.current.statusFilter).toBe('paid');
    });

    it('should update search', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setSearch('test query');
      });

      expect(result.current.search).toBe('test query');
    });
  });

  describe('queryFilters', () => {
    it('should include date range in query filters', () => {
      const { result } = renderHook(() => useTransactionFilters());

      expect(result.current.queryFilters.dateFrom).toBe('2000-01-01');
      expect(result.current.queryFilters.dateTo).toBe('2100-12-31');
    });

    it('should include currency in query filters', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setCurrency('ILS');
      });

      expect(result.current.queryFilters.currency).toBe('ILS');
    });

    it('should include search in query filters when set', () => {
      const { result } = renderHook(() => useTransactionFilters());

      act(() => {
        result.current.setSearch('invoice');
      });

      expect(result.current.queryFilters.search).toBe('invoice');
    });

    it('should not include empty search in query filters', () => {
      const { result } = renderHook(() => useTransactionFilters());

      expect(result.current.queryFilters.search).toBeUndefined();
    });

    it('should include fixed projectId in query filters', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ projectId: 'proj-123' })
      );

      expect(result.current.queryFilters.projectId).toBe('proj-123');
    });

    it('should include fixed clientId in query filters', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ clientId: 'client-456' })
      );

      expect(result.current.queryFilters.clientId).toBe('client-456');
    });

    it('should include default sort configuration', () => {
      const { result } = renderHook(() => useTransactionFilters());

      expect(result.current.queryFilters.sort).toEqual({
        by: 'occurredAt',
        dir: 'desc',
      });
    });
  });

  describe('type filter handling', () => {
    it('should not include type filter when withTypeFilter is false', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withTypeFilter: false })
      );

      act(() => {
        result.current.setTypeFilter('income');
      });

      expect(result.current.queryFilters.kind).toBeUndefined();
    });

    it('should include kind in query filters when withTypeFilter is true', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withTypeFilter: true })
      );

      act(() => {
        result.current.setTypeFilter('expense');
      });

      expect(result.current.queryFilters.kind).toBe('expense');
    });

    it('should handle receivable type filter specially', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withTypeFilter: true })
      );

      act(() => {
        result.current.setTypeFilter('receivable');
      });

      // Receivable = income + unpaid
      expect(result.current.queryFilters.kind).toBe('income');
      expect(result.current.queryFilters.status).toBe('unpaid');
    });
  });

  describe('status filter handling', () => {
    it('should not include status filter when withStatusFilter is false', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withStatusFilter: false })
      );

      act(() => {
        result.current.setStatusFilter('paid');
      });

      expect(result.current.queryFilters.status).toBeUndefined();
    });

    it('should include status in query filters when withStatusFilter is true', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withStatusFilter: true })
      );

      act(() => {
        result.current.setStatusFilter('unpaid');
      });

      expect(result.current.queryFilters.status).toBe('unpaid');
    });

    it('should not override status when receivable type is selected', () => {
      const { result } = renderHook(() =>
        useTransactionFilters({ withTypeFilter: true, withStatusFilter: true })
      );

      act(() => {
        result.current.setTypeFilter('receivable');
        result.current.setStatusFilter('paid'); // This should be ignored
      });

      // Receivable sets status to unpaid, statusFilter should not override
      expect(result.current.queryFilters.status).toBe('unpaid');
    });
  });
});
