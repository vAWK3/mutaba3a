import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { documentRepo, documentSequenceRepo, businessProfileRepo, clientRepo, transactionRepo } from '../repository';
import type { Document, BusinessProfile, Client, DocumentType } from '../../types';

describe('documentRepo', () => {
  let testProfile: BusinessProfile;
  let testClient: Client;

  beforeEach(async () => {
    // Clear tables
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.transactions.clear();

    // Create test data
    testProfile = await businessProfileRepo.create({
      name: 'Test Company',
      email: 'test@example.com',
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      isDefault: true,
    });

    testClient = await clientRepo.create({
      name: 'Test Client',
      email: 'client@example.com',
    });
  });

  afterEach(async () => {
    await db.documents.clear();
    await db.documentSequences.clear();
    await db.businessProfiles.clear();
    await db.clients.clear();
    await db.transactions.clear();
  });

  const createTestDocument = (overrides: Partial<Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'>> = {}): Omit<Document, 'id' | 'number' | 'createdAt' | 'updatedAt'> => ({
    type: 'invoice',
    status: 'draft',
    businessProfileId: testProfile.id,
    clientId: testClient.id,
    subject: 'Test Invoice',
    brief: 'Test description',
    notes: 'Test notes',
    items: [
      {
        name: 'Test Item',
        quantity: 1,
        rateMinor: 10000,
        rateVatMinor: 11700,
        discountMinor: 0,
        taxExempt: false,
      },
    ],
    payments: [],
    subtotalMinor: 10000,
    discountMinor: 0,
    taxMinor: 1700,
    totalMinor: 11700,
    taxRate: 0.17,
    currency: 'USD',
    language: 'en',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: undefined,
    paidAt: undefined,
    refDocumentId: undefined,
    linkedTransactionIds: [],
    templateId: 'template1',
    deletedAt: undefined,
    ...overrides,
  });

  describe('create', () => {
    it('should create a document with auto-generated number', async () => {
      const data = createTestDocument();
      const doc = await documentRepo.create(data);

      expect(doc.id).toBeDefined();
      expect(doc.number).toBe('INV-0001');
      expect(doc.type).toBe('invoice');
      expect(doc.status).toBe('draft');
      expect(doc.createdAt).toBeDefined();
      expect(doc.updatedAt).toBeDefined();
    });

    it('should increment document numbers correctly', async () => {
      const doc1 = await documentRepo.create(createTestDocument());
      const doc2 = await documentRepo.create(createTestDocument());
      const doc3 = await documentRepo.create(createTestDocument());

      expect(doc1.number).toBe('INV-0001');
      expect(doc2.number).toBe('INV-0002');
      expect(doc3.number).toBe('INV-0003');
    });

    it('should use correct prefix for different document types', async () => {
      const invoice = await documentRepo.create(createTestDocument({ type: 'invoice' }));
      const receipt = await documentRepo.create(createTestDocument({ type: 'receipt' }));
      const creditNote = await documentRepo.create(createTestDocument({ type: 'credit_note' }));
      const priceOffer = await documentRepo.create(createTestDocument({ type: 'price_offer' }));

      expect(invoice.number).toBe('INV-0001');
      expect(receipt.number).toBe('REC-0001');
      expect(creditNote.number).toBe('CN-0001');
      expect(priceOffer.number).toBe('PO-0001');
    });
  });

  describe('list', () => {
    it('should return all non-deleted documents', async () => {
      await documentRepo.create(createTestDocument({ subject: 'Doc 1' }));
      await documentRepo.create(createTestDocument({ subject: 'Doc 2' }));
      const toDelete = await documentRepo.create(createTestDocument({ subject: 'Doc 3' }));
      await documentRepo.softDelete(toDelete.id);

      const docs = await documentRepo.list();

      expect(docs).toHaveLength(2);
    });

    it('should filter by date range', async () => {
      await documentRepo.create(createTestDocument({ issueDate: '2024-01-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-02-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-03-15' }));

      const docs = await documentRepo.list({
        dateFrom: '2024-02-01',
        dateTo: '2024-02-28',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].issueDate).toBe('2024-02-15');
    });

    it('should filter by currency', async () => {
      await documentRepo.create(createTestDocument({ currency: 'USD' }));
      await documentRepo.create(createTestDocument({ currency: 'ILS' }));
      await documentRepo.create(createTestDocument({ currency: 'USD' }));

      const docs = await documentRepo.list({ currency: 'USD' });

      expect(docs).toHaveLength(2);
      docs.forEach((doc) => expect(doc.currency).toBe('USD'));
    });

    it('should filter by type', async () => {
      await documentRepo.create(createTestDocument({ type: 'invoice' }));
      await documentRepo.create(createTestDocument({ type: 'receipt' }));
      await documentRepo.create(createTestDocument({ type: 'invoice' }));

      const docs = await documentRepo.list({ type: 'invoice' });

      expect(docs).toHaveLength(2);
      docs.forEach((doc) => expect(doc.type).toBe('invoice'));
    });

    it('should filter by status', async () => {
      await documentRepo.create(createTestDocument({ status: 'draft' }));
      await documentRepo.create(createTestDocument({ status: 'issued' }));
      await documentRepo.create(createTestDocument({ status: 'paid' }));

      const docs = await documentRepo.list({ status: 'draft' });

      expect(docs).toHaveLength(1);
      expect(docs[0].status).toBe('draft');
    });

    it('should filter by businessProfileId', async () => {
      const secondProfile = await businessProfileRepo.create({
        name: 'Second Company',
        email: 'second@example.com',
        businessType: 'company',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      await documentRepo.create(createTestDocument());
      await documentRepo.create(createTestDocument({ businessProfileId: secondProfile.id }));

      const docs = await documentRepo.list({ businessProfileId: testProfile.id });

      expect(docs).toHaveLength(1);
      expect(docs[0].businessProfileId).toBe(testProfile.id);
    });

    it('should filter by clientId', async () => {
      const secondClient = await clientRepo.create({ name: 'Second Client' });

      await documentRepo.create(createTestDocument());
      await documentRepo.create(createTestDocument({ clientId: secondClient.id }));

      const docs = await documentRepo.list({ clientId: testClient.id });

      expect(docs).toHaveLength(1);
      expect(docs[0].clientId).toBe(testClient.id);
    });

    it('should search by number, subject, notes, and client name', async () => {
      await documentRepo.create(createTestDocument({ subject: 'Website Development' }));
      await documentRepo.create(createTestDocument({ subject: 'Mobile App' }));
      await documentRepo.create(createTestDocument({ notes: 'Website maintenance' }));

      const docs = await documentRepo.list({ search: 'website' });

      expect(docs).toHaveLength(2);
    });

    it('should sort by issueDate descending by default', async () => {
      await documentRepo.create(createTestDocument({ issueDate: '2024-01-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-03-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-02-15' }));

      const docs = await documentRepo.list();

      expect(docs[0].issueDate).toBe('2024-03-15');
      expect(docs[1].issueDate).toBe('2024-02-15');
      expect(docs[2].issueDate).toBe('2024-01-15');
    });

    it('should support custom sorting', async () => {
      await documentRepo.create(createTestDocument({ issueDate: '2024-01-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-03-15' }));
      await documentRepo.create(createTestDocument({ issueDate: '2024-02-15' }));

      const docs = await documentRepo.list({ sort: { by: 'issueDate', dir: 'asc' } });

      expect(docs[0].issueDate).toBe('2024-01-15');
      expect(docs[1].issueDate).toBe('2024-02-15');
      expect(docs[2].issueDate).toBe('2024-03-15');
    });

    it('should support pagination with limit and offset', async () => {
      for (let i = 0; i < 10; i++) {
        await documentRepo.create(createTestDocument({ subject: `Doc ${i}` }));
      }

      const page1 = await documentRepo.list({ limit: 3, offset: 0 });
      const page2 = await documentRepo.list({ limit: 3, offset: 3 });

      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it('should include clientName and businessProfileName in response', async () => {
      await documentRepo.create(createTestDocument());

      const docs = await documentRepo.list();

      expect(docs[0].clientName).toBe('Test Client');
      expect(docs[0].businessProfileName).toBe('Test Company');
    });
  });

  describe('get', () => {
    it('should return a document by id', async () => {
      const created = await documentRepo.create(createTestDocument());
      const fetched = await documentRepo.get(created.id);

      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.number).toBe(created.number);
    });

    it('should return undefined for non-existent id', async () => {
      const fetched = await documentRepo.get('non-existent-id');
      expect(fetched).toBeUndefined();
    });
  });

  describe('getByNumber', () => {
    it('should return a document by number', async () => {
      const created = await documentRepo.create(createTestDocument());
      const fetched = await documentRepo.getByNumber(created.number);

      expect(fetched).toBeDefined();
      expect(fetched?.number).toBe(created.number);
    });

    it('should return undefined for non-existent number', async () => {
      const fetched = await documentRepo.getByNumber('INV-9999');
      expect(fetched).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update document fields', async () => {
      const doc = await documentRepo.create(createTestDocument());

      await documentRepo.update(doc.id, {
        subject: 'Updated Subject',
        status: 'issued',
      });

      const updated = await documentRepo.get(doc.id);
      expect(updated?.subject).toBe('Updated Subject');
      expect(updated?.status).toBe('issued');
      // updatedAt should be set (may be same timestamp if test runs quickly)
      expect(updated?.updatedAt).toBeDefined();
    });
  });

  describe('markPaid', () => {
    it('should set status to paid and paidAt timestamp', async () => {
      const doc = await documentRepo.create(createTestDocument({ status: 'issued' }));

      await documentRepo.markPaid(doc.id);

      const updated = await documentRepo.get(doc.id);
      expect(updated?.status).toBe('paid');
      expect(updated?.paidAt).toBeDefined();
    });
  });

  describe('markVoided', () => {
    it('should set status to voided', async () => {
      const doc = await documentRepo.create(createTestDocument({ status: 'issued' }));

      await documentRepo.markVoided(doc.id);

      const updated = await documentRepo.get(doc.id);
      expect(updated?.status).toBe('voided');
    });
  });

  describe('softDelete', () => {
    it('should set deletedAt timestamp', async () => {
      const doc = await documentRepo.create(createTestDocument());

      await documentRepo.softDelete(doc.id);

      const deleted = await documentRepo.get(doc.id);
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('should exclude soft-deleted documents from list', async () => {
      const doc = await documentRepo.create(createTestDocument());
      await documentRepo.softDelete(doc.id);

      const docs = await documentRepo.list();

      expect(docs).toHaveLength(0);
    });
  });

  describe('linkTransactions', () => {
    it('should link transactions to a document', async () => {
      const doc = await documentRepo.create(createTestDocument());
      const tx1 = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: new Date().toISOString(),
        clientId: testClient.id,
      });
      const tx2 = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 5000,
        currency: 'USD',
        occurredAt: new Date().toISOString(),
        clientId: testClient.id,
      });

      await documentRepo.linkTransactions(doc.id, [tx1.id, tx2.id]);

      const updated = await documentRepo.get(doc.id);
      expect(updated?.linkedTransactionIds).toContain(tx1.id);
      expect(updated?.linkedTransactionIds).toContain(tx2.id);

      const updatedTx1 = await transactionRepo.get(tx1.id);
      const updatedTx2 = await transactionRepo.get(tx2.id);
      expect(updatedTx1?.linkedDocumentId).toBe(doc.id);
      expect(updatedTx2?.linkedDocumentId).toBe(doc.id);
    });

    it('should not duplicate linked transaction ids', async () => {
      const doc = await documentRepo.create(createTestDocument());
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: new Date().toISOString(),
      });

      await documentRepo.linkTransactions(doc.id, [tx.id]);
      await documentRepo.linkTransactions(doc.id, [tx.id]);

      const updated = await documentRepo.get(doc.id);
      expect(updated?.linkedTransactionIds).toHaveLength(1);
    });
  });

  describe('unlinkTransaction', () => {
    it('should unlink a transaction from a document', async () => {
      const doc = await documentRepo.create(createTestDocument());
      const tx = await transactionRepo.create({
        kind: 'income',
        status: 'paid',
        amountMinor: 10000,
        currency: 'USD',
        occurredAt: new Date().toISOString(),
      });

      await documentRepo.linkTransactions(doc.id, [tx.id]);
      await documentRepo.unlinkTransaction(doc.id, tx.id);

      const updated = await documentRepo.get(doc.id);
      expect(updated?.linkedTransactionIds).not.toContain(tx.id);

      const updatedTx = await transactionRepo.get(tx.id);
      expect(updatedTx?.linkedDocumentId).toBeUndefined();
    });
  });
});

describe('documentSequenceRepo', () => {
  let testProfile: BusinessProfile;

  beforeEach(async () => {
    await db.documentSequences.clear();
    await db.businessProfiles.clear();

    testProfile = await businessProfileRepo.create({
      name: 'Test Company',
      email: 'test@example.com',
      businessType: 'company',
      defaultCurrency: 'USD',
      defaultLanguage: 'en',
      isDefault: true,
    });
  });

  afterEach(async () => {
    await db.documentSequences.clear();
    await db.businessProfiles.clear();
  });

  describe('getNextNumber', () => {
    it('should create a new sequence and return first number', async () => {
      const number = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');

      expect(number).toBe('INV-0001');
    });

    it('should increment the sequence on each call', async () => {
      const num1 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');
      const num2 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');
      const num3 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');

      expect(num1).toBe('INV-0001');
      expect(num2).toBe('INV-0002');
      expect(num3).toBe('INV-0003');
    });

    it('should maintain separate sequences per document type', async () => {
      const inv1 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');
      const rec1 = await documentSequenceRepo.getNextNumber(testProfile.id, 'receipt');
      const inv2 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');
      const rec2 = await documentSequenceRepo.getNextNumber(testProfile.id, 'receipt');

      expect(inv1).toBe('INV-0001');
      expect(rec1).toBe('REC-0001');
      expect(inv2).toBe('INV-0002');
      expect(rec2).toBe('REC-0002');
    });

    it('should maintain separate sequences per business profile', async () => {
      const secondProfile = await businessProfileRepo.create({
        name: 'Second Company',
        email: 'second@example.com',
        businessType: 'company',
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        isDefault: false,
      });

      const num1 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');
      const num2 = await documentSequenceRepo.getNextNumber(secondProfile.id, 'invoice');
      const num3 = await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');

      expect(num1).toBe('INV-0001');
      expect(num2).toBe('INV-0001');
      expect(num3).toBe('INV-0002');
    });

    it('should use correct prefixes for all document types', async () => {
      const types: DocumentType[] = [
        'invoice',
        'receipt',
        'invoice_receipt',
        'credit_note',
        'price_offer',
        'proforma_invoice',
        'donation_receipt',
      ];
      const expectedPrefixes = ['INV', 'REC', 'IR', 'CN', 'PO', 'PI', 'DR'];

      for (let i = 0; i < types.length; i++) {
        const number = await documentSequenceRepo.getNextNumber(testProfile.id, types[i]);
        expect(number).toBe(`${expectedPrefixes[i]}-0001`);
      }
    });
  });

  describe('get', () => {
    it('should return a sequence by profile and type', async () => {
      await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');

      const sequence = await documentSequenceRepo.get(testProfile.id, 'invoice');

      expect(sequence).toBeDefined();
      expect(sequence?.lastNumber).toBe(1);
      expect(sequence?.prefix).toBe('INV');
    });

    it('should return undefined for non-existent sequence', async () => {
      const sequence = await documentSequenceRepo.get(testProfile.id, 'invoice');
      expect(sequence).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update sequence fields', async () => {
      await documentSequenceRepo.getNextNumber(testProfile.id, 'invoice');

      await documentSequenceRepo.update(testProfile.id, 'invoice', { prefix: 'FAC' });

      const sequence = await documentSequenceRepo.get(testProfile.id, 'invoice');
      expect(sequence?.prefix).toBe('FAC');
    });
  });
});
