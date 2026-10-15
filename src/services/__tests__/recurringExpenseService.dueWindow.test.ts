/**
 * MUT-96 (TD-069): Needs attention lists every unresolved payment since the later of the rule's start date and the
 * day after its last resolved payment. It used to look back only 90 days, so older missed months silently dropped out.
 * Runs against fake-indexeddb, with the clock fixed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../db/database';
import { recurringRuleRepo } from '../../db/expenseRepository';
import { confirmPayment, getDueOccurrences, skipOccurrence } from '../recurringExpenseService';

const PROFILE_ID = 'profile-1';

async function clearTables() {
  await Promise.all([db.recurringRules, db.recurringOccurrences, db.expenses, db.expenseCategories, db.vendors, db.projects].map((t) => t.clear()));
}

function monthlyRule(startDate: string) {
  return recurringRuleRepo.create({
    profileId: PROFILE_ID, title: 'Server hosting', amountMinor: 8000, currency: 'USD', frequency: 'monthly', dayOfMonth: 5,
    startDate, endMode: 'noEnd', scope: 'general', reminderDaysBefore: 0, isPaused: false,
  });
}

const dueMonths = async () => (await getDueOccurrences(PROFILE_ID)).map((o) => o.expectedDate.slice(0, 7));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)); // 15 Oct 2026, local
  await clearTables();
});

afterEach(async () => {
  vi.useRealTimers();
  await clearTables();
});

describe('getDueOccurrences lookback (MUT-96)', () => {
  it('lists every month since the rule started six months ago, not only the last 90 days', async () => {
    await monthlyRule('2026-04-01');
    expect(await dueMonths()).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  it('starts the day after the last resolved payment, paid or skipped', async () => {
    const rule = await monthlyRule('2026-04-01');
    await confirmPayment({ ruleId: rule.id, profileId: PROFILE_ID, expectedDate: '2026-06-05' });
    expect(await dueMonths()).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);

    await skipOccurrence({ ruleId: rule.id, profileId: PROFILE_ID, expectedDate: '2026-08-05' });
    expect(await dueMonths()).toEqual(['2026-09', '2026-10']);
  });

  it('reaches a rule started three years ago', async () => {
    await monthlyRule('2023-10-01');
    const months = await dueMonths();
    expect(months).toHaveLength(37);
    expect(months[0]).toBe('2023-10');
  });
});
