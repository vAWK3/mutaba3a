import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { ADMIN, businessOf, DAY, idem, issuingHarness, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-731 (ADR-284): Starter as the fallback plan end to end on the routes: /v1/me and the gate agree, the cancelled
 * person continues free, the person with more than one business must pick (Basel Q5), and the one-time Solo trial step.
 */

let seq = 0;

function harness(options: { starter?: boolean; soloTrialOfferSince?: Date | null } = {}) {
  return issuingHarness({ store: new MemoryLedgerStore({ starterPlan: options.starter ?? true }), billingGate: true, soloTrialOfferSince: options.soloTrialOfferSince ?? null });
}

const me = async (h: AccountantHarness, who: Person) => read(await h.app.request('/v1/me', { headers: who.auth }));
const billingOf = async (h: AccountantHarness, who: Person) => read(await h.app.request('/v1/billing', { headers: who.auth }));
const write = (h: AccountantHarness, who: Person, profileId: string) => h.app.request('/v1/customers', json({ name: `Client ${++seq}` }, { ...who.on(profileId), ...idem() }));

/** A paid plan that the person cancelled after paying (row 7: read-only, offering Starter). */
async function cancelledPaidPlan(h: AccountantHarness, userId: string, over: Record<string, unknown> = {}) {
  const customer = `cus_${++seq}`;
  const at = h.now();
  await h.store.billing.saveAccount({ stripeCustomerId: customer, userId, country: 'IL', currency: 'ILS', at, linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: customer,
    stripeSubscriptionId: `sub_${++seq}`,
    tier: 'FREELANCER',
    organizationId: null,
    status: 'canceled',
    currentPeriodEnd: new Date(at.getTime() - 5 * DAY),
    cancelAtPeriodEnd: true,
    priceLookupKey: 'freelancer_list_monthly_ils',
    founderUntil: null,
    endedAt: new Date(at.getTime() - 5 * DAY),
    endedReason: 'cancellation_requested',
    trialEnd: null,
    stripeUpdatedAt: at,
    at: new Date(at.getTime() - 60 * DAY),
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    ...over,
  });
}

describe('Starter is the fallback (rows 6–8)', () => {
  it('a person nothing covers is ACTIVE on Starter and can write; /v1/billing says starter', async () => {
    const h = harness();
    const who = await person(h);
    const personal = (await me(h, who)).profiles.find((p: { isPersonalDefault: boolean }) => p.isPersonalDefault);
    expect(personal.billing).toMatchObject({ state: 'ACTIVE', source: 'STARTER', tier: 'STARTER' });
    expect((await me(h, who)).plan).toMatchObject({ current: 'starter', businesses: null, soloTrialOffer: false });
    expect((await write(h, who, who.personalId)).status).toBe(201);
    const billing = await billingOf(h, who);
    expect(billing).toMatchObject({ currentPlan: 'starter', starter: { chosenAt: null, canContinueFree: false }, activeBusinesses: null });
    expect(billing.usage.meters).toEqual([
      { meter: 'documents', used: 0, limit: 3, level: 'ok' },
      { meter: 'scans', used: 0, limit: 12, level: 'ok' },
    ]);
  });

  it('off: the same person is read-only NONE, as before', async () => {
    const h = harness({ starter: false });
    const who = await person(h);
    expect((await me(h, who)).profiles[0].billing).toMatchObject({ state: 'READ_ONLY', source: 'NONE' });
    expect((await write(h, who, who.personalId)).status).toBe(402);
  });

  it('a legacy trial past its end (and past the lock) is Starter, not read-only or locked', async () => {
    const h = harness();
    const who = await person(h);
    await h.store.billing.setTrialStart(who.userId, new Date(h.now().getTime() - 40 * DAY));
    expect((await me(h, who)).profiles[0].billing).toMatchObject({ state: 'ACTIVE', source: 'STARTER' });
  });
});

describe('POST /v1/billing/starter: Continue free on Starter (13540 Q3)', () => {
  it('a cancelled, read-only person continues free; a repeat changes nothing', async () => {
    const h = harness();
    const who = await person(h);
    await cancelledPaidPlan(h, who.userId);
    expect((await me(h, who)).profiles[0].billing).toMatchObject({ state: 'READ_ONLY', source: 'STRIPE' });
    expect((await billingOf(h, who)).starter).toEqual({ chosenAt: null, canContinueFree: true });
    expect((await write(h, who, who.personalId)).status).toBe(402);
    const chosen = await h.app.request('/v1/billing/starter', { method: 'POST', headers: who.auth });
    expect(chosen.status, await chosen.clone().text()).toBe(200);
    expect(await read(chosen)).toMatchObject({ changed: true });
    expect((await me(h, who)).profiles[0].billing).toMatchObject({ state: 'ACTIVE', source: 'STARTER' });
    expect((await write(h, who, who.personalId)).status).toBe(201);
    expect(await read(await h.app.request('/v1/billing/starter', { method: 'POST', headers: who.auth }))).toMatchObject({ changed: false });
  });

  it('409 NOTHING_TO_LEAVE while a plan covers the person', async () => {
    const h = harness();
    const who = await person(h);
    await cancelledPaidPlan(h, who.userId, { status: 'active', endedAt: null, endedReason: null, currentPeriodEnd: new Date(h.now().getTime() + 20 * DAY) });
    const res = await h.app.request('/v1/billing/starter', { method: 'POST', headers: who.auth });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('NOTHING_TO_LEAVE');
  });

  it('404 with Starter off', async () => {
    const h = harness({ starter: false });
    const who = await person(h);
    expect((await h.app.request('/v1/billing/starter', { method: 'POST', headers: who.auth })).status).toBe(404);
  });
});

describe('more than one business on Starter: the person must pick (Basel Q5, Q9)', () => {
  async function twoBusinesses(h: AccountantHarness) {
    const who = await person(h);
    const first = await businessOf(h, who, 'Studio');
    const carried = await read(await h.app.request('/v1/profiles', json({ name: 'Carried', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', carriedOver: true }, { ...who.auth, ...idem() })));
    return { who, first, second: carried.id as string };
  }

  it('until they pick, every business is read-only (402, reason PLAN_LIMIT) and /v1/me says mustChoose; the personal profile stays open', async () => {
    const h = harness();
    const { who, first, second } = await twoBusinesses(h);
    const plan = (await me(h, who)).plan;
    expect(plan.businesses).toMatchObject({ cap: 1, active: [], mustChoose: true });
    expect([...plan.businesses.readOnly].sort()).toEqual([first, second].sort());
    for (const id of [first, second]) {
      const res = await write(h, who, id);
      expect(res.status).toBe(402);
      expect((await read(res)).error.details).toMatchObject({ reason: 'PLAN_LIMIT', state: 'READ_ONLY', source: 'STARTER' });
    }
    expect((await write(h, who, who.personalId)).status).toBe(201);
    expect((await h.app.request('/v1/customers', { headers: who.on(first) })).status).toBe(200);
    const billing = await billingOf(h, who);
    expect(billing.activeBusinesses).toMatchObject({ cap: 1, active: [], mustChoose: true });
    expect(billing.activeBusinesses.readOnly).toHaveLength(2);
  });

  it('PUT /v1/billing/active-businesses keeps the chosen one; the gate and /v1/me agree; it can be switched later', async () => {
    const h = harness();
    const { who, first, second } = await twoBusinesses(h);
    const res = await h.app.request('/v1/billing/active-businesses', json({ organizationIds: [second] }, who.auth, 'PUT'));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await read(res)).toEqual({ cap: 1, active: [second], readOnly: [first], mustChoose: false });
    expect((await write(h, who, second)).status).toBe(201);
    expect((await write(h, who, first)).status).toBe(402);
    const profiles = (await me(h, who)).profiles as Array<{ id: string; billing: { state: string; planLimit?: boolean } }>;
    expect(profiles.find((p) => p.id === first)!.billing).toMatchObject({ state: 'READ_ONLY', planLimit: true });
    expect(profiles.find((p) => p.id === second)!.billing.state).toBe('ACTIVE');
    expect((await h.app.request('/v1/billing/active-businesses', json({ organizationIds: [first] }, who.auth, 'PUT'))).status).toBe(200);
    expect((await write(h, who, first)).status).toBe(201);
    const audit = await h.store.audit.listByOrganization(first, 50);
    expect(JSON.stringify(audit)).toContain('billing.active_businesses_chosen');
  });

  it('the wrong count is 422 WRONG_COUNT; a business not theirs is 404; nothing to choose is 409', async () => {
    const h = harness();
    const { who, first, second } = await twoBusinesses(h);
    const both = await h.app.request('/v1/billing/active-businesses', json({ organizationIds: [first, second] }, who.auth, 'PUT'));
    expect(both.status).toBe(422);
    expect((await read(both)).error.details.reason).toBe('WRONG_COUNT');
    const other = await person(h);
    const theirs = await businessOf(h, other);
    expect((await h.app.request('/v1/billing/active-businesses', json({ organizationIds: [theirs] }, who.auth, 'PUT'))).status).toBe(404);
    expect((await h.app.request('/v1/billing/active-businesses', json({ organizationIds: [theirs] }, other.auth, 'PUT'))).status).toBe(409);
  });

  it('a paid plan keeps every business open (the cap is Starter’s only until MUT-704)', async () => {
    const h = harness();
    const { who, first, second } = await twoBusinesses(h);
    expect((await h.app.request('/admin/v1/billing/grants', json({ userId: who.userId, tier: 'SOLO', reason: 'test' }, ADMIN))).status).toBe(201);
    for (const id of [first, second]) expect((await write(h, who, id)).status).toBe(201);
    expect((await me(h, who)).plan.businesses).toBeNull();
  });

  it('billing:uncovered leaves the businesses read-only for the count out (they are the person’s to choose)', async () => {
    const h = harness();
    await twoBusinesses(h);
    const uncovered = await read(await h.app.request('/admin/v1/billing/uncovered', { headers: ADMIN }));
    expect(uncovered.profiles).toEqual([]);
  });
});

describe('the one-time Solo trial step (Basel Q7, 13554 #2)', () => {
  it('a new account on Starter is offered it once; once shown it is gone; older accounts never are', async () => {
    const since = new Date('2026-11-01T00:00:00Z');
    const h = harness({ soloTrialOfferSince: since });
    const who = await person(h);
    expect((await me(h, who)).plan.soloTrialOffer).toBe(true);
    const shown = await h.app.request('/v1/billing/solo-trial/offered', { method: 'POST', headers: who.auth });
    expect(shown.status).toBe(200);
    expect((await me(h, who)).plan.soloTrialOffer).toBe(false);
    const later = issuingHarness({ store: new MemoryLedgerStore({ starterPlan: true }), billingGate: true, soloTrialOfferSince: new Date('2027-01-01T00:00:00Z') });
    expect((await me(later, await person(later))).plan.soloTrialOffer).toBe(false);
  });

  it('off (no SOLO_TRIAL_OFFER_SINCE, until Solo can be bought): never offered', async () => {
    const h = harness();
    expect((await me(h, await person(h))).plan.soloTrialOffer).toBe(false);
  });
});
