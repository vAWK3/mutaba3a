import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { getRepositories } from '../provider';
import { getCategoryTemplates } from '../defaultExpenseCategories';

// MUT-47 (T8): category seeding moved from a standalone helper onto the
// expense-category repository. Behaviour pinned as it was: one category per
// template of the preset, named in the chosen language, and no de-duplication
// (seeding twice creates the set twice — the UI offers it on an empty list).

beforeEach(() => db.expenseCategories.clear());
afterEach(() => db.expenseCategories.clear());

describe('expenseCategories.seedDefaults', () => {
  it('creates the preset in the chosen language for the business', async () => {
    await getRepositories().base.expenseCategories.seedDefaults('bp-1', 'freelancer', 'ar');

    const rows = await db.expenseCategories.where('profileId').equals('bp-1').toArray();
    const expected = getCategoryTemplates('freelancer', 'ar');
    expect(rows.map((r) => [r.name, r.color]).sort()).toEqual(expected.map((c) => [c.name, c.color]).sort());
  });

  it('does not de-duplicate when run twice', async () => {
    const categories = getRepositories().base.expenseCategories;
    await categories.seedDefaults('bp-1', 'general', 'en');
    await categories.seedDefaults('bp-1', 'general', 'en');

    expect(await db.expenseCategories.count()).toBe(getCategoryTemplates('general', 'en').length * 2);
  });
});
