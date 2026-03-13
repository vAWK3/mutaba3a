/**
 * Income-specific query hooks
 *
 * These hooks provide a semantic API for income-related operations.
 * They wrap the generic transaction repository with income-specific filters.
 *
 * Use these hooks when working with income data specifically.
 * For mixed views (income + old-style expenses), use useTransactions from useQueries.ts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { transactionRepo } from '../db';
import type { QueryFilters, Transaction, Currency, TxStatus } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const incomeQueryKeys = {
  income: (filters: IncomeFilters) => ['income', filters] as const,
  incomeById: (id: string) => ['income', id] as const,
  receivables: (filters: ReceivablesFilters) => ['receivables', filters] as const,
  overviewTotals: (dateFrom: string, dateTo: string, currency?: Currency, profileId?: string) =>
    ['incomeOverviewTotals', { dateFrom, dateTo, currency, profileId }] as const,
  attentionReceivables: (currency?: Currency, profileId?: string) =>
    ['incomeAttentionReceivables', { currency, profileId }] as const,
};

// ============================================================================
// Filter Types
// ============================================================================

export interface IncomeFilters {
  profileId?: string;
  clientId?: string;
  projectId?: string;
  currency?: Currency;
  status?: TxStatus | 'overdue';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

export interface ReceivablesFilters {
  profileId?: string;
  clientId?: string;
  projectId?: string;
  currency?: Currency;
  /** Filter by overdue only */
  overdueOnly?: boolean;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

// ============================================================================
// Invalidation Helpers
// ============================================================================

function invalidateIncomeQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['income'] });
  queryClient.invalidateQueries({ queryKey: ['receivables'] });
  queryClient.invalidateQueries({ queryKey: ['incomeOverviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['incomeAttentionReceivables'] });
  // Also invalidate legacy transaction queries for backwards compatibility
  queryClient.invalidateQueries({ queryKey: ['transactions'] });
  queryClient.invalidateQueries({ queryKey: ['transaction'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotals'] });
  queryClient.invalidateQueries({ queryKey: ['overviewTotalsByCurrency'] });
  queryClient.invalidateQueries({ queryKey: ['attentionReceivables'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['projectSummary'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummaries'] });
  queryClient.invalidateQueries({ queryKey: ['clientSummary'] });
}

// ============================================================================
// Income Query Hooks
// ============================================================================

/**
 * Fetch income transactions with optional filters.
 * Always filters by kind='income'.
 */
export function useIncome(filters: IncomeFilters = {}) {
  const queryFilters: QueryFilters = {
    kind: 'income',
    profileId: filters.profileId,
    clientId: filters.clientId,
    projectId: filters.projectId,
    currency: filters.currency,
    status: filters.status,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    search: filters.search,
    limit: filters.limit,
    sort: filters.sort,
  };

  return useQuery({
    queryKey: incomeQueryKeys.income(filters),
    queryFn: () => transactionRepo.list(queryFilters),
  });
}

/**
 * Fetch a single income transaction by ID.
 */
export function useIncomeById(id: string) {
  return useQuery({
    queryKey: incomeQueryKeys.incomeById(id),
    queryFn: () => transactionRepo.get(id),
    enabled: !!id,
  });
}

/**
 * Fetch receivables (unpaid income).
 * Convenience hook that pre-filters to kind='income' + status='unpaid'.
 */
export function useReceivables(filters: ReceivablesFilters = {}) {
  const queryFilters: QueryFilters = {
    kind: 'income',
    status: filters.overdueOnly ? 'overdue' : 'unpaid',
    profileId: filters.profileId,
    clientId: filters.clientId,
    projectId: filters.projectId,
    currency: filters.currency,
    sort: filters.sort || { by: 'dueDate', dir: 'asc' },
  };

  return useQuery({
    queryKey: incomeQueryKeys.receivables(filters),
    queryFn: () => transactionRepo.list(queryFilters),
  });
}

/**
 * Fetch income totals for overview displays.
 */
export function useIncomeTotals(dateFrom: string, dateTo: string, currency?: Currency, profileId?: string) {
  return useQuery({
    queryKey: incomeQueryKeys.overviewTotals(dateFrom, dateTo, currency, profileId),
    queryFn: () => transactionRepo.getOverviewTotals({ dateFrom, dateTo, currency, profileId }),
  });
}

/**
 * Fetch receivables that need attention (overdue or due soon).
 */
export function useAttentionReceivables(currency?: Currency, profileId?: string) {
  return useQuery({
    queryKey: incomeQueryKeys.attentionReceivables(currency, profileId),
    queryFn: () => transactionRepo.getAttentionReceivables({ currency, profileId }),
  });
}

// ============================================================================
// Income Mutation Hooks
// ============================================================================

/**
 * Create a new income transaction.
 */
export function useCreateIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) =>
      transactionRepo.create({ ...data, kind: 'income' }),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Update an existing income transaction.
 */
export function useUpdateIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) =>
      transactionRepo.update(id, data),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Mark an income transaction as paid.
 */
export function useMarkIncomePaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.markPaid(id),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Record a partial payment on an income transaction.
 */
export function useRecordIncomePartialPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, paymentAmountMinor }: { id: string; paymentAmountMinor: number }) =>
      transactionRepo.recordPartialPayment(id, paymentAmountMinor),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Delete (soft delete) an income transaction.
 */
export function useDeleteIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.softDelete(id),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Archive an income transaction.
 */
export function useArchiveIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.archive(id),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}

/**
 * Unarchive an income transaction.
 */
export function useUnarchiveIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => transactionRepo.unarchive(id),
    onSuccess: () => invalidateIncomeQueries(queryClient),
  });
}
