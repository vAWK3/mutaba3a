import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { clientRepo, projectRepo, transactionRepo, clientSummaryRepo, paymentRecordRepo } from '../repository';
import { formatLocalDate } from '../../lib/dates';
import type { Client } from '../../types';

/** A local calendar date n days before today (negative = after). */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatLocalDate(d);
};

describe('clientRepo', () => {
  beforeEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
  });

  const createTestClient = (
    overrides: Partial<Omit<Client, 'id' | 'createdAt' | 'updatedAt'>> = {}
  ): Omit<Client, 'id' | 'createdAt' | 'updatedAt'> => ({
    name: 'Test Client',
    email: 'client@example.com',
    phone: '+972501234567',
    notes: 'Test notes',
    ...overrides,
  });

  describe('create', () => {
    it('should create a new client', async () => {
      const data = createTestClient();
      const client = await clientRepo.create(data);

      expect(client.id).toBeDefined();
      expect(client.name).toBe('Test Client');
      expect(client.email).toBe('client@example.com');
      expect(client.phone).toBe('+972501234567');
      expect(client.createdAt).toBeDefined();
      expect(client.updatedAt).toBeDefined();
    });

    it('should create client without optional fields', async () => {
      const client = await clientRepo.create({ name: 'Minimal Client' });

      expect(client.id).toBeDefined();
      expect(client.name).toBe('Minimal Client');
      expect(client.email).toBeUndefined();
      expect(client.phone).toBeUndefined();
    });
  });

  describe('list', () => {
    it('should return empty array when no clients exist', async () => {
      const clients = await clientRepo.list();
      expect(clients).toHaveLength(0);
    });

    it('should return all clients sorted by name', async () => {
      await clientRepo.create(createTestClient({ name: 'Zebra Corp' }));
      await clientRepo.create(createTestClient({ name: 'Alpha Inc' }));
      await clientRepo.create(createTestClient({ name: 'Beta LLC' }));

      const clients = await clientRepo.list();

      expect(clients).toHaveLength(3);
      expect(clients[0].name).toBe('Alpha Inc');
      expect(clients[1].name).toBe('Beta LLC');
      expect(clients[2].name).toBe('Zebra Corp');
    });

    it('should exclude archived clients by default', async () => {
      const active = await clientRepo.create(createTestClient({ name: 'Active' }));
      const toArchive = await clientRepo.create(createTestClient({ name: 'To Archive' }));
      await clientRepo.archive(toArchive.id);

      const clients = await clientRepo.list();

      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe(active.id);
    });

    it('should include archived clients when requested', async () => {
      await clientRepo.create(createTestClient({ name: 'Active' }));
      const toArchive = await clientRepo.create(createTestClient({ name: 'To Archive' }));
      await clientRepo.archive(toArchive.id);

      const clients = await clientRepo.list({ includeArchived: true });

      expect(clients).toHaveLength(2);
    });
  });

  describe('get', () => {
    it('should return a client by id', async () => {
      const created = await clientRepo.create(createTestClient());
      const fetched = await clientRepo.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.name).toBe(created.name);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await clientRepo.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update client fields', async () => {
      const client = await clientRepo.create(createTestClient());

      await clientRepo.update(client.id, { name: 'Updated Name', email: 'new@email.com' });

      const updated = await clientRepo.get(client.id);
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.email).toBe('new@email.com');
      // updatedAt should be set (may be same if test runs quickly, so just check it exists)
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should preserve unchanged fields', async () => {
      const client = await clientRepo.create(createTestClient());

      await clientRepo.update(client.id, { name: 'New Name' });

      const updated = await clientRepo.get(client.id);
      expect(updated?.email).toBe('client@example.com'); // Unchanged
      expect(updated?.phone).toBe('+972501234567'); // Unchanged
    });
  });

  describe('archive', () => {
    it('should archive a client', async () => {
      const client = await clientRepo.create(createTestClient());

      await clientRepo.archive(client.id);

      const archived = await clientRepo.get(client.id);
      expect(archived?.archivedAt).toBeDefined();
    });
  });

  describe('delete', () => {
    it('should permanently delete a client', async () => {
      const client = await clientRepo.create(createTestClient());

      await clientRepo.delete(client.id);

      const deleted = await clientRepo.get(client.id);
      expect(deleted).toBeUndefined();
    });
  });
});

describe('clientSummaryRepo', () => {
  beforeEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  afterEach(async () => {
    await db.clients.clear();
    await db.projects.clear();
    await db.transactions.clear();
    await db.paymentRecords.clear();
  });

  describe('list', () => {
    it('should return client summaries with transaction totals', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });

      // Create transactions for this client
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-01-20',
        clientId: client.id,
      });

      const summaries = await clientSummaryRepo.list();

      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('Test Client');
      expect(summaries[0].paidIncomeMinor).toBe(10000);
      expect(summaries[0].unpaidIncomeMinor).toBe(5000);
    });

    it('should count active projects', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });
      await projectRepo.create({ name: 'Project 1', clientId: client.id });
      await projectRepo.create({ name: 'Project 2', clientId: client.id });
      const archivedProject = await projectRepo.create({ name: 'Archived Project', clientId: client.id });
      await projectRepo.archive(archivedProject.id);

      const summaries = await clientSummaryRepo.list();

      expect(summaries[0].activeProjectCount).toBe(2);
    });

    it('should track last payment date', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        paidAt: '2024-01-15T10:00:00.000Z',
        clientId: client.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-02-01',
        paidAt: '2024-02-01T10:00:00.000Z',
        clientId: client.id,
      });

      const summaries = await clientSummaryRepo.list();

      expect(summaries[0].lastPaymentAt).toBe('2024-02-01T10:00:00.000Z');
    });

    it('should filter by currency', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'ILS',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });

      const summaries = await clientSummaryRepo.list({ currency: 'USD' });

      expect(summaries[0].paidIncomeMinor).toBe(10000);
    });

    it('should filter by search term', async () => {
      await clientRepo.create({ name: 'Acme Corp' });
      await clientRepo.create({ name: 'Beta Inc' });

      const summaries = await clientSummaryRepo.list({ search: 'acme' });

      expect(summaries).toHaveLength(1);
      expect(summaries[0].name).toBe('Acme Corp');
    });

    it('should include per-currency report totals when no currency filter', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 20000,
        currency: 'ILS',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });

      const summaries = await clientSummaryRepo.list();

      expect(summaries[0].paidIncomeMinorUSD).toBe(10000);
      expect(summaries[0].paidIncomeMinorILS).toBe(20000);
    });

    it('should sort by last activity date', async () => {
      const client1 = await clientRepo.create({ name: 'Client 1' });
      const client2 = await clientRepo.create({ name: 'Client 2' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-01',
        clientId: client1.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-02-01',
        clientId: client2.id,
      });

      const summaries = await clientSummaryRepo.list();

      // Most recent activity first
      expect(summaries[0].name).toBe('Client 2');
      expect(summaries[1].name).toBe('Client 1');
    });
  });

  /**
   * MUT-7: the clients index answers "who owes me, and who is late". Owed now
   * uses the MUT-3 helper (archived income excluded), and last payment uses
   * the same payment rows as the profile's Payments section (ADR-033).
   */
  describe('collection fields (MUT-7)', () => {
    const income = (clientId: string, overrides: Parameters<typeof transactionRepo.create>[0] | object = {}) =>
      transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: daysAgo(60),
        clientId,
        ...overrides,
      });

    it('reports owed now per currency, leaving out paid and archived income', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id, { amountMinor: 10000, dueDate: daysAgo(3) });
      await income(client.id, { amountMinor: 50000, currency: 'ILS', receivedAmountMinor: 20000 });
      await income(client.id, { status: 'paid', amountMinor: 99900 });
      const archived = await income(client.id, { amountMinor: 77700, currency: 'EUR' });
      await transactionRepo.archive(archived.id);

      const [summary] = await clientSummaryRepo.list();

      expect(summary.owed).toEqual([
        { currency: 'USD', owedMinor: 10000, overdueMinor: 10000 },
        { currency: 'ILS', owedMinor: 30000, overdueMinor: 0 },
      ]);
    });

    it('reports a settled client as owing nothing', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id, { status: 'paid' });

      const [summary] = await clientSummaryRepo.list();

      expect(summary.owed).toEqual([]);
      expect(summary.oldestOverdueDays).toBeUndefined();
    });

    it('reports the age of the oldest overdue item; due today is not overdue', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id, { dueDate: daysAgo(4) });
      await income(client.id, { dueDate: daysAgo(31), currency: 'ILS' });
      await income(client.id, { dueDate: daysAgo(0) });

      const [summary] = await clientSummaryRepo.list();

      expect(summary.oldestOverdueDays).toBe(31);
    });

    it('takes the last payment from payment records, so a partial payment counts', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await income(client.id, { currency: 'ILS' });
      await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 2500, paidAt: '2024-03-01' });

      const [summary] = await clientSummaryRepo.list();

      expect(summary.lastPayment).toEqual({ paidAt: '2024-03-01', amountMinor: 2500, currency: 'ILS' });
      expect(summary.lastPaymentAt).toBe('2024-03-01');
    });

    it('takes a backdated record over an older fully paid entry, and ignores deleted records', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id, { status: 'paid', amountMinor: 7000, paidAt: '2024-02-01' });
      const tx = await income(client.id);
      await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 3000, paidAt: '2024-02-20' });
      const deleted = await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 1000, paidAt: '2024-04-01' });
      await paymentRecordRepo.delete(deleted.id);

      const [summary] = await clientSummaryRepo.list();

      expect(summary.lastPayment).toEqual({ paidAt: '2024-02-20', amountMinor: 3000, currency: 'USD' });
    });

    it('counts income saved as already paid (no payment record) as a payment', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id, { status: 'paid', amountMinor: 7000, receivedAmountMinor: 7000, paidAt: '2024-02-01' });

      const [summary] = await clientSummaryRepo.list();

      expect(summary.lastPayment).toEqual({ paidAt: '2024-02-01', amountMinor: 7000, currency: 'USD' });
    });

    it('leaves last payment empty for a client who never paid', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await income(client.id);

      const [summary] = await clientSummaryRepo.list();

      expect(summary.lastPayment).toBeUndefined();
      expect(summary.lastPaymentAt).toBeUndefined();
    });

    it('leaves archived clients out', async () => {
      await clientRepo.create({ name: 'Active' });
      const gone = await clientRepo.create({ name: 'Gone' });
      await clientRepo.archive(gone.id);

      const summaries = await clientSummaryRepo.list();

      expect(summaries.map((s) => s.name)).toEqual(['Active']);
    });

    it('get() takes its last payment from payment records too', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await income(client.id);
      await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 2500, paidAt: '2024-03-01' });

      const summary = await clientSummaryRepo.get(client.id);

      expect(summary?.lastPaymentAt).toBe('2024-03-01');
    });
  });

  describe('get', () => {
    it('should return a single client summary', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });
      await projectRepo.create({ name: 'Project 1', clientId: client.id });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });

      const summary = await clientSummaryRepo.get(client.id);

      expect(summary).toBeDefined();
      expect(summary?.name).toBe('Test Client');
      expect(summary?.activeProjectCount).toBe(1);
      expect(summary?.paidIncomeMinor).toBe(10000);
    });

    it('should return undefined for non-existent client', async () => {
      const summary = await clientSummaryRepo.get('non-existent-id');
      expect(summary).toBeUndefined();
    });

    it('should filter by date range', async () => {
      const client = await clientRepo.create({ name: 'Test Client' });

      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: client.id,
      });
      await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-03-15',
        clientId: client.id,
      });

      const summary = await clientSummaryRepo.get(client.id, {
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31',
      });

      expect(summary?.paidIncomeMinor).toBe(10000);
    });
  });
});
