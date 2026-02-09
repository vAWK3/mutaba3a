import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, clientRepo, projectRepo, TransactionLockedError } from '../repository';
import type { Transaction, Client, Project } from '../../types';

describe('transactionRepo', () => {
  let testClient: Client;
  let testProject: Project;

  beforeEach(async () => {
    // Clear all relevant tables before each test
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();

    // Create test client and project for relationship tests
    testClient = await clientRepo.create({ name: 'Test Client', email: 'client@test.com' });
    testProject = await projectRepo.create({ name: 'Test Project', clientId: testClient.id });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();
  });

  const createTestTransaction = (
    overrides: Partial<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>> = {}
  ): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> => ({
    kind: 'income',
    status: 'paid',
    title: 'Test Transaction',
    amountMinor: 10000, // $100.00
    currency: 'USD',
    occurredAt: '2024-01-15',
    ...overrides,
  });

  describe('create', () => {
    it('should create a new transaction', async () => {
      const data = createTestTransaction();
      const transaction = await transactionRepo.create(data);

      expect(transaction.id).toBeDefined();
      expect(transaction.kind).toBe('income');
      expect(transaction.status).toBe('paid');
      expect(transaction.amountMinor).toBe(10000);
      expect(transaction.currency).toBe('USD');
      expect(transaction.createdAt).toBeDefined();
      expect(transaction.updatedAt).toBeDefined();
    });

    it('should create income transaction with unpaid status (receivable)', async () => {
      const data = createTestTransaction({
        kind: 'income',
        status: 'unpaid',
        dueDate: '2024-02-15',
      });
      const transaction = await transactionRepo.create(data);

      expect(transaction.kind).toBe('income');
      expect(transaction.status).toBe('unpaid');
      expect(transaction.dueDate).toBe('2024-02-15');
    });

    it('should create expense transaction', async () => {
      const data = createTestTransaction({
        kind: 'expense',
        title: 'Office Supplies',
        amountMinor: 5000,
      });
      const transaction = await transactionRepo.create(data);

      expect(transaction.kind).toBe('expense');
      expect(transaction.amountMinor).toBe(5000);
    });

    it('should create transaction with client and project references', async () => {
      const data = createTestTransaction({
        clientId: testClient.id,
        projectId: testProject.id,
      });
      const transaction = await transactionRepo.create(data);

      expect(transaction.clientId).toBe(testClient.id);
      expect(transaction.projectId).toBe(testProject.id);
    });
  });

  describe('list', () => {
    it('should return empty array when no transactions exist', async () => {
      const transactions = await transactionRepo.list();
      expect(transactions).toHaveLength(0);
    });

    it('should return all transactions sorted by occurredAt desc', async () => {
      await transactionRepo.create(createTestTransaction({ title: 'First', occurredAt: '2024-01-01' }));
      await transactionRepo.create(createTestTransaction({ title: 'Second', occurredAt: '2024-01-15' }));
      await transactionRepo.create(createTestTransaction({ title: 'Third', occurredAt: '2024-01-10' }));

      const transactions = await transactionRepo.list();

      expect(transactions).toHaveLength(3);
      expect(transactions[0].title).toBe('Second'); // Most recent first
      expect(transactions[1].title).toBe('Third');
      expect(transactions[2].title).toBe('First');
    });

    it('should exclude soft-deleted transactions', async () => {
      const tx = await transactionRepo.create(createTestTransaction({ title: 'To Delete' }));
      await transactionRepo.create(createTestTransaction({ title: 'Keep' }));

      await transactionRepo.softDelete(tx.id);

      const transactions = await transactionRepo.list();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].title).toBe('Keep');
    });

    it('should include resolved client and project names', async () => {
      await transactionRepo.create(
        createTestTransaction({
          clientId: testClient.id,
          projectId: testProject.id,
        })
      );

      const transactions = await transactionRepo.list();

      expect(transactions[0].clientName).toBe('Test Client');
      expect(transactions[0].projectName).toBe('Test Project');
    });
  });

  describe('list with filters', () => {
    beforeEach(async () => {
      // Create diverse set of transactions for filtering tests
      await transactionRepo.create(
        createTestTransaction({
          title: 'USD Income Paid',
          kind: 'income',
          status: 'paid',
          currency: 'USD',
          amountMinor: 10000,
          occurredAt: '2024-01-15',
          clientId: testClient.id,
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          title: 'USD Income Unpaid',
          kind: 'income',
          status: 'unpaid',
          currency: 'USD',
          amountMinor: 5000,
          occurredAt: '2024-01-20',
          dueDate: '2024-02-20',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          title: 'ILS Expense',
          kind: 'expense',
          status: 'paid',
          currency: 'ILS',
          amountMinor: 20000,
          occurredAt: '2024-02-01',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          title: 'EUR Income',
          kind: 'income',
          status: 'paid',
          currency: 'EUR',
          amountMinor: 15000,
          occurredAt: '2024-03-01',
        })
      );
    });

    it('should filter by currency', async () => {
      const transactions = await transactionRepo.list({ currency: 'USD' });

      expect(transactions).toHaveLength(2);
      transactions.forEach((tx) => expect(tx.currency).toBe('USD'));
    });

    it('should filter by kind', async () => {
      const incomes = await transactionRepo.list({ kind: 'income' });
      const expenses = await transactionRepo.list({ kind: 'expense' });

      expect(incomes).toHaveLength(3);
      expect(expenses).toHaveLength(1);
    });

    it('should filter by status', async () => {
      const paid = await transactionRepo.list({ status: 'paid' });
      const unpaid = await transactionRepo.list({ status: 'unpaid' });

      expect(paid).toHaveLength(3);
      expect(unpaid).toHaveLength(1);
    });

    it('should filter by date range', async () => {
      const transactions = await transactionRepo.list({
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(transactions).toHaveLength(2);
    });

    it('should filter by clientId', async () => {
      const transactions = await transactionRepo.list({ clientId: testClient.id });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].clientId).toBe(testClient.id);
    });

    it('should filter by search term in title', async () => {
      const transactions = await transactionRepo.list({ search: 'expense' });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].title).toBe('ILS Expense');
    });

    it('should filter by search term in client name', async () => {
      const transactions = await transactionRepo.list({ search: 'Test Client' });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].clientName).toBe('Test Client');
    });

    it('should apply pagination with limit and offset', async () => {
      const page1 = await transactionRepo.list({ limit: 2, offset: 0 });
      const page2 = await transactionRepo.list({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      // No overlap between pages
      const page1Ids = new Set(page1.map((t) => t.id));
      page2.forEach((t) => expect(page1Ids.has(t.id)).toBe(false));
    });

    it('should sort by custom field', async () => {
      const ascending = await transactionRepo.list({ sort: { by: 'amountMinor', dir: 'asc' } });
      const descending = await transactionRepo.list({ sort: { by: 'amountMinor', dir: 'desc' } });

      expect(ascending[0].amountMinor).toBe(5000);
      expect(descending[0].amountMinor).toBe(20000);
    });
  });

  describe('list with overdue filter', () => {
    it('should filter overdue receivables', async () => {
      const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Overdue receivable
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: pastDate,
          title: 'Overdue',
        })
      );

      // Not yet due receivable
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: futureDate,
          title: 'Not Due Yet',
        })
      );

      // Paid (not overdue)
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          title: 'Already Paid',
        })
      );

      const overdue = await transactionRepo.list({ status: 'overdue' });

      expect(overdue).toHaveLength(1);
      expect(overdue[0].title).toBe('Overdue');
    });
  });

  describe('get', () => {
    it('should return a transaction by id', async () => {
      const created = await transactionRepo.create(createTestTransaction());
      const fetched = await transactionRepo.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await transactionRepo.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('getDisplay', () => {
    it('should return transaction with resolved names', async () => {
      const created = await transactionRepo.create(
        createTestTransaction({
          clientId: testClient.id,
          projectId: testProject.id,
        })
      );

      const display = await transactionRepo.getDisplay(created.id);

      expect(display).toBeDefined();
      expect(display?.clientName).toBe('Test Client');
      expect(display?.projectName).toBe('Test Project');
    });

    it('should return undefined for deleted transaction', async () => {
      const created = await transactionRepo.create(createTestTransaction());
      await transactionRepo.softDelete(created.id);

      const display = await transactionRepo.getDisplay(created.id);

      expect(display).toBeUndefined();
    });

    it('should calculate daysOverdue for overdue receivables', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const created = await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: pastDate,
        })
      );

      const display = await transactionRepo.getDisplay(created.id);

      expect(display?.daysOverdue).toBeGreaterThanOrEqual(5);
    });
  });

  describe('update', () => {
    it('should update transaction fields', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      await transactionRepo.update(transaction.id, {
        title: 'Updated Title',
        amountMinor: 20000,
      });

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.amountMinor).toBe(20000);
      // updatedAt should be set (may be same if test runs quickly, so just check it exists)
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should throw error when updating locked transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      // Lock the transaction
      await db.transactions.update(transaction.id, {
        lockedAt: new Date().toISOString(),
        lockedByDocumentId: 'doc-123',
      });

      await expect(
        transactionRepo.update(transaction.id, { title: 'New Title' })
      ).rejects.toThrow(TransactionLockedError);
    });

    it('should allow archiving locked transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      // Lock the transaction
      await db.transactions.update(transaction.id, {
        lockedAt: new Date().toISOString(),
        lockedByDocumentId: 'doc-123',
      });

      // Archiving should still work
      await transactionRepo.archive(transaction.id);

      const archived = await transactionRepo.get(transaction.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });

  describe('markPaid', () => {
    it('should mark unpaid transaction as paid', async () => {
      const transaction = await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: '2024-02-15',
        })
      );

      await transactionRepo.markPaid(transaction.id);

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.paidAt).toBeDefined();
    });
  });

  describe('softDelete', () => {
    it('should soft delete a transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      await transactionRepo.softDelete(transaction.id);

      const deleted = await transactionRepo.get(transaction.id);
      expect(deleted?.deletedAt).toBeDefined();

      // Should not appear in list
      const list = await transactionRepo.list();
      expect(list).toHaveLength(0);
    });
  });

  describe('archive', () => {
    it('should archive a transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      await transactionRepo.archive(transaction.id);

      const archived = await transactionRepo.get(transaction.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });

  describe('unarchive', () => {
    it('should unarchive a transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());
      await transactionRepo.archive(transaction.id);

      await transactionRepo.unarchive(transaction.id);

      const unarchived = await transactionRepo.get(transaction.id);
      expect(unarchived?.archivedAt).toBeUndefined();
    });
  });

  describe('isLocked', () => {
    it('should return false for unlocked transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());
      const isLocked = await transactionRepo.isLocked(transaction.id);
      expect(isLocked).toBe(false);
    });

    it('should return true for locked transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());
      await db.transactions.update(transaction.id, { lockedAt: new Date().toISOString() });

      const isLocked = await transactionRepo.isLocked(transaction.id);
      expect(isLocked).toBe(true);
    });
  });

  describe('getOverviewTotals', () => {
    it('should calculate totals for date range', async () => {
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          amountMinor: 10000,
          currency: 'USD',
          occurredAt: '2024-01-15',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          amountMinor: 5000,
          currency: 'USD',
          occurredAt: '2024-01-20',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          kind: 'expense',
          status: 'paid',
          amountMinor: 3000,
          currency: 'USD',
          occurredAt: '2024-01-25',
        })
      );

      const totals = await transactionRepo.getOverviewTotals({
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        currency: 'USD',
      });

      expect(totals.paidIncomeMinor).toBe(10000);
      expect(totals.unpaidIncomeMinor).toBe(5000);
      expect(totals.expensesMinor).toBe(3000);
    });

    it('should filter by currency', async () => {
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          amountMinor: 10000,
          currency: 'USD',
          occurredAt: '2024-01-15',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          amountMinor: 20000,
          currency: 'ILS',
          occurredAt: '2024-01-15',
        })
      );

      const usdTotals = await transactionRepo.getOverviewTotals({
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
        currency: 'USD',
      });

      expect(usdTotals.paidIncomeMinor).toBe(10000);
    });
  });

  describe('getOverviewTotalsByCurrency', () => {
    it('should calculate totals separated by currency', async () => {
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          amountMinor: 10000,
          currency: 'USD',
          occurredAt: '2024-01-15',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          amountMinor: 20000,
          currency: 'ILS',
          occurredAt: '2024-01-15',
        })
      );
      await transactionRepo.create(
        createTestTransaction({
          kind: 'expense',
          status: 'paid',
          amountMinor: 5000,
          currency: 'EUR',
          occurredAt: '2024-01-15',
        })
      );

      const totals = await transactionRepo.getOverviewTotalsByCurrency({
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(totals.USD.paidIncomeMinor).toBe(10000);
      expect(totals.ILS.paidIncomeMinor).toBe(20000);
      expect(totals.EUR.expensesMinor).toBe(5000);
    });
  });

  describe('getAttentionReceivables', () => {
    it('should return overdue and soon-due receivables', async () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const soonDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const farDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Overdue
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: pastDate,
          title: 'Overdue',
          currency: 'USD',
        })
      );

      // Due in 5 days (within 7 day window)
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: soonDate,
          title: 'Due Soon',
          currency: 'USD',
        })
      );

      // Due in 30 days (not urgent)
      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'unpaid',
          dueDate: farDate,
          title: 'Far Away',
          currency: 'USD',
        })
      );

      const attention = await transactionRepo.getAttentionReceivables({ currency: 'USD' });

      expect(attention).toHaveLength(2);
      // Should be sorted by due date (most urgent first)
      expect(attention[0].title).toBe('Overdue');
      expect(attention[1].title).toBe('Due Soon');
    });

    it('should exclude paid transactions', async () => {
      const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      await transactionRepo.create(
        createTestTransaction({
          kind: 'income',
          status: 'paid',
          dueDate: pastDate,
          title: 'Already Paid',
          currency: 'USD',
        })
      );

      const attention = await transactionRepo.getAttentionReceivables({ currency: 'USD' });

      expect(attention).toHaveLength(0);
    });
  });
});
