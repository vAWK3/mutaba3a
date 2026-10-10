import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { expenseRepo, expenseCategoryRepo, receiptRepo, vendorRepo } from '../expenseRepository';

describe('expenseRepo', () => {
  const profileId = 'test-profile-1';

  beforeEach(async () => {
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.receipts.clear();
    await db.businessProfiles.clear();
    await db.businessProfiles.add({
      id: profileId,
      name: 'Test Profile',
      email: 'test@example.com',
      isDefault: true,
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await db.expenses.clear();
    await db.expenseCategories.clear();
    await db.receipts.clear();
    await db.businessProfiles.clear();
  });

  describe('create', () => {
    it('should create an expense with all fields', async () => {
      const expense = await expenseRepo.create({
        profileId,
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Office supplies',
        vendor: 'Staples',
      });

      expect(expense.id).toBeDefined();
      expect(expense.amountMinor).toBe(5000);
      expect(expense.currency).toBe('USD');
      expect(expense.title).toBe('Office supplies');
      expect(expense.createdAt).toBeDefined();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await expenseRepo.create({
        profileId,
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        title: 'Expense 1',
      });
      await expenseRepo.create({
        profileId,
        amountMinor: 3000,
        currency: 'ILS',
        occurredAt: '2024-03-20',
        title: 'Expense 2',
      });
      await expenseRepo.create({
        profileId,
        amountMinor: 2000,
        currency: 'USD',
        occurredAt: '2024-04-10',
        title: 'Expense 3',
      });
    });

    it('should return all expenses for a profile', async () => {
      const expenses = await expenseRepo.list({ profileId });
      expect(expenses).toHaveLength(3);
    });

    it('should filter by currency', async () => {
      const usdExpenses = await expenseRepo.list({ profileId, currency: 'USD' });
      expect(usdExpenses).toHaveLength(2);
    });

    it('should filter by year and month', async () => {
      const marchExpenses = await expenseRepo.list({
        profileId,
        year: 2024,
        month: 3,
      });
      expect(marchExpenses).toHaveLength(2);

      const aprilExpenses = await expenseRepo.list({
        profileId,
        year: 2024,
        month: 4,
      });
      expect(aprilExpenses).toHaveLength(1);
    });

    it('should search by title', async () => {
      const results = await expenseRepo.list({
        profileId,
        search: 'Expense 2',
      });
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Expense 2');
    });

    it('should sort by occurredAt descending by default', async () => {
      const expenses = await expenseRepo.list({ profileId });
      expect(expenses[0].occurredAt).toBe('2024-04-10');
      expect(expenses[2].occurredAt).toBe('2024-03-15');
    });
  });

  describe('get', () => {
    it('should return an expense by id', async () => {
      const created = await expenseRepo.create({
        profileId,
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
      });

      const fetched = await expenseRepo.get(created.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await expenseRepo.get('non-existent');
      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update expense fields', async () => {
      const expense = await expenseRepo.create({
        profileId,
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
      });

      await expenseRepo.update(expense.id, { amountMinor: 7500, title: 'Updated' });

      const updated = await expenseRepo.get(expense.id);
      expect(updated?.amountMinor).toBe(7500);
      expect(updated?.title).toBe('Updated');
    });
  });

  describe('softDelete', () => {
    it('should soft delete an expense', async () => {
      const expense = await expenseRepo.create({
        profileId,
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
      });

      await expenseRepo.softDelete(expense.id);

      const deleted = await expenseRepo.get(expense.id);
      expect(deleted?.deletedAt).toBeDefined();

      // Should not appear in list by default
      const expenses = await expenseRepo.list({ profileId });
      expect(expenses).toHaveLength(0);

      // Should appear with includeDeleted
      const allExpenses = await expenseRepo.list({ profileId, includeDeleted: true });
      expect(allExpenses).toHaveLength(1);
    });
  });

});

describe('expenseCategoryRepo', () => {
  const profileId = 'test-profile-1';

  beforeEach(async () => {
    await db.expenseCategories.clear();
  });

  afterEach(async () => {
    await db.expenseCategories.clear();
  });

  describe('create', () => {
    it('should create a category', async () => {
      const category = await expenseCategoryRepo.create({
        profileId,
        name: 'Office Supplies',
        color: '#FF0000',
      });

      expect(category.id).toBeDefined();
      expect(category.name).toBe('Office Supplies');
      expect(category.color).toBe('#FF0000');
    });
  });

  describe('list', () => {
    it('should return categories for a profile sorted by name', async () => {
      await expenseCategoryRepo.create({ profileId, name: 'Zebra' });
      await expenseCategoryRepo.create({ profileId, name: 'Alpha' });
      await expenseCategoryRepo.create({ profileId, name: 'Beta' });

      const categories = await expenseCategoryRepo.list(profileId);

      expect(categories).toHaveLength(3);
      expect(categories[0].name).toBe('Alpha');
      expect(categories[1].name).toBe('Beta');
      expect(categories[2].name).toBe('Zebra');
    });
  });

  describe('update', () => {
    it('should update category fields', async () => {
      const category = await expenseCategoryRepo.create({
        profileId,
        name: 'Test',
      });

      await expenseCategoryRepo.update(category.id, { name: 'Updated' });

      const updated = await expenseCategoryRepo.get(category.id);
      expect(updated?.name).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should delete a category', async () => {
      const category = await expenseCategoryRepo.create({
        profileId,
        name: 'Test',
      });

      await expenseCategoryRepo.delete(category.id);

      const deleted = await expenseCategoryRepo.get(category.id);
      expect(deleted).toBeUndefined();
    });
  });
});

describe('receiptRepo', () => {
  const profileId = 'test-profile-1';

  beforeEach(async () => {
    await db.receipts.clear();
    await db.expenses.clear();
  });

  afterEach(async () => {
    await db.receipts.clear();
    await db.expenses.clear();
  });

  describe('create', () => {
    it('should create a receipt', async () => {
      const receipt = await receiptRepo.create({
        profileId,
        fileName: 'receipt.pdf',
        monthKey: '2024-03',
        sizeBytes: 12345,
        mimeType: 'application/pdf',
        data: 'base64-test-data',
      });

      expect(receipt.id).toBeDefined();
      expect(receipt.fileName).toBe('receipt.pdf');
      expect(receipt.monthKey).toBe('2024-03');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await receiptRepo.create({
        profileId,
        fileName: 'receipt1.pdf',
        monthKey: '2024-03',
        sizeBytes: 100,
        mimeType: 'application/pdf',
        data: 'base64-test-data',
      });
      await receiptRepo.create({
        profileId,
        fileName: 'receipt2.pdf',
        monthKey: '2024-03',
        sizeBytes: 200,
        mimeType: 'application/pdf',
        data: 'base64-test-data',
      });
      await receiptRepo.create({
        profileId,
        fileName: 'receipt3.pdf',
        monthKey: '2024-04',
        sizeBytes: 300,
        mimeType: 'application/pdf',
        data: 'base64-test-data',
      });
    });

    it('should return receipts for a profile', async () => {
      const receipts = await receiptRepo.list({ profileId });
      expect(receipts).toHaveLength(3);
    });

    it('should filter by monthKey', async () => {
      const marchReceipts = await receiptRepo.list({ profileId, monthKey: '2024-03' });
      expect(marchReceipts).toHaveLength(2);
    });
  });

});

describe('vendorRepo', () => {
  const profileId = 'test-profile-1';

  beforeEach(async () => {
    await db.vendors.clear();
    await db.expenses.clear();
    await db.receipts.clear();
  });

  afterEach(async () => {
    await db.vendors.clear();
    await db.expenses.clear();
    await db.receipts.clear();
  });

  describe('create', () => {
    it('should create a vendor', async () => {
      const vendor = await vendorRepo.create({
        profileId,
        canonicalName: 'Amazon',
        aliases: ['AMZN', 'Amazon.com'],
      });

      expect(vendor.id).toBeDefined();
      expect(vendor.canonicalName).toBe('Amazon');
      expect(vendor.aliases).toEqual(['AMZN', 'Amazon.com']);
    });
  });

  describe('findByAlias', () => {
    it('should find vendor by canonical name', async () => {
      await vendorRepo.create({
        profileId,
        canonicalName: 'Amazon',
        aliases: [],
      });

      const found = await vendorRepo.findByAlias(profileId, 'Amazon');
      expect(found).toBeDefined();
      expect(found?.canonicalName).toBe('Amazon');
    });

    it('should find vendor by alias', async () => {
      await vendorRepo.create({
        profileId,
        canonicalName: 'Amazon',
        aliases: ['AMZN', 'Amazon.com'],
      });

      const found = await vendorRepo.findByAlias(profileId, 'AMZN');
      expect(found).toBeDefined();
      expect(found?.canonicalName).toBe('Amazon');
    });

    it('should return undefined for unknown vendor', async () => {
      const found = await vendorRepo.findByAlias(profileId, 'Unknown');
      expect(found).toBeUndefined();
    });
  });

  describe('findOrCreate', () => {
    it('should return existing vendor if found', async () => {
      const original = await vendorRepo.create({
        profileId,
        canonicalName: 'Amazon',
        aliases: [],
      });

      const found = await vendorRepo.findOrCreate(profileId, 'Amazon');
      expect(found.id).toBe(original.id);
    });

    it('should create new vendor if not found', async () => {
      const created = await vendorRepo.findOrCreate(profileId, 'New Vendor');
      expect(created.id).toBeDefined();
      expect(created.canonicalName).toBe('New Vendor');
    });
  });

});
