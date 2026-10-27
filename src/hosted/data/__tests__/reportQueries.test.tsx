import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { profileKey } from '../../session/me';
import { activityKey } from '../reportQueries';
import { expenseCategoriesKey } from '../expenseQueries';

/** MUT-175: a save anywhere refreshes Reports (found by @portal.reports.signed-out: an income save left it on first run). */

describe('activityKey', () => {
  it('sits under the profile’s summaries, so every save that refreshes the summaries refreshes Reports', async () => {
    const client = new QueryClient();
    const key = activityKey('p1', { from: '2026-10-01', to: '2026-10-31' }, 'day');
    client.setQueryData(key, { stale: false });
    // incomeQueries' invalidateIncome refreshes profileKey(id, 'summary'); expense saves refresh profileKey(id, 'summary', 'activity')
    await client.invalidateQueries({ queryKey: profileKey('p1', 'summary') });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, { stale: false });
    await client.invalidateQueries({ queryKey: profileKey('p1', 'summary', 'activity') });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

/** MUT-464: seeded category names follow the portal language, so a language switch must not reuse the other one's list. */
describe('expenseCategoriesKey', () => {
  it('differs by language and archived, and sits under the profile’s categories', async () => {
    expect(expenseCategoriesKey('p1', 'ar')).not.toEqual(expenseCategoriesKey('p1', 'en'));
    expect(expenseCategoriesKey('p1', 'en', true)).not.toEqual(expenseCategoriesKey('p1', 'en'));
    const client = new QueryClient();
    for (const key of [expenseCategoriesKey('p1', 'ar'), expenseCategoriesKey('p1', 'en', true)]) {
      client.setQueryData(key, { items: [] });
      await client.invalidateQueries({ queryKey: profileKey('p1', 'expense-categories') });
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
