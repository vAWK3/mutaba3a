import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { receipt, REG_VALID_COMPANY, REG_VALID_DEALER } from '../extract/__tests__/fixtures.js';
import type { OcrClient, OcrResult } from '../ocr-client.js';
import type { ReadDispatcher } from '../reading/dispatcher.js';
import { createReceiptReader, serverReaderVersion } from '../reading/reader.js';

/**
 * MUT-514 (D6, D10, T6): the read job keeps each read's bill-to and vendor numbers, learns the organization's buyer
 * numbers from its earlier reads, passes them and the upload day to the extractor, and stamps reader version 2.
 * Synthetic receipts only.
 */
const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const USER = '00000000-0000-4000-8000-0000000000b1';
const BUYER_PHONE = '052-9876543';
const AT = new Date('2026-10-29T09:00:00Z');

/** An invoice made out to the firm: its buyer block names the firm's own ID and phone. */
const INVOICE = receipt(['טונר הבית', `ע.מ ${REG_VALID_DEALER}`, `לכבוד ע.מ.: ${REG_VALID_COMPANY}`, `טל.: ${BUYER_PHONE}`, 'מדפסת 100.00', 'סה"כ ₪100.00']);
/** A later receipt that prints the firm's ID and phone with no bill-to label (the label lost to OCR). */
const UNLABELLED = receipt(['חנות הכלים', `ח.פ: ${REG_VALID_COMPANY}`, `טלפון: ${BUYER_PHONE}`, 'תאריך: 29/07/2020', 'סה"כ ₪50.00']);

class QueueOcr implements OcrClient {
  readonly queue: OcrResult['lines'][] = [];
  async read(): Promise<OcrResult> {
    return { engine: 'rapid-tess', lines: this.queue.shift() ?? [], pages: 1 };
  }
}

const noDispatch: ReadDispatcher = { enqueue: async () => {} };

function harness() {
  const store = new MemoryLedgerStore();
  vi.spyOn(store.features, 'activeFor').mockResolvedValue(['receipt_reading']);
  const storage = new MemoryAttachmentStorage();
  const ocr = new QueueOcr();
  const reader = createReceiptReader({ store, storage, ocr, dispatcher: noDispatch, logger: pino({ level: 'silent' }), now: () => AT });
  /** A To-review receipt on `org`, uploaded and READY, whose read is PENDING, with `lines` as what OCR will read. */
  async function upload(lines: OcrResult['lines'], org = ORG, receivedOn = '2026-10-29') {
    const created = await store.expenseReceipts.create({ organizationId: org, expenseId: null, filename: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 10, receivedOn, uploadedByUserId: USER, requestId: null }, AT);
    storage.put(created.storageKey, { sizeBytes: 4, contentType: 'image/jpeg' }, new Uint8Array([1, 2, 3, 4]));
    await store.expenseReceipts.complete(org, created.id, AT, 'PENDING');
    ocr.queue.push(lines);
    return created.id;
  }
  const get = async (id: string, org = ORG) => (await store.expenseReceipts.getById(org, id))!;
  return { store, reader, upload, get };
}

describe('receipt reader buyer memory (MUT-514)', () => {
  it('keeps the buyer block and vendor numbers of a read, digits only, and stamps reader version 2', async () => {
    const h = harness();
    const id = await h.upload(INVOICE);
    expect(await h.reader.readOne(id)).toBe('done');
    const r = await h.get(id);
    expect(r.readIdentifiers).toEqual({ buyer: expect.arrayContaining([REG_VALID_COMPANY, '0529876543']), vendor: [REG_VALID_DEALER] });
    expect(r.suggested?.readerVersion).toBe(serverReaderVersion('rapid-tess'));
    expect(serverReaderVersion('rapid-tess')).toBe('server-ocr-rapid-tess-2');
    expect(r.suggested?.registrationNo?.value).toBe(REG_VALID_DEALER);
    expect(r.suggested?.phone).toBeUndefined();
  });

  it("never fills the organization's own numbers learned from an earlier receipt's bill-to block, and passes the upload day", async () => {
    const h = harness();
    await h.reader.readOne(await h.upload(INVOICE));
    const id = await h.upload(UNLABELLED);
    await h.reader.readOne(id);
    const s = (await h.get(id)).suggested;
    expect(s?.registrationNo).toBeUndefined();
    expect(s?.phone).toBeUndefined();
    // A 2020 date on a receipt uploaded in 2026 is a misread year (receivedOn reached the extractor).
    expect(s?.date).toBeUndefined();
    expect(s?.totalMinor?.value).toBe('5000');
  });

  it('learns per organization: another profile still reads the same numbers as the vendor\'s', async () => {
    const h = harness();
    await h.reader.readOne(await h.upload(INVOICE));
    const id = await h.upload(UNLABELLED, OTHER_ORG);
    await h.reader.readOne(id);
    expect((await h.get(id, OTHER_ORG)).suggested?.registrationNo?.value).toBe(REG_VALID_COMPANY);
  });

  it("never learns a number an earlier read filled as the vendor's (R9)", async () => {
    const h = harness();
    // One receipt reads REG_VALID_COMPANY as its vendor's; another's (misfired) block holds it.
    await h.reader.readOne(await h.upload(receipt(['ספק אחד', `ח.פ ${REG_VALID_COMPANY}`, 'סה"כ ₪10.00'])));
    await h.reader.readOne(await h.upload(receipt(['ספק שני', `לכבוד ח.פ ${REG_VALID_COMPANY}`, 'סה"כ ₪20.00'])));
    const id = await h.upload(receipt(['ספק שלישי', `ח.פ ${REG_VALID_COMPANY}`, 'סה"כ ₪30.00']));
    await h.reader.readOne(id);
    expect((await h.get(id)).suggested?.registrationNo?.value).toBe(REG_VALID_COMPANY);
  });

  it('keeps the numbers even when the read added no field', async () => {
    const h = harness();
    const id = await h.upload(receipt(['לכבוד', `טל.: ${BUYER_PHONE}`]));
    expect(await h.reader.readOne(id)).toBe('done');
    expect((await h.get(id)).readIdentifiers).toEqual({ buyer: ['0529876543'], vendor: [] });
  });
});
