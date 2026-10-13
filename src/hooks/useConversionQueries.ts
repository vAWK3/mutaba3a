/**
 * Conversion-specific query hooks (MUT-141)
 *
 * Mirrors useIncomeQueries.ts: a semantic API over the generic transaction
 * repository, pre-filtered to kind='conversion'. Conversions are logged
 * money movements between currencies, excluded from P&L by construction
 * (src/db/aggregations.ts, src/lib/aggregations.ts) -- this file only
 * reads/writes them, it never aggregates them into totals.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRepositories } from '../db';
import { useMutationWithFeedback } from './useMutationWithFeedback';
import type { QueryFilters, Transaction, Currency } from '../types';
import { invalidateTransactionQueries } from './useQueries';

export interface ConversionFilters {
  profileId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export const conversionQueryKeys = {
  conversions: (filters: ConversionFilters) => ['conversions', filters] as const,
  conversionById: (id: string) => ['conversions', id] as const,
};

function invalidateConversionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateTransactionQueries(queryClient);
}

/** Fetch conversion transactions with optional filters. Always filters by kind='conversion'. */
export function useConversions(filters: ConversionFilters = {}) {
  const queryFilters: QueryFilters = {
    kind: 'conversion',
    profileId: filters.profileId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    search: filters.search,
    sort: { by: 'occurredAt', dir: 'desc' },
  };

  return useQuery({
    queryKey: conversionQueryKeys.conversions(filters),
    queryFn: () => getRepositories().base.transactions.list(queryFilters),
  });
}

/** Fetch a single conversion transaction by ID. */
export function useConversionById(id: string) {
  return useQuery<Transaction | null>({
    queryKey: conversionQueryKeys.conversionById(id),
    queryFn: async () => (await getRepositories().base.transactions.get(id)) ?? null,
    enabled: !!id,
  });
}

export interface CreateConversionData {
  profileId?: string;
  amountMinor: number;
  currency: Currency;
  toAmountMinor: number;
  toCurrency: Currency;
  occurredAt: string;
  notes?: string;
}

/** Create a new conversion transaction. Always paid (MUT-141: no due/unpaid concept for a conversion). */
export function useCreateConversion() {
  const queryClient = useQueryClient();

  return useMutationWithFeedback({
    mutationFn: (data: CreateConversionData) =>
      getRepositories().base.transactions.create({ ...data, kind: 'conversion', status: 'paid' }),
    onSuccess: () => invalidateConversionQueries(queryClient),
    errorMessage: 'Failed to create conversion. Please try again.',
  });
}

/** Update an existing conversion transaction. */
export function useUpdateConversion() {
  const queryClient = useQueryClient();

  return useMutationWithFeedback({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateConversionData> }) =>
      getRepositories().base.transactions.update(id, data),
    onSuccess: () => invalidateConversionQueries(queryClient),
    errorMessage: 'Failed to update conversion. Please try again.',
  });
}

/** Delete (soft delete) a conversion transaction. */
export function useDeleteConversion() {
  const queryClient = useQueryClient();

  return useMutationWithFeedback({
    mutationFn: (id: string) => getRepositories().base.transactions.softDelete(id),
    onSuccess: () => invalidateConversionQueries(queryClient),
    errorMessage: 'Failed to delete conversion. Please try again.',
  });
}
