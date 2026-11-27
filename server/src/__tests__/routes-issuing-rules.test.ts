import { describe, expect, it } from 'vitest';
import { ADMIN, issuingHarness, businessOf, json, person, read, shared, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-743: GET /v1/issuing/rules. What the clients (portal, phone) show and ask for, from the issuer's jurisdiction pack,
 * instead of hard-coding Israel. Same gate as GET /v1/issuing/setup.
 */
async function profile(h: AccountantHarness, invoicing = true) {
  const owner = await person(h);
  if (invoicing) expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, owner, 'Barmajiyat');
  return { owner, profileId, on: owner.on(profileId) };
}
const rules = (h: AccountantHarness, on: Record<string, string>, query = '') => h.app.request(`/v1/issuing/rules${query}`, { headers: on });

describe('GET /v1/issuing/rules (MUT-743)', () => {
  it('a profile with no issuer yet gets Israel\'s rules (the default country), cacheable for a few minutes', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const res = await rules(h, w.on);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
    const body = await read(res);
    expect(body).toMatchObject({ country: 'IL', live: true, rulesVersion: '1.0.0' });
    expect(body.rules.currency).toEqual({ base: 'ILS', issuing: ['ILS'] });
    expect(body.rules.dealerTypes.map((d: { value: string }) => d.value)).toEqual(['LICENSED', 'EXEMPT', 'COMPANY', 'NONPROFIT']);
    expect(body.rules.clearance).toEqual({ kind: 'IL_ALLOCATION' });
  });

  it('follows the issuer\'s country once the business details are saved', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const issuer = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };
    expect((await h.app.request('/v1/issuer', json(issuer, w.on, 'PUT'))).status).toBe(200);
    expect(await read(await rules(h, w.on))).toMatchObject({ country: 'IL', live: true });
  });

  it('?country= asks for a country before anything is saved; one that is not live is "not available yet"', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    expect(await read(await rules(h, w.on, '?country=JO'))).toEqual({ country: 'JO', live: false, rulesVersion: null, rules: null });
    expect(await read(await rules(h, w.on, '?country=IL'))).toMatchObject({ country: 'IL', live: true });
  });

  it('a malformed country is a validation error', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    for (const country of ['il', 'ISR', '1L']) expect((await rules(h, w.on, `?country=${country}`)).status, country).toBe(422);
  });

  it('is 404 for a profile without invoicing (a 404 means "no invoicing here", never "no rules")', async () => {
    const h = issuingHarness();
    const w = await profile(h, false);
    expect((await rules(h, w.on)).status).toBe(404);
  });

  it('an accountant with a grant reads it', async () => {
    const h = issuingHarness();
    const w = await profile(h);
    const accountant = await shared(h, w.owner, w.profileId);
    expect((await rules(h, accountant.on(w.profileId))).status).toBe(200);
  });
});
