import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { withErrorToast } from './useMutationWithFeedback';
// Standalone helpers, not repositories — they stay direct imports.
import {
  getReceiptMatchSuggestions,
  getUnlinkedReceiptsWithSuggestions,
  isReceiptDuplicate,
  createExpenseAndLinkReceipt,
  createReceiptsBulk,
} from '../db/expenseRepository';
import { calculateExpenseForecast } from '../db/forecastCalculations';
import { getRepositories } from '../db';
import type {
  Expense,
  RecurringRule,
  Receipt,
  ExpenseCategory,
  ExpenseFilters,
  ReceiptFilters,
  Currency,
  Vendor,
  MonthCloseChecklist,
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
}

function invalidateRecurringRuleQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['recurringRules'] });
  queryClient.invalidateQueries({ queryKey: ['recurringRule'] });
  queryClient.invalidateQueries({ queryKey: ['activeRecurringRules'] });
  queryClient.invalidateQueries({ queryKey: ['expenseForecast'] });
}

function invalidateReceiptQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['receipts'] });
  queryClient.invalidateQueries({ queryKey: ['receipt'] });
  queryClient.invalidateQueries({ queryKey: ['unlinkedReceipts'] });
  queryClient.invalidateQueries({ queryKey: ['receiptsByMonth'] });
  // Also invalidate expenses since receipt count may have changed
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
}

function invalidateExpenseCategoryQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['expenseCategories'] });
  queryClient.invalidateQueries({ queryKey: ['expenseCategory'] });
}

function invalidateVendorQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['vendors'] });
  queryClient.invalidateQueries({ queryKey: ['vendor'] });
}

function invalidateMonthCloseQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['monthCloseStatus'] });
  queryClient.invalidateQueries({ queryKey: ['monthCloseComputed'] });
  queryClient.invalidateQueries({ queryKey: ['monthCloseList'] });
}

function invalidateMatchSuggestionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['receiptMatchSuggestions'] });
  queryClient.invalidateQueries({ queryKey: ['unlinkedReceiptsWithSuggestions'] });
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

export function useExpenseYearlyTotals(profileId: string, year: number) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseYearlyTotals(profileId, year),
    queryFn: () => getRepositories().base.expenses.getYearlyTotals(profileId, year),
    enabled: !!profileId && !!year,
  });
}

export function useAllProfilesExpenseTotals(year: number) {
  return useQuery({
    queryKey: expenseQueryKeys.allProfilesExpenseTotals(year),
    queryFn: () => getRepositories().base.expenses.getAllProfilesTotals(year),
    enabled: !!year,
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

export function useReceipts(filters: ReceiptFilters) {
  return useQuery({
    queryKey: expenseQueryKeys.receipts(filters),
    queryFn: () => getRepositories().base.receipts.list(filters),
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.receipt(id),
    queryFn: () => getRepositories().base.receipts.get(id),
    enabled: !!id,
  });
}

export function useUnlinkedReceipts(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.unlinkedReceipts(profileId),
    queryFn: () => getRepositories().base.receipts.getUnlinkedByProfile(profileId),
    enabled: !!profileId,
  });
}

export function useReceiptsByMonth(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: expenseQueryKeys.receiptsByMonth(profileId, monthKey),
    queryFn: () => getRepositories().base.receipts.getByProfileAndMonth(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useCreateReceipt() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (data: Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.receipts.create(data),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useUpdateReceipt() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: Partial<Receipt> }) =>
      getRepositories().base.receipts.update(id, data),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.receipts.delete(id),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useLinkReceiptToExpense() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ receiptId, expenseId }: { receiptId: string; expenseId: string }) =>
      getRepositories().base.receipts.linkToExpense(receiptId, expenseId),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useUnlinkReceipt() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (receiptId: string) => getRepositories().base.receipts.unlinkFromExpense(receiptId),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

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

export function useExpenseCategory(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseCategory(id),
    queryFn: () => getRepositories().base.expenseCategories.get(id),
    enabled: !!id,
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (data: Omit<ExpenseCategory, 'id'>) =>
      getRepositories().base.expenseCategories.create(data),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: Partial<ExpenseCategory> }) =>
      getRepositories().base.expenseCategories.update(id, data),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.expenseCategories.delete(id),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

// ============================================================================
// Forecast Hooks
// ============================================================================

export function useExpenseForecast(year: number, profileIds: string[], currency: Currency) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseForecast(year, profileIds, currency),
    queryFn: async () => {
      const forecasts = [];

      for (const profileId of profileIds) {
        const [profile, rules, expenses] = await Promise.all([
          getRepositories().base.businessProfiles.get(profileId),
          getRepositories().base.recurringRules.listActive(profileId),
          getRepositories().base.expenses.list({ profileId, year }),
        ]);

        if (profile) {
          const forecast = calculateExpenseForecast({
            recurringRules: rules.filter((r) => r.currency === currency),
            actualExpenses: expenses.filter((e) => e.currency === currency),
            year,
            currency,
            profileId,
            profileName: profile.name,
          });
          forecasts.push(forecast);
        }
      }

      return forecasts;
    },
    enabled: !!year && profileIds.length > 0,
  });
}

// ============================================================================
// Category Seeding Hooks
// ============================================================================

import { seedExpenseCategories, type CategoryPreset } from '../db/defaultExpenseCategories';

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

export function useVendor(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.vendor(id),
    queryFn: () => getRepositories().base.vendors.get(id),
    enabled: !!id,
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (data: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>) =>
      getRepositories().base.vendors.create(data),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ id, data }: { id: string; data: Partial<Vendor> }) =>
      getRepositories().base.vendors.update(id, data),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (id: string) => getRepositories().base.vendors.delete(id),
    onSuccess: () => {
      invalidateVendorQueries(queryClient);
      invalidateExpenseQueries(queryClient);
      invalidateReceiptQueries(queryClient);
    },
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

export function useMergeVendors() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      getRepositories().base.vendors.mergeVendors(targetId, sourceId),
    onSuccess: () => {
      invalidateVendorQueries(queryClient);
      invalidateExpenseQueries(queryClient);
      invalidateReceiptQueries(queryClient);
    },
  });
}

export function useAddVendorAlias() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ vendorId, alias }: { vendorId: string; alias: string }) =>
      getRepositories().base.vendors.addAlias(vendorId, alias),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

// ============================================================================
// Receipt Matching Hooks
// ============================================================================

export function useReceiptMatchSuggestions(receiptId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.receiptMatchSuggestions(receiptId),
    queryFn: () => getReceiptMatchSuggestions(receiptId),
    enabled: !!receiptId,
  });
}

export function useUnlinkedReceiptsWithSuggestions(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.unlinkedReceiptsWithSuggestions(profileId),
    queryFn: () => getUnlinkedReceiptsWithSuggestions(profileId),
    enabled: !!profileId,
  });
}

export function useCreateExpenseAndLinkReceipt() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({
      expenseData,
      receiptId,
    }: {
      expenseData: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>;
      receiptId: string;
    }) => createExpenseAndLinkReceipt(expenseData, receiptId),
    onSuccess: () => {
      invalidateExpenseQueries(queryClient);
      invalidateReceiptQueries(queryClient);
      invalidateMatchSuggestionQueries(queryClient);
    },
  });
}

// ============================================================================
// Bulk Upload Hooks
// ============================================================================

export function useCheckReceiptDuplicate() {
  return useExpenseMutationWithToast({
    mutationFn: ({
      profileId,
      fileName,
      sizeBytes,
      monthKey,
    }: {
      profileId: string;
      fileName: string;
      sizeBytes: number;
      monthKey: string;
    }) => isReceiptDuplicate(profileId, fileName, sizeBytes, monthKey),
  });
}

export function useBulkCreateReceipts() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: (receipts: Array<Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>>) =>
      createReceiptsBulk(receipts),
    onSuccess: () => {
      invalidateReceiptQueries(queryClient);
      invalidateMatchSuggestionQueries(queryClient);
    },
  });
}

// ============================================================================
// Monthly Close Hooks
// ============================================================================

export function useMonthCloseStatus(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: expenseQueryKeys.monthCloseStatus(profileId, monthKey),
    queryFn: () => getRepositories().base.monthCloseStatuses.getOrCreate(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useMonthCloseComputed(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: expenseQueryKeys.monthCloseComputed(profileId, monthKey),
    queryFn: () => getRepositories().base.monthCloseStatuses.getComputedStatus(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useMonthCloseList(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.monthCloseList(profileId),
    queryFn: () => getRepositories().base.monthCloseStatuses.list(profileId),
    enabled: !!profileId,
  });
}

export function useUpdateMonthCloseChecklist() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({
      profileId,
      monthKey,
      updates,
    }: {
      profileId: string;
      monthKey: string;
      updates: Partial<MonthCloseChecklist>;
    }) => getRepositories().base.monthCloseStatuses.updateChecklist(profileId, monthKey, updates),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useCloseMonth() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({
      profileId,
      monthKey,
      notes,
    }: {
      profileId: string;
      monthKey: string;
      notes?: string;
    }) => getRepositories().base.monthCloseStatuses.closeMonth(profileId, monthKey, notes),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useReopenMonth() {
  const queryClient = useQueryClient();

  return useExpenseMutationWithToast({
    mutationFn: ({ profileId, monthKey }: { profileId: string; monthKey: string }) =>
      getRepositories().base.monthCloseStatuses.reopenMonth(profileId, monthKey),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useIsMonthClosed(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: ['isMonthClosed', profileId, monthKey],
    queryFn: () => getRepositories().base.monthCloseStatuses.isMonthClosed(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}
