import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ADMIN, accountantHarness, businessOf, DAY, idem, json, person, read, T0, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-644 (ADR-277, amended 2026-11-25): the operator's doors to a closed profile's issued documents: find it, export
 * its archive for the former owner, erase on request once the archive was handed over, and the per-document sweep.
 */
const ISSUER = { legalName: 'Kept Studio Ltd.', vatId: '516161619', country: 'IL', dealerType: 'COMPANY', city: 'Nazareth' };
const line = (description: string) => ({ description, kind: 'SERVICE', quantity: '1', unitPrice: '100.00' });

async function closedIssuer(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Kept Studio');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme Ltd.' }, { ...on, ...idem() })));
  const issue = async (body: Record<string, unknown>) => {
    const res = await h.app.request('/v1/issued-documents', json({ currency: 'ILS', language: 'he', ...body }, { ...on, ...idem() }));
    expect(res.status, await res.clone().text()).toBe(201);
    return read(res);
  };
  const invoice = await issue({ docType: 'TAX_INVOICE', documentDate: '2026-11-02', customerId: customer.id, lines: [line('Design')] });
  const receipt = await issue({ docType: 'RECEIPT', documentDate: '2026-11-04', payment: { method: 'CASH', receivedOn: '2026-11-04' }, lines: [line('Payment')] });
  // The invoice went out (its signed original is kept); the receipt was never produced.
  const produced = await h.app.request(`/v1/issued-documents/${invoice.id}/pdf`, json({ channel: 'DOWNLOAD' }, { ...on, ...idem() }));
  expect(produced.status, await produced.clone().text()).toBe(200);
  const sent = new Uint8Array(await produced.arrayBuffer());

  expect((await h.app.request('/v1/me/closure', json({ password: owner.password }, owner.auth))).status).toBe(200);
  h.setNow(new Date(T0.getTime() + 30 * DAY + 60_000));
  const purge = await read(await h.app.request('/admin/v1/accounts/purge', json({ dryRun: false }, ADMIN)));
  expect(purge.summary).toMatchObject({ purged: 1, issuingProfilesSwept: 0 });
  return { owner, profileId, invoice, receipt, sent };
}

const archive = (h: AccountantHarness, profileId: string, body: Record<string, unknown> = { reference: 'SUP-1042', lang: 'en' }) =>
  h.app.request(`/admin/v1/issuing/retained/${profileId}/archive`, json(body, ADMIN));

describe('closed profiles’ issued documents (MUT-644)', () => {
  it('finds a former owner’s profile by name or VAT number, with its deletion dates', async () => {
    const h = accountantHarness();
    const { profileId } = await closedIssuer(h);
    expect((await h.app.request('/admin/v1/issuing/retained')).status).toBe(401);
    const byName = await read(await h.app.request('/admin/v1/issuing/retained?query=kept%20studio', { headers: ADMIN }));
    expect(byName.data).toEqual([{ organizationId: profileId, legalName: 'Kept Studio Ltd.', vatId: '516161619', documents: 2, cancellations: 0, oldestDocumentDate: '2026-11-02', newestDocumentDate: '2026-11-04', nextSweepOn: '2033-11-03', retainedUntil: '2033-11-05' }]);
    const byVat = await read(await h.app.request('/admin/v1/issuing/retained?query=5161', { headers: ADMIN }));
    expect(byVat.data.map((p: { organizationId: string }) => p.organizationId)).toEqual([profileId]);
  });

  it('exports the archive: the signed original as sent, a signed copy of the rest, and the uniform file; logged', async () => {
    const h = accountantHarness();
    const { profileId, invoice, receipt, sent } = await closedIssuer(h);
    const res = await archive(h, profileId);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('x-archive-documents')).toBe('2');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(files).sort();
    expect(names).toEqual(['README.txt', `copies/400-${receipt.number}.pdf`, `originals/305-${invoice.number}.pdf`, 'uniform-file/OPENFRMT-516161619-2026-11-02_2026-11-04.zip']);
    expect(files[`originals/305-${invoice.number}.pdf`]).toEqual(sent);
    expect(strFromU8(files[`copies/400-${receipt.number}.pdf`]!.slice(0, 5))).toBe('%PDF-');
    const uniform = unzipSync(files['uniform-file/OPENFRMT-516161619-2026-11-02_2026-11-04.zip']!);
    expect(Object.keys(uniform).some((k) => k.endsWith('/INI.TXT'))).toBe(true);
    const readme = strFromU8(files['README.txt']!);
    expect(readme).toContain('the first from 2033-11-03, the last from 2033-11-05');
    // D7: the 7-year keep notice, in English, Arabic and Hebrew; its version is logged with the export.
    expect(readme).toContain('KEEP THIS ARCHIVE FOR 7 YEARS');
    expect(readme).toContain('احتفظ بهذا الأرشيف 7 سنوات');
    expect(readme).toContain('שמרו את הארכיון הזה 7 שנים');

    const events = await h.store.issuingRetention.events(profileId);
    expect(events).toMatchObject([{ action: 'ARCHIVE_EXPORTED', metadata: { reference: 'SUP-1042', documents: 2, originals: 1, copies: 1, noticeVersion: 1 } }]);
  });

  it('refuses a live profile (its owners download their own), an unknown id and a missing reference', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const live = await businessOf(h, owner, 'Live Studio');
    await h.store.issuing.putIssuer(live, { ...ISSUER, address: null, phone: null, email: null, website: null, pricesIncludeVat: false, ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null, offerAfterSave: true, defaultDocumentsPreference: 'ON_PAYMENT', dealerType: 'COMPANY' }, null, T0);
    const refused = await archive(h, live);
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'PROFILE_NOT_CLOSED' });
    expect((await archive(h, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await archive(h, live, {})).status).toBe(422);
    expect((await h.app.request(`/admin/v1/issuing/retained/${live}/archive`, json({ reference: 'x' }))).status).toBe(401);
  });

  it('the sweep: each document goes 7 years after its own date; the operator can dry-run it', async () => {
    const h = accountantHarness();
    const { profileId, invoice, receipt } = await closedIssuer(h);
    const sweep = async (dryRun: boolean) => read(await h.app.request('/admin/v1/issuing/retention/sweep', json({ dryRun }, ADMIN)));
    h.setNow(new Date('2033-11-02T23:00:00Z'));
    expect(await sweep(false)).toMatchObject({ due: 0, swept: 0, documentsDeleted: 0 });
    h.setNow(new Date('2033-11-03T00:00:00Z'));
    const dry = await sweep(true);
    expect(dry).toMatchObject({ dryRun: true, due: 1, swept: 1, documentsDeleted: 0, rows: [{ organizationId: profileId, outcome: 'would-sweep', documents: 2, deleted: null, nextSweepOn: '2033-11-03', retainedUntil: '2033-11-05' }] });
    expect(await h.store.issuing.getById(profileId, invoice.id)).not.toBeNull();
    // The invoice's day: it goes alone.
    expect(await sweep(false)).toMatchObject({ dryRun: false, swept: 1, documentsDeleted: 1, failed: 0, rows: [{ outcome: 'swept', deleted: 1, remaining: 1 }] });
    expect(await h.store.issuing.getById(profileId, invoice.id)).toBeNull();
    expect(await h.store.issuing.getById(profileId, receipt.id)).not.toBeNull();
    const listed = await read(await h.app.request('/admin/v1/issuing/retained?query=kept%20studio', { headers: ADMIN }));
    expect(listed.data).toMatchObject([{ documents: 1, oldestDocumentDate: '2026-11-04', nextSweepOn: '2033-11-05' }]);
    // The receipt's day: it goes, and the business details with it.
    h.setNow(new Date('2033-11-05T00:00:00Z'));
    expect(await sweep(false)).toMatchObject({ swept: 1, documentsDeleted: 1, rows: [{ deleted: 1, remaining: 0 }] });
    expect(await h.store.issuing.getById(profileId, receipt.id)).toBeNull();
    expect(await h.store.issuing.getIssuer(profileId)).toBeNull();
    expect((await archive(h, profileId)).status).toBe(404);
  });

  it('erases on request only after the archive, with its keep notice, was handed over (D7)', async () => {
    const h = accountantHarness();
    const { profileId, invoice } = await closedIssuer(h);
    const erase = (id: string, body: Record<string, unknown> = { reference: 'SUP-1043' }, headers: Record<string, string> = ADMIN) =>
      h.app.request(`/admin/v1/issuing/retained/${id}/erase`, json(body, headers));

    expect((await erase(profileId, { reference: 'x' }, {})).status).toBe(401);
    expect((await erase(profileId, {})).status).toBe(422);
    const early = await erase(profileId);
    expect(early.status).toBe(409);
    expect((await read(early)).error.details).toMatchObject({ reason: 'ARCHIVE_NOT_HANDED_OVER' });
    expect(await h.store.issuing.getById(profileId, invoice.id)).not.toBeNull();

    expect((await archive(h, profileId)).status).toBe(200);
    const done = await erase(profileId);
    expect(done.status, await done.clone().text()).toBe(200);
    const body = await read(done);
    expect(body).toMatchObject({ organizationId: profileId, documents: 2, cancellations: 0 });
    expect(body.rows).toBeGreaterThanOrEqual(6);
    expect(await h.store.issuing.getById(profileId, invoice.id)).toBeNull();
    expect(await h.store.issuing.getIssuer(profileId)).toBeNull();
    const events = await h.store.issuingRetention.events(profileId);
    expect(events.map((e) => e.action)).toEqual(['ARCHIVE_EXPORTED', 'ERASED']);
    expect(events[1]).toMatchObject({ metadata: { reference: 'SUP-1043', documents: 2, archiveEventId: events[0]!.id } });
    expect((await erase(profileId)).status).toBe(404);
    expect((await archive(h, profileId)).status).toBe(404);
  });

  it('never erases a live profile', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const live = await businessOf(h, owner, 'Live Studio');
    const refused = await h.app.request(`/admin/v1/issuing/retained/${live}/erase`, json({ reference: 'SUP-1' }, ADMIN));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'PROFILE_NOT_CLOSED' });
    expect((await h.app.request('/admin/v1/issuing/retained/00000000-0000-4000-8000-000000000000/erase', json({ reference: 'SUP-1' }, ADMIN))).status).toBe(404);
  });
});
