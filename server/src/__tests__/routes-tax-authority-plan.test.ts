import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeTaxAuthority } from '../israel/tax-authority/__tests__/fake-client.js';
import { TokenBox } from '../israel/tax-authority/token-box.js';
import type { UsagePlan } from '../usage/kinds.js';
import { ADMIN, ORIGIN, businessOf, idem, issuingHarness, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-736 (ADR-282, AC9–AC11): the Tax Authority connection is a paid-plan feature. Starter (MUT-731) doesn't resolve
 * from an entitlement yet, so the payer's plan is scripted here; everything else is the real app. On Starter:
 * connect, the callback and held-number decisions refuse with 409 PLAN_LIMIT; allocation is MANUAL with the "automatic
 * on Solo" hint; an existing connection reads `suspended`, is never deleted, and works again on a paid plan.
 */
let payerPlan: UsagePlan = 'starter';
vi.mock('../usage/plan-of.js', async (original) => ({ ...(await original<typeof import('../usage/plan-of.js')>()), payerPlanOf: vi.fn(async () => payerPlan) }));
afterEach(() => void (payerPlan = 'starter'));

const box = new TokenBox('route-test-secret-with-at-least-32-characters');
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '777777715', dealerType: 'COMPANY', city: 'Nazareth' };

function harness(over: Parameters<typeof issuingHarness>[0] = {}) {
  const client = new FakeTaxAuthority();
  const h = issuingHarness({ invoicingForAll: true, taxAuthority: { client, box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 }, ...over });
  return { h, client };
}

async function profile(h: AccountantHarness) {
  const owner = await person(h);
  const sharedWith = () => shared(h, owner, profileId);
  const profileId = await businessOf(h, owner, 'Nour Studio');
  const on = owner.on(profileId);
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const business = await read(await h.app.request('/v1/customers', json({ name: 'Levant Design Ltd.', taxId: '516123452' }, { ...on, ...idem() })));
  return { profileId, on, business: business.id as string, sharedWith };
}

/** Connected while on a paid plan (the plan then drops to Starter in the test). */
async function connectedOnSolo(h: AccountantHarness, on: Record<string, string>) {
  payerPlan = 'solo';
  const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: { ...on, origin: ORIGIN } }));
  const state = new URL(started.authorizeUrl).searchParams.get('state')!;
  expect((await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`)).headers.get('location')).toContain('taxAuthority=connected');
  return state;
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
const issue = (h: AccountantHarness, on: Record<string, string>, body: unknown) => h.app.request('/v1/issued-documents', json(body, { ...on, ...idem() }));

async function planLimit(res: Response) {
  expect(res.status).toBe(409);
  const { error } = await read(res);
  expect(error.code).toBe('PLAN_LIMIT');
  return error.details;
}

describe('the Tax Authority connection on Starter (MUT-736)', () => {
  it('AC9: connect refuses with PLAN_LIMIT naming the limit, the plan and Solo; no Checkout here, so no upgrade button', async () => {
    const { h } = harness();
    const w = await profile(h);
    expect(await planLimit(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: w.on }))).toEqual({ limit: 'taxAuthority', plan: 'starter', nextPlan: 'solo', canUpgrade: false });
  });

  it('canUpgrade is true where a paid plan can be bought on this server (Checkout configured)', async () => {
    const { h } = harness({ planCheckout: true });
    const w = await profile(h);
    expect((await planLimit(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: w.on }))).canUpgrade).toBe(true);
  });

  it('GET says the plan does not include it, and the state is none before any connection', async () => {
    const { h } = harness();
    const w = await profile(h);
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'none', plan: { allowed: false, nextPlan: 'solo' } });
  });

  it('a callback that lands after the plan dropped to Starter stores nothing and returns with taxAuthority=plan', async () => {
    const { h } = harness();
    const w = await profile(h);
    payerPlan = 'solo';
    const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: { ...w.on, origin: ORIGIN } }));
    const state = new URL(started.authorizeUrl).searchParams.get('state')!;
    payerPlan = 'starter';
    const back = await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe(`${ORIGIN}/p/${w.profileId}/you/invoicing?taxAuthority=plan`);
    expect(await h.store.issuing.getTaxConnection(w.profileId)).toBeNull();
  });

  it('the callback’s own page (no portal to return to) says the connection is on Solo and above', async () => {
    const { h } = harness();
    const w = await profile(h);
    payerPlan = 'solo';
    const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: w.on }));
    const state = new URL(started.authorizeUrl).searchParams.get('state')!;
    payerPlan = 'starter';
    const page = await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Solo');
  });

  it('allocation decisions refuse with PLAN_LIMIT; disconnect always works', async () => {
    const { h } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    payerPlan = 'starter';
    expect((await planLimit(await h.app.request('/v1/issuing/allocation-decisions', json({ heldKey: idem()['idempotency-key'], choice: 'CANCEL' }, w.on)))).limit).toBe('taxAuthority');
    expect((await h.app.request('/v1/issuing/tax-authority', { method: 'DELETE', headers: w.on })).status).toBe(204);
    expect(await h.store.issuing.getTaxConnection(w.profileId)).toBeNull();
  });

  it('AC11: a connection made on Solo reads suspended on Starter, is not deleted, and is connected again on Solo with no new setup', async () => {
    const { h } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    const stored = await h.store.issuing.getTaxConnection(w.profileId);
    expect((await read(await h.app.request('/v1/issuing/setup', { headers: w.on }))).steps.taxAuthority).toBe('done');

    payerPlan = 'starter';
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'suspended', plan: { allowed: false, nextPlan: 'solo' }, environment: 'sandbox' });
    expect(await h.store.issuing.getTaxConnection(w.profileId)).toEqual(stored);
    expect((await read(await h.app.request('/v1/issuing/setup', { headers: w.on }))).steps.taxAuthority).toBe('later');

    // An accountant on the profile reads the same answer (the owner's plan, under the accountant's read-only guard).
    const accountant = await w.sharedWith();
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: accountant.on(w.profileId) }))).toMatchObject({ state: 'suspended', plan: { allowed: false } });

    payerPlan = 'business';
    expect(await read(await h.app.request('/v1/issuing/tax-authority', { headers: w.on }))).toMatchObject({ state: 'connected', plan: { allowed: true, nextPlan: null } });
    expect((await read(await h.app.request('/v1/issuing/setup', { headers: w.on }))).steps.taxAuthority).toBe('done');
  });
});

describe('allocation numbers on Starter (MUT-736 AC10)', () => {
  it('the preview is MANUAL with automaticOn solo, even while connected', async () => {
    const { h } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    expect((await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)))).allocation).toMatchObject({ mode: 'AUTOMATIC', automaticOn: null });
    payerPlan = 'starter';
    expect((await read(await h.app.request('/v1/issued-documents/preview', json(invoice(w.business, '6000.00'), w.on)))).allocation).toMatchObject({ mode: 'MANUAL', automaticOn: 'solo', nextNumber: 1 });
  });

  it('without a number the issue is refused with ALLOCATION_NUMBER_REQUIRED and the hint; the Tax Authority is never called', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    payerPlan = 'starter';
    const res = await issue(h, w.on, invoice(w.business, '6000.00'));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_REQUIRED', field: 'manualAllocation', next: 1, automaticOn: 'solo' });
    expect(client.approvals).toHaveLength(0);
  });

  it('a held number’s "continue" on Starter never reports to the Tax Authority', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    payerPlan = 'starter';
    const res = await issue(h, w.on, invoice(w.business, '6000.00', { withoutAllocation: { heldKey: idem()['idempotency-key'] } }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_REQUIRED' });
    expect(client.decisions).toHaveLength(0);
  });

  it('a typed number issues exactly like an automatic one: stored with source MANUAL; malformed and moved are refused as before', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    const bad = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '12345', forNumber: 1 } }));
    expect(bad.status).toBe(422);
    expect((await read(bad)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_INVALID' });
    const moved = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '123456789', forNumber: 2 } }));
    expect(moved.status).toBe(409);
    expect((await read(moved)).error.details).toMatchObject({ reason: 'ALLOCATION_NUMBER_MOVED' });
    const ok = await issue(h, w.on, invoice(w.business, '6000.00', { manualAllocation: { number: '123-456-789', forNumber: 1 } }));
    expect(ok.status, await ok.clone().text()).toBe(201);
    const doc = await read(ok);
    expect(doc).toMatchObject({ number: 1, allocationNumber: '123456789', allocationSource: 'MANUAL' });
    expect(client.approvals).toHaveLength(0);
    const pdf = await h.app.request(`/v1/issued-documents/${doc.id}/pdf`, { headers: w.on });
    expect(pdf.status).toBe(200);
  });

  it('Solo, connected: the number comes back by itself, as before', async () => {
    const { h, client } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    const res = await issue(h, w.on, invoice(w.business, '6000.00'));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await read(res)).toMatchObject({ allocationSource: 'API' });
    expect(client.approvals).toHaveLength(1);
  });
});

describe('reconnect reminders (MUT-736)', () => {
  it('skip a connection kept on Starter (nothing to renew); mail it again on a paid plan', async () => {
    const { h } = harness();
    const w = await profile(h);
    await connectedOnSolo(h, w.on);
    const until = (await h.store.issuing.getTaxConnection(w.profileId))!.refreshExpiresAt!;
    h.setNow(new Date(until.getTime() - 4 * 86_400_000));
    const dryRun = async () => read(await h.app.request('/admin/v1/issuing/tax-authority-reminders', json({ dryRun: true }, ADMIN)));
    payerPlan = 'starter';
    expect((await dryRun()).rows).toEqual([{ organizationId: w.profileId, stage: 'soon', action: 'skip', skip: 'plan', outcome: null }]);
    payerPlan = 'solo';
    expect((await dryRun()).rows).toEqual([{ organizationId: w.profileId, stage: 'soon', action: 'send', skip: null, outcome: null }]);
  });
});
