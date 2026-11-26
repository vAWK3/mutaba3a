import { describe, expect, it } from 'vitest';
import { TokenBox } from '../jurisdictions/il/tax-authority/token-box.js';
import { FakeTaxAuthority } from '../jurisdictions/il/tax-authority/__tests__/fake-client.js';
import { ADMIN, accountantHarness, businessOf, idem, issuingHarness, json, person, read, signedIn, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-710 (ADR-274 D10, AC4): issuing and the Tax Authority need two-step sign-in on and a session that passed it;
 * the refusal comes before the idempotency layer, so it is never replayed; disconnecting always works.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };
const TAX = { client: new FakeTaxAuthority(), box: new TokenBox('gate-secret-with-at-least-32-characters!'), stateSecret: 'gate-state', accountingSoftwareNumber: 987654321 };

async function refusal(res: Response) {
  expect(res.status).toBe(403);
  const body = await read(res);
  expect(body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
  return body.error.details as { enrolled: boolean };
}

async function owner(h: AccountantHarness) {
  const p = await person(h);
  expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const profileId = await businessOf(h, p);
  return { p, profileId, on: p.on(profileId) };
}

describe('the issuing gate (MUT-710 D10)', () => {
  it('without two-step sign-in, all four routes point to setup (enrolled: false)', async () => {
    const h = accountantHarness({ taxAuthority: TAX, twoFactorIssuingGate: true });
    const { on } = await owner(h);
    expect(await refusal(await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT')))).toEqual({ enrolled: false });
    expect(await refusal(await h.app.request('/v1/issued-documents', json({}, { ...on, ...idem() })))).toEqual({ enrolled: false });
    expect(await refusal(await h.app.request('/v1/issuing/tax-authority/connect', json({}, on)))).toEqual({ enrolled: false });
    expect(await refusal(await h.app.request('/v1/issuing/allocation-decisions', json({ heldKey: 'k', choice: 'CANCEL' }, on)))).toEqual({ enrolled: false });
  });

  it('a session that passed the step goes through; turning it off un-stamps every session (enrolled: false), turning it on signs the others out', async () => {
    const h = issuingHarness({ taxAuthority: TAX });
    const { p, on } = await owner(h);
    expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);

    const state = await h.store.twoFactor.get(p.userId);
    await h.store.twoFactor.disable(p.userId, h.now(), []);
    expect(await refusal(await h.app.request('/v1/issuing/tax-authority/connect', json({}, on)))).toEqual({ enrolled: false });
    await h.store.twoFactor.enable({ userId: p.userId, method: 'totp', totpSecretSealed: state!.totpSecretSealed, lastUsedStep: null, recoveryDigests: [], at: h.now(), keepSessionId: null, audit: [] });
    expect((await h.app.request('/v1/issuing/tax-authority/connect', json({}, on))).status).toBe(401);
  });

  it('a refusal is never stored under the Idempotency-Key: the same key works once the session passed the step', async () => {
    const h = issuingHarness({ taxAuthority: TAX });
    const { p, profileId, on } = await owner(h);
    const key = idem();
    await h.store.twoFactor.disable(p.userId, h.now(), []);
    expect((await refusal(await h.app.request('/v1/issued-documents', json({}, { ...on, ...key })))).enrolled).toBe(false);
    const again = await signedIn(h, p.email, p.password, p.userId, p.personalId);
    const res = await h.app.request('/v1/issued-documents', json({}, { ...again.on(profileId), ...key }));
    expect((await read(res)).error?.code).not.toBe('TWO_FACTOR_SETUP_REQUIRED');
  });

  it('with TWO_FACTOR_ISSUING_GATE_ENABLED off (the default), issuing needs no two-step sign-in', async () => {
    const h = accountantHarness({ taxAuthority: TAX });
    const { p, on } = await owner(h);
    expect(await h.store.twoFactor.get(p.userId)).toBeNull();
    expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
    for (const res of [
      await h.app.request('/v1/issued-documents', json({}, { ...on, ...idem() })),
      await h.app.request('/v1/issuing/tax-authority/connect', json({}, on)),
      await h.app.request('/v1/issuing/allocation-decisions', json({ heldKey: 'k', choice: 'CANCEL' }, on)),
    ]) {
      expect((await res.text()).includes('TWO_FACTOR_SETUP_REQUIRED')).toBe(false);
    }
  });

  it('disconnecting from the Tax Authority always works', async () => {
    const h = accountantHarness({ taxAuthority: TAX });
    const { on } = await owner(h);
    const res = await h.app.request('/v1/issuing/tax-authority', { method: 'DELETE', headers: on });
    expect((await res.text()).includes('TWO_FACTOR_SETUP_REQUIRED')).toBe(false);
  });
});
