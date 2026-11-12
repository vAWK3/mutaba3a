import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MemoryAttachmentStorage } from '../../attachments/storage.js';
import { receipt } from '../../receipts/extract/__tests__/fixtures.js';
import type { OcrClient, OcrResult } from '../../receipts/ocr-client.js';
import { createReceiptReader, READ_GIVE_UP_MS, SERVER_READER_GENERATION, serverReaderVersion } from '../../receipts/reading/reader.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { ReceiptSuggestion } from '../../repositories/ports.js';
import { rereadReceipts, withoutServerFields } from '../receipts-reread.js';

/**
 * MUT-514 (D11 reversed, 2026-11-03): the re-read command. A receipt an older server reader filled is reset so the
 * sweep reads it again with the fixed reader; nothing approved, filed or client-sent is lost. Synthetic receipts only.
 */
const USER = '00000000-0000-4000-8000-0000000000d1';
const FIRST_READ = new Date('2026-10-30T09:00:00Z');
const LATER = new Date(FIRST_READ.getTime() + 2 * READ_GIVE_UP_MS);
const f = <T>(value: T, source: 'ocr' | 'pdf-text' | 'qr' = 'ocr') => ({ value, source, confidence: 0.9 });
/** What the old reader filled on a Paz receipt: the pre-VAT total as the VAT, and a QR date the phone sent. */
const OLD_READ: ReceiptSuggestion = { readerVersion: 'server-ocr-rapid-tess-1', totalMinor: f('17637'), currency: f('ILS'), vatMinor: f('14947'), date: f('2026-10-21', 'qr') };
const PAZ = receipt(['תחנת דלק הגליל', 'סה"כ לפנ\' מע"מ149.47 ש"ח', 'מע"מ להוצ רכב 26.98', 'סה"כ לתשלום 176.37']);

class OneOcr implements OcrClient {
  constructor(private readonly lines: OcrResult['lines']) {}
  async read(): Promise<OcrResult> {
    return { engine: 'rapid-tess', lines: this.lines, pages: 1 };
  }
}

async function world(granted = true, lines: OcrResult['lines'] = PAZ) {
  const store = new MemoryLedgerStore();
  const ORG = (await store.organizations.create({ name: 'Firm', slug: `reread-${Math.random().toString(36).slice(2, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' })).id;
  vi.spyOn(store.features, 'activeFor').mockResolvedValue(granted ? ['receipt_reading'] : []);
  const storage = new MemoryAttachmentStorage();
  const clock = { now: FIRST_READ };
  const reader = createReceiptReader({ store, storage, ocr: new OneOcr(lines), dispatcher: { enqueue: async () => {} }, logger: pino({ level: 'silent' }), now: () => clock.now });
  /** A To-review receipt the old reader read (claimed once, DONE) with `suggested`. */
  async function oldRead(suggested: ReceiptSuggestion = OLD_READ, mimeType = 'image/jpeg') {
    const r = await store.expenseReceipts.create({ organizationId: ORG, expenseId: null, filename: mimeType === 'application/pdf' ? 'r.pdf' : 'r.jpg', mimeType, sizeBytes: 4, receivedOn: '2026-10-30', uploadedByUserId: USER, requestId: null }, FIRST_READ);
    storage.put(r.storageKey, { sizeBytes: 4, contentType: mimeType }, new Uint8Array([1, 2, 3, 4]));
    await store.expenseReceipts.complete(ORG, r.id, FIRST_READ, 'PENDING');
    const claim = await store.expenseReceipts.claimRead(r.id, FIRST_READ, 90_000);
    if (claim.kind !== 'claimed') throw new Error('not claimed');
    await store.expenseReceipts.finishRead(r.id, claim.record.version, { status: 'DONE', suggested });
    return (await store.expenseReceipts.getById(ORG, r.id))!;
  }
  return { store, reader, clock, oldRead, ORG };
}

describe('receipts:reread (MUT-514)', () => {
  it('a dry run lists the receipt, its field names and sources, and writes nothing', async () => {
    const w = await world();
    const before = await w.oldRead();
    const r = await rereadReceipts(w.store, { readerBelow: 2, apply: false, now: LATER });
    expect(r.planned).toEqual([{ id: before.id, organizationId: w.ORG, readerVersion: 'server-ocr-rapid-tess-1', fields: expect.arrayContaining([{ field: 'vatMinor', source: 'ocr' }, { field: 'date', source: 'qr' }]), cleared: ['totalMinor', 'currency', 'vatMinor'] }]);
    expect(await w.store.expenseReceipts.getById(w.ORG, before.id)).toEqual(before);
    expect((await w.store.audit.listByOrganization(w.ORG, 10)).filter((e) => e.action === 'expense_receipt.reread_requested')).toEqual([]);
  });

  it('applied, a receipt first claimed long ago is read again by the fixed reader, not given up on; the QR field stays', async () => {
    const w = await world();
    const before = await w.oldRead();
    w.clock.now = LATER;
    const r = await rereadReceipts(w.store, { readerBelow: 2, apply: true, now: LATER });
    expect(r.reset).toEqual([before.id]);
    const reset = (await w.store.expenseReceipts.getById(w.ORG, before.id))!;
    expect(reset).toMatchObject({ readStatus: 'PENDING', readAttempts: 0, readFirstClaimedAt: null, readLeaseUntil: null, readRequestedAt: LATER, version: before.version + 1 });
    expect(reset.suggested).toEqual({ readerVersion: serverReaderVersion('rapid-tess'), date: OLD_READ.date });
    // The sweep asks for it; the read job reads it.
    expect((await w.store.expenseReceipts.listPendingForSweep(LATER, 10)).map((x) => x.id)).toEqual([before.id]);
    expect(await w.reader.readOne(before.id)).toBe('done');
    const read = (await w.store.expenseReceipts.getById(w.ORG, before.id))!.suggested!;
    expect(read.readerVersion).toBe(serverReaderVersion('rapid-tess'));
    expect(read.vatMinor?.value).toBe('2690');
    expect(read.date).toEqual(OLD_READ.date);
    const audit = (await w.store.audit.listByOrganization(w.ORG, 10)).filter((e) => e.action === 'expense_receipt.reread_requested');
    expect(audit).toMatchObject([{ actorType: 'ADMIN', entityId: before.id, metadata: { readerVersion: 'server-ocr-rapid-tess-1', cleared: ['totalMinor', 'currency', 'vatMinor'] } }]);
  });

  it('leaves approved, filed, current-reader and client-filled receipts, and an uploader without the grant, as they are', async () => {
    const w = await world();
    const current = await w.oldRead({ ...OLD_READ, readerVersion: serverReaderVersion('rapid-tess') });
    const phone = await w.oldRead({ ...OLD_READ, readerVersion: 'phone-1' });
    const filed = await w.oldRead();
    await w.store.expenseReceipts.fileOntoExpense({ organizationId: w.ORG, receiptId: filed.id, expenseId: (await w.store.expenses.create({ organizationId: w.ORG, occurredOn: '2026-10-21', amountMinor: 17637n, currency: 'ILS', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, allocationNumber: null, createdByUserId: USER }, LATER)).id, maxReceipts: 10 });
    const r = await rereadReceipts(w.store, { readerBelow: 2, apply: true, now: LATER });
    expect(r.planned).toEqual([]);
    for (const x of [current, phone]) expect((await w.store.expenseReceipts.getById(w.ORG, x.id))?.suggested).toEqual(x.suggested);

    const ungranted = await world(false);
    const kept = await ungranted.oldRead();
    expect(await rereadReceipts(ungranted.store, { readerBelow: 2, apply: true, now: LATER })).toEqual({ planned: [], noGrant: [kept.id], reset: [] });
  });

  it('with a file type, only receipts of that type are picked (MUT-590 D3: PDFs only)', async () => {
    const w = await world();
    const pdf = await w.oldRead(OLD_READ, 'application/pdf');
    await w.oldRead();
    const r = await rereadReceipts(w.store, { readerBelow: 2, mimeType: 'application/pdf', apply: false, now: LATER });
    expect(r.planned.map((x) => x.id)).toEqual([pdf.id]);
  });

  it('a receipt edited between the list and the reset is left alone', async () => {
    const w = await world();
    const before = await w.oldRead();
    expect(await w.store.expenseReceipts.resetForReread(before.id, before.version - 1, null, LATER)).toBe(false);
    expect((await w.store.expenseReceipts.getById(w.ORG, before.id))?.readStatus).toBe('DONE');
  });

  it('drops only the server-read fields; nothing left is no suggestion', () => {
    expect(withoutServerFields({ readerVersion: 'server-ocr-x-1', totalMinor: f('1'), currency: f('ILS', 'pdf-text') })).toBeNull();
    expect(withoutServerFields({ readerVersion: 'server-ocr-x-1', totalMinor: f('1'), date: f('2026-10-01', 'qr') })).toEqual({ readerVersion: 'server-ocr-x-4', date: f('2026-10-01', 'qr') });
  });

  it('a vendor-list name goes with the registration number it was looked up by (qa-reconcile review)', () => {
    const named = { readerVersion: 'server-ocr-x-1', registrationNo: f('123456782'), vendorName: { value: 'Old Vendor', source: 'vendor' as const, confidence: 1 }, date: f('2026-10-01', 'qr') };
    expect(withoutServerFields(named)).toEqual({ readerVersion: 'server-ocr-x-4', date: f('2026-10-01', 'qr') });
    expect(withoutServerFields({ ...named, registrationNo: f('123456782', 'qr') })).toEqual({ ...named, readerVersion: 'server-ocr-x-4', registrationNo: f('123456782', 'qr') });
  });

  it('a re-read that adds nothing is not picked again, and a generation above the current reader is refused (qa-reconcile review)', async () => {
    // The fixed reader finds nothing on this receipt it can be sure of.
    const w = await world(true, receipt(['חנות']));
    const before = await w.oldRead({ readerVersion: 'server-ocr-rapid-tess-1', vatMinor: f('14947'), date: f('2026-10-21', 'qr') });
    w.clock.now = LATER;
    await rereadReceipts(w.store, { readerBelow: 2, apply: true, now: LATER });
    await w.reader.readOne(before.id);
    expect((await rereadReceipts(w.store, { readerBelow: 2, apply: false, now: LATER })).planned).toEqual([]);
    await expect(rereadReceipts(w.store, { readerBelow: SERVER_READER_GENERATION + 1, apply: false, now: LATER })).rejects.toThrow(/reader-below/);
  });
});
