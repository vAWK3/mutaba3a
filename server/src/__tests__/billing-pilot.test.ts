import { describe, expect, it } from 'vitest';
import { ADMIN, get, harness, json, minutes, operator, passwordSignIn, person, post, read, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-752 (ADR-296, plan `docs/designs/pilot-testers-business-plan.md`): the pilot marker on a grant, `pilot` on
 * GET /v1/billing and the Welcome flag, end to end through the real app (memory store).
 */
const DAY = 86_400_000;
const adminGrant = (h: Harness, body: Record<string, unknown>) => h.app.request('/admin/v1/billing/grants', json(body, ADMIN));
const PILOT = { tier: 'BUSINESS', reason: 'pilot Nasser & Co', cohort: 'dec-2026' } as const;

async function signedIn(h: Harness) {
  const p = await person(h);
  const token = await passwordSignIn(h, p.email, p.password);
  return { ...p, token, billing: async () => (await read(await get(h, '/v1/billing', token))) as Loose };
}

async function auditOf(h: Harness, userId: string) {
  const [personal] = await h.store.memberships.listByUser(userId);
  return (await h.store.audit.list(personal!.organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('billing.grant'));
}

describe('MUT-752 pilot grants (admin token and operator console)', () => {
  it('a pilot grant without an expiry ends in 60 days, names the cohort and the accountant, and is audited with both', async () => {
    const h = harness();
    const tester = await person(h);
    const accountant = await person(h);
    const res = await adminGrant(h, { ...PILOT, userId: tester.id, referredByUserId: accountant.id });
    expect(res.status).toBe(201);
    const grant = await read(res);
    expect(grant).toMatchObject({ userId: tester.id, tier: 'BUSINESS', cohort: 'dec-2026', referredByUserId: accountant.id, expiresAt: new Date(h.clock.now.getTime() + 60 * DAY).toISOString() });
    const [row] = await auditOf(h, tester.id);
    expect(row!.metadata).toMatchObject({ cohort: 'dec-2026', referredByUserId: accountant.id, expiresAt: grant.expiresAt });
  });

  it('keeps an expiry the operator gives', async () => {
    const h = harness();
    const tester = await person(h);
    const expiresAt = new Date(h.clock.now.getTime() + 45 * DAY).toISOString();
    expect(await read(await adminGrant(h, { ...PILOT, userId: tester.id, expiresAt }))).toMatchObject({ expiresAt, referredByUserId: null });
  });

  it('a plain grant is unchanged: no cohort, no default expiry', async () => {
    const h = harness();
    const tester = await person(h);
    expect(await read(await adminGrant(h, { tier: 'BUSINESS', reason: 'comp', userId: tester.id }))).toMatchObject({ cohort: null, referredByUserId: null, expiresAt: null });
    const [row] = await auditOf(h, tester.id);
    expect(row!.metadata).not.toHaveProperty('cohort');
  });

  it.each([
    ['a cohort that is not a slug', { ...PILOT, cohort: 'Rana Haddad' }, 'cohort', undefined],
    ['an Accountant plan pilot', { ...PILOT, tier: 'ACCOUNTANT' }, 'tier', 'PILOT_NOT_ACCOUNTANT'],
    ['an accountant without a cohort', { tier: 'BUSINESS', reason: 'x' }, 'referredByUserId', 'REFERRAL_NEEDS_PILOT'],
  ])('refuses %s with 422', async (_name, body, field, reason) => {
    const h = harness();
    const tester = await person(h);
    const accountant = await person(h);
    const res = await adminGrant(h, { ...body, userId: tester.id, ...(field === 'referredByUserId' ? { referredByUserId: accountant.id } : {}) });
    expect(res.status).toBe(422);
    const error = (await read(res)).error;
    expect(error.details).toMatchObject({ field, ...(reason ? { reason } : {}) });
    expect(await h.store.billing.listGrants({ userId: tester.id })).toEqual([]);
  });

  it('refuses a pilot on a profile, a tester referring themselves, and an unknown accountant', async () => {
    const h = harness();
    const tester = await person(h);
    const [personal] = await h.store.memberships.listByUser(tester.id);
    expect((await adminGrant(h, { ...PILOT, organizationId: personal!.organizationId })).status).toBe(422);
    expect((await adminGrant(h, { ...PILOT, userId: tester.id, referredByUserId: tester.id })).status).toBe(422);
    const unknown = await adminGrant(h, { ...PILOT, userId: tester.id, referredByUserId: '00000000-0000-4000-8000-000000000752' });
    expect(unknown.status).toBe(404);
    expect(await h.store.billing.listGrants({ userId: tester.id })).toEqual([]);
  });

  it('the operator console grants a pilot the same way (grantedBy operator:<id>)', async () => {
    const h = harness();
    const op = await operator(h);
    const tester = await person(h);
    const accountant = await person(h);
    const res = await post(h, `/v1/operator/accounts/${tester.id}/billing-grants`, op.token, { ...PILOT, referredByUserId: accountant.id });
    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ cohort: 'dec-2026', referredByUserId: accountant.id, grantedBy: `operator:${op.id}`, expiresAt: new Date(h.clock.now.getTime() + 60 * DAY).toISOString() });
    const list = await read(await get(h, `/v1/operator/accounts/${tester.id}/billing-grants`, op.token));
    expect(list.grants[0]).toMatchObject({ cohort: 'dec-2026', referredByUserId: accountant.id });
  });
});

describe('MUT-752 GET /v1/billing pilot', () => {
  it('a tester on a pilot grant sees the cohort, the end, no Welcome yet, and the three plans with Expected prices and limits', async () => {
    const h = harness();
    const tester = await signedIn(h);
    const grant = await read(await adminGrant(h, { ...PILOT, userId: tester.id }));
    const billing = await tester.billing();
    expect(billing.currentPlan).toBe('business');
    expect(billing.pilot).toEqual({
      cohort: 'dec-2026',
      endsAt: grant.expiresAt,
      welcomeSeenAt: null,
      pricesExpected: true,
      plans: [
        { plan: 'solo', expectedMonthly: { ILS: 3900, USD: 1200 }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
        { plan: 'business', expectedMonthly: { ILS: 8900, USD: 2700 }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
        { plan: 'firm', expectedMonthly: { ILS: 24900, USD: 7500 }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
      ],
    });
    // Usage is the Business plan's (MUT-735): counted, never refused (eng review finding 3).
    expect(billing.usage.plan).toBe('business');
  });

  it('is null with nothing, a plain grant, or a running trial', async () => {
    const h = harness();
    const nothing = await signedIn(h);
    expect((await nothing.billing()).pilot).toBeNull();
    const plain = await signedIn(h);
    await adminGrant(h, { tier: 'BUSINESS', reason: 'comp', userId: plain.id });
    expect((await plain.billing()).pilot).toBeNull();
    const trial = await signedIn(h);
    await h.store.billing.setTrialStart(trial.id, h.clock.now);
    expect((await trial.billing()).pilot).toBeNull();
  });

  it('is null for a tester who also pays (a Stripe subscription), and back once it lapses', async () => {
    const h = harness();
    const tester = await signedIn(h);
    await adminGrant(h, { ...PILOT, userId: tester.id });
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_pilot', userId: tester.id, country: 'IL', currency: 'ILS', at: h.clock.now, linkAudit: [] });
    const subscription = (status: string) => ({
      stripeCustomerId: 'cus_pilot',
      stripeSubscriptionId: 'sub_pilot',
      tier: 'SOLO' as const,
      organizationId: null,
      status,
      currentPeriodEnd: new Date(h.clock.now.getTime() + 20 * DAY),
      cancelAtPeriodEnd: false,
      priceLookupKey: 'solo_list_monthly_ils',
      founderUntil: null,
      stripeUpdatedAt: h.clock.now,
      at: h.clock.now,
      audit: { profileIds: [], source: 'webhook' as const, eventId: null, requestId: null },
    });
    await h.store.billing.saveSubscription(subscription('active'));
    expect((await tester.billing()).pilot).toBeNull();
    minutes(h, 1);
    await h.store.billing.saveSubscription({ ...subscription('canceled'), stripeUpdatedAt: h.clock.now, at: h.clock.now });
    expect((await tester.billing()).pilot).toMatchObject({ cohort: 'dec-2026' });
  });

  it('ends with the grant: an expired or revoked pilot is null', async () => {
    const h = harness();
    const tester = await signedIn(h);
    const soon = await read(await adminGrant(h, { ...PILOT, userId: tester.id, expiresAt: new Date(h.clock.now.getTime() + 30 * 60_000).toISOString() }));
    expect((await tester.billing()).pilot.endsAt).toBe(soon.expiresAt);
    minutes(h, 30);
    expect((await tester.billing()).pilot).toBeNull();

    const other = await signedIn(h);
    const grant = await read(await adminGrant(h, { ...PILOT, userId: other.id }));
    expect((await h.app.request(`/admin/v1/billing/grants/${grant.id}`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);
    expect((await other.billing()).pilot).toBeNull();
  });

  it('an extension (revoke + new grant) shows the new end and keeps the Welcome closed', async () => {
    const h = harness();
    const tester = await signedIn(h);
    const first = await read(await adminGrant(h, { ...PILOT, userId: tester.id }));
    expect((await post(h, '/v1/billing/pilot-welcome', tester.token)).status).toBe(200);
    const seen = (await tester.billing()).pilot.welcomeSeenAt;
    expect(seen).toBe(h.clock.now.toISOString());

    minutes(h, 5);
    await h.app.request(`/admin/v1/billing/grants/${first.id}`, { method: 'DELETE', headers: ADMIN });
    const extended = await read(await adminGrant(h, { ...PILOT, userId: tester.id, expiresAt: new Date(h.clock.now.getTime() + 90 * DAY).toISOString() }));
    const pilot = (await tester.billing()).pilot;
    expect(pilot.endsAt).toBe(extended.expiresAt);
    expect(pilot.welcomeSeenAt).toBe(seen);
  });
});

describe('MUT-752 POST /v1/billing/pilot-welcome', () => {
  it('records the first close only; a second call keeps the first instant', async () => {
    const h = harness();
    const tester = await signedIn(h);
    await adminGrant(h, { ...PILOT, userId: tester.id });
    const first = await read(await post(h, '/v1/billing/pilot-welcome', tester.token));
    expect(first).toEqual({ welcomeSeenAt: h.clock.now.toISOString() });
    minutes(h, 10);
    expect(await read(await post(h, '/v1/billing/pilot-welcome', tester.token))).toEqual(first);
  });

  it('signed out is 401', async () => {
    const h = harness();
    expect((await post(h, '/v1/billing/pilot-welcome', undefined)).status).toBe(401);
  });
});
