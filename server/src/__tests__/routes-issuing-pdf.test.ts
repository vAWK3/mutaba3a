import { describe, expect, it } from 'vitest';
import { inspectPdf, pageText } from '../issuing/pdf/__tests__/pdf-inspection.js';
import pino from 'pino';
import type { DocumentSigner } from '../issuing/pdf/sign/index.js';
import { checkSignedPdf } from '../issuing/pdf/sign/verify.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/** MUT-640: the PDF routes. A view copy (GET) counts nothing; a produced copy (POST) is counted, the first the original. */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY', city: 'Nazareth' };

async function invoicing(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
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
    const firstText = await text(first);
    expect(firstText).toContain('מקור');
    expect(firstText).not.toContain('העתק');
    expect(await text(await produce(key))).toContain('מקור');
    const later = await text(await produce());
    expect(later).toContain('העתק');
    expect(later).not.toContain('מקור');
  });

  it('GET is a view copy: prints העתק and counts nothing', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const view = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect(view.status).toBe(200);
    const viewed = await text(view);
    expect(viewed).toContain('העתק');
    expect(viewed).not.toContain('מקור');
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

describe('issued-document PDFs are signed (MUT-641, ADR-265)', () => {
  const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
  const signedWhole = (bytes: Uint8Array) => checkSignedPdf(bytes);

  it('every delivery route answers a signed file; the draft preview is unsigned (AC4)', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const produced = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...idem() }));
    const viewed = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    const acc = await shared(h, w.owner, w.profileId);
    const accountantView = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: acc.on(w.profileId) });
    for (const res of [produced, viewed, accountantView]) {
      expect(res.status).toBe(200);
      const check = signedWhole(await bytesOf(res));
      expect(check.problems).toEqual([]);
      expect(check.subFilter).toBe('ETSI.CAdES.detached');
      expect(check.reason).toBe('נחתם דיגיטלית על ידי MTB3A בשם Barmajiyat Ltd. (123456789)');
      expect(check.timestampedAt).not.toBeNull();
    }
    const preview = await h.app.request('/v1/issued-documents/preview/pdf', json(w.body, w.on));
    expect(preview.status).toBe(200);
    expect(signedWhole(await bytesOf(preview)).problems).toEqual(['not signed']);
  });

  it('the signed original is kept: a retry gets the very same bytes, later copies are signed afresh', async () => {
    const h = accountantHarness();
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const key = idem();
    const produce = (k = idem()) => h.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...k }));
    const original = await bytesOf(await produce(key));
    h.setNow(new Date(h.now().getTime() + 60_000));
    const again = await bytesOf(await produce(key));
    expect(Buffer.compare(Buffer.from(again), Buffer.from(original))).toBe(0);
    expect((await h.store.issuing.getOriginalPdf(w.profileId, doc.id))!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const copy = await bytesOf(await produce());
    expect(signedWhole(copy).intact).toBe(true);
    expect(Buffer.compare(Buffer.from(copy), Buffer.from(original))).not.toBe(0);
  });

  it('a server without a signer answers 503 and counts no copy; the preview still prints', async () => {
    const off = accountantHarness({ documentSigner: null });
    const w = await invoicing(off);
    const doc = await read(await off.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    for (const res of [
      await off.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...idem() })),
      await off.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on }),
    ]) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SIGNING_NOT_CONFIGURED');
    }
    expect((await off.app.request('/v1/issued-documents/preview/pdf', json(w.body, w.on))).status).toBe(200);
    // Nothing was counted: once a signer is in place, the first produced copy is still the original.
    const on = accountantHarness({ store: off.store });
    expect(await text(await on.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...idem() })))).toContain('מקור');
  });

  it('a signing outage answers 503, never the unsigned file; a retry with the same key gets the signed original (AC5)', async () => {
    const down: DocumentSigner = { kind: 'kms', sign: () => Promise.reject(new Error('KMS unavailable')) };
    const failing = accountantHarness({ documentSigner: down });
    const w = await invoicing(failing);
    const doc = await read(await failing.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const key = idem();
    const res = await failing.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...key }));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SIGNING_UNAVAILABLE');
    expect((await failing.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on })).status).toBe(503);
    expect(await failing.store.issuing.getOriginalPdf(w.profileId, doc.id)).toBeNull();
    // The issue itself stands (MUT-568 is never rolled back), and the retry produces the signed original.
    const recovered = accountantHarness({ store: failing.store });
    const retry = await recovered.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...key }));
    const bytes = new Uint8Array(await retry.clone().arrayBuffer());
    expect(await text(retry)).toContain('מקור');
    expect(signedWhole(bytes).intact).toBe(true);
  });

  it('an outage doesn\'t spend the original: the next produced copy, with any key, is the signed original (review)', async () => {
    const failures: unknown[] = [];
    const logger = pino({ level: 'error' }, { write: (line: string) => void failures.push(JSON.parse(line)) });
    const down: DocumentSigner = { kind: 'kms', sign: () => Promise.reject(new Error('TSA unavailable')) };
    const failing = accountantHarness({ documentSigner: down, logger });
    const w = await invoicing(failing);
    const doc = await read(await failing.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const firstKey = idem();
    expect((await failing.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...firstKey }))).status).toBe(503);
    // The failure is logged with the document, so an outage is seen.
    expect(failures).toContainEqual(expect.objectContaining({ msg: 'issued document could not be signed; nothing was sent', documentId: doc.id, organizationId: w.profileId }));
    const recovered = accountantHarness({ store: failing.store });
    const fresh = await recovered.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...idem() }));
    const bytes = new Uint8Array(await fresh.clone().arrayBuffer());
    expect(await text(fresh)).toContain('מקור');
    expect(signedWhole(bytes).intact).toBe(true);
    // Kept now, with the copy that received it: the next one is a copy, and so is the failed request's own retry.
    expect(await text(await recovered.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...w.on, ...idem() })))).toContain('העתק');
    const oldKey = await text(await recovered.app.request(`/v1/issued-documents/${doc.id}/pdf`, json({ channel: 'EMAIL' }, { ...w.on, ...firstKey })));
    expect(oldKey).toContain('העתק');
    expect(oldKey).not.toContain('מקור');
  });

  it('a setup problem (an expired certificate, a key that isn\'t the certificate\'s) is SIGNING_NOT_CONFIGURED with its reason', async () => {
    const broken: DocumentSigner = { kind: 'kms', sign: () => Promise.reject(Object.assign(new Error('expired'), { name: 'SigningSetupError', reason: 'CERTIFICATE_NOT_VALID' })) };
    const h = accountantHarness({ documentSigner: broken });
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const res = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string; details: unknown } }).error).toMatchObject({ code: 'SIGNING_NOT_CONFIGURED', details: { reason: 'CERTIFICATE_NOT_VALID' } });
  });

  it('a view copy is signed once and served again for a few minutes, not re-signed on every reload (review)', async () => {
    let signatures = 0;
    const counting: DocumentSigner = { kind: 'dev', sign: async (pdf) => ((signatures += 1), pdf) };
    const h = accountantHarness({ documentSigner: counting });
    const w = await invoicing(h);
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const view = () => h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect((await view()).status).toBe(200);
    expect((await view()).status).toBe(200);
    expect(signatures).toBe(1);
    h.setNow(new Date(h.now().getTime() + 11 * 60 * 1000));
    expect((await view()).status).toBe(200);
    expect(signatures).toBe(2);
  });
});
