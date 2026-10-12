/**
 * React Query hooks for recurring expense operations.
 *
 * Provides query and mutation hooks for:
 * - Virtual occurrences (computed from rules)
 * - Due/overdue occurrences (needs attention)
 * - Persisted occurrences
 * - Payment confirmation, skipping, snoozing (in batches, MUT-87)
 * - Rule CRUD operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { withErrorToast } from './useMutationWithFeedback';

function useRecurringMutationWithToast<TData, TError extends Error, TVariables>(
  opts: Parameters<typeof useMutation<TData, TError, TVariables>>[0]
) {
  return useMutation(withErrorToast(opts));
}
import {
  getVirtualOccurrences,
  getDueOccurrences,
  confirmPayments,
  skipOccurrences,
  snoozeOccurrences,
  createRecurringRule,
  type ConfirmPaymentsParams,
  type SkipOccurrencesParams,
  type SnoozeOccurrencesParams,
  type CreateRecurringRuleParams,
} from '../services/recurringExpenseService';
import { getRepositories } from '../db';
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
 * Fetch all recurring rules for a profile.
 */
export function useRecurringRules(profileId: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.rules(profileId),
    queryFn: () => getRepositories().base.recurringRules.list({ profileId }),
    enabled: !!profileId,
  });
}

/**
 * Fetch active (non-paused) recurring rules for a profile.
 */
export function useActiveRecurringRules(profileId: string | undefined) {
  return useQuery({
    queryKey: recurringExpenseQueryKeys.activeRules(profileId || ''),
    queryFn: () => getRepositories().base.recurringRules.listActive(profileId!),
    enabled: !!profileId,
  });
}

/**
 * Fetch a single recurring rule by ID.
 */
export function useRecurringRule(id: string | undefined) {
  return useQuery<RecurringRule | null>({
    queryKey: recurringExpenseQueryKeys.rule(id || ''),
    queryFn: async () => (await getRepositories().base.recurringRules.get(id!)) ?? null,
    enabled: !!id,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * What a recurring payment's resolution changes: the occurrence lists, the
 * Needs attention rows and the rule's history; marking paid also writes
 * expenses. Never the money-event keys (MUT-58 removes those).
 */
function invalidateOccurrenceQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  ruleId: string,
  { expensesWritten }: { expensesWritten: boolean }
) {
  queryClient.invalidateQueries({ queryKey: ['virtualOccurrences'] });
  queryClient.invalidateQueries({ queryKey: ['dueOccurrences'] });
  queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
  queryClient.invalidateQueries({ queryKey: recurringExpenseQueryKeys.ruleHistory(ruleId) });
  if (expensesWritten) {
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
  }
}

/**
 * Mark several payments of a rule paid: one expense per payment, each dated on
 * its expected date, in one all-or-nothing write (MUT-87).
 */
export function useConfirmRecurringPayments() {
  const queryClient = useQueryClient();

  return useRecurringMutationWithToast({
    mutationFn: (params: ConfirmPaymentsParams) => confirmPayments(params),
    onSuccess: (_expenses: unknown, params: ConfirmPaymentsParams) => {
      invalidateOccurrenceQueries(queryClient, params.ruleId, { expensesWritten: true });
    },
  });
}

/**
 * Skip one or several payments of a rule, all or nothing (MUT-87).
 */
export function useSkipRecurringOccurrences() {
  const queryClient = useQueryClient();

  return useRecurringMutationWithToast({
    mutationFn: (params: SkipOccurrencesParams) => skipOccurrences(params),
    onSuccess: (_: unknown, params: SkipOccurrencesParams) => {
      invalidateOccurrenceQueries(queryClient, params.ruleId, { expensesWritten: false });
    },
  });
}

/**
 * Snooze one or several payments of a rule until a date, all or nothing (MUT-87).
 */
export function useSnoozeRecurringOccurrences() {
  const queryClient = useQueryClient();

  return useRecurringMutationWithToast({
    mutationFn: (params: SnoozeOccurrencesParams) => snoozeOccurrences(params),
    onSuccess: (_: unknown, params: SnoozeOccurrencesParams) => {
      invalidateOccurrenceQueries(queryClient, params.ruleId, { expensesWritten: false });
    },
  });
}

/**
 * Create a new recurring expense rule.
 */
export function useCreateRecurringRule() {
  const queryClient = useQueryClient();

  return useRecurringMutationWithToast({
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

  return useRecurringMutationWithToast({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RecurringRule> }) => {
      await getRepositories().base.recurringRules.update(id, data);
      return getRepositories().base.recurringRules.get(id);
    },
    onSuccess: (_: unknown, { id }: { id: string; data: Partial<RecurringRule> }) => {
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

  return useRecurringMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.pause(id),
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

  return useRecurringMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.resume(id),
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

  return useRecurringMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.softDelete(id),
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
