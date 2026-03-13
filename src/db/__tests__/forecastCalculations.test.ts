import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateExpenseForecast,
  calculateMinimumNeededFunds,
  generateVirtualExpenses,
  getMonthKeys,
  getCurrentMonthKey,
} from '../forecastCalculations';
import type { RecurringRule, Expense } from '../../types';

// Helper to create a mock recurring rule
function createRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    profileId: 'profile-1',
    title: 'Test Expense',
    amountMinor: 10000,
    currency: 'USD',
    frequency: 'monthly',
    dayOfMonth: 15,
    startDate: '2024-01-01',
    endMode: 'noEnd',
    scope: 'general',
    reminderDaysBefore: 0,
    isPaused: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// Helper to create a mock expense
function createExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    profileId: 'profile-1',
    amountMinor: 5000,
    currency: 'USD',
    occurredAt: '2024-03-15T00:00:00Z',
    createdAt: '2024-03-15T00:00:00Z',
    updatedAt: '2024-03-15T00:00:00Z',
    ...overrides,
  };
}

describe('forecastCalculations', () => {
  describe('calculateExpenseForecast', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate forecast for a year', () => {
      const rules = [createRule({ amountMinor: 10000, currency: 'USD' })];
      const actualExpenses = [createExpense({ amountMinor: 8000, occurredAt: '2024-03-15T00:00:00Z' })];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses,
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test Profile',
      });

      expect(result.year).toBe(2024);
      expect(result.profileId).toBe('profile-1');
      expect(result.profileName).toBe('Test Profile');
      expect(result.currency).toBe('USD');
      expect(result.breakdown).toHaveLength(12);
    });

    it('should use actual expenses for past months', () => {
      const rules = [createRule({ amountMinor: 10000 })];
      const actualExpenses = [
        createExpense({ amountMinor: 5000, occurredAt: '2024-03-15T00:00:00Z' }),
        createExpense({ id: 'exp-2', amountMinor: 3000, occurredAt: '2024-03-20T00:00:00Z' }),
      ];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses,
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // March is past (we're in June), should use actual expenses
      const marchData = result.breakdown.find((m) => m.month === 3);
      expect(marchData?.actualMinor).toBe(8000);
      expect(marchData?.isPast).toBe(true);
    });

    it('should project from rules for future months', () => {
      const rules = [createRule({ amountMinor: 10000 })];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses: [],
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // July is future (we're in June)
      const julyData = result.breakdown.find((m) => m.month === 7);
      expect(julyData?.projectedMinor).toBe(10000);
      expect(julyData?.isPast).toBe(false);
    });

    it('should calculate months remaining', () => {
      const result = calculateExpenseForecast({
        recurringRules: [],
        actualExpenses: [],
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // We're in June (month 6), so 6 months remaining (July-December)
      expect(result.monthsRemaining).toBe(6);
    });

    it('should handle yearly rules', () => {
      const rules = [
        createRule({
          frequency: 'yearly',
          startDate: '2024-03-15',
          amountMinor: 50000,
        }),
      ];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses: [],
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // Yearly rule started in March, should only project for March
      const marchData = result.breakdown.find((m) => m.month === 3);
      const aprilData = result.breakdown.find((m) => m.month === 4);

      // March is past, so it uses actual (which is 0 since no actual expenses)
      expect(marchData?.projectedMinor).toBe(0);
      expect(aprilData?.projectedMinor).toBe(0);
    });

    it('should exclude paused rules', () => {
      const rules = [
        createRule({ amountMinor: 10000, isPaused: false }),
        createRule({ id: 'rule-2', amountMinor: 20000, isPaused: true }),
      ];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses: [],
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // Future month should only include non-paused rule
      const julyData = result.breakdown.find((m) => m.month === 7);
      expect(julyData?.projectedMinor).toBe(10000);
    });

    it('should filter by currency', () => {
      const rules = [
        createRule({ amountMinor: 10000, currency: 'USD' }),
        createRule({ id: 'rule-2', amountMinor: 5000, currency: 'ILS' }),
      ];

      const result = calculateExpenseForecast({
        recurringRules: rules,
        actualExpenses: [],
        year: 2024,
        currency: 'USD',
        profileId: 'profile-1',
        profileName: 'Test',
      });

      // Should only include USD
      const julyData = result.breakdown.find((m) => m.month === 7);
      expect(julyData?.projectedMinor).toBe(10000);
    });
  });

  describe('calculateMinimumNeededFunds', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should calculate funds needed for remaining months', () => {
      const rules = [createRule({ amountMinor: 10000 })];

      const result = calculateMinimumNeededFunds({
        recurringRules: rules,
        year: 2024,
        currency: 'USD',
      });

      // We're in June, so need funds for July-December (6 months)
      expect(result).toBe(60000);
    });

    it('should return 0 for past years', () => {
      const rules = [createRule({ amountMinor: 10000 })];

      const result = calculateMinimumNeededFunds({
        recurringRules: rules,
        year: 2023,
        currency: 'USD',
      });

      expect(result).toBe(0);
    });

    it('should calculate full year for future years', () => {
      const rules = [createRule({ amountMinor: 10000 })];

      const result = calculateMinimumNeededFunds({
        recurringRules: rules,
        year: 2025,
        currency: 'USD',
      });

      // Full 12 months
      expect(result).toBe(120000);
    });

    it('should exclude paused rules', () => {
      const rules = [
        createRule({ amountMinor: 10000, isPaused: false }),
        createRule({ id: 'rule-2', amountMinor: 20000, isPaused: true }),
      ];

      const result = calculateMinimumNeededFunds({
        recurringRules: rules,
        year: 2024,
        currency: 'USD',
      });

      // Only non-paused rule for 6 months
      expect(result).toBe(60000);
    });
  });

  describe('generateVirtualExpenses', () => {
    it('should generate virtual expenses from rules', () => {
      // The function uses the day from startDate, so use day 15
      const rules = [createRule({ startDate: '2024-01-15' })];

      const result = generateVirtualExpenses(rules, '2024-03-01', '2024-05-31');

      expect(result).toHaveLength(3);
      expect(result[0].ruleId).toBe('rule-1');
      expect(result.every((e) => e.isProjected)).toBe(true);
    });

    it('should respect date range', () => {
      const rules = [createRule({ startDate: '2024-01-15' })];

      const result = generateVirtualExpenses(rules, '2024-03-01', '2024-03-31');

      expect(result).toHaveLength(1);
      expect(result[0].occurredAt).toContain('2024-03');
    });

    it('should handle rule start date', () => {
      // Rule starts on April 1st (first of month)
      const rules = [createRule({ startDate: '2024-04-01' })];

      const result = generateVirtualExpenses(rules, '2024-01-01', '2024-06-30');

      // Should only generate from April onwards (April, May, June)
      expect(result).toHaveLength(3);
    });

    it('should exclude paused rules', () => {
      const rules = [createRule({ isPaused: true })];

      const result = generateVirtualExpenses(rules, '2024-03-01', '2024-05-31');

      expect(result).toHaveLength(0);
    });

    it('should handle yearly rules', () => {
      const rules = [
        createRule({
          frequency: 'yearly',
          // Use first of month to ensure start month is included
          // (shouldRuleOccurInMonth compares checkDate which is 1st of month)
          startDate: '2024-06-01',
        }),
      ];

      const result = generateVirtualExpenses(rules, '2024-01-01', '2025-12-31');

      // Should occur once per year in June - 2024 and 2025
      expect(result).toHaveLength(2);
    });

    it('should include rule details in virtual expense', () => {
      const rules = [
        createRule({
          title: 'Rent',
          vendor: 'Landlord',
          categoryId: 'cat-1',
          amountMinor: 100000,
          startDate: '2024-01-15',
        }),
      ];

      const result = generateVirtualExpenses(rules, '2024-03-01', '2024-03-31');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Rent');
      expect(result[0].vendor).toBe('Landlord');
      expect(result[0].categoryId).toBe('cat-1');
      expect(result[0].amountMinor).toBe(100000);
    });

    it('should sort by date', () => {
      const rules = [
        createRule({ id: 'rule-1', startDate: '2024-01-20' }),
        createRule({ id: 'rule-2', startDate: '2024-01-05' }),
      ];

      const result = generateVirtualExpenses(rules, '2024-03-01', '2024-03-31');

      expect(result).toHaveLength(2);
      expect(result[0].ruleId).toBe('rule-2'); // Day 5 comes first
      expect(result[1].ruleId).toBe('rule-1'); // Day 20 comes second
    });

    it('should handle end of month clamping', () => {
      const rules = [createRule({ startDate: '2024-01-31' })];

      const result = generateVirtualExpenses(rules, '2024-02-01', '2024-02-29');

      // February 2024 has 29 days (leap year), so day 31 becomes 29
      expect(result).toHaveLength(1);
      // Check the occurrence is in February by parsing back to local date
      const occurrenceDate = new Date(result[0].occurredAt);
      expect(occurrenceDate.getFullYear()).toBe(2024);
      expect(occurrenceDate.getMonth()).toBe(1); // February (0-indexed)
      expect(occurrenceDate.getDate()).toBe(29);
    });

    it('should respect endOfYear end mode', () => {
      const rules = [
        createRule({
          // Use first of month to ensure start month is included
          startDate: '2024-06-01',
          endMode: 'endOfYear',
        }),
      ];

      const result = generateVirtualExpenses(rules, '2024-01-01', '2025-12-31');

      // Should only generate for June-December 2024 (7 months)
      expect(result).toHaveLength(7);
      // All occurrences should be in 2024
      for (const expense of result) {
        const date = new Date(expense.occurredAt);
        expect(date.getFullYear()).toBe(2024);
      }
    });

    it('should respect untilDate end mode', () => {
      const rules = [
        createRule({
          startDate: '2024-01-15',
          endMode: 'untilDate',
          endDate: '2024-04-01',
        }),
      ];

      const result = generateVirtualExpenses(rules, '2024-01-01', '2024-12-31');

      // Should only generate for Jan-Mar (April 1 is the end date)
      expect(result).toHaveLength(3);
    });
  });

  describe('getMonthKeys', () => {
    it('should return 12 month keys for a year', () => {
      const result = getMonthKeys(2024);

      expect(result).toHaveLength(12);
      expect(result[0]).toBe('2024-01');
      expect(result[11]).toBe('2024-12');
    });

    it('should pad month numbers with zeros', () => {
      const result = getMonthKeys(2024);

      expect(result[0]).toBe('2024-01');
      expect(result[8]).toBe('2024-09');
    });
  });

  describe('getCurrentMonthKey', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return current month key', () => {
      vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));

      const result = getCurrentMonthKey();

      expect(result).toBe('2024-06');
    });

    it('should pad single-digit months', () => {
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      const result = getCurrentMonthKey();

      expect(result).toBe('2024-01');
    });

    it('should handle double-digit months', () => {
      vi.setSystemTime(new Date('2024-12-15T12:00:00Z'));

      const result = getCurrentMonthKey();

      expect(result).toBe('2024-12');
    });
  });
});
