import { describe, expect, it } from 'vitest';
import { FakeTaxAuthority } from '../israel/tax-authority/__tests__/fake-client.js';
import { TokenBox } from '../israel/tax-authority/token-box.js';
import { ADMIN, ORIGIN, issuingHarness, businessOf, idem, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-571/572 (ADR-264): connecting a profile to the Tax Authority, and the allocation number on an issued invoice. The
 * Tax Authority is a scripted fake; no token may ever appear in an answer, a redirect or the audit trail.
 */
const box = new TokenBox('route-test-secret-with-at-least-32-characters');
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '777777715', dealerType: 'COMPANY', city: 'Nazareth' };

function harness(client = new FakeTaxAuthority(), over: Parameters<typeof issuingHarness>[0] = {}) {
  const h = issuingHarness({ taxAuthority: { client, box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 }, ...over });
  return { h, client };
}

async function profile(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const business = await read(await h.app.request('/v1/customers', json({ name: 'Acme Digital Ltd.', taxId: '516123452' }, { ...on, ...idem() })));
  const privatePerson = await read(await h.app.request('/v1/customers', json({ name: 'Nour Haddad' }, { ...on, ...idem() })));
  return { owner, profileId, on, business: business.id as string, privatePerson: privatePerson.id as string };
}

/** Connect from the portal (its Origin, by default this server's PORTAL_ORIGIN), then come back with `back`. */
async function startConnect(h: AccountantHarness, on: Record<string, string>, origin: string | null = ORIGIN) {
  const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: { ...on, ...(origin ? { origin } : {}) } }));
  return new URL(started.authorizeUrl).searchParams.get('state')!;
}

async function connect(h: AccountantHarness, on: Record<string, string>, origin: string | null = ORIGIN, back = 'code=good-code') {
  const state = await startConnect(h, on, origin);
  return h.app.request(`/v1/issuing/tax-authority/callback?${back}&state=${encodeURIComponent(state)}`);
}

const invoice = (customerId: string, price: string, over: Record<string, unknown> = {}) => ({
  docType: 'TAX_INVOICE',
  documentDate: '2026-11-05',
  currency: 'ILS',
  language: 'he',
  customerId,
  lines: [{ description: 'פיתוח אפליקציה – ספרינט 3', kind: 'SERVICE', quantity: '1', unitPrice: price }],
  ...over,
});

describe('Tax Authority connection (MUT-571)', () => {
  it('is 404 on a server without it configured', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect((await h.app.request('/v1/issuing/tax-authority', { headers: w.on })).status).toBe(404);
  });

  it('AC1: connects through the sign-in and shows "connected until"; the setup step is done', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'none' });
    const back = await connect(h, w.on);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${ORIGIN}/p/${w.profileId}/you/invoicing?taxAuthority=connected`);
    const status = await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }));
    expect(status).toMatchObject({ state: 'connected', environment: 'sandbox', until: '2027-01-30T08:00:00.000Z' });
    expect((await read(await h.app.request('/v1/issuing/setup', { headers: w.on }))).steps.taxAuthority).toBe('done');
    // AC4: no token in the stored row's clear text, an answer or the audit.
    const row = await h.store.issuing.getTaxConnection(w.profileId);
    const events = await h.store.audit.listByOrganization(w.profileId, 100);
    expect(events.map((e) => e.action)).toContain('tax_authority.connected');
    const audit = JSON.stringify(events);
    for (const token of client.issuedTokens) {
      expect(JSON.stringify(row)).not.toContain(token);
      expect(JSON.stringify(status)).not.toContain(token);
      expect(audit).not.toContain(token);
    }
  });

  it('refuses a forged or expired state, and a refused code, storing nothing', async () => {
    const { h } = harness();
    const w = await profile(h);
    const forged = await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=not.valid`);
    expect(forged.status).toBe(200);
    expect(await forged.text()).toContain('did not complete');
    const state = await startConnect(h, w.on);
    const refused = await h.app.request(`/v1/issuing/tax-authority/callback?code=bad-code&state=${encodeURIComponent(state)}`);
    expect(refused.headers.get('location')).toContain('taxAuthority=failed');
    h.setNow(new Date(h.now().getTime() + 11 * 60_000));
    const late = await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(await late.text()).toContain('did not complete');
    expect(await h.store.issuing.getTaxConnection(w.profileId)).toBeNull();
  });

  describe('where the browser lands after the Tax Authority (follow-up: never an address with no page)', () => {
    const landing = (profileId: string, origin: string, outcome: string) => `${origin}/p/${profileId}/you/invoicing?taxAuthority=${outcome}`;

    it('the dev portal on another local port: back to it, not to the API origin (which serves no portal here)', async () => {
      const { h } = harness();
      const w = await profile(h);
      const back = await connect(h, w.on, 'http://127.0.0.1:5175');
      expect(back.status).toBe(302);
      expect(back.headers.get('location')).toBe(landing(w.profileId, 'http://127.0.0.1:5175', 'connected'));
    });

    it('an API-only server and a start with no portal Origin (a phone): its own page says connected, in Arabic and English', async () => {
      const { h } = harness();
      const w = await profile(h);
      const back = await connect(h, w.on, null);
      expect(back.status).toBe(200);
      const page = await back.text();
      expect(page).toContain('dir="rtl"');
      expect(page).toContain('تم الربط بسلطة الضرائب');
      expect(page).toContain('Connected to the Tax Authority');
      expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'connected' });
    });

    it('a server that serves the portal: back to PORTAL_ORIGIN even with no Origin on the start', async () => {
      const { h } = harness(new FakeTaxAuthority(), { portal: { distDir: '/nonexistent-portal-dist' } });
      const w = await profile(h);
      const back = await connect(h, w.on, null);
      expect(back.headers.get('location')).toBe(landing(w.profileId, ORIGIN, 'connected'));
    });

    it('a foreign Origin is never signed into the state', async () => {
      const { h } = harness();
      const w = await profile(h);
      const back = await connect(h, w.on, 'https://evil.example');
      expect(back.status).toBe(200);
      expect(back.headers.get('location')).toBeNull();
    });

    it('consent refused on the Tax Authority site: back to the setup with taxAuthority=refused, nothing exchanged or stored', async () => {
      const { h, client } = harness();
      const w = await profile(h);
      const back = await connect(h, w.on, ORIGIN, 'error=access_denied');
      expect(back.headers.get('location')).toBe(landing(w.profileId, ORIGIN, 'refused'));
      expect(client.issuedTokens).toHaveLength(0);
      expect(await h.store.issuing.getTaxConnection(w.profileId)).toBeNull();
      const own = await connect(h, w.on, null, 'error=access_denied');
      expect(await own.text()).toContain('was not approved');
    });
  });

  it('only the owner connects or disconnects; an accountant reads the status', async () => {
    const { h } = harness();
    const w = await profile(h);
    const accountant = await shared(h, w.owner, w.profileId);
    const on = accountant.on(w.profileId);
    expect((await h.app.request('/v1/issuing/tax-authority', { headers: on })).status).toBe(200);
    expect((await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: on })).status).toBe(403);
    expect((await h.app.request('/v1/issuing/tax-authority', { method: 'DELETE', headers: on })).status).toBe(403);
    await connect(h, w.on);
    expect((await h.app.request('/v1/issuing/tax-authority', { method: 'DELETE', headers: w.on })).status).toBe(204);
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'none' });
  });
});

describe('allocation numbers (MUT-572)', () => {
  it('AC1: over the threshold the invoice carries the number (its last 9 digits); under it, or to a private person, no call', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connect(h, w.on);
    const small = await read(await h.app.request('/v1/issued-documents', json(invoice(w.business, '4999.99'), { ...w.on, ...idem() })));
    expect(small.allocationNumber).toBeNull();
    const toPerson = await read(await h.app.request('/v1/issued-documents', json(invoice(w.privatePerson, '9000.00'), { ...w.on, ...idem() })));
    expect(toPerson.allocationNumber).toBeNull();
    expect(client.approvals).toHaveLength(0);

    const res = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...idem() }));
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await read(res);
    expect(doc.number).toBe(3);
    expect(doc.allocationNumber).toBe('000100001');
    expect(client.approvals).toHaveLength(1);
    expect(client.approvals[0]!.request).toMatchObject({
      invoiceType: 305,
      vatNumber: 777777715,
      customerVatNumber: 516123452,
      invoiceReferenceNumber: '3',
      invoiceDate: '2026-11-05',
      accountingSoftwareNumber: 987654321,
      paymentAmount: 6000,
      vatAmount: 1080,
      paymentAmountIncludingVat: 7080,
    });
    expect(client.approvals[0]!.request.items[0]).toMatchObject({ category: 2, quantity: 1, pricePerUnit: 6000, totalAmount: 6000, vatRate: 18 });
  });

  it('AC4: a profile not connected cannot issue over the threshold, and no number is taken', async () => {
    const { h } = harness();
    const w = await profile(h);
    const refused = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...idem() }));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'TAX_AUTHORITY_NOT_CONNECTED' });
    expect((await read(await h.app.request('/v1/issued-documents', json(invoice(w.business, '100.00'), { ...w.on, ...idem() })))).number).toBe(1);
  });

  it('AC3: a timeout, then the same request again: one invoice, one number, one request id', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connect(h, w.on);
    client.answers = ['throw'];
    const key = idem();
    const first = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...key }));
    expect(first.status).toBe(502);
    expect((await read(first)).error.code).toBe('TAX_AUTHORITY_UNAVAILABLE');
    const again = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...key }));
    expect(again.status, await again.clone().text()).toBe(201);
    const doc = await read(again);
    expect(doc.number).toBe(1);
    expect(client.approvals.map((a) => a.request.invoiceId)).toEqual([client.approvals[0]!.request.invoiceId, client.approvals[0]!.request.invoiceId]);
    const replay = await read(await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...key })));
    expect(replay.id).toBe(doc.id);
    expect(client.approvals).toHaveLength(2);
    expect((await read(await h.app.request('/v1/issued-documents', { headers: w.on }))).items).toHaveLength(1);
  });

  it('AC2: a held number offers the choices; the choice is reported; "continue" issues without a number', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connect(h, w.on);
    client.answers = [{ kind: 'held', message: 'Invoice held' }];
    const heldKey = idem();
    const held = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...heldKey }));
    expect(held.status).toBe(409);
    expect((await read(held)).error.details).toMatchObject({ reason: 'ALLOCATION_HELD', choices: ['CANCEL', 'CONTINUE', 'FURTHER_OBJECTION'] });
    const objection = await h.app.request('/v1/issuing/allocation-decisions', json({ heldKey: heldKey['idempotency-key'], choice: 'FURTHER_OBJECTION' }, w.on));
    expect(objection.status).toBe(204);
    const continued = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00', { withoutAllocation: { heldKey: heldKey['idempotency-key'] } }), { ...w.on, ...idem() }));
    expect(continued.status, await continued.clone().text()).toBe(201);
    const doc = await read(continued);
    expect(doc).toMatchObject({ number: 1, allocationNumber: null });
    const heldId = client.approvals[0]!.request.invoiceId;
    expect(client.decisions).toEqual([
      { choice: 'FURTHER_OBJECTION', invoiceId: heldId },
      { choice: 'CONTINUE', invoiceId: heldId },
    ]);
  });

  it('a refused request says why, and takes no number', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connect(h, w.on);
    client.answers = [{ kind: 'refused', errors: [{ code: 434, message: 'Invoice date is too old for approval', param: 'invoice_date' }] }];
    const refused = await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...idem() }));
    expect(refused.status).toBe(422);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'ALLOCATION_REFUSED', errors: [{ code: 434, param: 'invoice_date' }] });
    expect((await read(await h.app.request('/v1/issued-documents', json(invoice(w.business, '6000.00'), { ...w.on, ...idem() })))).number).toBe(1);
  });
});
