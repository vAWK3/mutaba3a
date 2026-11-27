import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IL_PACK } from '../jurisdictions/il/index.js';
import { registerPackForTests } from '../jurisdictions/index.js';
import { ISSUER_LOGO_MAX_BYTES } from '../routes/issuing.js';
import { ADMIN, issuingHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-646: the invoicing setup. Five steps (details, logo, defaults, numbering, Tax Authority); nothing is issued until
 * the details and the numbering answer are in (S1-a); each step saves on its own; issued documents keep their logo.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };
const DEFAULTS = { documentStyle: 'MODERN', ink: 'BLUE', defaultLanguage: 'ar', pricesIncludeVat: true, paymentTermsDays: 30, bankDetails: 'Bank Leumi 10-800-123456', footerNote: 'شكراً لتعاملكم معنا' };
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function profile(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.' }, { ...on, ...idem() })));
  const body = { docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId: customer.id, lines: [{ description: 'פיתוח Flutter', kind: 'SERVICE', quantity: '1', unitPrice: '1000.00' }] };
  return { owner, profileId, on, body };
}

const setup = async (h: AccountantHarness, on: Record<string, string>) => read(await h.app.request('/v1/issuing/setup', { headers: on }));
const putLogo = (h: AccountantHarness, on: Record<string, string>, bytes: Uint8Array, type = 'image/png') =>
  h.app.request('/v1/issuer/logo', { method: 'PUT', headers: { ...on, 'content-type': type }, body: bytes });

describe('invoicing setup (MUT-646)', () => {
  it('starts with every step to do; the Tax Authority waits for MUT-571', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect(await setup(h, w.on)).toEqual({
      steps: { details: 'todo', logo: 'todo', defaults: 'todo', numbering: 'todo', taxAuthority: 'later' },
      canIssue: false,
      missing: ['DETAILS', 'NUMBERING'],
      introSeen: false,
      hasLogo: false,
      country: null,
      countryLocked: false,
      liveJurisdictions: ['IL'],
    });
  });

  it('AC1: refuses to issue until the details and the numbering answer are in, and says which is missing', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const refused = async (missing: string[]) => {
      const res = await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() }));
      expect(res.status).toBe(409);
      expect((await read(res)).error).toMatchObject({ code: 'CONFLICT', details: { reason: 'ISSUING_SETUP_INCOMPLETE', missing } });
    };
    await refused(['DETAILS', 'NUMBERING']);
    expect((await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT'))).status).toBe(200);
    await refused(['NUMBERING']);
    expect((await setup(h, w.on)).missing).toEqual(['NUMBERING']);
    const answered = await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    expect(answered.status).toBe(200);
    expect(await read(answered)).toMatchObject({ canIssue: true, missing: [], steps: { details: 'done', numbering: 'done', logo: 'todo', defaults: 'todo' } });
    expect((await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() }))).status).toBe(201);
    // Nothing was numbered by the refused attempts.
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items.map((d: { number: number }) => d.number)).toEqual([1]);
  });

  it('the numbering answer can continue another tool’s numbers, per type; once a type has documents it is fixed', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT'));
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: true }, w.on, 'PUT'))).status).toBe(422);
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false, starts: { TAX_INVOICE: 5 } }, w.on, 'PUT'))).status).toBe(422);
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: true, starts: { TAX_INVOICE: 1043, RECEIPT: 88 } }, w.on, 'PUT'))).status).toBe(200);
    const counters = (await read(await h.app.request('/v1/issuing/settings', { headers: w.on }))).counters;
    expect(counters).toEqual(expect.arrayContaining([expect.objectContaining({ docType: 'TAX_INVOICE', next: 1043 }), expect.objectContaining({ docType: 'RECEIPT', next: 88 })]));
    expect((await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })))).number).toBe(1043);
    const fixed = await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: true, starts: { RECEIPT: 300, TAX_INVOICE: 2000 } }, w.on, 'PUT'));
    expect(fixed.status).toBe(409);
    expect((await read(fixed)).error.details).toMatchObject({ reason: 'HAS_DOCUMENTS', docType: 'TAX_INVOICE' });
    // Refused as a whole: the receipt's number didn't move either.
    const after = (await read(await h.app.request('/v1/issuing/settings', { headers: w.on }))).counters;
    expect(after).toEqual(expect.arrayContaining([expect.objectContaining({ docType: 'RECEIPT', next: 88 })]));
    // "No" puts back to 1 every type without documents; the tax invoices keep theirs.
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'))).status).toBe(200);
    const reset = (await read(await h.app.request('/v1/issuing/settings', { headers: w.on }))).counters;
    expect(reset).toEqual(expect.arrayContaining([expect.objectContaining({ docType: 'RECEIPT', next: 1 }), expect.objectContaining({ docType: 'TAX_INVOICE', next: 1044 })]));
  });

  it('AC2: the defaults save on their own, keep the details, and the details keep the defaults', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect((await h.app.request('/v1/issuer/defaults', json(DEFAULTS, { ...w.on, 'if-match': '1' }, 'PUT'))).status).toBe(422);
    const details = await read(await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT')));
    expect((await h.app.request('/v1/issuer/defaults', json(DEFAULTS, w.on, 'PUT'))).status).toBe(422);
    expect((await h.app.request('/v1/issuer/defaults', json({ ...DEFAULTS, ink: 'RED' }, { ...w.on, 'if-match': '1' }, 'PUT'))).status).toBe(422);
    expect((await h.app.request('/v1/issuer/defaults', json({ ...DEFAULTS, documentStyle: 'FANCY' }, { ...w.on, 'if-match': '1' }, 'PUT'))).status).toBe(422);
    const saved = await h.app.request('/v1/issuer/defaults', json(DEFAULTS, { ...w.on, 'if-match': String(details.version) }, 'PUT'));
    expect(saved.status).toBe(200);
    expect(await read(saved)).toMatchObject({ ...DEFAULTS, legalName: 'Barmajiyat Ltd.', city: 'Nazareth', version: 2 });
    expect((await setup(h, w.on)).steps.defaults).toBe('done');
    expect((await h.app.request('/v1/issuer/defaults', json(DEFAULTS, { ...w.on, 'if-match': '1' }, 'PUT'))).status).toBe(409);
    const renamed = await read(await h.app.request('/v1/issuer', json({ ...ISSUER, legalName: 'Barmajiyat Software Ltd.' }, { ...w.on, 'if-match': '2' }, 'PUT')));
    expect(renamed).toMatchObject({ ...DEFAULTS, legalName: 'Barmajiyat Software Ltd.', version: 3 });
  });

  it('a document is printed in the style and ink of the defaults it was issued under', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const details = await read(await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT')));
    await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    await h.app.request('/v1/issuer/defaults', json(DEFAULTS, { ...w.on, 'if-match': String(details.version) }, 'PUT'));
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    expect(doc).toMatchObject({ style: 'MODERN', ink: 'BLUE', issuer: { bankDetails: 'Bank Leumi 10-800-123456', footerNote: 'شكراً لتعاملكم معنا' } });
  });

  it('the logo: a PNG or JPEG by its own bytes, at most 256 KB; read back; removed for new documents only', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect((await putLogo(h, w.on, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png')).status).toBe(422);
    expect((await putLogo(h, w.on, new Uint8Array(ISSUER_LOGO_MAX_BYTES + 1).fill(0x89))).status).toBe(413);
    expect((await h.app.request('/v1/issuer/logo', { headers: w.on })).status).toBe(404);
    expect((await putLogo(h, w.on, PNG)).status).toBe(204);
    const got = await h.app.request('/v1/issuer/logo', { headers: w.on });
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
    expect(await setup(h, w.on)).toMatchObject({ hasLogo: true, steps: { logo: 'done' } });

    await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT'));
    await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    expect(doc.issuer.logoId).toEqual(expect.any(String));
    const printsImage = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString('latin1').includes('/Subtype /Image');
    expect(await printsImage(await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on }))).toBe(true);

    expect((await h.app.request('/v1/issuer/logo', { method: 'DELETE', headers: w.on })).status).toBe(204);
    expect((await h.app.request('/v1/issuer/logo', { headers: w.on })).status).toBe(404);
    expect((await setup(h, w.on)).hasLogo).toBe(false);
    // The issued document still prints the logo it was issued with; a new one prints none.
    expect(await printsImage(await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on }))).toBe(true);
    const next = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    expect(next.issuer.logoId).toBeUndefined();
    expect(await printsImage(await h.app.request(`/v1/issued-documents/${next.id}/pdf`, { headers: w.on }))).toBe(false);
  });

  it('refuses a file that only starts like a PNG; a document whose logo can’t be drawn still prints, without it', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect((await putLogo(h, w.on, PNG.slice(0, 40))).status).toBe(422);
    expect((await putLogo(h, w.on, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]), 'image/jpeg')).status).toBe(422);
    // It looks whole (signature, IHDR, IEND) but its pixels are broken: the engine's trial print refuses it.
    expect((await putLogo(h, w.on, new Uint8Array([...PNG.slice(0, 33), 0, 0, 0, 0, ...PNG.slice(-12)]))).status).toBe(422);
    await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT'));
    await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    // Stored past the route's checks (as a broken file would be), then printed.
    await h.store.issuing.addLogo(w.profileId, { contentType: 'image/png', bytes: new Uint8Array([...PNG.slice(0, 33), 0, 0, 0, 0, ...PNG.slice(-12)]), sha256: '0'.repeat(64) }, h.now());
    const doc = await read(await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() })));
    const pdf = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  }, 30_000);

  it('MUT-570: lists the styles from the server', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect(await read(await h.app.request('/v1/issuing/styles', { headers: w.on }))).toEqual({ styles: [{ key: 'PROFESSIONAL' }, { key: 'MODERN' }, { key: 'MINIMAL' }] });
  });

  it('MUT-648: offers to issue after saving income unless the business turns it off', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const details = await read(await h.app.request('/v1/issuer', json(ISSUER, w.on, 'PUT')));
    expect(details.offerAfterSave).toBe(true);
    const off = await read(await h.app.request('/v1/issuer/defaults', json({ ...DEFAULTS, offerAfterSave: false }, { ...w.on, 'if-match': String(details.version) }, 'PUT')));
    expect(off.offerAfterSave).toBe(false);
    // Saving the defaults again without it, or the details, keeps the choice.
    const again = await read(await h.app.request('/v1/issuer/defaults', json(DEFAULTS, { ...w.on, 'if-match': String(off.version) }, 'PUT')));
    expect(again.offerAfterSave).toBe(false);
    expect((await read(await h.app.request('/v1/issuer', json(ISSUER, { ...w.on, 'if-match': String(again.version) }, 'PUT')))).offerAfterSave).toBe(false);
  });

  it('remembers that the introduction was read', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const res = await h.app.request('/v1/issuing/setup/intro-seen', { method: 'POST', headers: w.on });
    expect(res.status).toBe(200);
    expect((await read(res)).introSeen).toBe(true);
    expect((await setup(h, w.on)).introSeen).toBe(true);
  });

  it('an accountant reads the setup but changes none of it', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const accountant = await shared(h, w.owner, w.profileId);
    const on = accountant.on(w.profileId);
    expect((await h.app.request('/v1/issuing/setup', { headers: on })).status).toBe(200);
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(403);
    expect((await h.app.request('/v1/issuing/setup/intro-seen', { method: 'POST', headers: on })).status).toBe(403);
    expect((await putLogo(h, on, PNG)).status).toBe(403);
    expect((await h.app.request('/v1/issuer/logo', { method: 'DELETE', headers: on })).status).toBe(403);
  });
});

/**
 * MUT-740 (ADR-287 D1, D4): the issuer's country. Israel is the only live pack; a country that isn't live saves and
 * issues nothing; the country is locked by the first document; an Israeli number's check digit counts.
 */
describe('the issuer’s country (MUT-740)', () => {
  // A hypothetical second country with its own pack (MUT-741: a live country must have one), taking tax IDs as typed.
  const JO_PACK = { ...IL_PACK, country: 'JO', taxId: { ...IL_PACK.taxId, normalize: (raw: string): string | null => raw, scheme: 'JO_TAX_ID' } };
  let unregister: () => void;
  beforeAll(() => {
    unregister = registerPackForTests(JO_PACK);
  });
  afterAll(() => unregister());
  const put = (h: AccountantHarness, on: Record<string, string>, body: Record<string, unknown>, headers: Record<string, string> = {}) => h.app.request('/v1/issuer', json(body, { ...on, ...headers }, 'PUT'));
  const reason = async (res: Response) => (await read(res)).error.details;

  it('a first save with no country is Israel, and the setup status says which countries are live', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect(await read(await put(h, w.on, ISSUER))).toMatchObject({ country: 'IL' });
    expect(await setup(h, w.on)).toMatchObject({ country: 'IL', liveJurisdictions: ['IL'] });
  });

  it('AC1: a country that is not live is refused, and nothing is saved', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const refused = await put(h, w.on, { ...ISSUER, country: 'JO' });
    expect(refused.status).toBe(422);
    expect(await reason(refused)).toMatchObject({ reason: 'JURISDICTION_NOT_LIVE', field: 'country', country: 'JO', live: ['IL'] });
    expect((await h.app.request('/v1/issuer', { headers: w.on })).status).toBe(404);
    expect(await setup(h, w.on)).toMatchObject({ country: null, steps: { details: 'todo' } });
  });

  it('a malformed country is a validation error', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    for (const country of ['il', 'ISR', 'I', '1L']) expect((await put(h, w.on, { ...ISSUER, country })).status).toBe(422);
  });

  it('a live country other than Israel saves; its number gets no Israeli check digit; a replace keeps the country', async () => {
    const h = issuingHarness({ invoicingJurisdictions: ['IL', 'JO'] });
    const w = await profile(h);
    const saved = await put(h, w.on, { ...ISSUER, vatId: '123456789', country: 'JO' });
    expect(saved.status).toBe(200);
    const record = await read(saved);
    expect(record).toMatchObject({ country: 'JO', vatId: '123456789' });
    const renamed = await read(await put(h, w.on, { ...ISSUER, vatId: '123456789', legalName: 'Amman Studio' }, { 'if-match': String(record.version) }));
    expect(renamed).toMatchObject({ country: 'JO', legalName: 'Amman Studio', version: 2 });
    expect(await setup(h, w.on)).toMatchObject({ country: 'JO', liveJurisdictions: ['IL', 'JO'] });
  });

  it('AC4: an Israeli number with a wrong check digit is refused; a right one is kept', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const refused = await put(h, w.on, { ...ISSUER, vatId: '123456789' });
    expect(refused.status).toBe(422);
    expect(await reason(refused)).toMatchObject({ reason: 'VAT_ID_INVALID', field: 'vatId' });
    expect((await h.app.request('/v1/issuer', { headers: w.on })).status).toBe(404);
    expect(await read(await put(h, w.on, { ...ISSUER, vatId: '517108775' }))).toMatchObject({ vatId: '517108775', country: 'IL' });
  });

  it('AC3: the country can change until the first document, then it is locked', async () => {
    const h = issuingHarness({ invoicingJurisdictions: ['IL', 'JO'] });
    const w = await profile(h);
    const first = await read(await put(h, w.on, { ...ISSUER, country: 'JO', vatId: '123456789' }));
    const switched = await put(h, w.on, { ...ISSUER, country: 'IL' }, { 'if-match': String(first.version) });
    expect(switched.status).toBe(200);
    const details = await read(switched);
    expect(details.country).toBe('IL');
    await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    expect(await setup(h, w.on)).toMatchObject({ countryLocked: false });
    expect((await h.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() }))).status).toBe(201);
    expect(await setup(h, w.on)).toMatchObject({ countryLocked: true });
    const locked = await put(h, w.on, { ...ISSUER, country: 'JO', vatId: '123456789' }, { 'if-match': String(details.version) });
    expect(locked.status).toBe(409);
    expect(await reason(locked)).toMatchObject({ reason: 'COUNTRY_LOCKED', field: 'country' });
    // The same country again is just a save.
    expect((await put(h, w.on, { ...ISSUER, legalName: 'Barmajiyat Software Ltd.' }, { 'if-match': String(details.version) })).status).toBe(200);
  });

  it('a stored country that is no longer live issues and previews nothing', async () => {
    const wide = issuingHarness({ invoicingJurisdictions: ['IL', 'JO'] });
    const w = await profile(wide);
    expect((await put(wide, w.on, { ...ISSUER, country: 'JO', vatId: '123456789' })).status).toBe(200);
    await wide.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, w.on, 'PUT'));
    const narrow = issuingHarness({ store: wide.store });
    const issued = await narrow.app.request('/v1/issued-documents', json(w.body, { ...w.on, ...idem() }));
    expect(issued.status).toBe(422);
    expect(await reason(issued)).toMatchObject({ reason: 'JURISDICTION_NOT_LIVE', country: 'JO' });
    const previewed = await narrow.app.request('/v1/issued-documents/preview', json(w.body, w.on));
    expect(previewed.status).toBe(422);
    expect(await reason(previewed)).toMatchObject({ reason: 'JURISDICTION_NOT_LIVE' });
    expect((await read(await narrow.app.request('/v1/issued-documents', { headers: w.on }))).items).toEqual([]);
  });
});
