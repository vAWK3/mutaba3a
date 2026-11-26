import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { readInvoiceNumber } from '../issuing/external-reading.js';
import type { OcrClient, OcrResult } from '../receipts/ocr-client.js';
import { ADMIN, issuingHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-647: an invoice issued elsewhere, attached to an Owed or a Received. Read (number, date, total), confirmed,
 * kept as the entry's INVOICE attachment, never numbered here; while attached, MTB3A issues no document for the entry.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };
const PDF = new TextEncoder().encode('%PDF-1.4\n% an invoice issued elsewhere\n%%EOF');
const line = (text: string, y: number) => ({ text, conf: 0.99, box: [10, y, 400, y + 20] as [number, number, number, number] });

class FakeOcr implements OcrClient {
  next: () => Promise<OcrResult> = async () => ({
    engine: 'test',
    pages: 1,
    lines: [line('מאפיית השלום בע"מ', 10), line('חשבונית מס מספר 3381', 40), line('תאריך: 15/11/2026', 70), line('עבודה 1,271.19', 100), line('מע"מ 18% 228.81', 130), line('סה"כ לתשלום ₪1,500.00', 160)],
  });
  read() {
    return this.next();
  }
}

async function setup(options: { ocr?: OcrClient | null; storage?: boolean } = {}) {
  const storage = new MemoryAttachmentStorage();
  const ocr = options.ocr === undefined ? new FakeOcr() : options.ocr;
  const h = issuingHarness({
    ...(options.storage === false ? {} : { attachments: storage, attachmentUrlTtlSeconds: 600 }),
    ...(ocr ? { receiptReading: { ocr, dispatcher: { enqueue: async () => undefined } } } : {}),
  });
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'מאפיית השלום' }, { ...on, ...idem() })));
  const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount: '1500.00', currency: 'ILS', occurredOn: '2026-11-05', customerId: customer.id }, { ...on, ...idem() })));
  return { h, storage, owner, profileId, on, customerId: customer.id as string, owedId: owed.id as string };
}

const attach = (h: AccountantHarness, on: Record<string, string>, query: Record<string, string>, body: Uint8Array = PDF) =>
  h.app.request(`/v1/issuing/external-invoices?${new URLSearchParams(query)}`, { method: 'POST', headers: { ...on, 'content-type': 'application/pdf' }, body });

describe('invoices issued elsewhere (MUT-647)', () => {
  it('reads the number in Hebrew, Arabic and English', () => {
    expect(readInvoiceNumber('חשבונית מס מספר 3381')).toBe('3381');
    expect(readInvoiceNumber("חשבונית מס קבלה מס' 1042")).toBe('1042');
    expect(readInvoiceNumber('فاتورة ضريبية رقم 77')).toBe('77');
    expect(readInvoiceNumber('Tax Invoice No. 2026-15')).toBe('2026-15');
    expect(readInvoiceNumber('Thank you')).toBeNull();
  });

  it('AC2 the reader fills the number, date and total; nothing is stored', async () => {
    const w = await setup();
    const res = await w.h.app.request('/v1/issuing/external-invoices/read', { method: 'POST', headers: { ...w.on, 'content-type': 'application/pdf' }, body: PDF });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ read: true, number: '3381', documentDate: '2026-11-15', amount: '1500.00' });
    expect(w.storage.objects.size).toBe(0);
  });

  it('AC2 without a reader, or a file it can’t read, the person types the fields', async () => {
    const none = await setup({ ocr: null });
    expect(await read(await none.h.app.request('/v1/issuing/external-invoices/read', { method: 'POST', headers: { ...none.on, 'content-type': 'application/pdf' }, body: PDF }))).toEqual({ read: false, number: null, documentDate: null, amount: null });
    const broken = new FakeOcr();
    broken.next = async () => {
      throw new Error('unreadable');
    };
    const w = await setup({ ocr: broken });
    expect((await read(await w.h.app.request('/v1/issuing/external-invoices/read', { method: 'POST', headers: { ...w.on, 'content-type': 'application/pdf' }, body: PDF }))).read).toBe(false);
    const text = await w.h.app.request('/v1/issuing/external-invoices/read', { method: 'POST', headers: { ...w.on, 'content-type': 'application/pdf' }, body: new TextEncoder().encode('not a pdf') });
    expect(text.status).toBe(422);
  });

  it('AC1 attaches it to the Owed with its number and date; it opens; a second one is refused', async () => {
    const w = await setup();
    const res = await attach(w.h, w.on, { entryKind: 'OWED', entryId: w.owedId, number: '3381', documentDate: '2026-11-15', filename: 'invoice-3381.pdf' });
    expect(res.status, await res.clone().text()).toBe(201);
    const attached = await read(res);
    expect(attached).toMatchObject({ entryKind: 'OWED', entryId: w.owedId, number: '3381', documentDate: '2026-11-15', filename: 'invoice-3381.pdf', mimeType: 'application/pdf' });
    expect([...w.storage.objects.values()]).toHaveLength(1);

    const list = await read(await w.h.app.request(`/v1/issuing/external-invoices?entryKind=OWED&entryIds=${w.owedId}`, { headers: w.on }));
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([attached.id]);
    const file = await w.h.app.request(`/v1/issuing/external-invoices/${attached.id}/file`, { headers: w.on });
    expect(file.status).toBe(200);
    expect((await read(file)).url).toContain('disposition=inline');

    const again = await attach(w.h, w.on, { entryKind: 'OWED', entryId: w.owedId, number: '3382', documentDate: '2026-11-16', filename: 'b.pdf' });
    expect(again.status).toBe(409);
    expect((await read(again)).error.details).toMatchObject({ reason: 'EXTERNAL_INVOICE_EXISTS', externalInvoiceId: attached.id });
  });

  it('AC3 issuing a MTB3A invoice for that entry is refused while it is attached; removing it allows it again', async () => {
    const w = await setup();
    const attached = await read(await attach(w.h, w.on, { entryKind: 'OWED', entryId: w.owedId, number: '3381', documentDate: '2026-11-15', filename: 'i.pdf' }));
    const body = { docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, fromEntry: { kind: 'owed', id: w.owedId }, pricesIncludeVat: true, lines: [{ description: 'עבודה', kind: 'SERVICE', quantity: '1', unitPrice: '1500.00' }] };
    const refused = await w.h.app.request('/v1/issued-documents', json(body, { ...w.on, ...idem() }));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'EXTERNAL_INVOICE_ATTACHED', number: '3381' });

    expect((await w.h.app.request(`/v1/issuing/external-invoices/${attached.id}`, { method: 'DELETE', headers: w.on })).status).toBe(204);
    expect((await read(await w.h.app.request(`/v1/issuing/external-invoices?entryKind=OWED&entryIds=${w.owedId}`, { headers: w.on }))).items).toEqual([]);
    const issued = await w.h.app.request('/v1/issued-documents', json(body, { ...w.on, ...idem() }));
    expect(issued.status, await issued.clone().text()).toBe(201);
  });

  it('attaches to a Received; refuses an Owed MTB3A issued, an unknown entry, and a file that is not a PDF or image', async () => {
    const w = await setup();
    const received = await read(await w.h.app.request('/v1/income', json({ kind: 'received', amount: '590.00', currency: 'ILS', occurredOn: '2026-11-05', customerId: w.customerId, method: 'BANK' }, { ...w.on, ...idem() })));
    expect((await attach(w.h, w.on, { entryKind: 'RECEIVED', entryId: received.id, number: 'R-17', documentDate: '2026-11-15', filename: 'r.pdf' })).status).toBe(201);

    const doc = await read(await w.h.app.request('/v1/issued-documents', json({ docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, lines: [{ description: 'x', kind: 'SERVICE', quantity: '1', unitPrice: '100.00' }] }, { ...w.on, ...idem() })));
    const ours = await attach(w.h, w.on, { entryKind: 'OWED', entryId: doc.receivableId, number: '1', documentDate: '2026-11-15', filename: 'x.pdf' });
    expect(ours.status).toBe(409);
    expect((await read(ours)).error.details.reason).toBe('ISSUED_HERE');

    expect((await attach(w.h, w.on, { entryKind: 'OWED', entryId: '00000000-0000-4000-8000-000000000000', number: '1', documentDate: '2026-11-15', filename: 'x.pdf' })).status).toBe(404);
    expect((await attach(w.h, w.on, { entryKind: 'OWED', entryId: w.owedId, number: '1', documentDate: '2026-11-15', filename: 'x.txt' }, new TextEncoder().encode('hello'))).status).toBe(422);
    expect((await attach(w.h, w.on, { entryKind: 'OWED', entryId: w.owedId, number: '1', documentDate: '15/11/2026', filename: 'x.pdf' })).status).toBe(422);
  });

  it('needs file storage to attach (503); an accountant reads but doesn’t attach', async () => {
    const none = await setup({ storage: false });
    expect((await attach(none.h, none.on, { entryKind: 'OWED', entryId: none.owedId, number: '1', documentDate: '2026-11-15', filename: 'x.pdf' })).status).toBe(503);

    const w = await setup();
    const accountant = await shared(w.h, w.owner, w.profileId);
    const on = accountant.on(w.profileId);
    expect((await w.h.app.request(`/v1/issuing/external-invoices?entryKind=OWED&entryIds=${w.owedId}`, { headers: on })).status).toBe(200);
    expect((await attach(w.h, on, { entryKind: 'OWED', entryId: w.owedId, number: '1', documentDate: '2026-11-15', filename: 'x.pdf' })).status).toBe(403);
  });
});
