import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, paymentRecordRepo, PaymentRecordError } from '../repository';

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
      const r1 = await paymentRecordRepo.create({
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

  describe('overpayment', () => {
    it('should allow overpayment and still mark as paid', async () => {
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 6000,
        paidAt: '2024-01-20',
      });
      await paymentRecordRepo.create({
        transactionId: incomeId,
        amountMinor: 6000,
        paidAt: '2024-01-25',
      });

      const tx = await transactionRepo.get(incomeId);
      // Sum is 12000 > 10000, stored as actual sum (not capped)
      expect(tx?.receivedAmountMinor).toBe(12000);
      expect(tx?.status).toBe('paid');
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
});
