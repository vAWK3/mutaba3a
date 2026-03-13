import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  recurringExpenseQueryKeys,
  useVirtualOccurrences,
  useDueOccurrences,
  useRecurringRules,
  useActiveRecurringRules,
  useRecurringRule,
  useRuleHistory,
  useConfirmRecurringPayment,
  useSkipRecurringOccurrence,
  useSnoozeRecurringOccurrence,
  useCreateRecurringRule,
  usePauseRecurringRule,
  useResumeRecurringRule,
  useDeleteRecurringRule,
} from '../useRecurringExpenseQueries';
import * as recurringService from '../../services/recurringExpenseService';
import * as expenseRepository from '../../db/expenseRepository';

// Mock dependencies
vi.mock('../../services/recurringExpenseService', () => ({
  getVirtualOccurrences: vi.fn(),
  getDueOccurrences: vi.fn(),
  confirmPayment: vi.fn(),
  skipOccurrence: vi.fn(),
  snoozeOccurrence: vi.fn(),
  createRecurringRule: vi.fn(),
  getRuleHistory: vi.fn(),
}));

vi.mock('../../db/expenseRepository', () => ({
  recurringRuleRepo: {
    list: vi.fn(),
    get: vi.fn(),
    listActive: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    softDelete: vi.fn(),
  },
  recurringOccurrenceRepo: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe('recurringExpenseQueryKeys', () => {
  it('should generate virtualOccurrences key', () => {
    const key = recurringExpenseQueryKeys.virtualOccurrences('profile-1', '2026-01-01', '2026-12-31');
    expect(key).toEqual(['virtualOccurrences', { profileId: 'profile-1', dateFrom: '2026-01-01', dateTo: '2026-12-31' }]);
  });

  it('should generate dueOccurrences key', () => {
    const key = recurringExpenseQueryKeys.dueOccurrences('profile-1');
    expect(key).toEqual(['dueOccurrences', 'profile-1']);
  });

  it('should generate occurrences key with filters', () => {
    const key = recurringExpenseQueryKeys.occurrences({
      profileId: 'profile-1',
      ruleId: 'rule-1',
      status: 'pending',
    });
    expect(key).toEqual(['recurringOccurrences', { profileId: 'profile-1', ruleId: 'rule-1', status: 'pending' }]);
  });

  it('should generate occurrence key', () => {
    const key = recurringExpenseQueryKeys.occurrence('occ-1');
    expect(key).toEqual(['recurringOccurrence', 'occ-1']);
  });

  it('should generate ruleHistory key', () => {
    const key = recurringExpenseQueryKeys.ruleHistory('rule-1');
    expect(key).toEqual(['recurringRuleHistory', 'rule-1']);
  });

  it('should generate rules key', () => {
    const key = recurringExpenseQueryKeys.rules('profile-1');
    expect(key).toEqual(['recurringRules', { profileId: 'profile-1' }]);
  });

  it('should generate rule key', () => {
    const key = recurringExpenseQueryKeys.rule('rule-1');
    expect(key).toEqual(['recurringRule', 'rule-1']);
  });

  it('should generate activeRules key', () => {
    const key = recurringExpenseQueryKeys.activeRules('profile-1');
    expect(key).toEqual(['activeRecurringRules', 'profile-1']);
  });
});

describe('Query Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useVirtualOccurrences', () => {
    it('should fetch virtual occurrences', async () => {
      const mockOccurrences = [{ ruleId: 'rule-1', expectedDate: '2026-03-15' }];
      (recurringService.getVirtualOccurrences as ReturnType<typeof vi.fn>).mockResolvedValue(mockOccurrences);

      const { result } = renderHook(
        () => useVirtualOccurrences('profile-1', '2026-03-01', '2026-03-31'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockOccurrences);
      expect(recurringService.getVirtualOccurrences).toHaveBeenCalledWith('profile-1', '2026-03-01', '2026-03-31');
    });

    it('should not fetch when profileId is undefined', () => {
      renderHook(
        () => useVirtualOccurrences(undefined, '2026-03-01', '2026-03-31'),
        { wrapper: createWrapper() }
      );

      expect(recurringService.getVirtualOccurrences).not.toHaveBeenCalled();
    });

    it('should not fetch when disabled', () => {
      renderHook(
        () => useVirtualOccurrences('profile-1', '2026-03-01', '2026-03-31', { enabled: false }),
        { wrapper: createWrapper() }
      );

      expect(recurringService.getVirtualOccurrences).not.toHaveBeenCalled();
    });
  });

  describe('useDueOccurrences', () => {
    it('should fetch due occurrences', async () => {
      const mockOccurrences = [{ ruleId: 'rule-1', computedState: 'due' }];
      (recurringService.getDueOccurrences as ReturnType<typeof vi.fn>).mockResolvedValue(mockOccurrences);

      const { result } = renderHook(
        () => useDueOccurrences('profile-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockOccurrences);
    });

    it('should not fetch when profileId is undefined', () => {
      renderHook(
        () => useDueOccurrences(undefined),
        { wrapper: createWrapper() }
      );

      expect(recurringService.getDueOccurrences).not.toHaveBeenCalled();
    });
  });

  describe('useRecurringRules', () => {
    it('should fetch rules for profile', async () => {
      const mockRules = [{ id: 'rule-1', title: 'Test Rule' }];
      (expenseRepository.recurringRuleRepo.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockRules);

      const { result } = renderHook(
        () => useRecurringRules('profile-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockRules);
      expect(expenseRepository.recurringRuleRepo.list).toHaveBeenCalledWith({ profileId: 'profile-1' });
    });
  });

  describe('useActiveRecurringRules', () => {
    it('should fetch active rules', async () => {
      const mockRules = [{ id: 'rule-1', isPaused: false }];
      (expenseRepository.recurringRuleRepo.listActive as ReturnType<typeof vi.fn>).mockResolvedValue(mockRules);

      const { result } = renderHook(
        () => useActiveRecurringRules('profile-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockRules);
    });
  });

  describe('useRecurringRule', () => {
    it('should fetch single rule', async () => {
      const mockRule = { id: 'rule-1', title: 'Test Rule' };
      (expenseRepository.recurringRuleRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRule);

      const { result } = renderHook(
        () => useRecurringRule('rule-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockRule);
    });

    it('should not fetch when id is undefined', () => {
      renderHook(
        () => useRecurringRule(undefined),
        { wrapper: createWrapper() }
      );

      expect(expenseRepository.recurringRuleRepo.get).not.toHaveBeenCalled();
    });
  });

  describe('useRuleHistory', () => {
    it('should fetch rule history', async () => {
      const mockHistory = [{ id: 'occ-1', status: 'resolved_paid' }];
      (recurringService.getRuleHistory as ReturnType<typeof vi.fn>).mockResolvedValue(mockHistory);

      const { result } = renderHook(
        () => useRuleHistory('rule-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockHistory);
    });
  });
});

describe('Mutation Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useConfirmRecurringPayment', () => {
    it('should confirm payment', async () => {
      const mockExpense = { id: 'expense-1' };
      (recurringService.confirmPayment as ReturnType<typeof vi.fn>).mockResolvedValue(mockExpense);

      const { result } = renderHook(
        () => useConfirmRecurringPayment(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          ruleId: 'rule-1',
          profileId: 'profile-1',
          expectedDate: '2026-03-15',
        });
      });

      expect(recurringService.confirmPayment).toHaveBeenCalledWith({
        ruleId: 'rule-1',
        profileId: 'profile-1',
        expectedDate: '2026-03-15',
      });
    });
  });

  describe('useSkipRecurringOccurrence', () => {
    it('should skip occurrence', async () => {
      const mockOccurrence = { id: 'occ-1', status: 'resolved_skipped' };
      (recurringService.skipOccurrence as ReturnType<typeof vi.fn>).mockResolvedValue(mockOccurrence);

      const { result } = renderHook(
        () => useSkipRecurringOccurrence(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          ruleId: 'rule-1',
          profileId: 'profile-1',
          expectedDate: '2026-03-15',
        });
      });

      expect(recurringService.skipOccurrence).toHaveBeenCalled();
    });
  });

  describe('useSnoozeRecurringOccurrence', () => {
    it('should snooze occurrence', async () => {
      const mockOccurrence = { id: 'occ-1', status: 'snoozed' };
      (recurringService.snoozeOccurrence as ReturnType<typeof vi.fn>).mockResolvedValue(mockOccurrence);

      const { result } = renderHook(
        () => useSnoozeRecurringOccurrence(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          ruleId: 'rule-1',
          profileId: 'profile-1',
          expectedDate: '2026-03-15',
          snoozeUntil: '2026-03-20',
        });
      });

      expect(recurringService.snoozeOccurrence).toHaveBeenCalled();
    });
  });

  describe('useCreateRecurringRule', () => {
    it('should create rule', async () => {
      const mockRule = { id: 'rule-1' };
      (recurringService.createRecurringRule as ReturnType<typeof vi.fn>).mockResolvedValue(mockRule);

      const { result } = renderHook(
        () => useCreateRecurringRule(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync({
          profileId: 'profile-1',
          title: 'Test Rule',
          amountMinor: 10000,
          currency: 'USD',
          frequency: 'monthly',
          dayOfMonth: 15,
          startDate: '2026-01-01',
          endMode: 'noEnd',
        });
      });

      expect(recurringService.createRecurringRule).toHaveBeenCalled();
    });
  });

  describe('usePauseRecurringRule', () => {
    it('should pause rule', async () => {
      (expenseRepository.recurringRuleRepo.pause as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(
        () => usePauseRecurringRule(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('rule-1');
      });

      expect(expenseRepository.recurringRuleRepo.pause).toHaveBeenCalledWith('rule-1');
    });
  });

  describe('useResumeRecurringRule', () => {
    it('should resume rule', async () => {
      (expenseRepository.recurringRuleRepo.resume as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useResumeRecurringRule(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('rule-1');
      });

      expect(expenseRepository.recurringRuleRepo.resume).toHaveBeenCalledWith('rule-1');
    });
  });

  describe('useDeleteRecurringRule', () => {
    it('should soft delete rule', async () => {
      (expenseRepository.recurringRuleRepo.softDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const { result } = renderHook(
        () => useDeleteRecurringRule(),
        { wrapper: createWrapper() }
      );

      await act(async () => {
        await result.current.mutateAsync('rule-1');
      });

      expect(expenseRepository.recurringRuleRepo.softDelete).toHaveBeenCalledWith('rule-1');
    });
  });
});
