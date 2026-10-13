import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, clientRepo, projectRepo, paymentRecordRepo } from '../repository';
import { expenseRepo } from '../expenseRepository';
import { formatLocalDate } from '../../lib/dates';
import type { Transaction, Client, Project } from '../../types';

describe('transactionRepo', () => {
  let testClient: Client;
  let testProject: Project;

  beforeEach(async () => {
    // Clear all relevant tables before each test
    await db.transactions.clear();
    await db.expenses.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();

    // Create test client and project for relationship tests
    testClient = await clientRepo.create({ name: 'Test Client', email: 'client@test.com' });
    testProject = await projectRepo.create({ name: 'Test Project', clientId: testClient.id });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.expenses.clear();
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

    it('should exclude archived transactions by default', async () => {
      await transactionRepo.create(createTestTransaction({ title: 'Active' }));
      const toArchive = await transactionRepo.create(createTestTransaction({ title: 'Archived' }));
      await transactionRepo.archive(toArchive.id);

      const transactions = await transactionRepo.list();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].title).toBe('Active');
    });

    it('should include archived transactions when includeArchived is true', async () => {
      await transactionRepo.create(createTestTransaction({ title: 'Active' }));
      const toArchive = await transactionRepo.create(createTestTransaction({ title: 'Archived' }));
      await transactionRepo.archive(toArchive.id);

      const transactions = await transactionRepo.list({ includeArchived: true });
      expect(transactions).toHaveLength(2);
    });

    it('should filter by profileId using baseQuery helper', async () => {
      await transactionRepo.create(createTestTransaction({ title: 'Profile A', profileId: 'profile-a' }));
      await transactionRepo.create(createTestTransaction({ title: 'Profile B', profileId: 'profile-b' }));

      const profileA = await transactionRepo.list({ profileId: 'profile-a' });
      expect(profileA).toHaveLength(1);
      expect(profileA[0].title).toBe('Profile A');

      const all = await transactionRepo.list();
      expect(all).toHaveLength(2);
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

    // MUT-145: documents are gone, so a row an exported document once locked
    // is an ordinary entry. Its stale lock fields stay in the row (no
    // rewrite, ADR-029) and nothing reads them.
    it('updates a legacy document-locked transaction (MUT-145)', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());
      await db.transactions.update(transaction.id, {
        lockedAt: new Date().toISOString(),
        lockedByDocumentId: 'doc-123',
      } as never);

      await transactionRepo.update(transaction.id, { title: 'New Title', amountMinor: 12345 });

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.title).toBe('New Title');
      expect(updated?.amountMinor).toBe(12345);
    });

    it('soft-deletes a legacy document-locked transaction (MUT-145)', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());
      await db.transactions.update(transaction.id, {
        lockedAt: new Date().toISOString(),
        lockedByDocumentId: 'doc-123',
      } as never);

      await transactionRepo.softDelete(transaction.id);

      expect((await db.transactions.get(transaction.id))?.deletedAt).toBeDefined();
    });

    it('archives a legacy document-locked transaction', async () => {
      const transaction = await transactionRepo.create(createTestTransaction());

      await db.transactions.update(transaction.id, {
        lockedAt: new Date().toISOString(),
        lockedByDocumentId: 'doc-123',
      } as never);
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

    /**
     * MUT-18: markPaid used to hardcode paidAt to the instant you clicked, so
     * reconciling a payment that arrived earlier recorded the wrong date --
     * and, for a payment near a month boundary, bucketed it in the wrong
     * month on any report grouped by paidAt.
     */
    it('should record a backdated paidAt when one is given', async () => {
      const transaction = await transactionRepo.create(
        createTestTransaction({ kind: 'income', status: 'unpaid' })
      );

      await transactionRepo.markPaid(transaction.id, { paidAt: '2026-09-20' });

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.paidAt).toBe('2026-09-20');
    });

    it('should default paidAt to today when none is given', async () => {
      const transaction = await transactionRepo.create(
        createTestTransaction({ kind: 'income', status: 'unpaid' })
      );
      const before = new Date().toISOString();

      await transactionRepo.markPaid(transaction.id);

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.paidAt).toBeDefined();
      expect(updated!.paidAt! >= before).toBe(true);
    });

    it('should bucket a backdated payment in the month it was received, not the month it was entered', async () => {
      const transaction = await transactionRepo.create(
        createTestTransaction({ kind: 'income', status: 'unpaid' })
      );

      // Reconciled in October for a payment that actually arrived in September.
      await transactionRepo.markPaid(transaction.id, { paidAt: '2026-09-30' });

      const updated = await transactionRepo.get(transaction.id);
      expect(updated?.paidAt?.startsWith('2026-09')).toBe(true);
    });

    it('should reject a future-dated payment', async () => {
      const transaction = await transactionRepo.create(
        createTestTransaction({ kind: 'income', status: 'unpaid' })
      );

      await expect(
        transactionRepo.markPaid(transaction.id, { paidAt: '2099-01-01' })
      ).rejects.toThrow('Payment date cannot be in the future');
    });
  });

  describe('createReceivedIncome', () => {
    const receivedFields = (overrides: Partial<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'paidAt' | 'receivedAmountMinor'>> = {}) => ({
      kind: 'income' as const,
      title: 'Design payment',
      amountMinor: 50000,
      currency: 'USD' as const,
      occurredAt: '2026-10-11',
      ...overrides,
    });

    /**
     * MUT-60: a fast-added income entry saved as Received used to write
     * status/paidAt/receivedAmountMinor straight onto the Transaction with no
     * PaymentRecord (TD-029). createReceivedIncome composes create + markPaid
     * so every Received entry becomes record-backed, like Mark-paid.
     */
    it('creates exactly one PaymentRecord for the full amount, dated paidAt', async () => {
      const tx = await transactionRepo.createReceivedIncome(receivedFields(), '2026-10-09');

      expect(tx.status).toBe('paid');
      expect(tx.receivedAmountMinor).toBe(50000);
      expect(tx.paidAt).toBe('2026-10-09');

      const records = await paymentRecordRepo.listByTransaction(tx.id);
      expect(records).toHaveLength(1);
      expect(records[0].amountMinor).toBe(50000);
      expect(records[0].paidAt).toBe('2026-10-09');
    });

    it('is atomic: a rejected payment date leaves no Transaction row behind', async () => {
      await expect(
        transactionRepo.createReceivedIncome(receivedFields(), '2099-01-01')
      ).rejects.toThrow('Payment date cannot be in the future');

      const list = await transactionRepo.list();
      expect(list).toHaveLength(0);
    });

    it('is editable afterward exactly like any other record-backed entry (the hasRecords branch, unchanged by this ticket)', async () => {
      const tx = await transactionRepo.createReceivedIncome(receivedFields(), '2026-10-09');

      // Payment state is owned by the record now -- an edit can't move it (ADR-039).
      await transactionRepo.update(tx.id, { status: 'unpaid', paidAt: undefined, receivedAmountMinor: undefined });

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.receivedAmountMinor).toBe(50000);
    });
  });

  // MUT-169: an unpaid entry edited to Received gets its payment record, like
  // a Received create (MUT-60). Before, the edit wrote status/paidAt/received
  // straight onto the entry, which left Edit Payment with no record to edit.
  describe('update to Received with no payment records', () => {
    const unpaid = () =>
      transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 40000,
        currency: 'USD',
        occurredAt: '2026-10-01',
      });

    it('records one payment for the full amount, dated the paidAt given', async () => {
      const tx = await unpaid();

      await transactionRepo.update(tx.id, { title: 'Logo', status: 'paid', paidAt: '2026-10-09', receivedAmountMinor: 40000 });

      const updated = await transactionRepo.get(tx.id);
      expect(updated).toMatchObject({ title: 'Logo', status: 'paid', paidAt: '2026-10-09', receivedAmountMinor: 40000 });
      const records = await paymentRecordRepo.listByTransaction(tx.id);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ amountMinor: 40000, paidAt: '2026-10-09' });
    });

    it('leaves an edit that stays unpaid without a record', async () => {
      const tx = await unpaid();

      await transactionRepo.update(tx.id, { title: 'Still owed', status: 'unpaid' });

      expect(await paymentRecordRepo.listByTransaction(tx.id)).toHaveLength(0);
      expect((await transactionRepo.get(tx.id))?.status).toBe('unpaid');
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
      await expenseRepo.create({
        profileId: 'profile-1',
        amountMinor: 3000,
        currency: 'USD',
        occurredAt: '2024-01-25',
      });

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
      await expenseRepo.create({
        profileId: 'profile-1',
        amountMinor: 5000,
        currency: 'EUR',
        occurredAt: '2024-01-15',
      });

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

    /**
     * MUT-8: Home's Needs attention renders this list directly, across every
     * currency, so its window and order are pinned here.
     */
    describe('as Home\'s Needs attention (MUT-8)', () => {
      const inDays = (n: number) => {
        const d = new Date();
        d.setDate(d.getDate() + n);
        return formatLocalDate(d);
      };
      const receivable = (title: string, dueInDays: number, overrides: Partial<Transaction> = {}) =>
        transactionRepo.create(
          createTestTransaction({ kind: 'income', status: 'unpaid', title, dueDate: inDays(dueInDays), ...overrides })
        );

      it('includes due today and due in exactly 7 days, but not 8 days out', async () => {
        await receivable('Today', 0);
        await receivable('Seven', 7);
        await receivable('Eight', 8);

        const titles = (await transactionRepo.getAttentionReceivables({})).map((t) => t.title);

        expect(titles).toEqual(['Today', 'Seven']);
      });

      it('marks only items due before today as overdue', async () => {
        await receivable('Yesterday', -1);
        await receivable('Today', 0);

        const rows = await transactionRepo.getAttentionReceivables({});

        expect(rows.map((r) => [r.title, r.daysOverdue])).toEqual([
          ['Yesterday', 1],
          ['Today', undefined],
        ]);
      });

      it('covers every currency when no currency is given, EUR included', async () => {
        await receivable('Euro', -2, { currency: 'EUR' });
        await receivable('Shekel', -1, { currency: 'ILS' });

        const rows = await transactionRepo.getAttentionReceivables({});

        expect(rows.map((r) => r.currency)).toEqual(['EUR', 'ILS']);
      });

      it('orders oldest due first, then by client name, so equal dates never reshuffle', async () => {
        const zed = await clientRepo.create({ name: 'Zed' });
        const abe = await clientRepo.create({ name: 'Abe' });
        await receivable('Zed job', -3, { clientId: zed.id });
        await receivable('Abe job', -3, { clientId: abe.id });
        await receivable('Older', -10);

        const titles = (await transactionRepo.getAttentionReceivables({})).map((t) => t.title);

        expect(titles).toEqual(['Older', 'Abe job', 'Zed job']);
      });

      it('leaves out archived entries', async () => {
        const archived = await receivable('Archived', -5);
        await transactionRepo.archive(archived.id);

        expect(await transactionRepo.getAttentionReceivables({})).toEqual([]);
      });
    });
  });
});
