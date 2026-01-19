import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  expenseRepo,
  recurringRuleRepo,
  receiptRepo,
  expenseCategoryRepo,
  vendorRepo,
  monthCloseRepo,
  getReceiptMatchSuggestions,
  getUnlinkedReceiptsWithSuggestions,
  isReceiptDuplicate,
  createExpenseAndLinkReceipt,
  createReceiptsBulk,
} from '../db/expenseRepository';
import { calculateExpenseForecast } from '../db/forecastCalculations';
import { businessProfileRepo } from '../db';
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
    queryFn: () => expenseRepo.list(filters),
  });
}

export function useExpense(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expense(id),
    queryFn: () => expenseRepo.get(id),
    enabled: !!id,
  });
}

export function useExpenseYearlyTotals(profileId: string, year: number) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseYearlyTotals(profileId, year),
    queryFn: () => expenseRepo.getYearlyTotals(profileId, year),
    enabled: !!profileId && !!year,
  });
}

export function useAllProfilesExpenseTotals(year: number) {
  return useQuery({
    queryKey: expenseQueryKeys.allProfilesExpenseTotals(year),
    queryFn: () => expenseRepo.getAllProfilesTotals(year),
    enabled: !!year,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>) =>
      expenseRepo.create(data),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Expense> }) =>
      expenseRepo.update(id, data),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => expenseRepo.softDelete(id),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

// ============================================================================
// Recurring Rule Hooks
// ============================================================================

export function useRecurringRules(profileId?: string) {
  return useQuery({
    queryKey: expenseQueryKeys.recurringRules(profileId),
    queryFn: () => recurringRuleRepo.list(profileId),
  });
}

export function useActiveRecurringRules(profileId?: string) {
  return useQuery({
    queryKey: expenseQueryKeys.activeRecurringRules(profileId),
    queryFn: () => recurringRuleRepo.listActive(profileId),
  });
}

export function useRecurringRule(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.recurringRule(id),
    queryFn: () => recurringRuleRepo.get(id),
    enabled: !!id,
  });
}

export function useCreateRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<RecurringRule, 'id' | 'createdAt' | 'updatedAt'>) =>
      recurringRuleRepo.create(data),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useUpdateRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RecurringRule> }) =>
      recurringRuleRepo.update(id, data),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function usePauseRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.pause(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useResumeRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.resume(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

export function useDeleteRecurringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringRuleRepo.delete(id),
    onSuccess: () => invalidateRecurringRuleQueries(queryClient),
  });
}

// ============================================================================
// Receipt Hooks
// ============================================================================

export function useReceipts(filters: ReceiptFilters) {
  return useQuery({
    queryKey: expenseQueryKeys.receipts(filters),
    queryFn: () => receiptRepo.list(filters),
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.receipt(id),
    queryFn: () => receiptRepo.get(id),
    enabled: !!id,
  });
}

export function useUnlinkedReceipts(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.unlinkedReceipts(profileId),
    queryFn: () => receiptRepo.getUnlinkedByProfile(profileId),
    enabled: !!profileId,
  });
}

export function useReceiptsByMonth(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: expenseQueryKeys.receiptsByMonth(profileId, monthKey),
    queryFn: () => receiptRepo.getByProfileAndMonth(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useCreateReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Receipt, 'id' | 'createdAt' | 'updatedAt'>) =>
      receiptRepo.create(data),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useUpdateReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Receipt> }) =>
      receiptRepo.update(id, data),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useDeleteReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => receiptRepo.delete(id),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useLinkReceiptToExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ receiptId, expenseId }: { receiptId: string; expenseId: string }) =>
      receiptRepo.linkToExpense(receiptId, expenseId),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

export function useUnlinkReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (receiptId: string) => receiptRepo.unlinkFromExpense(receiptId),
    onSuccess: () => invalidateReceiptQueries(queryClient),
  });
}

// ============================================================================
// Expense Category Hooks
// ============================================================================

export function useExpenseCategories(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseCategories(profileId),
    queryFn: () => expenseCategoryRepo.list(profileId),
    enabled: !!profileId,
  });
}

export function useExpenseCategory(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.expenseCategory(id),
    queryFn: () => expenseCategoryRepo.get(id),
    enabled: !!id,
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<ExpenseCategory, 'id'>) =>
      expenseCategoryRepo.create(data),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ExpenseCategory> }) =>
      expenseCategoryRepo.update(id, data),
    onSuccess: () => invalidateExpenseCategoryQueries(queryClient),
  });
}

export function useDeleteExpenseCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => expenseCategoryRepo.delete(id),
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
          businessProfileRepo.get(profileId),
          recurringRuleRepo.listActive(profileId),
          expenseRepo.list({ profileId, year }),
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

  return useMutation({
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
    queryFn: () => vendorRepo.list(profileId),
    enabled: !!profileId,
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: expenseQueryKeys.vendor(id),
    queryFn: () => vendorRepo.get(id),
    enabled: !!id,
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Vendor, 'id' | 'createdAt' | 'updatedAt'>) =>
      vendorRepo.create(data),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Vendor> }) =>
      vendorRepo.update(id, data),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vendorRepo.delete(id),
    onSuccess: () => {
      invalidateVendorQueries(queryClient);
      invalidateExpenseQueries(queryClient);
      invalidateReceiptQueries(queryClient);
    },
  });
}

export function useFindOrCreateVendor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, rawVendor }: { profileId: string; rawVendor: string }) =>
      vendorRepo.findOrCreate(profileId, rawVendor),
    onSuccess: () => invalidateVendorQueries(queryClient),
  });
}

export function useMergeVendors() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ targetId, sourceId }: { targetId: string; sourceId: string }) =>
      vendorRepo.mergeVendors(targetId, sourceId),
    onSuccess: () => {
      invalidateVendorQueries(queryClient);
      invalidateExpenseQueries(queryClient);
      invalidateReceiptQueries(queryClient);
    },
  });
}

export function useAddVendorAlias() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vendorId, alias }: { vendorId: string; alias: string }) =>
      vendorRepo.addAlias(vendorId, alias),
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

  return useMutation({
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
  return useMutation({
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

  return useMutation({
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
    queryFn: () => monthCloseRepo.getOrCreate(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useMonthCloseComputed(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: expenseQueryKeys.monthCloseComputed(profileId, monthKey),
    queryFn: () => monthCloseRepo.getComputedStatus(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}

export function useMonthCloseList(profileId: string) {
  return useQuery({
    queryKey: expenseQueryKeys.monthCloseList(profileId),
    queryFn: () => monthCloseRepo.list(profileId),
    enabled: !!profileId,
  });
}

export function useUpdateMonthCloseChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      monthKey,
      updates,
    }: {
      profileId: string;
      monthKey: string;
      updates: Partial<MonthCloseChecklist>;
    }) => monthCloseRepo.updateChecklist(profileId, monthKey, updates),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useCloseMonth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      monthKey,
      notes,
    }: {
      profileId: string;
      monthKey: string;
      notes?: string;
    }) => monthCloseRepo.closeMonth(profileId, monthKey, notes),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useReopenMonth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profileId, monthKey }: { profileId: string; monthKey: string }) =>
      monthCloseRepo.reopenMonth(profileId, monthKey),
    onSuccess: () => invalidateMonthCloseQueries(queryClient),
  });
}

export function useIsMonthClosed(profileId: string, monthKey: string) {
  return useQuery({
    queryKey: ['isMonthClosed', profileId, monthKey],
    queryFn: () => monthCloseRepo.isMonthClosed(profileId, monthKey),
    enabled: !!profileId && !!monthKey,
  });
}
