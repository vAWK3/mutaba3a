import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-569 (ADR-272): GET /v1/issuing/uniform-file. Every document dated in the range as the uniform file (1.31), in the
 * OPENFRMT zip with its report. Same gate as the other issuing reads: the owner's `invoicing` feature on a business
 * profile; an accountant with a grant reads it too.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '515151512', dealerType: 'COMPANY', city: 'Nazareth' };

async function invoicing(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'شركة النور' }, { ...on, ...idem() })));
  return { owner, profileId, on, customerId: customer.id as string };
}

const line = (description: string, unitPrice = '100.00') => ({ description, kind: 'SERVICE', quantity: '1', unitPrice });
const issue = async (h: AccountantHarness, on: Record<string, string>, body: Record<string, unknown>) => {
  const res = await h.app.request('/v1/issued-documents', json({ currency: 'ILS', language: 'he', ...body }, { ...on, ...idem() }));
  expect(res.status, await res.clone().text()).toBe(201);
  return read(res);
};
const download = (h: AccountantHarness, on: Record<string, string>, query: string) => h.app.request(`/v1/issuing/uniform-file?${query}`, { headers: on });

async function entries(res: Response) {
  const all = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const ini = Object.keys(all).find((k) => k.endsWith('/INI.TXT'))!;
  const bkmvZip = Object.keys(all).find((k) => k.endsWith('/BKMVDATA.zip'))!;
  const bkmv = Buffer.from(unzipSync(all[bkmvZip]!)['BKMVDATA.TXT']!).toString('latin1');
  return { names: Object.keys(all), ini: Buffer.from(all[ini]!).toString('latin1'), bkmv, report: strFromU8(all['report.html']!) };
}
const codes = (text: string) => text.split('\r\n').filter(Boolean).map((l) => l.slice(0, 4));

describe('GET /v1/issuing/uniform-file (MUT-569)', () => {
  it('exports every document type dated in the range, with counts in the headers and an audit row', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const invoice = await issue(h, w.on, { docType: 'TAX_INVOICE', documentDate: '2026-11-02', customerId: w.customerId, lines: [line('تطوير'), line('ייעוץ')] });
    await issue(h, w.on, { docType: 'TAX_INVOICE_RECEIPT', documentDate: '2026-11-03', customerId: w.customerId, payment: { method: 'BANK', receivedOn: '2026-11-03' }, lines: [line('Hosting')] });
    await issue(h, w.on, { docType: 'CREDIT_NOTE', documentDate: '2026-11-04', customerId: w.customerId, originalId: invoice.id, lines: [line('خصم', '10.00')] });
    await issue(h, w.on, { docType: 'RECEIPT', documentDate: '2026-11-05', payment: { method: 'CASH', receivedOn: '2026-11-05' }, lines: [line('دفعة')] });

    const res = await download(h, w.on, 'from=2026-11-01&to=2026-11-06&lang=en');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="OPENFRMT-515151512-2026-11-01_2026-11-06.zip"');
    expect(res.headers.get('x-uniform-file-documents')).toBe('4');
    const file = await entries(res);
    expect(file.names.sort()).toEqual(['OPENFRMT/51515151.26/11061100/BKMVDATA.zip', 'OPENFRMT/51515151.26/11061100/INI.TXT', 'report.html']);
    expect(codes(file.bkmv)).toEqual(['A100', 'C100', 'D110', 'D110', 'C100', 'D110', 'D120', 'C100', 'D110', 'C100', 'D120', 'Z900']);
    expect(res.headers.get('x-uniform-file-records')).toBe('12');
    expect(codes(file.ini)).toEqual(['A000', 'C100', 'D110', 'D120']);
    expect(file.report).toContain('Documents report');

    const audit = await h.store.audit.listByOrganization(w.profileId, 50);
    expect(audit.map((e) => e.action)).toContain('issuing.uniform_file_exported');
  });

  it('MUT-741 (AC4): the issue audit entry carries the core version, the jurisdiction and the pack version', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    await issue(h, w.on, { docType: 'TAX_INVOICE', documentDate: '2026-11-02', customerId: w.customerId, lines: [line('تطوير')] });
    const audit = await h.store.audit.listByOrganization(w.profileId, 50);
    const issued = audit.find((e) => e.action === 'issued_document.issued');
    expect(issued?.metadata).toMatchObject({ docType: 'TAX_INVOICE', coreVersion: '1.0.0', jurisdiction: 'IL', packVersion: '1.0.0' });
  });

  it('leaves out documents dated outside the range, and another profile’s', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const other = await invoicing(h);
    await issue(h, w.on, { docType: 'TAX_INVOICE', documentDate: '2026-10-30', customerId: w.customerId, lines: [line('October')] });
    await issue(h, other.on, { docType: 'TAX_INVOICE', documentDate: '2026-11-02', customerId: other.customerId, lines: [line('Theirs')] });
    const res = await download(h, w.on, 'from=2026-11-01&to=2026-11-06');
    expect(res.headers.get('x-uniform-file-documents')).toBe('0');
    expect(codes((await entries(res)).bkmv)).toEqual(['A100', 'Z900']);
  });

  it('AC3: a profile with no documents exports a valid empty file', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const file = await entries(await download(h, w.on, 'from=2026-01-01&to=2026-11-06'));
    expect(codes(file.bkmv)).toEqual(['A100', 'Z900']);
    expect(codes(file.ini)).toEqual(['A000']);
    expect(file.report).toContain('لا مستندات في هذه التواريخ');
  });

  it('refuses a reversed range, a range past today and a malformed date', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    for (const query of ['from=2026-11-05&to=2026-11-01', 'from=2026-11-01&to=2026-11-07', 'from=2026-1-1&to=2026-11-01', 'from=2026-02-31&to=2026-11-01', 'from=0000-01-01&to=2026-11-01']) {
      const res = await download(h, w.on, query);
      expect(res.status, query).toBe(422);
    }
    expect((await read(await download(h, w.on, 'from=2026-11-05&to=2026-11-01'))).error.details.reason).toBe('PERIOD_RANGE');
  });

  it('an accountant with a grant downloads it; personal profiles and a profile without the feature get 404', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const acc = await shared(h, w.owner, w.profileId);
    const res = await download(h, acc.on(w.profileId), 'from=2026-11-01&to=2026-11-06');
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await download(h, w.owner.on(w.owner.personalId), 'from=2026-11-01&to=2026-11-06')).status).toBe(404);
    const plain = await person(h);
    const profileId = await businessOf(h, plain);
    expect((await download(h, plain.on(profileId), 'from=2026-11-01&to=2026-11-06')).status).toBe(404);
  });
});
