import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { receipt } from '../extract/__tests__/fixtures.js';
import type { OcrClient, OcrResult } from '../ocr-client.js';
import type { ReadDispatcher } from '../reading/dispatcher.js';
import { createReceiptReader } from '../reading/reader.js';

/**
 * MUT-590: a read that ends SKIPPED says why (deleted, filed or complete), and a text-PDF read logs its text length,
 * never the text. Receipt 27e28e05 (2026-11-10) was filed onto an expense 10 s into its read; the log only said
 * `skipped`. Synthetic receipts only.
 */
const USER = '00000000-0000-4000-8000-0000000000b1';
const AT = new Date('2026-11-10T08:40:40Z');
const LINES = receipt(['חנות הכלים', 'תאריך: 09/11/2026', 'סה"כ ₪200.00']);
const PDF_TEXT = 'חנות הכלים\nתאריך: 09/11/2026\nסה"כ ₪200.00';

type During = (store: MemoryLedgerStore, id: string) => Promise<void>;

let ORG = '';

async function harness(result: (during: () => Promise<void>) => Promise<OcrResult>) {
  const store = new MemoryLedgerStore();
  ORG = (await store.organizations.create({ name: 'Firm', slug: `skip-${Math.random().toString(36).slice(2, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' })).id;
  vi.spyOn(store.features, 'activeFor').mockResolvedValue(['receipt_reading']);
  const storage = new MemoryAttachmentStorage();
  const logs: Record<string, unknown>[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => void logs.push(JSON.parse(line)) });
  let during: () => Promise<void> = async () => {};
  const ocr: OcrClient = { read: () => result(() => during()) };
  const dispatcher: ReadDispatcher = { enqueue: async () => {} };
  const reader = createReceiptReader({ store, storage, ocr, dispatcher, logger, now: () => AT });
  async function upload(whileReading: During = async () => {}) {
    const created = await store.expenseReceipts.create({ organizationId: ORG, expenseId: null, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-11-10', uploadedByUserId: USER, requestId: null }, AT);
    storage.put(created.storageKey, { sizeBytes: 4, contentType: 'application/pdf' }, new Uint8Array([1, 2, 3, 4]));
    await store.expenseReceipts.complete(ORG, created.id, AT, 'PENDING');
    during = () => whileReading(store, created.id);
    return created.id;
  }
  const readLog = () => logs.find((l) => l.msg === 'receipt read');
  return { store, reader, upload, readLog };
}

const ocrRead = (during: () => Promise<void>) => during().then((): OcrResult => ({ engine: 'rapid-tess', lines: LINES, pages: 1 }));
const pdfRead = (during: () => Promise<void>) => during().then((): OcrResult => ({ engine: 'pdf-text', lines: [], pdfText: PDF_TEXT, pages: 1 }));

async function newExpense(store: MemoryLedgerStore) {
  const expense = await store.expenses.create({ organizationId: ORG, occurredOn: '2026-11-10', amountMinor: 20000n, currency: 'ILS', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, allocationNumber: null, createdByUserId: USER }, AT);
  return expense.id;
}

describe('receipt read skip reason (MUT-590)', () => {
  it('a receipt filed onto an expense during its read: skipped, code filed, nothing written', async () => {
    const h = await harness(ocrRead);
    const id = await h.upload(async (store, receiptId) => {
      await store.expenseReceipts.fileOntoExpense({ organizationId: ORG, receiptId, expenseId: await newExpense(store), maxReceipts: 10 });
    });
    expect(await h.reader.readOne(id)).toBe('skipped');
    expect(h.readLog()).toMatchObject({ status: 'skipped', code: 'filed', added: 0 });
    const r = await h.store.expenseReceipts.getById(ORG, id);
    expect(r?.readStatus).toBe('SKIPPED');
    expect(r?.suggested).toBeNull();
  });

  it('a receipt deleted during its read: skipped, code deleted', async () => {
    const h = await harness(ocrRead);
    const id = await h.upload(async (store, receiptId) => {
      await store.expenseReceipts.softDelete(ORG, receiptId, AT);
    });
    expect(await h.reader.readOne(id)).toBe('skipped');
    expect(h.readLog()).toMatchObject({ status: 'skipped', code: 'deleted' });
  });

  it('a receipt deleted before its read starts: skipped, code deleted', async () => {
    const h = await harness(ocrRead);
    const id = await h.upload();
    await h.store.expenseReceipts.softDelete(ORG, id, AT);
    expect(await h.reader.readOne(id)).toBe('skipped');
    expect(h.readLog()).toMatchObject({ status: 'skipped', code: 'deleted' });
  });

  it('a receipt still To review after its read gets the read’s fields, even when the person edited it meanwhile', async () => {
    const h = await harness(ocrRead);
    const id = await h.upload(async (store, receiptId) => {
      const r = (await store.expenseReceipts.getById(ORG, receiptId))!;
      await store.expenseReceipts.setSuggested(ORG, receiptId, r.version, { readerVersion: 'phone-1', vendorName: { value: 'typed', source: 'ocr', confidence: 1 } });
    });
    expect(await h.reader.readOne(id)).toBe('done');
    const r = await h.store.expenseReceipts.getById(ORG, id);
    expect(r?.readStatus).toBe('DONE');
    expect(r?.suggested?.vendorName?.value).toBe('typed');
    expect(r?.suggested?.totalMinor?.value).toBe('20000');
  });

  it('a text-PDF read logs its engine and text length, never the text', async () => {
    const h = await harness(pdfRead);
    const id = await h.upload();
    expect(await h.reader.readOne(id)).toBe('done');
    const log = h.readLog()!;
    expect(log).toMatchObject({ status: 'done', engine: 'pdf-text', chars: PDF_TEXT.length });
    expect(JSON.stringify(log)).not.toContain('200.00');
  });
});
