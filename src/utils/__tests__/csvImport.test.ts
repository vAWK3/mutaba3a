import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../db/database';
import { expenseRepo, expenseCategoryRepo } from '../../db/expenseRepository';
import { importExpenseRow, resolveImportProfileId } from '../csvImport';

describe('csvImport', () => {
  beforeEach(async () => {
    await db.businessProfiles.clear();
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.transactions.clear();
    await db.categories.clear();
  });

  afterEach(async () => {
    await db.businessProfiles.clear();
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.transactions.clear();
    await db.categories.clear();
  });

  describe('resolveImportProfileId', () => {
    it('returns the selected profile id unchanged when one is already selected', async () => {
      const result = await resolveImportProfileId('existing-profile-id', 'en');
      expect(result).toBe('existing-profile-id');
      expect(await db.businessProfiles.count()).toBe(0);
    });

    it('auto-creates a default profile when none is selected, mirroring WelcomeModal\'s skip shape', async () => {
      const profileId = await resolveImportProfileId(null, 'en');

      const profiles = await db.businessProfiles.toArray();
      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe(profileId);
      expect(profiles[0].name).toBe('Default Profile');
      expect(profiles[0].email).toBe('');
      expect(profiles[0].businessType).toBe('none');
      expect(profiles[0].defaultCurrency).toBe('USD');
      expect(profiles[0].defaultLanguage).toBe('en');
      expect(profiles[0].isDefault).toBe(true);
    });

    it('names the auto-created default profile in Arabic when the app language is Arabic', async () => {
      await resolveImportProfileId(null, 'ar');

      const profiles = await db.businessProfiles.toArray();
      expect(profiles[0].name).toBe('ملف تعريف افتراضي');
      expect(profiles[0].defaultLanguage).toBe('ar');
    });
  });

  describe('importExpenseRow', () => {
    it('creates the row in db.expenses, not db.transactions', async () => {
      await importExpenseRow(
        { name: 'Office rent', amount: '150.50', currency: 'USD', date: '2026-01-15', notes: 'Jan rent' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      const expenses = await expenseRepo.list({});
      expect(expenses).toHaveLength(1);
      expect(expenses[0].title).toBe('Office rent');
      expect(expenses[0].amountMinor).toBe(15050);
      expect(expenses[0].currency).toBe('USD');
      expect(expenses[0].occurredAt).toBe('2026-01-15');
      expect(expenses[0].notes).toBe('Jan rent');
      expect(expenses[0].profileId).toBe('profile-1');

      expect(await db.transactions.count()).toBe(0);
    });

    it('resolves a category against db.expenseCategories, not the legacy global db.categories table', async () => {
      await importExpenseRow(
        { amount: '20', currency: 'USD', date: '2026-01-15', category: 'Groceries' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      const expenseCategories = await db.expenseCategories.toArray();
      expect(expenseCategories).toHaveLength(1);
      expect(expenseCategories[0].name).toBe('Groceries');
      expect(expenseCategories[0].profileId).toBe('profile-1');

      const [expense] = await expenseRepo.list({});
      expect(expense.categoryId).toBe(expenseCategories[0].id);

      expect(await db.categories.count()).toBe(0);
    });

    it('reuses an existing expense category instead of creating a duplicate', async () => {
      const existing = await expenseCategoryRepo.create({ profileId: 'profile-1', name: 'Travel' });

      await importExpenseRow(
        { amount: '40', currency: 'USD', date: '2026-01-15', category: 'Travel' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      expect(await db.expenseCategories.count()).toBe(1);
      const [expense] = await expenseRepo.list({});
      expect(expense.categoryId).toBe(existing.id);
    });

    it('resolves client and project ids from the provided name maps', async () => {
      const clientNameToId = new Map([['Acme', 'client-1']]);
      const projectNameToId = new Map([['Website', 'project-1']]);

      await importExpenseRow(
        { amount: '10', currency: 'USD', date: '2026-01-15', client: 'Acme', project: 'Website' },
        { profileId: 'profile-1', clientNameToId, projectNameToId }
      );

      const [expense] = await expenseRepo.list({});
      expect(expense.clientId).toBe('client-1');
      expect(expense.projectId).toBe('project-1');
    });

    it('skips a row missing amount, currency, or date and reports it was not created', async () => {
      const created = await importExpenseRow(
        { amount: '', currency: 'USD', date: '2026-01-15' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      expect(created).toBe(false);
      expect(await db.expenses.count()).toBe(0);
    });

    it('reports a row was created when valid', async () => {
      const created = await importExpenseRow(
        { amount: '10', currency: 'USD', date: '2026-01-15' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      expect(created).toBe(true);
    });

    it('defaults the title when the row has no name', async () => {
      await importExpenseRow(
        { amount: '10', currency: 'USD', date: '2026-01-15' },
        { profileId: 'profile-1', clientNameToId: new Map(), projectNameToId: new Map() }
      );

      const [expense] = await expenseRepo.list({});
      expect(expense.title).toBe('Expense');
    });
  });
});
