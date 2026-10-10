import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { withErrorToast } from './useMutationWithFeedback';
// Standalone helpers, not repositories — they stay direct imports.
import { seedExpenseCategories, type CategoryPreset } from '../db/defaultExpenseCategories';
import { getRepositories } from '../db';
import { invalidateMoneyEventQueries } from './useMoneyEventQueries';
import type {
  Expense,
  RecurringRule,
  ExpenseFilters,
  ReceiptFilters,
  Currency,
} from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const expenseQueryKeys = {
  // Expenses
  expenses: (filters: ExpenseFilters) => ['expenses', filters] as const,
  expense: (id: string) => ['expense', id] as const,
  expenseYearlyTotals: (profileId: string, year: number) =>
    ['expenseYearlyTotals', profileId, year] as const,
  allProfilesExpenseTotals: (year: number) => ['allProfilesExpenseTotals', year] as const,

  // Recurring Rules
  recurringRules: (profileId?: string) => ['recurringRules', { profileId }] as const,
  recurringRule: (id: string) => ['recurringRule', id] as const,
  activeRecurringRules: (profileId?: string) => ['activeRecurringRules', { profileId }] as const,

  // Receipts
  receipts: (filters: ReceiptFilters) => ['receipts', filters] as const,
  receipt: (id: string) => ['receipt', id] as const,
  unlinkedReceipts: (profileId: string) => ['unlinkedReceipts', profileId] as const,
  receiptsByMonth: (profileId: string, monthKey: string) =>
    ['receiptsByMonth', profileId, monthKey] as const,
  receiptMatchSuggestions: (receiptId: string) => ['receiptMatchSuggestions', receiptId] as const,
  unlinkedReceiptsWithSuggestions: (profileId: string) =>
    ['unlinkedReceiptsWithSuggestions', profileId] as const,

  // Categories
  expenseCategories: (profileId: string) => ['expenseCategories', profileId] as const,
  expenseCategory: (id: string) => ['expenseCategory', id] as const,

  // Forecast
  expenseForecast: (year: number, profileIds: string[], currency: Currency) =>
    ['expenseForecast', year, profileIds, currency] as const,

  // Vendors
  vendors: (profileId: string) => ['vendors', profileId] as const,
  vendor: (id: string) => ['vendor', id] as const,

  // Monthly Close
  monthCloseStatus: (profileId: string, monthKey: string) =>
    ['monthCloseStatus', profileId, monthKey] as const,
  monthCloseComputed: (profileId: string, monthKey: string) =>
    ['monthCloseComputed', profileId, monthKey] as const,
  monthCloseList: (profileId: string) => ['monthCloseList', profileId] as const,
};

// ============================================================================
// Invalidation Helpers
// ============================================================================

function invalidateExpenseQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  queryClient.invalidateQueries({ queryKey: ['expense'] });
  queryClient.invalidateQueries({ queryKey: ['expenseYearlyTotals'] });
  queryClient.invalidateQueries({ queryKey: ['allProfilesExpenseTotals'] });
  queryClient.invalidateQueries({ queryKey: ['expenseForecast'] });
  // Invalidate recurring occurrence queries (for expenses from recurring rules)
  queryClient.invalidateQueries({ queryKey: ['virtualOccurrences'] });
  queryClient.invalidateQueries({ queryKey: ['dueOccurrences'] });
  queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
  // Invalidate month close queries (expense changes affect month status)
  queryClient.invalidateQueries({ queryKey: ['monthCloseStatus'] });
  queryClient.invalidateQueries({ queryKey: ['monthCloseComputed'] });
  queryClient.invalidateQueries({ queryKey: ['monthCloseList'] });
  // Money events are derived from this data, so the Overview KPI strip and
  // attention feed have to refetch with it.
  invalidateMoneyEventQueries(queryClient);
}

function invalidateRecurringRuleQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['recurringRules'] });
  queryClient.invalidateQueries({ queryKey: ['recurringRule'] });
  queryClient.invalidateQueries({ queryKey: ['activeRecurringRules'] });
  queryClient.invalidateQueries({ queryKey: ['expenseForecast'] });
}

function invalidateExpenseCategoryQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
  queryClient.invalidateQueries({ queryKey: ['expenseCategory'] });
}

function invalidateVendorQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['vendors'] });
  queryClient.invalidateQueries({ queryKey: ['vendor'] });
}

// ============================================================================
// Expense Hooks
// ============================================================================

export function useExpenses(filters: ExpenseFilters) {
  return useQuery({
    queryKey: expenseQueryKeys.expenses(filters),
    queryFn: () => getRepositories().base.expenses.list(filters),
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expense(id),
    queryFn: () => getRepositories().base.expenses.get(id),
    enabled: !!id,
  });
}

function useExpenseMutationWithToast<TData, TError extends Error, TVariables>(
  opts: Parameters<typeof useMutation<TData, TError, TVariables>>[0]
) {
  return useMutation(withErrorToast(opts));
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (data: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.expenses.create(data),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: Partial<Expense> }) =>
      getRepositories().base.expenses.update(id, data),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.expenses.softDelete(id),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

// ============================================================================
// Recurring Rule Hooks
// ============================================================================

export function useRecurringRules(profileId?: string) {
  return useQuery({
    queryKey: expenseQueryKeys.recurringRules(profileId),
    queryFn: () => getRepositories().base.recurringRules.list({ profileId }),
  });
}

export function useActiveRecurringRules(profileId?: string) {
  return useQuery({
    queryKey: expenseQueryKeys.activeRecurringRules(profileId),
    queryFn: () => getRepositories().base.recurringRules.listActive(profileId!),
    enabled: !!profileId,
  });
}

export function useRecurringRule(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.recurringRule(id),
    queryFn: () => getRepositories().base.recurringRules.get(id),
    enabled: !!id,
  });
}

export function useCreateRecurringRule() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (data: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.recurringRules.create(data),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useUpdateRecurringRule() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: Partial<RecurringRule> }) =>
      getRepositories().base.recurringRules.update(id, data),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function usePauseRecurringRule() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.pause(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useResumeRecurringRule() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.resume(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useDeleteRecurringRule() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.recurringRules.delete(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

// ============================================================================
// Receipt Hooks
// ============================================================================

// ============================================================================
// Expense Category Hooks
// ============================================================================

export function useExpenseCategories(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseCategories(profileId),
    queryFn: () => getRepositories().base.expenseCategories.list(profileId),
    enabled: !!profileId,
  });
}

// ============================================================================
// Forecast Hooks
// ============================================================================

// ============================================================================
// Category Seeding Hooks
// ============================================================================

export function useSeedExpenseCategories() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({
      profileId,
      preset,
      language,
    }: {
      profileId: string;
      preset: CategoryPreset;
      language: 'en' | 'ar';
    }) => seedExpenseCategories(profileId, preset, language),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

// ============================================================================
// Vendor Hooks
// ============================================================================

export function useVendors(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.vendors(profileId),
    queryFn: () => getRepositories().base.vendors.list(profileId),
    enabled: !!profileId,
  });
}

export function useFindOrCreateVendor() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ profileId, rawVendor }: { profileId: string; rawVendor: string }) =>
      getRepositories().base.vendors.findOrCreate(profileId, rawVendor),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

// ============================================================================
// Receipt Matching Hooks
// ============================================================================

// ============================================================================
// Bulk Upload Hooks
// ============================================================================

// ============================================================================
// Monthly Close Hooks
// ============================================================================

