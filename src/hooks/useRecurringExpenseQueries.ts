/**
 * React Query hooks for recurring expense operations.
 *
 * Provides query and mutation hooks for:
 * - Virtual occurrences (computed from rules)
 * - Due/overdue occurrences (needs attention)
 * - Persisted occurrences
 * - Payment confirmation, skipping, snoozing
 * - Rule CRUD operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getVirtualOccurrences,
  getDueOccurrences,
  confirmPayment,
  skipOccurrence,
  snoozeOccurrence,
  createRecurringRule,
  getRuleHistory,
  type ConfirmPaymentParams,
  type SkipOccurrenceParams,
  type SnoozeOccurrenceParams,
  type CreateRecurringRuleParams,
} from '../services/recurringExpenseService';
import {
  recurringRuleRepo,
  recurringOccurrenceRepo,
} from '../db/expenseRepository';
import type { RecurringRule } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const recurringExpenseQueryKeys = {
  // Virtual occurrences (computed)
  virtualOccurrences: (profileId: string, dateFrom: string, dateTo: string) =>
    ['virtualOccurrences', { profileId, dateFrom, dateTo }] as const,

  // Due/overdue occurrences for attention
  dueOccurrences: (profileId: string) =>
    ['dueOccurrences', profileId] as const,

  // Persisted occurrences
  occurrences: (filters: {
    profileId: string;
    ruleId?: string;
    status?: string | string[];
    dateFrom?: string;
    dateTo?: string;
  }) => ['recurringOccurrences', filters] as const,

  occurrence: (id: string) =>
    ['recurringOccurrence', id] as const,

  // Rule history
  ruleHistory: (ruleId: string) =>
    ['recurringRuleHistory', ruleId] as const,

  // Rules (re-export for consistency)
  rules: (profileId?: string) =>
    ['recurringRules', { profileId }] as const,

  rule: (id: string) =>
    ['recurringRule', id] as const,

  activeRules: (profileId: string) =>
    ['activeRecurringRules', profileId] as const,
};

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch virtual occurrences for a date range.
 * These are computed from rules and merged with persisted occurrences.
 */
export function useVirtualOccurrences(
  profileId: string | undefined,
  dateFrom: string,
  dateTo: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.virtualOccurrences(profileId || '', dateFrom, dateTo),
    queryFn: () => getVirtualOccurrences(profileId!, dateFrom, dateTo),
    enabled: !!profileId && (options?.enabled !== false),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch due and overdue occurrences that need attention.
 */
export function useDueOccurrences(
  profileId: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.dueOccurrences(profileId || ''),
    queryFn: () => getDueOccurrences(profileId!),
    enabled: !!profileId && (options?.enabled !== false),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Fetch persisted occurrences with filters.
 */
export function useRecurringOccurrences(
  filters: {
    profileId: string;
    ruleId?: string;
    status?: string | string[];
    dateFrom?: string;
    dateTo?: string;
  },
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.occurrences(filters),
    queryFn: () => recurringOccurrenceRepo.list(filters as Parameters<typeof recurringOccurrenceRepo.list>[0]),
    enabled: !!filters.profileId && (options?.enabled !== false),
  });
}

/**
 * Fetch a single occurrence by ID.
 */
export function useRecurringOccurrence(id: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.occurrence(id || ''),
    queryFn: () => recurringOccurrenceRepo.get(id!),
    enabled: !!id,
  });
}

/**
 * Fetch occurrence history for a rule.
 */
export function useRuleHistory(ruleId: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.ruleHistory(ruleId || ''),
    queryFn: () => getRuleHistory(ruleId!),
    enabled: !!ruleId,
  });
}

/**
 * Fetch all recurring rules for a profile.
 */
export function useRecurringRules(profileId: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.rules(profileId),
    queryFn: () => recurringRuleRepo.list({ profileId }),
    enabled: !!profileId,
  });
}

/**
 * Fetch active (non-paused) recurring rules for a profile.
 */
export function useActiveRecurringRules(profileId: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.activeRules(profileId || ''),
    queryFn: () => recurringRuleRepo.listActive(profileId!),
    enabled: !!profileId,
  });
}

/**
 * Fetch a single recurring rule by ID.
 */
export function useRecurringRule(id: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.rule(id || ''),
    queryFn: () => recurringRuleRepo.get(id!),
    enabled: !!id,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Confirm payment for a recurring expense occurrence.
 * Creates an expense and marks the occurrence as resolved_paid.
 */
export function useConfirmRecurringPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: ConfirmPaymentParams) => confirmPayment(params),
    onSuccess: (_expense, params) => {
      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['recurringOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: recurringExpenseQueryKeys.ruleHistory(params.ruleId),
      });
      // Also invalidate expense queries
      queryClient.invalidateQueries({
        queryKey: ['expenses'],
      });
    },
  });
}

/**
 * Skip a recurring expense occurrence.
 */
export function useSkipRecurringOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SkipOccurrenceParams) => skipOccurrence(params),
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['recurringOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: recurringExpenseQueryKeys.ruleHistory(params.ruleId),
      });
    },
  });
}

/**
 * Snooze a recurring expense occurrence.
 */
export function useSnoozeRecurringOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SnoozeOccurrenceParams) => snoozeOccurrence(params),
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['recurringOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: recurringExpenseQueryKeys.ruleHistory(params.ruleId),
      });
    },
  });
}

/**
 * Create a new recurring expense rule.
 */
export function useCreateRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateRecurringRuleParams) => createRecurringRule(params),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['recurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['activeRecurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
    },
  });
}

/**
 * Update a recurring expense rule.
 */
export function useUpdateRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RecurringRule> }) => {
      await recurringRuleRepo.update(id, data);
      return recurringRuleRepo.get(id);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({
        queryKey: ['recurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['activeRecurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: recurringExpenseQueryKeys.rule(id),
      });
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
    },
  });
}

/**
 * Pause a recurring expense rule.
 */
export function usePauseRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['recurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['activeRecurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
    },
  });
}

/**
 * Resume a paused recurring expense rule.
 */
export function useResumeRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.resume(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['recurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['activeRecurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
    },
  });
}

/**
 * Soft delete a recurring expense rule.
 */
export function useDeleteRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.softDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['recurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['activeRecurringRules'],
      });
      queryClient.invalidateQueries({
        queryKey: ['virtualOccurrences'],
      });
      queryClient.invalidateQueries({
        queryKey: ['dueOccurrences'],
      });
    },
  });
}
