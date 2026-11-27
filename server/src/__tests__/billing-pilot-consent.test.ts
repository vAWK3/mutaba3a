import { describe, expect, it } from 'vitest';
import { ADMIN, get, harness, json, minutes, operator, passwordSignIn, person, post, read, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-777 (ADR-333): each pilot tester's one yes to watched and recorded sessions, with its date: given in the Welcome
 * (POST /v1/billing/pilot-watch-consent) or recorded by the operator's grant on their behalf (`watchConsent`), shown on
 * GET /v1/billing `pilot.watchConsentAt` and on the operator's Accounts row. The first yes is kept.
 */
const PILOT = { tier: 'BUSINESS', reason: 'pilot Nasser & Co', cohort: 'dec-2026' } as const;
const adminGrant = (h: Harness, body: Record<string, unknown>) => h.app.request('/admin/v1/billing/grants', json(body, ADMIN));

async function signedIn(h: Harness) {
  const p = await person(h);
  const token = await passwordSignIn(h, p.email, p.password);
  return { ...p, token, billing: async () => (await read(await get(h, '/v1/billing', token))) as Loose };
}

describe('MUT-777 the pilot tester’s yes to watched sessions', () => {
  it('no yes yet: the pilot runs, watchConsentAt is null', async () => {
    const h = harness();
    const tester = await signedIn(h);
    await adminGrant(h, { ...PILOT, userId: tester.id });
    expect((await tester.billing()).pilot).toMatchObject({ cohort: 'dec-2026', watchConsentAt: null });
  });

  it('the tester’s yes from the Welcome is stored with its instant; a second yes keeps the first', async () => {
    const h = harness();
    const tester = await signedIn(h);
    await adminGrant(h, { ...PILOT, userId: tester.id });
    const first = h.clock.now.toISOString();
    const res = await post(h, '/v1/billing/pilot-watch-consent', tester.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ watchConsentAt: first });
    minutes(h, 5);
    expect(await read(await post(h, '/v1/billing/pilot-watch-consent', tester.token))).toEqual({ watchConsentAt: first });
    expect((await tester.billing()).pilot.watchConsentAt).toBe(first);
  });

  it('needs a signed-in person (401 without a session)', async () => {
    const h = harness();
    expect((await post(h, '/v1/billing/pilot-watch-consent', undefined)).status).toBe(401);
  });

  it('the operator’s grant records it on the tester’s behalf and audits it; the Accounts row shows it', async () => {
    const h = harness();
    const op = await operator(h);
    const tester = await signedIn(h);
    const res = await post(h, `/v1/operator/accounts/${tester.id}/billing-grants`, op.token, { ...PILOT, watchConsent: true });
    expect(res.status).toBe(201);
    const at = h.clock.now.toISOString();
    expect((await tester.billing()).pilot.watchConsentAt).toBe(at);
    const [personal] = await h.store.memberships.listByUser(tester.id);
    const audit = (await h.store.audit.list(personal!.organizationId, {}, { limit: 10, cursor: null })).items.find((e) => e.action === 'billing.grant_created');
    expect(audit!.metadata).toMatchObject({ cohort: 'dec-2026', watchConsent: true });
    const list = await read(await get(h, '/v1/operator/accounts?pilot=1', op.token));
    expect(list.data.find((a: Loose) => a.id === tester.id).pilot).toMatchObject({ watchConsentAt: at });
  });

  it('a yes only on a pilot grant (422 CONSENT_NEEDS_PILOT), and nothing is granted', async () => {
    const h = harness();
    const tester = await person(h);
    const res = await adminGrant(h, { tier: 'BUSINESS', reason: 'comp', userId: tester.id, watchConsent: true });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ field: 'watchConsent', reason: 'CONSENT_NEEDS_PILOT' });
    expect(await h.store.billing.listGrants({ userId: tester.id })).toEqual([]);
    expect(await h.store.billing.pilotWatchConsentOf(tester.id)).toBeNull();
  });

  it('watchConsent false records nothing; the Accounts row says null', async () => {
    const h = harness();
    const op = await operator(h);
    const tester = await person(h);
    expect((await adminGrant(h, { ...PILOT, userId: tester.id, watchConsent: false })).status).toBe(201);
    const list = await read(await get(h, '/v1/operator/accounts?pilot=1', op.token));
    expect(list.data.find((a: Loose) => a.id === tester.id).pilot).toMatchObject({ watchConsentAt: null });
  });
});
