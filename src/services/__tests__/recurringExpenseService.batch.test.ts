/**
 * MUT-87: the Needs attention drawer marks, skips and snoozes several payments
 * of one recurring rule at once. Each batch is one all-or-nothing write that
 * reuses the single-payment service functions. Runs against fake-indexeddb.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../db/database';
import { recurringOccurrenceRepo, recurringRuleRepo } from '../../db/expenseRepository';
import {
  confirmPayments,
  skipOccurrences,
  snoozeOccurrences,
  getVirtualOccurrences,
} from '../recurringExpenseService';
import type { RecurringRule } from '../../types';

const PROFILE_ID = 'profile-1';
const AUG = '2026-08-05';
const SEP = '2026-09-05';
const OCT = '2026-10-05';
const RANGE_FROM = '2026-08-01';
const RANGE_TO = '2026-10-31';
const FAR_FUTURE = '2099-01-01';

async function clearTables() {
  await Promise.all([
    db.recurringRules.clear(),
    db.recurringOccurrences.clear(),
    db.expenses.clear(),
    db.expenseCategories.clear(),
    db.vendors.clear(),
    db.projects.clear(),
  ]);
}

async function createHostingRule(): Promise<RecurringRule> {
  return recurringRuleRepo.create({
    profileId: PROFILE_ID,
    title: 'Server hosting',
    amountMinor: 8000,
    currency: 'USD',
    frequency: 'monthly',
    dayOfMonth: 5,
    startDate: RANGE_FROM,
    endMode: 'noEnd',
    scope: 'general',
    reminderDaysBefore: 0,
    isPaused: false,
  });
}

async function liveExpenses() {
  return (await db.expenses.toArray()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

describe('recurring expense batches (MUT-87)', () => {
  let rule: RecurringRule;

  beforeEach(async () => {
    await clearTables();
    rule = await createHostingRule();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearTables();
  });

  describe('confirmPayments', () => {
    it('writes one expense per payment, each dated on its own expected date (T9)', async () => {
      const created = await confirmPayments({
        ruleId: rule.id,
        profileId: PROFILE_ID,
        payments: [{ expectedDate: AUG }, { expectedDate: SEP }, { expectedDate: OCT }],
      });

      expect(created).toHaveLength(3);
      const expenses = await liveExpenses();
      expect(expenses.map((e) => e.occurredAt)).toEqual([AUG, SEP, OCT]);
      expect(expenses.every((e) => e.amountMinor === 8000 && e.currency === 'USD')).toBe(true);
      expect(expenses.every((e) => e.recurringRuleId === rule.id && e.title === 'Server hosting')).toBe(true);

      const occurrences = await db.recurringOccurrences.toArray();
      expect(occurrences).toHaveLength(3);
      for (const expense of expenses) {
        const occurrence = occurrences.find((o) => o.id === expense.recurringOccurrenceId);
        expect(occurrence).toMatchObject({
          status: 'resolved_paid',
          fulfilledExpenseId: expense.id,
          expectedDate: expense.occurredAt,
        });
      }
    });

    it('writes only the selected payments; the rest stay due (T10)', async () => {
      await confirmPayments({
        ruleId: rule.id,
        profileId: PROFILE_ID,
        payments: [{ expectedDate: AUG }, { expectedDate: OCT }],
      });

      expect((await liveExpenses()).map((e) => e.occurredAt)).toEqual([AUG, OCT]);
      const remaining = await getVirtualOccurrences(PROFILE_ID, RANGE_FROM, RANGE_TO);
      expect(remaining.map((o) => o.expectedDate)).toEqual([SEP]);
    });

    it('leaves nothing behind when one payment fails (T11)', async () => {
      const create = recurringOccurrenceRepo.create.bind(recurringOccurrenceRepo);
      vi.spyOn(recurringOccurrenceRepo, 'create')
        .mockImplementationOnce(create)
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(
        confirmPayments({
          ruleId: rule.id,
          profileId: PROFILE_ID,
          payments: [{ expectedDate: AUG }, { expectedDate: SEP }, { expectedDate: OCT }],
        })
      ).rejects.toThrow('disk full');

      expect(await db.expenses.count()).toBe(0);
      expect(await db.recurringOccurrences.count()).toBe(0);
    });

    it('writes nothing for an unknown rule', async () => {
      await expect(
        confirmPayments({ ruleId: 'missing', profileId: PROFILE_ID, payments: [{ expectedDate: AUG }] })
      ).rejects.toThrow(/not found/);

      expect(await db.expenses.count()).toBe(0);
    });

    it('stores an edited amount, and only an edited one, as the override (T12)', async () => {
      await confirmPayments({
        ruleId: rule.id,
        profileId: PROFILE_ID,
        payments: [{ expectedDate: AUG, amountMinor: 9550 }, { expectedDate: SEP }],
      });

      const [aug, sep] = await liveExpenses();
      expect(aug.amountMinor).toBe(9550);
      expect(sep.amountMinor).toBe(8000);
      const augOccurrence = await recurringOccurrenceRepo.getByRuleAndDate(rule.id, AUG);
      const sepOccurrence = await recurringOccurrenceRepo.getByRuleAndDate(rule.id, SEP);
      expect(augOccurrence?.actualAmountMinor).toBe(9550);
      expect(sepOccurrence?.actualAmountMinor).toBeUndefined();
    });

    it('does nothing for an empty selection', async () => {
      expect(await confirmPayments({ ruleId: rule.id, profileId: PROFILE_ID, payments: [] })).toEqual([]);
      expect(await db.expenses.count()).toBe(0);
    });
  });

  describe('skipOccurrences (T13)', () => {
    it('skips one payment and writes no expense', async () => {
      await skipOccurrences({ ruleId: rule.id, profileId: PROFILE_ID, expectedDates: [SEP] });

      expect(await db.expenses.count()).toBe(0);
      expect((await recurringOccurrenceRepo.getByRuleAndDate(rule.id, SEP))?.status).toBe('resolved_skipped');
      const remaining = await getVirtualOccurrences(PROFILE_ID, RANGE_FROM, RANGE_TO);
      expect(remaining.map((o) => o.expectedDate)).toEqual([AUG, OCT]);
    });

    it('skips every payment at once', async () => {
      await skipOccurrences({ ruleId: rule.id, profileId: PROFILE_ID, expectedDates: [AUG, SEP, OCT] });

      const occurrences = await db.recurringOccurrences.toArray();
      expect(occurrences.map((o) => o.status)).toEqual(['resolved_skipped', 'resolved_skipped', 'resolved_skipped']);
      expect(await getVirtualOccurrences(PROFILE_ID, RANGE_FROM, RANGE_TO)).toEqual([]);
    });

    it('is all or nothing', async () => {
      const create = recurringOccurrenceRepo.create.bind(recurringOccurrenceRepo);
      vi.spyOn(recurringOccurrenceRepo, 'create')
        .mockImplementationOnce(create)
        .mockRejectedValueOnce(new Error('disk full'));

      await expect(
        skipOccurrences({ ruleId: rule.id, profileId: PROFILE_ID, expectedDates: [AUG, SEP] })
      ).rejects.toThrow('disk full');

      expect(await db.recurringOccurrences.count()).toBe(0);
    });
  });

  describe('snoozeOccurrences (T14)', () => {
    it('snoozes each payment until the date', async () => {
      await snoozeOccurrences({
        ruleId: rule.id,
        profileId: PROFILE_ID,
        expectedDates: [AUG, SEP],
        snoozeUntil: FAR_FUTURE,
      });

      const occurrences = await db.recurringOccurrences.toArray();
      expect(occurrences).toHaveLength(2);
      expect(occurrences.every((o) => o.status === 'snoozed' && o.snoozeUntil === FAR_FUTURE)).toBe(true);
    });

    it('rejects a date that is not in the future and writes nothing', async () => {
      await expect(
        snoozeOccurrences({
          ruleId: rule.id,
          profileId: PROFILE_ID,
          expectedDates: [AUG, SEP],
          snoozeUntil: '2000-01-01',
        })
      ).rejects.toThrow(/future/);

      expect(await db.recurringOccurrences.count()).toBe(0);
    });
  });

  it('carries the rule frequency on each virtual occurrence (T15)', async () => {
    const occurrences = await getVirtualOccurrences(PROFILE_ID, RANGE_FROM, RANGE_TO);

    expect(occurrences.map((o) => o.frequency)).toEqual(['monthly', 'monthly', 'monthly']);
  });
});
