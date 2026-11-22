import { describe, expect, it } from 'vitest';
import { RegistryLookup } from '../israel/registry.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/** MUT-642: a customer's VAT/company number and address, the registry lookup, and both on issued documents. */
const company = { 'שם חברה': 'אקמי דיגיטל בע״מ', 'שם באנגלית': 'ACME DIGITAL LTD', 'סטטוס חברה': 'פעילה', 'שם רחוב': 'הרצל', 'מספר בית': '5', 'שם עיר': 'חיפה' };

function harness(records: unknown[] | 'down' = [company]) {
  const fetch = async () => (records === 'down' ? Promise.reject(new Error('timeout')) : new Response(JSON.stringify({ success: true, result: { records } }), { status: 200 }));
  const registry = new RegistryLookup({ baseUrl: 'https://data.example/api', companiesResource: 'c', nonprofitsResource: 'n', timeoutMs: 1000, ttlMs: 60_000, fetch });
  return accountantHarness({ registry });
}

async function profile(h: AccountantHarness) {
  const owner = await person(h);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  return { owner, profileId, on: owner.on(profileId) };
}

describe('customer VAT number and address (MUT-642)', () => {
  it('saves a valid number normalised to 9 digits, with an address; clears both with null', async () => {
    const h = harness();
    const w = await profile(h);
    const created = await read(await h.app.request('/v1/customers', json({ name: 'Acme', taxId: '51-612345-2', address: '5 Herzl St, Haifa' }, { ...w.on, ...idem() })));
    expect(created).toMatchObject({ taxId: '516123452', address: '5 Herzl St, Haifa' });
    const cleared = await h.app.request(`/v1/customers/${created.id}`, json({ taxId: null, address: null }, { ...w.on, 'if-match': String(created.version) }, 'PATCH'));
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect(await read(cleared)).toMatchObject({ taxId: null, address: null });
  });

  it('refuses a number with a wrong check digit', async () => {
    const h = harness();
    const w = await profile(h);
    const res = await h.app.request('/v1/customers', json({ name: 'Acme', taxId: '516123458' }, { ...w.on, ...idem() }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ field: 'taxId', reason: 'TAX_ID_INVALID' });
  });
});

describe('GET /v1/business-lookup (MUT-642)', () => {
  it('finds an active company with its registered address', async () => {
    const h = harness();
    const w = await profile(h);
    const res = await h.app.request('/v1/business-lookup?number=516123452', { headers: w.on });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ taxId: '516123452', kind: 'company', name: 'אקמי דיגיטל בע״מ', nameEn: 'ACME DIGITAL LTD', status: 'פעילה', active: true, address: 'הרצל 5, חיפה' });
  });

  it('answers 422 for a bad check digit, 404 NOT_IN_REGISTRY for a sole dealer, 502 when the registry is down', async () => {
    const h = harness('down');
    const w = await profile(h);
    expect((await h.app.request('/v1/business-lookup?number=516123458', { headers: w.on })).status).toBe(422);
    const soleDealer = await h.app.request('/v1/business-lookup?number=000000018', { headers: w.on });
    expect(soleDealer.status).toBe(404);
    expect((await read(soleDealer)).error.details).toMatchObject({ reason: 'NOT_IN_REGISTRY' });
    const down = await h.app.request('/v1/business-lookup?number=516123452', { headers: w.on });
    expect(down.status).toBe(502);
    expect((await read(down)).error.code).toBe('REGISTRY_UNAVAILABLE');
  });
});

describe('issued documents carry the customer number and address (MUT-642 AC2)', () => {
  it('snapshots them at issue; a later edit of the customer leaves the document as it was', async () => {
    const h = harness();
    const w = await profile(h);
    expect((await h.app.request(`/admin/v1/users/${w.owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    expect((await h.app.request('/v1/issuer', json({ legalName: 'Barmajiyat Ltd.', vatId: '516123452', dealerType: 'COMPANY' }, w.on, 'PUT'))).status).toBe(200);
    const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme', taxId: '510000045', address: '5 Herzl St, Haifa' }, { ...w.on, ...idem() })));
    const body = { docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'en', customerId: customer.id, lines: [{ description: 'Sprint', kind: 'SERVICE', quantity: '1', unitPrice: '100.00' }] };
    const doc = await read(await h.app.request('/v1/issued-documents', json(body, { ...w.on, ...idem() })));
    expect(doc.customer).toEqual({ name: 'Acme', taxId: '510000045', address: '5 Herzl St, Haifa' });
    await h.app.request(`/v1/customers/${customer.id}`, json({ address: 'Elsewhere' }, { ...w.on, 'if-match': String(customer.version) }, 'PATCH'));
    expect((await read(await h.app.request(`/v1/issued-documents/${doc.id}`, { headers: w.on }))).customer).toEqual({ name: 'Acme', taxId: '510000045', address: '5 Herzl St, Haifa' });
  });
});
