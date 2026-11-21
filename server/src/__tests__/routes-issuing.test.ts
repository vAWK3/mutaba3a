import { describe, expect, it } from 'vitest';
import { FEATURES } from '../features.js';
import { SESSION_ONLY_ENTITY_TYPES } from '../routes/audit.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, shared, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-568 (ADR-259): /v1/issuer, /v1/issuing/*, /v1/issued-documents*. Gated on the profile owner's `invoicing` feature
 * and a business profile (D1); issued documents are immutable; the ledger rows they post are a person's to see, not edit.
 */
const grantInvoicing = (h: AccountantHarness, p: Person) => h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN });
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY', city: 'Nazareth' };

async function invoicing(h: AccountantHarness) {
  const owner = await person(h);
  expect((await grantInvoicing(h, owner)).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.' }, { ...on, ...idem() })));
  return { owner, profileId, on, customerId: customer.id as string };
}

const invoiceBody = (customerId: string, over: Record<string, unknown> = {}) => ({
  docType: 'TAX_INVOICE',
  documentDate: '2026-11-05',
  currency: 'ILS',
  language: 'he',
  customerId,
  lines: [
    { description: 'פיתוח אפליקציית Flutter (iOS + Android) – ספרינט 3', kind: 'SERVICE', quantity: '40', unitPrice: '450.00' },
    { description: 'SHAAM API (Invoices v1)', kind: 'SERVICE', quantity: '1', unitPrice: '6500.00' },
    { description: 'Hosting', kind: 'SERVICE', quantity: '1', unitPrice: '1300.00', discount: '100.00' },
  ],
  discount: '1000.00',
  ...over,
});

const issue = (h: AccountantHarness, on: Record<string, string>, body: unknown, key = idem()) => h.app.request('/v1/issued-documents', json(body, { ...on, ...key }));

describe('issuing routes (MUT-568)', () => {
  it('names the feature', () => {
    expect(FEATURES).toContain('invoicing');
  });

  it('is switched off (404) without the owner’s feature, and on personal profiles', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const profileId = await businessOf(h, owner);
    expect((await h.app.request('/v1/issuer', json(ISSUER, owner.on(profileId), 'PUT'))).status).toBe(404);
    expect((await h.app.request('/v1/issued-documents', { headers: owner.on(profileId) })).status).toBe(404);
    expect((await grantInvoicing(h, owner)).status).toBe(200);
    expect((await h.app.request('/v1/issued-documents', { headers: owner.on(profileId) })).status).toBe(200);
    expect((await h.app.request('/v1/issued-documents', { headers: owner.on(owner.personalId) })).status).toBe(404);
  });

  it('previews without issuing, then issues number 1 with the right totals and an Owed (D5)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const preview = await h.app.request('/v1/issued-documents/preview', json(invoiceBody(w.customerId), w.on));
    expect(preview.status).toBe(200);
    expect(await read(preview)).toMatchObject({ subtotal: '25700.00', discount: '1000.00', net: '24700.00', vatRateBasisPoints: 1800, vat: '4446.00', gross: '29146.00' });
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toEqual([]);

    const res = await issue(h, w.on, invoiceBody(w.customerId));
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await read(res);
    expect(doc).toMatchObject({ docType: 'TAX_INVOICE', number: 1, gross: '29146.00', style: 'PROFESSIONAL', ink: 'BLACK', coreVersion: '1.0.0', customer: { name: 'Acme Digital Ltd.' }, issuer: { legalName: 'Barmajiyat Ltd.', vatId: '123456789' } });
    expect(doc.lines[0]).toMatchObject({ quantity: '40', unitPrice: '450.00', net: '18000.00' });
    const owed = await h.store.receivables.getById(w.profileId, doc.receivableId);
    expect(owed).toMatchObject({ origin: 'ISSUED_DOCUMENT', grossMinor: 2_914_600n, title: 'חשבונית מס 1' });
    expect((await read(await h.app.request(`/v1/issued-documents/${doc.id}`, { headers: w.on }))).id).toBe(doc.id);
  });

  it('a retry with the same Idempotency-Key returns the same document and takes no second number', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const key = idem();
    const first = await read(await issue(h, w.on, invoiceBody(w.customerId), key));
    const again = await issue(h, w.on, invoiceBody(w.customerId), key);
    expect(again.status).toBe(201);
    expect((await read(again)).id).toBe(first.id);
    expect((await read(await issue(h, w.on, invoiceBody(w.customerId)))).number).toBe(2);
  });

  it('has no route that changes or removes an issued document (AC1)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await issue(h, w.on, invoiceBody(w.customerId)));
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      const res = await h.app.request(`/v1/issued-documents/${doc.id}`, { method, headers: { ...w.on, 'content-type': 'application/json' }, body: method === 'DELETE' ? null : '{}' });
      expect([404, 405]).toContain(res.status);
    }
    // The Owed it posted is the document's: the person's Owed routes don't reach it.
    expect((await h.app.request(`/v1/income/${doc.receivableId}`, { method: 'DELETE', headers: { ...w.on, ...idem() } })).status).toBe(404);
    expect(await read(await h.app.request(`/v1/issued-documents/${doc.id}`, { headers: w.on }))).toEqual(doc);
  });

  it('refuses the wrong fields for a type, a future date and a date before the last of its type', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const reason = async (body: unknown) => (await read(await issue(h, w.on, body))).error.details.reason;
    expect(await reason(invoiceBody(w.customerId, { payment: { method: 'BANK', receivedOn: '2026-11-05' } }))).toBe('FIELD_NOT_ALLOWED_FOR_TYPE');
    expect(await reason(invoiceBody(w.customerId, { docType: 'CREDIT_NOTE' }))).toBe('FIELD_NOT_ALLOWED_FOR_TYPE');
    expect(await reason({ ...invoiceBody(w.customerId), customerId: null })).toBe('FIELD_NOT_ALLOWED_FOR_TYPE');
    expect((await read(await issue(h, w.on, invoiceBody(w.customerId, { documentDate: '2026-11-07' })))).error.code).toBe('VALIDATION_FAILED');
    expect((await issue(h, w.on, invoiceBody(w.customerId))).status).toBe(201);
    expect(await reason(invoiceBody(w.customerId, { documentDate: '2026-11-04' }))).toBe('DATE_BEFORE_LAST_DOCUMENT');
  });

  it('a credit note credits its invoice up to what is owed; beyond is ORIGINAL_PAID (AC3)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const invoice = await read(await issue(h, w.on, invoiceBody(w.customerId)));
    const note = { docType: 'CREDIT_NOTE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: w.customerId, originalId: invoice.id, lines: [{ description: 'Discount agreed', kind: 'SERVICE', quantity: '1', unitPrice: '1000.00' }] };
    const res = await issue(h, w.on, note);
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await h.store.receivables.getById(w.profileId, invoice.receivableId)).toMatchObject({ creditedMinor: 118_000n });
    const tooMuch = await read(await issue(h, w.on, { ...note, lines: [{ description: 'All', kind: 'SERVICE', quantity: '1', unitPrice: '30000.00' }] }));
    expect(tooMuch.error.details.reason).toBe('ORIGINAL_PAID');
  });

  it('an invoice-receipt is received in full; an exempt dealer issues only receipts', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const res = await issue(h, w.on, invoiceBody(w.customerId, { docType: 'TAX_INVOICE_RECEIPT', payment: { method: 'BANK', reference: 'TRX-1', receivedOn: '2026-11-05' } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await read(res);
    expect(await h.store.payments.getById(w.profileId, doc.paymentId)).toMatchObject({ origin: 'ISSUED_DOCUMENT', amountMinor: 2_914_600n });
    const exempt = await read(await h.app.request('/v1/issuer', { headers: w.on }));
    expect((await h.app.request('/v1/issuer', json({ ...ISSUER, dealerType: 'EXEMPT' }, { ...w.on, 'if-match': String(exempt.version) }, 'PUT'))).status).toBe(200);
    expect((await read(await issue(h, w.on, invoiceBody(w.customerId)))).error.details.reason).toBe('EXEMPT_DEALER_TAX_INVOICE');
    const receipt = await issue(h, w.on, { docType: 'RECEIPT', documentDate: '2026-11-05', currency: 'ILS', language: 'ar', payment: { method: 'CASH', receivedOn: '2026-11-05' }, lines: [{ description: 'دفعة', kind: 'SERVICE', quantity: '1', unitPrice: '500.00' }] });
    expect(receipt.status, await receipt.clone().text()).toBe(201);
    expect(await read(receipt)).toMatchObject({ number: 1, vat: '0.00', gross: '500.00' });
  });

  it('copies: the first is the original, then copies, and a retried copy keeps its label (AC4)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await issue(h, w.on, invoiceBody(w.customerId)));
    const copy = (key = idem()) => h.app.request(`/v1/issued-documents/${doc.id}/copies`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...key }));
    const key = idem();
    expect(await read(await copy(key))).toEqual({ copyIndex: 0, label: 'ORIGINAL' });
    expect(await read(await copy(key))).toEqual({ copyIndex: 0, label: 'ORIGINAL' });
    expect(await read(await copy())).toEqual({ copyIndex: 1, label: 'COPY' });
    expect(await read(await copy())).toEqual({ copyIndex: 2, label: 'COPY' });
  });

  it('starting numbers until the first document, and no gaps (D3, AC5)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const set = (start: number) => h.app.request('/v1/issuing/starting-numbers/TAX_INVOICE', json({ start }, w.on, 'PUT'));
    expect((await set(1040)).status).toBe(200);
    expect((await read(await issue(h, w.on, invoiceBody(w.customerId)))).number).toBe(1040);
    expect((await read(await set(1))).error.details.reason).toBe('HAS_DOCUMENTS');
    const settings = await read(await h.app.request('/v1/issuing/settings', { headers: w.on }));
    expect(settings.counters.find((k: { docType: string }) => k.docType === 'TAX_INVOICE')).toEqual({ docType: 'TAX_INVOICE', start: 1040, next: 1041, hasDocuments: true });
    const gaps = await read(await h.app.request('/v1/issuing/gaps', { headers: w.on }));
    expect(gaps.types).toEqual([{ docType: 'TAX_INVOICE', start: 1040, last: 1040, missing: [] }]);
  });

  it('a co-owner issues on the creator’s feature; an accountant reads but never writes', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const coOwner = await person(h);
    expect((await h.app.request(`/admin/v1/users/${coOwner.userId}/memberships`, json({ organizationId: w.profileId, role: 'OWNER' }, ADMIN))).status).toBe(201);
    expect((await issue(h, coOwner.on(w.profileId), invoiceBody(w.customerId))).status).toBe(201);
    const acc = await shared(h, w.owner, w.profileId);
    expect((await h.app.request('/v1/issued-documents', { headers: acc.on(w.profileId) })).status).toBe(200);
    expect((await issue(h, acc.on(w.profileId), invoiceBody(w.customerId))).status).toBe(403);
  });

  it('audits the issue as session-only activity', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    await issue(h, w.on, invoiceBody(w.customerId));
    expect(SESSION_ONLY_ENTITY_TYPES).toEqual(expect.arrayContaining(['issued_document', 'issuer_details']));
  });
});

