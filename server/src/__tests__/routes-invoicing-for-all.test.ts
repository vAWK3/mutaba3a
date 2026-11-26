import { describe, expect, it } from 'vitest';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-736 (ADR-282, AC8): invoicing for everyone. With INVOICING_FOR_ALL on, a brand-new account issues from its
 * business profile with no operator action, and /v1/me names `invoicing` so the portal and every shipped phone build
 * open issuing. Off is the kill switch: the operator's per-person `invoicing` grant decides again.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '777777715', dealerType: 'COMPANY', city: 'Nazareth' };

async function newAccount(h: AccountantHarness) {
  const p = await person(h);
  const profileId = await businessOf(h, p, 'Nour Studio');
  return { p, profileId, on: p.on(profileId) };
}

const features = async (h: AccountantHarness, auth: Record<string, string>) => (await read(await h.app.request('/v1/me', { headers: auth }))).user.features as string[];

describe('INVOICING_FOR_ALL on', () => {
  it('AC8: a brand-new account with no grant reaches issuing on its business profile, and issues', async () => {
    const h = accountantHarness({ invoicingForAll: true });
    const { on } = await newAccount(h);
    expect((await h.app.request('/v1/issuing/setup', { headers: on })).status).toBe(200);
    expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
    expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
    const client = await read(await h.app.request('/v1/customers', json({ name: 'Levant Design Ltd.' }, { ...on, ...idem() })));
    const res = await h.app.request(
      '/v1/issued-documents',
      json({ docType: 'TAX_INVOICE', customerId: client.id, documentDate: '2026-11-05', currency: 'ILS', language: 'en', lines: [{ description: 'Design', kind: 'SERVICE', quantity: '1', unitPrice: '100.00' }] }, { ...on, ...idem() }),
    );
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('/v1/me names invoicing for everyone, once, whether or not they hold the grant', async () => {
    const h = accountantHarness({ invoicingForAll: true });
    const { p } = await newAccount(h);
    expect(await features(h, p.auth)).toContain('invoicing');
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    expect((await features(h, p.auth)).filter((f) => f === 'invoicing')).toHaveLength(1);
  });

  it('the personal profile still has no issuing', async () => {
    const h = accountantHarness({ invoicingForAll: true });
    const { p } = await newAccount(h);
    expect((await h.app.request('/v1/issuing/setup', { headers: p.on(p.personalId) })).status).toBe(404);
  });

  it('an operator revoke changes nothing while it is on', async () => {
    const h = accountantHarness({ invoicingForAll: true });
    const { p, on } = await newAccount(h);
    await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN });
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'DELETE', headers: ADMIN })).status).toBeLessThan(300);
    expect((await h.app.request('/v1/issuing/setup', { headers: on })).status).toBe(200);
  });

  it('MUT-710’s gate still applies: issuing without two-step sign-in points to setup', async () => {
    const h = accountantHarness({ invoicingForAll: true, twoFactorIssuingGate: true });
    const { on } = await newAccount(h);
    const res = await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'));
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  });
});

describe('INVOICING_FOR_ALL off (the default, the kill switch)', () => {
  it('a new account without the grant has no issuing and /v1/me does not name it', async () => {
    const h = accountantHarness();
    const { p, on } = await newAccount(h);
    expect((await h.app.request('/v1/issuing/setup', { headers: on })).status).toBe(404);
    expect(await features(h, p.auth)).not.toContain('invoicing');
  });

  it('the operator grant opens it again, as before', async () => {
    const h = accountantHarness();
    const { p, on } = await newAccount(h);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    expect((await h.app.request('/v1/issuing/setup', { headers: on })).status).toBe(200);
    expect(await features(h, p.auth)).toContain('invoicing');
  });
});
