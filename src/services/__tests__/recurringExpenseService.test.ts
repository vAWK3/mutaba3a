/**
 * Unit tests for RecurringExpenseService
 *
 * Tests:
 * - generateExpectedDates helper
 * - computeState helper
 * - Service operations (confirmPayment, skipOccurrence, snoozeOccurrence)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateExpectedDates,
  computeState,
} from '../recurringExpenseService';
import type { RecurringRule, RecurringOccurrence } from '../../types';

describe('generateExpectedDates', () => {
  const createRule = (overrides: Partial<RecurringRule> = {}): RecurringRule => ({
    id: 'rule-1',
    profileId: 'profile-1',
    title: 'Test Expense',
    amountMinor: 10000,
    currency: 'USD',
    frequency: 'monthly',
    dayOfMonth: 15,
    startDate: '2025-01-01',
    endMode: 'noEnd',
    scope: 'general',
    reminderDaysBefore: 0,
    isPaused: false,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  });

  describe('monthly frequency', () => {
    it('generates correct dates for monthly rule', () => {
      const rule = createRule({ dayOfMonth: 15 });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-06-30');

      expect(dates).toEqual([
        '2025-01-15',
        '2025-02-15',
        '2025-03-15',
        '2025-04-15',
        '2025-05-15',
        '2025-06-15',
      ]);
    });

    it('starts from rule startDate if after requested range start', () => {
      const rule = createRule({ startDate: '2025-03-01', dayOfMonth: 10 });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-06-30');

      expect(dates).toEqual([
        '2025-03-10',
        '2025-04-10',
        '2025-05-10',
        '2025-06-10',
      ]);
    });

    it('handles day 28 across all months', () => {
      const rule = createRule({ dayOfMonth: 28 });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-03-31');

      expect(dates).toEqual([
        '2025-01-28',
        '2025-02-28',
        '2025-03-28',
      ]);
    });

    it('clamps to last day of month for days > month length', () => {
      // February in non-leap year has 28 days
      const rule = createRule({ dayOfMonth: 30 });
      const dates = generateExpectedDates(rule, '2025-02-01', '2025-02-28');

      // Should clamp to Feb 28
      expect(dates).toEqual(['2025-02-28']);
    });
  });

  describe('yearly frequency', () => {
    it('generates correct dates for yearly rule', () => {
      const rule = createRule({
        frequency: 'yearly',
        dayOfMonth: 1,
        monthOfYear: 4, // April
        startDate: '2023-01-01',
      });
      const dates = generateExpectedDates(rule, '2023-01-01', '2027-12-31');

      expect(dates).toEqual([
        '2023-04-01',
        '2024-04-01',
        '2025-04-01',
        '2026-04-01',
        '2027-04-01',
      ]);
    });

    it('handles yearly rule with specific day', () => {
      const rule = createRule({
        frequency: 'yearly',
        dayOfMonth: 15,
        monthOfYear: 7, // July
        startDate: '2025-01-01',
      });
      const dates = generateExpectedDates(rule, '2025-01-01', '2027-12-31');

      expect(dates).toEqual([
        '2025-07-15',
        '2026-07-15',
        '2027-07-15',
      ]);
    });
  });

  describe('end modes', () => {
    it('respects endOfYear mode', () => {
      const rule = createRule({
        dayOfMonth: 1,
        startDate: '2025-10-01',
        endMode: 'endOfYear',
      });
      const dates = generateExpectedDates(rule, '2025-10-01', '2026-12-31');

      // Should only generate dates until end of 2025
      expect(dates).toEqual([
        '2025-10-01',
        '2025-11-01',
        '2025-12-01',
      ]);
    });

    it('respects untilDate mode', () => {
      const rule = createRule({
        dayOfMonth: 15,
        startDate: '2025-01-01',
        endMode: 'untilDate',
        endDate: '2025-04-01',
      });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-12-31');

      expect(dates).toEqual([
        '2025-01-15',
        '2025-02-15',
        '2025-03-15',
      ]);
    });

    it('continues indefinitely with noEnd mode', () => {
      const rule = createRule({
        dayOfMonth: 1,
        startDate: '2025-01-01',
        endMode: 'noEnd',
      });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-12-31');

      expect(dates).toHaveLength(12);
    });
  });

  describe('edge cases', () => {
    it('returns empty array if range is before startDate', () => {
      const rule = createRule({ startDate: '2026-01-01' });
      const dates = generateExpectedDates(rule, '2025-01-01', '2025-12-31');

      expect(dates).toEqual([]);
    });

    it('returns empty array if range end is before start', () => {
      const rule = createRule();
      const dates = generateExpectedDates(rule, '2025-06-01', '2025-03-01');

      expect(dates).toEqual([]);
    });

    it('handles single-day range', () => {
      const rule = createRule({ dayOfMonth: 15 });
      const dates = generateExpectedDates(rule, '2025-03-15', '2025-03-15');

      expect(dates).toEqual(['2025-03-15']);
    });
  });
});

describe('computeState', () => {
  beforeEach(() => {
    // Mock Date to return consistent "today"
    const mockDate = new Date('2025-03-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('without persisted occurrence', () => {
    it('returns "overdue" for past dates', () => {
      const state = computeState('2025-03-10', 0);
      expect(state).toBe('overdue');
    });

    it('returns "due" for today', () => {
      const state = computeState('2025-03-15', 0);
      expect(state).toBe('due');
    });

    it('returns "due" within reminder window', () => {
      const state = computeState('2025-03-18', 5); // 3 days away, reminder is 5
      expect(state).toBe('due');
    });

    it('returns "projected" for future dates outside reminder', () => {
      const state = computeState('2025-04-15', 3); // 31 days away, reminder is 3
      expect(state).toBe('projected');
    });
  });

  describe('with snoozed occurrence', () => {
    it('returns "projected" if snooze is still active', () => {
      const persisted: RecurringOccurrence = {
        id: 'occ-1',
        ruleId: 'rule-1',
        profileId: 'profile-1',
        expectedDate: '2025-03-10',
        amountMinorSnapshot: 10000,
        currencySnapshot: 'USD',
        status: 'snoozed',
        snoozeUntil: '2025-03-20', // Snoozed until future
        createdAt: '2025-03-10T00:00:00Z',
        updatedAt: '2025-03-10T00:00:00Z',
      };

      const state = computeState('2025-03-10', 0, persisted);
      expect(state).toBe('projected');
    });

    it('returns normal state if snooze expired', () => {
      const persisted: RecurringOccurrence = {
        id: 'occ-1',
        ruleId: 'rule-1',
        profileId: 'profile-1',
        expectedDate: '2025-03-10',
        amountMinorSnapshot: 10000,
        currencySnapshot: 'USD',
        status: 'snoozed',
        snoozeUntil: '2025-03-14', // Snooze expired
        createdAt: '2025-03-10T00:00:00Z',
        updatedAt: '2025-03-10T00:00:00Z',
      };

      const state = computeState('2025-03-10', 0, persisted);
      expect(state).toBe('overdue'); // Original date is past
    });
  });

  describe('with resolved occurrence', () => {
    it('returns "projected" for resolved_paid', () => {
      const persisted: RecurringOccurrence = {
        id: 'occ-1',
        ruleId: 'rule-1',
        profileId: 'profile-1',
        expectedDate: '2025-03-10',
        amountMinorSnapshot: 10000,
        currencySnapshot: 'USD',
        status: 'resolved_paid',
        fulfilledExpenseId: 'expense-1',
        resolvedAt: '2025-03-10T00:00:00Z',
        createdAt: '2025-03-10T00:00:00Z',
        updatedAt: '2025-03-10T00:00:00Z',
      };

      const state = computeState('2025-03-10', 0, persisted);
      expect(state).toBe('projected'); // Resolved ones get filtered out in getVirtualOccurrences
    });

    it('returns "projected" for resolved_skipped', () => {
      const persisted: RecurringOccurrence = {
        id: 'occ-1',
        ruleId: 'rule-1',
        profileId: 'profile-1',
        expectedDate: '2025-03-10',
        amountMinorSnapshot: 10000,
        currencySnapshot: 'USD',
        status: 'resolved_skipped',
        resolvedAt: '2025-03-10T00:00:00Z',
        createdAt: '2025-03-10T00:00:00Z',
        updatedAt: '2025-03-10T00:00:00Z',
      };

      const state = computeState('2025-03-10', 0, persisted);
      expect(state).toBe('projected');
    });
  });
});

describe('date edge cases', () => {
  it('handles leap year February correctly', () => {
    // 2024 is a leap year
    const rule: RecurringRule = {
      id: 'rule-1',
      profileId: 'profile-1',
      title: 'Test',
      amountMinor: 10000,
      currency: 'USD',
      frequency: 'monthly',
      dayOfMonth: 29,
      startDate: '2024-01-01',
      endMode: 'noEnd',
      scope: 'general',
      reminderDaysBefore: 0,
      isPaused: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    const dates = generateExpectedDates(rule, '2024-02-01', '2024-03-31');

    // Feb 29 exists in leap year
    expect(dates).toContain('2024-02-29');
    expect(dates).toContain('2024-03-29');
  });

  it('handles year boundary correctly', () => {
    const rule: RecurringRule = {
      id: 'rule-1',
      profileId: 'profile-1',
      title: 'Test',
      amountMinor: 10000,
      currency: 'USD',
      frequency: 'monthly',
      dayOfMonth: 15,
      startDate: '2024-11-01',
      endMode: 'noEnd',
      scope: 'general',
      reminderDaysBefore: 0,
      isPaused: false,
      createdAt: '2024-11-01T00:00:00Z',
      updatedAt: '2024-11-01T00:00:00Z',
    };

    const dates = generateExpectedDates(rule, '2024-11-01', '2025-02-28');

    expect(dates).toEqual([
      '2024-11-15',
      '2024-12-15',
      '2025-01-15',
      '2025-02-15',
    ]);
  });
});
