import { useQuery, useQueryClient } from '@tanstack/react-query';
import { moneyEventRepo } from '../db/moneyEventRepository';
import type { Currency, MoneyAnswersFilters } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const moneyAnswersQueryKeys = {
  // Money Events
  events: (filters: MoneyAnswersFilters) => ['moneyEvents', filters] as const,
  dailyAggregates: (filters: MoneyAnswersFilters, openingBalance: number) =>
    ['moneyDailyAggregates', filters, openingBalance] as const,
  monthSummary: (filters: MoneyAnswersFilters) => ['moneyMonthSummary', filters] as const,
  monthKPIs: (filters: MoneyAnswersFilters, openingBalance: number) =>
    ['moneyMonthKPIs', filters, openingBalance] as const,
  guidance: (filters: MoneyAnswersFilters) => ['moneyGuidance', filters] as const,
  dayEvents: (date: string, currency: Currency) => ['moneyDayEvents', date, currency] as const,
  yearSummary: (year: number, currency: Currency, includeReceivables: boolean, includeProjections: boolean) =>
    ['moneyYearSummary', year, currency, includeReceivables, includeProjections] as const,
};

// ============================================================================
// Invalidation Helpers
// ============================================================================

export function useInvalidateMoneyAnswers() {
  const queryClient = useQueryClient();

  return {
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: ['moneyEvents'] });
      queryClient.invalidateQueries({ queryKey: ['moneyDailyAggregates'] });
      queryClient.invalidateQueries({ queryKey: ['moneyMonthSummary'] });
      queryClient.invalidateQueries({ queryKey: ['moneyMonthKPIs'] });
      queryClient.invalidateQueries({ queryKey: ['moneyMonthKPIsBoth'] });
      queryClient.invalidateQueries({ queryKey: ['moneyGuidance'] });
      queryClient.invalidateQueries({ queryKey: ['moneyDayEvents'] });
      queryClient.invalidateQueries({ queryKey: ['moneyYearSummary'] });
      queryClient.invalidateQueries({ queryKey: ['moneyYearSummaryBoth'] });
    },
    invalidateForMonth: (month: string) => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          if (Array.isArray(key) && key.length > 1) {
            const filters = key[1] as MoneyAnswersFilters | undefined;
            return filters?.month === month;
          }
          return false;
        },
      });
    },
  };
}

// ============================================================================
// Money Events Queries
// ============================================================================

/**
 * Get all money events for a month
 */
export function useMoneyEvents(filters: MoneyAnswersFilters) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.events(filters),
    queryFn: () => moneyEventRepo.getMoneyEvents(filters),
    enabled: !!filters.month,
  });
}

/**
 * Get daily aggregates with running balance for a month
 */
export function useDailyAggregates(
  filters: MoneyAnswersFilters,
  openingBalanceMinor: number = 0
) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.dailyAggregates(filters, openingBalanceMinor),
    queryFn: () => moneyEventRepo.getDailyAggregates(filters, openingBalanceMinor),
    enabled: !!filters.month,
  });
}

/**
 * Get month summary totals
 */
export function useMonthSummary(filters: MoneyAnswersFilters) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.monthSummary(filters),
    queryFn: () => moneyEventRepo.getMonthSummary(filters),
    enabled: !!filters.month,
  });
}

/**
 * Get KPI values for the month
 */
export function useMonthKPIs(
  filters: MoneyAnswersFilters,
  openingBalanceMinor: number = 0
) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.monthKPIs(filters, openingBalanceMinor),
    queryFn: () => moneyEventRepo.getMonthKPIs(filters, openingBalanceMinor),
    enabled: !!filters.month,
  });
}

/**
 * Get guidance items for the month
 */
export function useGuidance(filters: MoneyAnswersFilters) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.guidance(filters),
    queryFn: () => moneyEventRepo.generateGuidance(filters),
    enabled: !!filters.month,
  });
}

/**
 * Get events for a specific day
 */
export function useDayEvents(date: string, currency: Currency) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.dayEvents(date, currency),
    queryFn: () => moneyEventRepo.getDayEvents(date, currency),
    enabled: !!date && !!currency,
  });
}

/**
 * Get year summary with all month summaries and yearly totals
 */
export function useYearSummary(
  year: number,
  currency: Currency,
  includeReceivables: boolean = true,
  includeProjections: boolean = true
) {
  return useQuery({
    queryKey: moneyAnswersQueryKeys.yearSummary(year, currency, includeReceivables, includeProjections),
    queryFn: () => moneyEventRepo.getYearSummary(year, currency, includeReceivables, includeProjections),
    enabled: !!year && !!currency,
  });
}

/**
 * Get year summary for both currencies (for unified display)
 */
export function useYearSummaryBothCurrencies(
  year: number,
  includeReceivables: boolean = true,
  includeProjections: boolean = true
) {
  return useQuery({
    queryKey: ['moneyYearSummaryBoth', year, includeReceivables, includeProjections] as const,
    queryFn: () => moneyEventRepo.getYearSummaryBothCurrencies(year, includeReceivables, includeProjections),
    enabled: !!year,
  });
}

/**
 * Get month KPIs for both currencies (for unified display)
 */
export function useMonthKPIsBothCurrencies(
  month: string,
  openingBalanceMinorUSD: number = 0,
  openingBalanceMinorILS: number = 0,
  includeReceivables: boolean = true,
  includeProjections: boolean = true
) {
  return useQuery({
    queryKey: ['moneyMonthKPIsBoth', month, openingBalanceMinorUSD, openingBalanceMinorILS, includeReceivables, includeProjections] as const,
    queryFn: () => moneyEventRepo.getMonthKPIsBothCurrencies(month, openingBalanceMinorUSD, openingBalanceMinorILS, includeReceivables, includeProjections),
    enabled: !!month,
  });
}
