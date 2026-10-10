/**
 * Money-event views are derived, never written.
 *
 * `moneyEventRepository` recomputes every event from transactions, expenses and
 * projected income on each read, so no write ever invalidates these keys as a
 * side effect of its own data changing -- the write paths have to say so. Until
 * MUT-6 QA they did not: the key list had a single caller,
 * `useInvalidateMoneyEvents`, which nothing in the app called, and the Overview
 * KPI strip and attention feed served stale numbers after every write.
 *
 * This suite guards the list itself. The write paths that call it are covered
 * where their modules have a mutation harness: the payment path in
 * `useQueries.test.tsx` and `markPaid` in `useIncomeQueries.test.tsx`.
 */
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateMoneyEventQueries } from '../useMoneyEventQueries';

/** Every key a money-event query is registered under. */
const MONEY_EVENT_KEYS = [
  'moneyEvents',
  'moneyDailyAggregates',
  'moneyMonthSummary',
  'moneyMonthKPIs',
  'moneyMonthKPIsBoth',
  'moneyGuidance',
  'moneyDayEvents',
  'moneyYearSummary',
  'moneyYearSummaryBoth',
];

function collectInvalidatedKeys() {
  const queryClient = new QueryClient();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');

  invalidateMoneyEventQueries(queryClient);

  return spy.mock.calls.map(([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]);
}

describe('invalidateMoneyEventQueries', () => {
  it.each(MONEY_EVENT_KEYS)('invalidates %s', (key) => {
    expect(collectInvalidatedKeys()).toContain(key);
  });

  it('invalidates every money-event key and nothing else', () => {
    // A new money-event query whose key is not added here would show the user
    // stale numbers after a write, with nothing failing to say so.
    expect(collectInvalidatedKeys().sort()).toEqual([...MONEY_EVENT_KEYS].sort());
  });
});
