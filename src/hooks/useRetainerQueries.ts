import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  retainerRepo,
  projectedIncomeRepo,
  scheduleGenerator,
  retainerMatching,
  markProjectedIncomeMissed,
  getRetainerSummary,
} from '../db/retainerRepository';
import type {
  RetainerAgreement,
  RetainerFilters,
  ProjectedIncomeFilters,
  Currency,
} from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const retainerQueryKeys = {
  // Retainers
  retainers: (filters: RetainerFilters) => ['retainers', filters] as const,
  retainer: (id: string) => ['retainer', id] as const,
  retainerDisplay: (id: string) => ['retainerDisplay', id] as const,
  retainerSummary: (profileId?: string, currency?: Currency) => ['retainerSummary', profileId, currency] as const,

  // Projected Income
  projectedIncome: (filters: ProjectedIncomeFilters) => ['projectedIncome', filters] as const,
  retainerSchedule: (retainerId: string) => ['retainerSchedule', retainerId] as const,
  dueItems: (currency?: Currency) => ['dueItems', currency] as const,
  forecastItems: (dateFrom: string, dateTo: string, currency?: Currency) =>
    ['forecastItems', dateFrom, dateTo, currency] as const,

  // Matching
  matchSuggestions: (transactionId: string) => ['retainerMatchSuggestions', transactionId] as const,
  allMatchSuggestions: () => ['allRetainerMatchSuggestions'] as const,
};

// ============================================================================
// Invalidation Helpers
// ============================================================================

function invalidateRetainerQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['retainers'] });
  queryClient.invalidateQueries({ queryKey: ['retainer'] });
  queryClient.invalidateQueries({ queryKey: ['retainerDisplay'] });
  queryClient.invalidateQueries({ queryKey: ['retainerSummary'] });
}

function invalidateProjectedIncomeQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['projectedIncome'] });
  queryClient.invalidateQueries({ queryKey: ['retainerSchedule'] });
  queryClient.invalidateQueries({ queryKey: ['dueItems'] });
  queryClient.invalidateQueries({ queryKey: ['forecastItems'] });
}

function invalidateMatchingQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['retainerMatchSuggestions'] });
  queryClient.invalidateQueries({ queryKey: ['allRetainerMatchSuggestions'] });
}

function invalidateAllRetainerQueries(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateRetainerQueries(queryClient);
  invalidateProjectedIncomeQueries(queryClient);
  invalidateMatchingQueries(queryClient);
}

// ============================================================================
// Retainer Queries
// ============================================================================

/**
 * List retainers with filters
 */
export function useRetainers(filters: RetainerFilters = {}) {
  return useQuery({
    queryKey: retainerQueryKeys.retainers(filters),
    queryFn: () => retainerRepo.list(filters),
  });
}

/**
 * Get a single retainer by ID
 */
export function useRetainer(id: string) {
  return useQuery({
    queryKey: retainerQueryKeys.retainer(id),
    queryFn: () => retainerRepo.get(id),
    enabled: !!id,
  });
}

/**
 * Get a single retainer with display enrichment
 */
export function useRetainerDisplay(id: string) {
  return useQuery({
    queryKey: retainerQueryKeys.retainerDisplay(id),
    queryFn: () => retainerRepo.getDisplay(id),
    enabled: !!id,
  });
}

/**
 * Get retainer summary totals
 */
export function useRetainerSummary(profileId?: string, currency?: Currency) {
  return useQuery({
    queryKey: retainerQueryKeys.retainerSummary(profileId, currency),
    queryFn: () => getRetainerSummary(profileId, currency),
  });
}

// ============================================================================
// Retainer Mutations
// ============================================================================

/**
 * Create a new retainer
 */
export function useCreateRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<RetainerAgreement, 'id' | 'createdAt' | 'updatedAt'>) =>
      retainerRepo.create(data),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

/**
 * Update a retainer
 */
export function useUpdateRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RetainerAgreement> }) =>
      retainerRepo.update(id, data),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

/**
 * Archive a retainer
 */
export function useArchiveRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retainerRepo.archive(id),
    onSuccess: () => invalidateRetainerQueries(queryClient),
  });
}

/**
 * Activate a draft retainer
 */
export function useActivateRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retainerRepo.activate(id),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

/**
 * Pause an active retainer
 */
export function usePauseRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retainerRepo.pause(id),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

/**
 * Resume a paused retainer
 */
export function useResumeRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retainerRepo.resume(id),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

/**
 * End a retainer
 */
export function useEndRetainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => retainerRepo.end(id),
    onSuccess: () => invalidateAllRetainerQueries(queryClient),
  });
}

// ============================================================================
// Projected Income Queries
// ============================================================================

/**
 * List projected income items with filters
 */
export function useProjectedIncome(filters: ProjectedIncomeFilters = {}) {
  return useQuery({
    queryKey: retainerQueryKeys.projectedIncome(filters),
    queryFn: () => projectedIncomeRepo.list(filters),
  });
}

/**
 * Get projected income schedule for a specific retainer
 */
export function useRetainerSchedule(retainerId: string) {
  return useQuery({
    queryKey: retainerQueryKeys.retainerSchedule(retainerId),
    queryFn: () => projectedIncomeRepo.getByRetainer(retainerId),
    enabled: !!retainerId,
  });
}

/**
 * Get all due items
 */
export function useDueItems(currency?: Currency) {
  return useQuery({
    queryKey: retainerQueryKeys.dueItems(currency),
    queryFn: () => projectedIncomeRepo.getDueItems(currency),
  });
}

/**
 * Get projected income for forecast
 */
export function useForecastItems(dateFrom: string, dateTo: string, currency?: Currency) {
  return useQuery({
    queryKey: retainerQueryKeys.forecastItems(dateFrom, dateTo, currency),
    queryFn: () => projectedIncomeRepo.getForForecast(dateFrom, dateTo, currency),
    enabled: !!dateFrom && !!dateTo,
  });
}

// ============================================================================
// Projected Income Mutations
// ============================================================================

/**
 * Mark a projected income item as missed
 */
export function useMarkProjectedIncomeMissed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => markProjectedIncomeMissed(id),
    onSuccess: () => invalidateProjectedIncomeQueries(queryClient),
  });
}

/**
 * Update due states (call on app load or periodically)
 */
export function useUpdateDueStates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => scheduleGenerator.updateDueStates(),
    onSuccess: () => invalidateProjectedIncomeQueries(queryClient),
  });
}

// ============================================================================
// Matching Queries
// ============================================================================

/**
 * Get match suggestions for a specific transaction
 */
export function useRetainerMatchSuggestions(transactionId: string) {
  return useQuery({
    queryKey: retainerQueryKeys.matchSuggestions(transactionId),
    queryFn: () => retainerMatching.getSuggestionsForTransaction(transactionId),
    enabled: !!transactionId,
  });
}

/**
 * Get all match suggestions for unlinked income transactions
 */
export function useAllRetainerMatchSuggestions() {
  return useQuery({
    queryKey: retainerQueryKeys.allMatchSuggestions(),
    queryFn: () => retainerMatching.getAllSuggestionsForUnlinkedTransactions(),
  });
}

// ============================================================================
// Matching Mutations
// ============================================================================

/**
 * Match a transaction to a projected income item
 */
export function useMatchTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectedIncomeId,
      transactionId,
    }: {
      projectedIncomeId: string;
      transactionId: string;
    }) => retainerMatching.matchTransaction(projectedIncomeId, transactionId),
    onSuccess: () => {
      invalidateAllRetainerQueries(queryClient);
      // Also invalidate transaction queries
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transaction'] });
    },
  });
}

/**
 * Unmatch a transaction from a projected income item
 */
export function useUnmatchTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectedIncomeId,
      transactionId,
    }: {
      projectedIncomeId: string;
      transactionId: string;
    }) => retainerMatching.unmatchTransaction(projectedIncomeId, transactionId),
    onSuccess: () => {
      invalidateAllRetainerQueries(queryClient);
      // Also invalidate transaction queries
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['transaction'] });
    },
  });
}
