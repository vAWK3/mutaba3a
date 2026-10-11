import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, paymentRecordRepo, clientRepo } from '../repository';

describe('paymentRecordRepo', () => {
  let incomeId: string;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();

    const tx = await transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      amountMinor: 10000, // $100.00
      currency: 'USD',
      occurredAt: '2024-01-15',
      dueDate: '2024-02-15',
    });
    incomeId = tx.id;
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.paymentRecords.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();
  });

  describe('create', () => {
    it('should create a payment record and recalculate receivedAmountMinor', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      expect(record.transactionId).toBe(incomeId);
      expect(record.amountMinor).toBe(3000);
      expect(record.paidAt).toBe('2024-01-20');
      expect(record.id).toBeDefined();

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(3000);
      expect(tx?.status).toBe('unpaid');
    });

    it('should accumulate multiple payment records correctly', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 2000,
        paidAt: '2024-01-25',
      });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(5000);
      expect(tx?.status).toBe('unpaid');
    });

    it('should auto-mark paid when sum >= amountMinor', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 10000,
        paidAt: '2024-01-20',
      });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(10000);
      expect(tx?.status).toBe('paid');
      expect(tx?.paidAt).toBeDefined();
    });

    it('should reject negative payment amount', async () => {
      await expect(
        paymentRecordRepo.create({
          transactionId: incomeId,
          amountMinor: -1000,
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Payment amount must be positive');
    });

    it('should reject zero payment amount', async () => {
      await expect(
        paymentRecordRepo.create({
          transactionId: incomeId,
          amountMinor: 0,
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Payment amount must be positive');
    });

    it('should reject non-existent transaction', async () => {
      await expect(
        paymentRecordRepo.create({
          transactionId: 'non-existent',
          amountMinor: 1000,
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Transaction not found');
    });

    it('should reject expense transactions', async () => {
      const expense = await transactionRepo.create({
        kind: 'expense',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await expect(
        paymentRecordRepo.create({
          transactionId: expense.id,
          amountMinor: 1000,
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Payment records only apply to income transactions');
    });

    it('should store notes on payment record', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
        notes: 'Check #123',
      });

      expect(record.notes).toBe('Check #123');
    });
  });

  describe('update', () => {
    it('should update amount and recalculate', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      await paymentRecordRepo.update(record.id, { amountMinor: 5000 });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(5000);

      const updated = await paymentRecordRepo.get(record.id);
      expect(updated?.amountMinor).toBe(5000);
    });

    it('should update date without changing amount', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      await paymentRecordRepo.update(record.id, { paidAt: '2024-02-01' });

      const updated = await paymentRecordRepo.get(record.id);
      expect(updated?.paidAt).toBe('2024-02-01');
      expect(updated?.amountMinor).toBe(3000);
    });

    it('should update notes only', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      await paymentRecordRepo.update(record.id, { notes: 'Updated note' });

      const updated = await paymentRecordRepo.get(record.id);
      expect(updated?.notes).toBe('Updated note');
      expect(updated?.amountMinor).toBe(3000);
    });

    it('should reject non-existent record', async () => {
      await expect(
        paymentRecordRepo.update('non-existent', { amountMinor: 5000 })
      ).rejects.toThrow('Payment record not found');
    });

    it('should reject negative amount on update', async () => {
      const record = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      await expect(
        paymentRecordRepo.update(record.id, { amountMinor: -100 })
      ).rejects.toThrow('Payment amount must be positive');
    });
  });

  describe('delete', () => {
    it('should soft-delete and recalculate (total decreases)', async () => {
      const r1 = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 2000,
        paidAt: '2024-01-25',
      });

      // Before delete: 5000
      let tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(5000);

      await paymentRecordRepo.delete(r1.id);

      // After delete: 2000
      tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(2000);

      // Record should have deletedAt set
      const deleted = await paymentRecordRepo.get(r1.id);
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('should revert paid status when sum drops below amountMinor', async () => {
      // Pay in full
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 6000,
        paidAt: '2024-01-20',
      });
      const r2 = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-25',
      });

      let tx = await transactionRepo.get(incomeId);
      expect(tx?.status).toBe('paid');

      // Delete second payment, dropping below total
      await paymentRecordRepo.delete(r2.id);

      tx = await transactionRepo.get(incomeId);
      expect(tx?.status).toBe('unpaid');
      expect(tx?.receivedAmountMinor).toBe(6000);
    });

    it('should set receivedAmountMinor to 0 when all records deleted', async () => {
      const r1 = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      await paymentRecordRepo.delete(r1.id);

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(0);
      expect(tx?.status).toBe('unpaid');
    });

    it('should reject non-existent record', async () => {
      await expect(
        paymentRecordRepo.delete('non-existent')
      ).rejects.toThrow('Payment record not found');
    });
  });

  describe('listByTransaction', () => {
    it('should return records sorted by paidAt, excluding deleted', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 2000,
        paidAt: '2024-02-01',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 1000,
        paidAt: '2024-01-15',
      });
      const r3 = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 500,
        paidAt: '2024-01-25',
      });

      // Delete one
      await paymentRecordRepo.delete(r3.id);

      const records = await paymentRecordRepo.listByTransaction(incomeId);
      expect(records).toHaveLength(2);
      // Sorted by paidAt ascending
      expect(records[0].paidAt).toBe('2024-01-15');
      expect(records[1].paidAt).toBe('2024-02-01');
    });

    it('should return empty array for transaction with no records', async () => {
      const records = await paymentRecordRepo.listByTransaction(incomeId);
      expect(records).toEqual([]);
    });
  });

  // ADR-030: overpayment is rejected. These assertions replace the previous
  // "overpayment is allowed and clamped" contract, which stored an excess that
  // no surface in the app could show.
  describe('overpayment', () => {
    it('should reject a payment larger than the transaction total', async () => {
      await expect(
        paymentRecordRepo.create({
          transactionId: incomeId,
          amountMinor: 12000, // transaction is 10000
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Payment amount');

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor ?? 0).toBe(0);
      expect(tx?.status).toBe('unpaid');
      expect(await paymentRecordRepo.listByTransaction(incomeId)).toHaveLength(0);
    });

    it('should reject a payment that pushes the accumulated sum past the total', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 6000,
        paidAt: '2024-01-20',
      });

      await expect(
        paymentRecordRepo.create({
          transactionId: incomeId,
          amountMinor: 6000, // 6000 + 6000 > 10000
          paidAt: '2024-01-25',
        })
      ).rejects.toThrow('Payment amount');

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(6000);
      expect(tx?.status).toBe('unpaid');
    });

    it('should accept a payment that settles the exact remaining balance', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 6000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-25',
      });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(10000);
      expect(tx?.status).toBe('paid');
    });

    it('should reject an update that pushes the sum past the total', async () => {
      const first = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-25',
      });

      await expect(
        paymentRecordRepo.update(first.id, { amountMinor: 7000 }) // 7000 + 4000 > 10000
      ).rejects.toThrow('Payment amount');

      const unchanged = await paymentRecordRepo.get(first.id);
      expect(unchanged?.amountMinor).toBe(4000);
      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(8000);
    });

    it('should allow an update that stays within the total', async () => {
      const first = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 4000,
        paidAt: '2024-01-25',
      });

      await paymentRecordRepo.update(first.id, { amountMinor: 6000 }); // 6000 + 4000 === 10000

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(10000);
      expect(tx?.status).toBe('paid');
    });

    it('should not count deleted records towards the total', async () => {
      const first = await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 8000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.delete(first.id);

      // Without the delete this would overpay; with it the balance is free again.
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 9000,
        paidAt: '2024-01-25',
      });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(9000);
    });
  });

  // ADR-030: lockedAt protects the invoice facts (amount, currency, client,
  // date), not payment tracking. Paying an invoiced receivable is the normal
  // flow, so it must keep working -- see recalculateReceivedAmount.
  describe('locked transactions', () => {
    it('should accept a payment against a locked transaction and mark it paid', async () => {
      await db.transactions.update(incomeId, {
        lockedAt: '2024-01-16T00:00:00.000Z',
        lockedByDocumentId: 'doc-1',
      });

      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 10000,
        paidAt: '2024-01-20',
      });

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(10000);
      expect(tx?.status).toBe('paid');
      expect(tx?.paidAt).toBeDefined();
      expect(tx?.lockedAt).toBe('2024-01-16T00:00:00.000Z');
    });

    it('should still reject an overpayment on a locked transaction', async () => {
      await db.transactions.update(incomeId, {
        lockedAt: '2024-01-16T00:00:00.000Z',
        lockedByDocumentId: 'doc-1',
      });

      await expect(
        paymentRecordRepo.create({
          transactionId: incomeId,
          amountMinor: 10001,
          paidAt: '2024-01-20',
        })
      ).rejects.toThrow('Payment amount');
    });
  });

  describe('integration with transactionRepo', () => {
    it('recordPartialPayment should create a PaymentRecord', async () => {
      await transactionRepo.recordPartialPayment(incomeId, 3000);

      const records = await paymentRecordRepo.listByTransaction(incomeId);
      expect(records).toHaveLength(1);
      expect(records[0].amountMinor).toBe(3000);

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(3000);
    });

    it('markPaid should create a PaymentRecord for remaining amount', async () => {
      // First record a partial
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 3000,
        paidAt: '2024-01-20',
      });

      // Then mark fully paid
      await transactionRepo.markPaid(incomeId);

      const records = await paymentRecordRepo.listByTransaction(incomeId);
      expect(records).toHaveLength(2);
      // Second record should be for the remaining 7000
      expect(records[1].amountMinor).toBe(7000);

      const tx = await transactionRepo.get(incomeId);
      expect(tx?.receivedAmountMinor).toBe(10000);
      expect(tx?.status).toBe('paid');
    });
  });

  describe('listByClient', () => {
    const createClientTx = async (
      clientId: string,
      overrides: Partial<Parameters<typeof transactionRepo.create>[0]> = {}
    ) =>
      transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 100000,
        currency: 'USD',
        occurredAt: '2024-01-01',
        clientId,
        ...overrides,
      });

    it('returns payments joined with parent title and currency, newest first', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const txA = await createClientTx(client.id, { title: 'Logo work' });
      const txB = await createClientTx(client.id, {
        title: 'Site build',
        occurredAt: '2024-02-01',
      });
      await paymentRecordRepo.create({
        transactionId: txA.id,
        amountMinor: 50000,
        paidAt: '2024-01-10',
      });
      await paymentRecordRepo.create({
        transactionId: txB.id,
        amountMinor: 100000,
        paidAt: '2024-03-05',
        notes: 'wire',
      });

      const rows = await paymentRecordRepo.listByClient(client.id);

      expect(rows).toHaveLength(2);
      // Newest payment first
      expect(rows[0]).toMatchObject({
        transactionId: txB.id,
        transactionTitle: 'Site build',
        amountMinor: 100000,
        currency: 'USD',
        paidAt: '2024-03-05',
        notes: 'wire',
        source: 'record',
      });
      expect(rows[1].transactionTitle).toBe('Logo work');
    });

    it('returns an empty array when the client has transactions but no payments', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      await createClientTx(client.id);

      expect(await paymentRecordRepo.listByClient(client.id)).toEqual([]);
    });

    it('returns an empty array for an unknown client id', async () => {
      expect(await paymentRecordRepo.listByClient('missing-client')).toEqual([]);
    });

    it('excludes soft-deleted payment records', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await createClientTx(client.id);
      const record = await paymentRecordRepo.create({
        transactionId: tx.id,
        amountMinor: 1000,
        paidAt: '2024-01-10',
      });
      await paymentRecordRepo.delete(record.id);

      expect(await paymentRecordRepo.listByClient(client.id)).toEqual([]);
    });

    it('takes currency from the parent transaction and filters per currency', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const txUsd = await createClientTx(client.id, { title: 'USD work' });
      const txIls = await createClientTx(client.id, {
        title: 'ILS work',
        currency: 'ILS',
        amountMinor: 50000,
      });
      await paymentRecordRepo.create({
        transactionId: txUsd.id,
        amountMinor: 1000,
        paidAt: '2024-01-05',
      });
      await paymentRecordRepo.create({
        transactionId: txIls.id,
        amountMinor: 2000,
        paidAt: '2024-01-06',
      });

      const rows = await paymentRecordRepo.listByClient(client.id, { currency: 'ILS' });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ currency: 'ILS', amountMinor: 2000, transactionTitle: 'ILS work' });
    });

    it('filters by date range with inclusive boundaries', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await createClientTx(client.id);
      for (const paidAt of ['2024-01-10', '2024-01-20', '2024-02-01']) {
        await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 1000, paidAt });
      }

      const rows = await paymentRecordRepo.listByClient(client.id, {
        dateFrom: '2024-01-20',
        dateTo: '2024-02-01',
      });

      expect(rows.map((r) => r.paidAt)).toEqual(['2024-02-01', '2024-01-20']);
    });

    it('applies limit after sorting by paidAt descending', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await createClientTx(client.id);
      for (const paidAt of ['2024-01-01', '2024-01-15', '2024-02-01']) {
        await paymentRecordRepo.create({ transactionId: tx.id, amountMinor: 1000, paidAt });
      }

      const rows = await paymentRecordRepo.listByClient(client.id, { limit: 2 });

      expect(rows.map((r) => r.paidAt)).toEqual(['2024-02-01', '2024-01-15']);
    });

    it('includes a timestamped payment made on the dateTo day', async () => {
      const client = await clientRepo.create({ name: 'Acme' });
      const tx = await createClientTx(client.id);
      await paymentRecordRepo.create({
        transactionId: tx.id,
        amountMinor: 1000,
        paidAt: '2024-02-01T09:30:00.000Z',
      });

      const rows = await paymentRecordRepo.listByClient(client.id, {
        dateFrom: '2024-02-01',
        dateTo: '2024-02-01',
      });

      expect(rows).toHaveLength(1);
    });

    /**
     * MUT-3 / D3: income saved as Received in the income drawer is marked paid
     * with no PaymentRecord. Without these rows the client's payment history
     * would leave out every job the user logged as already paid.
     */
    describe('income received without payment records', () => {
      it('returns one entry row for income saved as already paid', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        const tx = await createClientTx(client.id, {
          title: 'Logo',
          status: 'paid',
          amountMinor: 20000,
          currency: 'ILS',
          receivedAmountMinor: 20000,
          paidAt: '2024-01-14T08:00:00.000Z',
        });

        const rows = await paymentRecordRepo.listByClient(client.id);

        expect(rows).toEqual([
          {
            id: `entry:${tx.id}`,
            transactionId: tx.id,
            transactionTitle: 'Logo',
            amountMinor: 20000,
            currency: 'ILS',
            paidAt: '2024-01-14T08:00:00.000Z',
            notes: undefined,
            source: 'entry',
          },
        ]);
      });

      it('dates the entry row by occurredAt when the entry has no paidAt', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        await createClientTx(client.id, { status: 'paid', occurredAt: '2024-01-03' });

        const rows = await paymentRecordRepo.listByClient(client.id);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ paidAt: '2024-01-03', amountMinor: 100000, source: 'entry' });
      });

      it('adds no entry row when payment records already cover the entry', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        const tx = await createClientTx(client.id);
        await transactionRepo.markPaid(tx.id, { paidAt: '2024-01-20' });

        const rows = await paymentRecordRepo.listByClient(client.id);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ source: 'record', amountMinor: 100000 });
      });

      it('adds an entry row only for the part the records do not cover', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        const tx = await createClientTx(client.id, {
          status: 'paid',
          receivedAmountMinor: 100000,
          paidAt: '2024-01-30',
        });
        // A record written straight to the table, as a pre-v18 import or a
        // sync bundle could leave it, alongside the entry's own received total.
        await db.paymentRecords.add({
          id: 'rec-1',
          transactionId: tx.id,
          amountMinor: 40000,
          paidAt: '2024-01-10',
          createdAt: '2024-01-10T00:00:00.000Z',
          updatedAt: '2024-01-10T00:00:00.000Z',
        });

        const rows = await paymentRecordRepo.listByClient(client.id);

        expect(rows.map((r) => [r.source, r.amountMinor])).toEqual([
          ['entry', 60000],
          ['record', 40000],
        ]);
      });

      it('adds no row for an unpaid entry with nothing received', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        await createClientTx(client.id);

        expect(await paymentRecordRepo.listByClient(client.id)).toEqual([]);
      });

      it('leaves out a soft-deleted entry and its payments entirely', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        const paid = await createClientTx(client.id, { status: 'paid' });
        const partial = await createClientTx(client.id);
        await paymentRecordRepo.create({ transactionId: partial.id, amountMinor: 1000, paidAt: '2024-01-05' });
        await transactionRepo.softDelete(paid.id);
        await transactionRepo.softDelete(partial.id);

        expect(await paymentRecordRepo.listByClient(client.id)).toEqual([]);
      });

      it('applies currency, date range and limit to entry rows and sorts them with records', async () => {
        const client = await clientRepo.create({ name: 'Acme' });
        const recorded = await createClientTx(client.id);
        await paymentRecordRepo.create({ transactionId: recorded.id, amountMinor: 1000, paidAt: '2024-02-10' });
        await createClientTx(client.id, { status: 'paid', paidAt: '2024-02-20' });
        await createClientTx(client.id, { status: 'paid', paidAt: '2024-01-05' });
        await createClientTx(client.id, { status: 'paid', paidAt: '2024-02-15', currency: 'ILS' });

        const usdFebruary = await paymentRecordRepo.listByClient(client.id, {
          currency: 'USD',
          dateFrom: '2024-02-01',
          dateTo: '2024-02-29',
        });
        expect(usdFebruary.map((r) => [r.source, r.paidAt])).toEqual([
          ['entry', '2024-02-20'],
          ['record', '2024-02-10'],
        ]);

        const newestTwo = await paymentRecordRepo.listByClient(client.id, { limit: 2 });
        expect(newestTwo.map((r) => r.paidAt)).toEqual(['2024-02-20', '2024-02-15']);
      });
    });
  });

  /**
   * MUT-8: Home's Recent payments -- the same payment rows as a client's
   * Payments section (ADR-033), across every client, with the client named.
   */
  describe('listRecent', () => {
    const income = (overrides: Partial<Parameters<typeof transactionRepo.create>[0]> = {}) =>
      transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 100000,
        currency: 'USD',
        occurredAt: '2024-01-01',
        ...overrides,
      });

    beforeEach(async () => {
      // The suite's own fixture income has no client; start from nothing.
      await db.transactions.clear();
    });

    it('returns an empty list when nothing has been paid', async () => {
      await income();
      expect(await paymentRecordRepo.listRecent()).toEqual([]);
    });

    it('lists payments across clients, newest first, naming the client and what it was for', async () => {
      const acme = await clientRepo.create({ name: 'Acme' });
      const beta = await clientRepo.create({ name: 'Beta' });
      const a = await income({ clientId: acme.id, title: 'Homepage' });
      await paymentRecordRepo.create({ transactionId: a.id, amountMinor: 2000, paidAt: '2024-02-01', notes: 'wire' });
      await income({ clientId: beta.id, title: 'Logo', status: 'paid', paidAt: '2024-03-01', currency: 'ILS' });

      const rows = await paymentRecordRepo.listRecent();

      expect(rows.map((r) => [r.clientName, r.transactionTitle, r.amountMinor, r.currency, r.source])).toEqual([
        ['Beta', 'Logo', 100000, 'ILS', 'entry'],
        ['Acme', 'Homepage', 2000, 'USD', 'record'],
      ]);
      expect(rows[1]).toMatchObject({ clientId: acme.id, paidAt: '2024-02-01', notes: 'wire' });
    });

    it('keeps income without a client, with no client name', async () => {
      await income({ title: 'Walk-in', status: 'paid', paidAt: '2024-03-01' });

      const [row] = await paymentRecordRepo.listRecent();

      expect(row).toMatchObject({ transactionTitle: 'Walk-in', clientId: undefined, clientName: undefined });
    });

    it('returns the last 10 by default, and honours a smaller limit', async () => {
      for (let day = 1; day <= 12; day++) {
        await income({ status: 'paid', paidAt: `2024-01-${String(day).padStart(2, '0')}` });
      }

      const rows = await paymentRecordRepo.listRecent();
      expect(rows).toHaveLength(10);
      expect(rows[0].paidAt).toBe('2024-01-12');
      expect(await paymentRecordRepo.listRecent({ limit: 3 })).toHaveLength(3);
    });

    it('scopes to the given profile', async () => {
      await income({ title: 'Mine', status: 'paid', paidAt: '2024-03-01', profileId: 'p1' });
      await income({ title: 'Theirs', status: 'paid', paidAt: '2024-03-02', profileId: 'p2' });

      const rows = await paymentRecordRepo.listRecent({ profileId: 'p1' });

      expect(rows.map((r) => r.transactionTitle)).toEqual(['Mine']);
    });

    it('leaves out deleted entries and deleted records, but keeps archived entries\' payments', async () => {
      const deletedEntry = await income({ status: 'paid', paidAt: '2024-03-01', title: 'Deleted entry' });
      await transactionRepo.softDelete(deletedEntry.id);
      const withRecords = await income({ title: 'Records' });
      const gone = await paymentRecordRepo.create({ transactionId: withRecords.id, amountMinor: 500, paidAt: '2024-03-02' });
      await paymentRecordRepo.delete(gone.id);
      const archived = await income({ status: 'paid', paidAt: '2024-03-03', title: 'Archived' });
      await transactionRepo.archive(archived.id);

      const titles = (await paymentRecordRepo.listRecent()).map((r) => r.transactionTitle);

      expect(titles).toEqual(['Archived']);
    });
  });
});
