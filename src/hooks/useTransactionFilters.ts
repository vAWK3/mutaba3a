import { useState, useMemo } from 'react';
import { getDateRangePreset } from '../lib/utils';
import type { Currency, TxKind, TxStatus, QueryFilters } from '../types';

type TypeFilter = TxKind | 'receivable' | undefined;
type DatePreset = 'this-month' | 'last-month' | 'this-year' | 'all';

interface UseTransactionFiltersOptions {
  /** Default date range preset. Defaults to 'this-month' */
  defaultPreset?: DatePreset;
  /** Whether to include type filter. Defaults to false */
  withTypeFilter?: boolean;
  /** Whether to include status filter. Defaults to false */
  withStatusFilter?: boolean;
  /** Fixed project ID to filter by */
  projectId?: string;
  /** Fixed client ID to filter by */
  clientId?: string;
}

interface TransactionFiltersState {
  dateRange: { dateFrom: string; dateTo: string };
  setDateRange: (range: { dateFrom: string; dateTo: string }) => void;
  currency: Currency | undefined;
  setCurrency: (currency: Currency | undefined) => void;
  typeFilter: TypeFilter;
  setTypeFilter: (type: TypeFilter) => void;
  statusFilter: TxStatus | 'overdue' | undefined;
  setStatusFilter: (status: TxStatus | 'overdue' | undefined) => void;
  search: string;
  setSearch: (search: string) => void;
  /** Ready-to-use query filters for useTransactions */
  queryFilters: QueryFilters;
}

/**
 * Consolidates filter state management for transaction lists.
 * Used by TransactionsPage, ProjectDetailPage, ClientDetailPage.
 */
export function useTransactionFilters(options: UseTransactionFiltersOptions = {}): TransactionFiltersState {
  const {
    defaultPreset = 'this-month',
    withTypeFilter = false,
    withStatusFilter = false,
    projectId,
    clientId,
  } = options;

  const [dateRange, setDateRange] = useState(() => getDateRangePreset(defaultPreset));
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(undefined);
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'overdue' | undefined>(undefined);
  const [search, setSearch] = useState('');

  const queryFilters = useMemo((): QueryFilters => {
    const filters: QueryFilters = {
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      currency,
      search: search || undefined,
      sort: { by: 'occurredAt', dir: 'desc' },
    };

    // Add fixed entity filters
    if (projectId) filters.projectId = projectId;
    if (clientId) filters.clientId = clientId;

    // Handle type filter with receivable special case
    if (withTypeFilter && typeFilter) {
      if (typeFilter === 'receivable') {
        filters.kind = 'income';
        filters.status = 'unpaid';
      } else {
        filters.kind = typeFilter;
      }
    }

    // Handle status filter (only if not already set by receivable)
    if (withStatusFilter && statusFilter && typeFilter !== 'receivable') {
      filters.status = statusFilter;
    }

    return filters;
  }, [dateRange, currency, typeFilter, statusFilter, search, projectId, clientId, withTypeFilter, withStatusFilter]);

  return {
    dateRange,
    setDateRange,
    currency,
    setCurrency,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    queryFilters,
  };
}
