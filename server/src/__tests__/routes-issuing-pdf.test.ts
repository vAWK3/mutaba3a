import { describe, expect, it } from 'vitest';
import { inspectPdf, pageText } from '../issuing/pdf/__tests__/pdf-inspection.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/** MUT-640: the PDF routes. A view copy (GET) counts nothing; a produced copy (POST) is counted, the first the original. */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY', city: 'Nazareth' };

async function invoicing(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.' }, { ...on, ...idem() })));
  const body = { docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: customer.id, lines: [{ description: 'פיתוח Flutter', kind: 'SERVICE', quantity: '1', unitPrice: '1000.00' }] };
  return { owner, profileId, on, body };
}

const text = async (res: Response) => pageText((await inspectPdf(new Uint8Array(await res.arrayBuffer()))).pages[0]!).replace(/\s+/g, '');

describe('issued-document PDF routes (MUT-640)', () => {
  it('POST produces counted copies: the first prints מקור, every later one העתק; a retry keeps its copy', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const produce = (key = idem()) => h.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...key }));
    const key = idem();
    const first = await produce(key);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/pdf');
    expect(await text(first)).toContain('מקור');
    expect(await text(await produce(key))).toContain('מקור');
    expect(await text(await produce())).toContain('העתק');
  });

  it('GET is a view copy: prints העתק and counts nothing', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const view = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect(view.status).toBe(200);
    expect(await text(view)).toContain('העתק');
    // The first produced copy is still the original.
    expect(await text(await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...idem() })))).toContain('מקור');
  });

  it('the preview PDF is a draft with the next number, and writes nothing', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const res = await h.app.request('/v1/issued-documents/preview/pdf', json(w.body, w.on));
    expect(res.status, await res.clone().text()).toBe(200);
    const t = await text(res);
    expect(t).toContain('טיוטה');
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toEqual([]);
  });

  it('an accountant views a copy but can’t produce one', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const acc = await shared(h, w.owner, w.profileId);
    expect((await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: acc.on(w.profileId) })).status).toBe(200);
    expect((await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...acc.on(w.profileId), ...idem() }))).status).toBe(403);
  });
});
