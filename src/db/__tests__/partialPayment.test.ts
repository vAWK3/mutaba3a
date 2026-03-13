import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { transactionRepo, clientRepo } from '../repository';
import type { Client } from '../../types';

describe('transactionRepo.partialPayment', () => {
  let testClient: Client;

  beforeEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();

    testClient = await clientRepo.create({ name: 'Test Client', email: 'client@test.com' });
  });

  afterEach(async () => {
    await db.transactions.clear();
    await db.clients.clear();
    await db.projects.clear();
    await db.categories.clear();
  });

  describe('recordPartialPayment', () => {
    it('should record a partial payment on unpaid transaction', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000, // $100.00
        currency: 'USD',
        occurredAt: '2024-01-15',
        dueDate: '2024-02-15',
        clientId: testClient.id,
      });

      await transactionRepo.recordPartialPayment(tx.id, 3000); // $30.00

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.receivedAmountMinor).toBe(3000);
      expect(updated?.status).toBe('unpaid'); // Still unpaid
    });

    it('should accumulate multiple partial payments', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await transactionRepo.recordPartialPayment(tx.id, 3000);
      await transactionRepo.recordPartialPayment(tx.id, 2000);

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.receivedAmountMinor).toBe(5000);
    });

    it('should mark as paid when full amount is received', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await transactionRepo.recordPartialPayment(tx.id, 10000);

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.receivedAmountMinor).toBe(10000);
      expect(updated?.status).toBe('paid');
      expect(updated?.paidAt).toBeDefined();
    });

    it('should mark as paid when payment exceeds remaining amount', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await transactionRepo.recordPartialPayment(tx.id, 5000);
      await transactionRepo.recordPartialPayment(tx.id, 6000); // More than remaining

      const updated = await transactionRepo.get(tx.id);
      // Should cap at total amount
      expect(updated?.receivedAmountMinor).toBe(10000);
      expect(updated?.status).toBe('paid');
    });

    it('should throw error for negative payment amount', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await expect(
        transactionRepo.recordPartialPayment(tx.id, -1000)
      ).rejects.toThrow('Payment amount must be positive');
    });

    it('should throw error for already paid transaction', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        paidAt: new Date().toISOString(),
      });

      await expect(
        transactionRepo.recordPartialPayment(tx.id, 1000)
      ).rejects.toThrow('Transaction is already fully paid');
    });

    it('should throw error for non-existent transaction', async () => {
      await expect(
        transactionRepo.recordPartialPayment('non-existent-id', 1000)
      ).rejects.toThrow('Transaction not found');
    });

    it('should not allow partial payments on expenses', async () => {
      const tx = await transactionRepo.create({
        kind: 'expense',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      await expect(
        transactionRepo.recordPartialPayment(tx.id, 1000)
      ).rejects.toThrow('Partial payments only apply to income');
    });
  });

  describe('getDisplay with payment status', () => {
    it('should compute paymentStatus as unpaid when no payments received', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      const display = await transactionRepo.getDisplay(tx.id);
      expect(display?.paymentStatus).toBe('unpaid');
      expect(display?.remainingAmountMinor).toBe(10000);
    });

    it('should compute paymentStatus as partial when some payments received', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        receivedAmountMinor: 3000,
      });

      const display = await transactionRepo.getDisplay(tx.id);
      expect(display?.paymentStatus).toBe('partial');
      expect(display?.remainingAmountMinor).toBe(7000);
    });

    it('should compute paymentStatus as paid when fully paid', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        receivedAmountMinor: 10000,
        paidAt: new Date().toISOString(),
      });

      const display = await transactionRepo.getDisplay(tx.id);
      expect(display?.paymentStatus).toBe('paid');
      expect(display?.remainingAmountMinor).toBe(0);
    });

    it('should return undefined paymentStatus for expenses', async () => {
      const tx = await transactionRepo.create({
        kind: 'expense',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
      });

      const display = await transactionRepo.getDisplay(tx.id);
      expect(display?.paymentStatus).toBeUndefined();
      expect(display?.remainingAmountMinor).toBeUndefined();
    });
  });

  describe('markPaid integration with receivedAmountMinor', () => {
    it('should set receivedAmountMinor to full amount when marking paid', async () => {
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        receivedAmountMinor: 3000, // Previously received partial payment
      });

      await transactionRepo.markPaid(tx.id);

      const updated = await transactionRepo.get(tx.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.receivedAmountMinor).toBe(10000);
    });
  });
});
