import { describe, expect, it } from 'vitest';
import { FakeTaxAuthority } from '../israel/tax-authority/__tests__/fake-client.js';
import { DEFAULT_MANUAL_ALLOCATION_URL } from '../israel/tax-authority/service.js';
import { TokenBox } from '../israel/tax-authority/token-box.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-711 (ADR-272): Plan B. When MTB3A can't request the allocation number (the Tax Authority is off on this server,
 * or the profile isn't connected), the business requests it by hand and enters it before issuing. The invoice number
 * it was requested for is only a preview: the numbering never has a gap, and a number requested for another invoice
 * number is never printed.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '777777715', dealerType: 'COMPANY', city: 'Nazareth' };
const box = new TokenBox('route-test-secret-with-at-least-32-characters');

async function profile(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const business = await read(await h.app.request('/v1/customers', json({ name: 'Levant Design Ltd.', taxId: '516123452' }, { ...on, ...idem() })));
  const privatePerson = await read(await h.app.request('/v1/customers', json({ name: 'Nour Haddad' }, { ...on, ...idem() })));
  return { profileId, on, business: business.id as string, privatePerson: privatePerson.id as string };
}

const invoice = (customerId: string, price: string, over: Record<string, unknown> = {}) => ({
  docType: 'TAX_INVOICE',
  documentDate: '2026-11-05',
  currency: 'ILS',
  language: 'ar',
  customerId,
  lines: [{ description: 'تطوير تطبيق', kind: 'SERVICE', quantity: '1', unitPrice: price }],
  ...over,
});

const issue = (h: AccountantHarness, on: Record<string, string>, body: unknown, key = idem()) => h.app.request('/v1/issued-documents', json(body, { ...on, ...key }));

describe('manual allocation number (MUT-711)', () => {
  it('AC1: the preview says a number is needed and MTB3A cannot request it, with the details the Tax Authority asks for', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const preview = await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)));
    expect(preview.allocation).toEqual({ mode: 'MANUAL', nextNumber: 1, documentDate: '2026-11-05', net: '6000.00', customerTaxId: '516123452', requestUrl: DEFAULT_MANUAL_ALLOCATION_URL });
    // Under the threshold, or to a private person: no panel.
    expect((await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '4999.99'), w.on)))).allocation).toBeNull();
    expect((await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.privatePerson, '9000.00'), w.on)))).allocation).toBeNull();
  });

  it('the preview is AUTOMATIC once the profile is connected, MANUAL while it is not; the link is configurable', async () => {
    const client = new FakeTaxAuthority();
    const h = accountantHarness({ taxAuthority: { client, box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 }, manualAllocationUrl: 'https://example.test/allocation' });
    const w = await profile(h);
    const before = await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)));
    expect(before.allocation).toMatchObject({ mode: 'MANUAL', requestUrl: 'https://example.test/allocation' });
    const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: w.on }));
    const state = new URL(started.authorizeUrl).searchParams.get('state')!;
    await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`);
    const after = await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)));
    expect(after.allocation).toMatchObject({ mode: 'AUTOMATIC' });
  });

  it('AC2: without a number the issue is refused; a malformed number is refused; nothing is taken', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const missing = await issue(h, w.on, invoice(w.business, '6000.00'));
    expect(missing.status).toBe(409);
    expect((await read(missing)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_REQUIRED', next: 1 });
    for (const bad of ['12345678', '1234567890', '12345678a', '']) {
      const res = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: bad, forNumber: 1 } }));
      expect(res.status, bad).toBe(422);
      expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_INVALID' });
    }
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toHaveLength(0);
  });

  it('AC4: the entered number is saved with source MANUAL (spaces and dashes dropped)', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const res = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '123-456 789', forNumber: 1 } }));
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await read(res);
    expect(doc).toMatchObject({ number: 1, allocationNumber: '123456789', allocationSource: 'MANUAL' });
    expect(await read(await h.app.request(`/v1/issued-documents/${doc.id}`, { headers: w.on }))).toMatchObject({ allocationNumber: '123456789', allocationSource: 'MANUAL' });
    // A document that needs no number has no source.
    const small = await read(await issue(h, w.on, invoice(w.business, '100.00')));
    expect(small).toMatchObject({ allocationNumber: null, allocationSource: null });
  });

  it('AC3: the number is a preview; if another document takes it first the issue is refused, and asking again for the new number works', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const preview = await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)));
    expect(preview.allocation.nextNumber).toBe(1);
    // Walking away consumes nothing: the next document still takes 1.
    const other = await read(await issue(h, w.on, invoice(w.business, '100.00')));
    expect(other.number).toBe(1);
    const moved = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '123456789', forNumber: 1 } }));
    expect(moved.status).toBe(409);
    const error = (await read(moved)).error;
    expect(error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_MOVED', requestedFor: 1, next: 2 });
    expect(error.message).toContain('now 2');
    const again = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '987654321', forNumber: 2 } }));
    expect(again.status, await again.clone().text()).toBe(201);
    expect(await read(again)).toMatchObject({ number: 2, allocationNumber: '987654321', allocationSource: 'MANUAL' });
    // No gap: 1 and 2 are both taken, nothing skipped.
    expect((await read(await h.app.request('/v1/issuing/gaps', { headers: w.on }))).types.find((t: { docType: string }) => t.docType === 'TAX_INVOICE')).toMatchObject({ last: 2, missing: [] });
  });

  it('a manual number on a document that needs none is refused', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const res = await issue(h, w.on, invoice(w.business, '100.00', { manualAllocation: { number: '123456789', forNumber: 1 } }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_NOT_NEEDED' });
  });

  it('works on a server with the Tax Authority on but the profile not connected, without calling it', async () => {
    const client = new FakeTaxAuthority();
    const h = accountantHarness({ taxAuthority: { client, box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 } });
    const w = await profile(h);
    const res = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '123456789', forNumber: 1 } }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await read(res)).toMatchObject({ allocationNumber: '123456789', allocationSource: 'MANUAL' });
    expect(client.approvals).toHaveLength(0);
  });

  it('the same Idempotency-Key returns the same document', async () => {
    const h = accountantHarness();
    const w = await profile(h);
    const key = idem();
    const body = invoice(w.business, '6000.00', { manualAllocation: { number: '123456789', forNumber: 1 } });
    const first = await read(await issue(h, w.on, body, key));
    const replay = await read(await issue(h, w.on, body, key));
    expect(replay.id).toBe(first.id);
  });
});
