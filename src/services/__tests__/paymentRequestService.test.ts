import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../../db/database';
import { businessProfileRepo, clientRepo, paymentRecordRepo, transactionRepo } from '../../db/repository';
import {
  createPaymentRequestWithReceivable,
  recordPaymentForRequest,
  updatePaymentRequestWithTransaction,
} from '../paymentRequestService';
import type { Document } from '../../types';

/** Runs fn with the clock at instant, in timeZone (Node applies a TZ change at once). */
async function atInstantIn(timeZone: string, instant: string, fn: () => Promise<void>) {
  const savedTz = process.env.TZ;
  process.env.TZ = timeZone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  try {
    await fn();
  } finally {
    vi.useRealTimers();
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  }
}

type DocumentInput = Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt' | 'linkedTransactionIds'>;

async function clearTables() {
  await db.documents.clear();
  await db.documentSequences.clear();
  await db.businessProfiles.clear();
  await db.clients.clear();
  await db.transactions.clear();
  await db.paymentRecords.clear();
}

describe('paymentRequestService', () => {
  let documentData: DocumentInput;

  beforeEach(async () => {
    await clearTables();
    const profile = await businessProfileRepo.create({
      name: 'Test Company',
      email: 'test@example.com',
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      isDefault: true,
    });
    const client = await clientRepo.create({ name: 'Test Client' });
    documentData = {
      type: 'payment_request',
      status: 'issued',
      businessProfileId: profile.id,
      clientId: client.id,
      subject: 'Logo work',
      items: [],
      payments: [],
      subtotalMinor: 10000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 10000,
      taxRate: 0,
      vatEnabled: false,
      currency: 'USD',
      language: 'en',
      issueDate: '2024-01-15',
      dueDate: '2024-02-15',
      templateId: 'template1',
      exportCount: 0,
    };
  });

  afterEach(clearTables);

  describe('recordPaymentForRequest', () => {
    it('marks the linked receivable paid when nothing was recorded yet', async () => {
      const { document, transaction } = await createPaymentRequestWithReceivable({ documentData });

      await recordPaymentForRequest(document.id, '2024-01-20');

      const tx = await transactionRepo.get(transaction.id);
      expect(tx?.status).toBe('paid');
      expect(tx?.paidAt).toBe('2024-01-20');
      expect(tx?.receivedAmountMinor).toBe(10000);
    });

    // ADR-039: payment records own the payment state, so writing status: 'paid'
    // onto a part-paid receivable is dropped. The rest has to be recorded.
    it('pays the remaining balance of a part-paid receivable', async () => {
      const { document, transaction } = await createPaymentRequestWithReceivable({ documentData });
      await paymentRecordRepo.create({ transactionId: transaction.id, amountMinor: 3000, paidAt: '2024-01-18' });

      await recordPaymentForRequest(document.id, '2024-01-20');

      const tx = await transactionRepo.get(transaction.id);
      expect(tx?.status).toBe('paid');
      expect(tx?.paidAt).toBe('2024-01-20');
      expect(tx?.receivedAmountMinor).toBe(10000);
      const doc = await db.documents.get(document.id);
      expect(doc?.status).toBe('paid');
    });
  });

  describe('recordPaymentForRequest as the document page calls it', () => {
    it('records "now" in the evening west of UTC', async () => {
      const { document, transaction } = await createPaymentRequestWithReceivable({ documentData });

      await atInstantIn('America/New_York', '2026-10-13T01:30:00.000Z', async () => {
        await recordPaymentForRequest(document.id, new Date().toISOString());
      });

      expect((await transactionRepo.get(transaction.id))?.status).toBe('paid');
    });
  });

  describe('updatePaymentRequestWithTransaction', () => {
    it('updates the document and its unpaid receivable', async () => {
      const { document, transaction } = await createPaymentRequestWithReceivable({ documentData });

      await updatePaymentRequestWithTransaction(document.id, { totalMinor: 12000, subject: 'Logo and icons' });

      const tx = await transactionRepo.get(transaction.id);
      expect(tx?.amountMinor).toBe(12000);
      expect(tx?.title).toBe('Logo and icons');
      const doc = await db.documents.get(document.id);
      expect(doc?.totalMinor).toBe(12000);
    });

    it('leaves the document untouched when the receivable refuses the change', async () => {
      const { document, transaction } = await createPaymentRequestWithReceivable({ documentData });
      await paymentRecordRepo.create({ transactionId: transaction.id, amountMinor: 3000, paidAt: '2024-01-18' });

      await expect(
        updatePaymentRequestWithTransaction(document.id, { currency: 'ILS', subject: 'Renamed' })
      ).rejects.toThrow();

      const doc = await db.documents.get(document.id);
      expect(doc?.currency).toBe('USD');
      expect(doc?.subject).toBe('Logo work');
      const tx = await transactionRepo.get(transaction.id);
      expect(tx?.currency).toBe('USD');
    });
  });
});
