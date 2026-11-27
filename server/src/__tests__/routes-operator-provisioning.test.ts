import { describe, expect, it } from 'vitest';
import { personalOrganizationIdOf } from '../accountants/provision.js';
import { COOKIE, SAME_ORIGIN, get, harness, json, operator, passwordSignIn, person, read, stepUp, type Harness } from './helpers/operator-harness.js';

/**
 * MUT-764 (accountant channel, epic MUT-762; eng T7, CEO ACCT-7): the operator console approves an accountant to
 * create customers, sets the two daily limits, withdraws the approval, and lists the accounts that were created but
 * not yet claimed (with whether they have paid). A non-operator gets 404; every write needs the passkey step-up.
 */
const approvalPath = (userId: string) => `/v1/operator/accounts/${userId}/accountant-provisioning`;
const LIST = '/v1/operator/provisioned-accounts';

const write = (h: Harness, method: 'PUT' | 'DELETE', path: string, token: string, body?: unknown) =>
  h.app.request(path, { method, headers: { 'content-type': 'application/json', cookie: `${COOKIE}=${token}`, ...SAME_ORIGIN }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** An operator who has passed the step-up, and the person to approve. */
async function setup() {
  const h = harness();
  const op = await operator(h);
  expect((await stepUp(h, op.token, op.auth)).status).toBe(200);
  const accountant = await person(h);
  return { h, op, accountant };
}

/** One customer this accountant created, through the store (as the route does). */
async function provisioned(h: Harness, accountantUserId: string, n: number) {
  const result = await h.store.provision.create({
    accountantUserId,
    email: `cust${n}-${Math.random().toString(36).slice(2, 7)}@cafe.ps`,
    displayName: `Customer ${n}`,
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-op-${n}-${Math.random().toString(36).slice(2, 7)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    profile: { name: `Business ${n}`, slug: `op-biz-${n}-${Math.random().toString(36).slice(2, 7)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    setupLink: { tokenDigest: `op-digest-${n}-${Math.random().toString(36).slice(2, 9)}`, expiresAt: new Date(h.clock.now.getTime() + 14 * 86_400_000) },
    claimCodeDigest: `op-claim-${n}-${Math.random().toString(36).slice(2, 9)}`,
    at: new Date(h.clock.now.getTime() + n * 1000),
    auditFor: () => [],
  });
  if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
  return result.user;
}

describe('Operator › accountant provisioning (MUT-764)', () => {
  it('is 404 for a person who is not an operator, on all four routes', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    expect((await get(h, approvalPath(p.id), token)).status).toBe(404);
    expect((await get(h, LIST, token)).status).toBe(404);
    expect((await write(h, 'PUT', approvalPath(p.id), token, {})).status).toBe(404);
    expect((await write(h, 'DELETE', approvalPath(p.id), token)).status).toBe(404);
  });

  it('shows an unapproved person as off, with the default limits and today’s counts', async () => {
    const { h, op, accountant } = await setup();
    const res = await get(h, approvalPath(accountant.id), op.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({
      userId: accountant.id,
      enabled: false,
      createLimitPerDay: null,
      lookupLimitPerDay: null,
      defaults: { createLimitPerDay: 50, lookupLimitPerDay: 100 },
      createdToday: 0,
      lookupsToday: 0,
    });
  });

  it('approves with limits, shows them, and audits the change on the accountant’s own profile', async () => {
    const { h, op, accountant } = await setup();
    const res = await write(h, 'PUT', approvalPath(accountant.id), op.token, { createLimitPerDay: 20, lookupLimitPerDay: 40 });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ userId: accountant.id, enabled: true, createLimitPerDay: 20, lookupLimitPerDay: 40 });
    expect(await h.store.provision.approvalOf(accountant.id)).toEqual({ enabled: true, createLimitPerDay: 20, lookupLimitPerDay: 40 });
    expect(await read(await get(h, approvalPath(accountant.id), op.token))).toMatchObject({ enabled: true, createLimitPerDay: 20, lookupLimitPerDay: 40 });

    const events = await h.store.audit.listByOrganization(await personalOrganizationIdOf(h.store, accountant.id), 20);
    const row = events.find((e) => e.action === 'accountant.provisioning_approved');
    expect(row).toMatchObject({ actorId: op.id, entityId: accountant.id, metadata: { createLimitPerDay: 20, lookupLimitPerDay: 40 } });
  });

  it('is idempotent, and an empty body approves on the defaults (null limits)', async () => {
    const { h, op, accountant } = await setup();
    expect((await write(h, 'PUT', approvalPath(accountant.id), op.token, {})).status).toBe(200);
    expect((await write(h, 'PUT', approvalPath(accountant.id), op.token, {})).status).toBe(200);
    expect(await h.store.provision.approvalOf(accountant.id)).toEqual({ enabled: true, createLimitPerDay: null, lookupLimitPerDay: null });
    // PUT replaces the whole approval: a limit that is null or left out is the default.
    await write(h, 'PUT', approvalPath(accountant.id), op.token, { createLimitPerDay: 5, lookupLimitPerDay: 9 });
    await write(h, 'PUT', approvalPath(accountant.id), op.token, { createLimitPerDay: null, lookupLimitPerDay: 9 });
    expect(await h.store.provision.approvalOf(accountant.id)).toEqual({ enabled: true, createLimitPerDay: null, lookupLimitPerDay: 9 });
  });

  it('refuses a limit that is not a whole number from 1 to 1000, and an unknown person', async () => {
    const { h, op, accountant } = await setup();
    for (const bad of [{ createLimitPerDay: 0 }, { createLimitPerDay: -3 }, { lookupLimitPerDay: 1.5 }, { lookupLimitPerDay: 1001 }, { createLimitPerDay: 'many' }]) {
      expect((await write(h, 'PUT', approvalPath(accountant.id), op.token, bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect(await h.store.provision.approvalOf(accountant.id)).toEqual({ enabled: false, createLimitPerDay: null, lookupLimitPerDay: null });
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await write(h, 'PUT', approvalPath(unknown), op.token, {})).status).toBe(404);
    expect((await get(h, approvalPath(unknown), op.token)).status).toBe(404);
  });

  it('needs the passkey step-up for a write, and not for a read', async () => {
    const h = harness();
    const op = await operator(h);
    const accountant = await person(h);
    expect((await get(h, approvalPath(accountant.id), op.token)).status).toBe(200);
    const res = await write(h, 'PUT', approvalPath(accountant.id), op.token, {});
    expect(res.status).toBe(403);
    expect((await read(res)).error.code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect((await h.store.provision.approvalOf(accountant.id))?.enabled).toBe(false);
  });

  it('withdraws the approval, keeps the limits for a later approval, and audits it', async () => {
    const { h, op, accountant } = await setup();
    await write(h, 'PUT', approvalPath(accountant.id), op.token, { createLimitPerDay: 20, lookupLimitPerDay: 40 });
    const res = await write(h, 'DELETE', approvalPath(accountant.id), op.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ enabled: false, createLimitPerDay: 20, lookupLimitPerDay: 40 });
    expect(await h.store.provision.approvalOf(accountant.id)).toEqual({ enabled: false, createLimitPerDay: 20, lookupLimitPerDay: 40 });
    const events = await h.store.audit.listByOrganization(await personalOrganizationIdOf(h.store, accountant.id), 20);
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['accountant.provisioning_approved', 'accountant.provisioning_withdrawn']));
  });

  it('counts what the accountant did today', async () => {
    const { h, op, accountant } = await setup();
    await write(h, 'PUT', approvalPath(accountant.id), op.token, {});
    await provisioned(h, accountant.id, 1);
    await provisioned(h, accountant.id, 2);
    expect(await read(await get(h, approvalPath(accountant.id), op.token))).toMatchObject({ createdToday: 2, lookupsToday: 0 });
  });

  it('lists accounts created for customers and not yet claimed, newest first, with who made them and whether they paid', async () => {
    const { h, op, accountant } = await setup();
    await write(h, 'PUT', approvalPath(accountant.id), op.token, {});
    const first = await provisioned(h, accountant.id, 1);
    const second = await provisioned(h, accountant.id, 2);
    const third = await provisioned(h, accountant.id, 3);

    // The second customer paid at the accountant's table (an active subscription) but has not set a password.
    await h.store.billing.saveAccount({ stripeCustomerId: 'cus_op_1', userId: second.id, country: 'IL', currency: 'ILS', at: h.clock.now, linkAudit: [] });
    await h.store.billing.saveSubscription({
      stripeCustomerId: 'cus_op_1', stripeSubscriptionId: 'sub_op_1', tier: 'FREELANCER', organizationId: null, status: 'active', currentPeriodEnd: new Date(h.clock.now.getTime() + 30 * 86_400_000),
      cancelAtPeriodEnd: false, priceLookupKey: 'freelancer_list_monthly_ils', founderUntil: null, stripeUpdatedAt: h.clock.now, at: h.clock.now,
      audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
    });

    const res = await get(h, LIST, op.token);
    expect(res.status).toBe(200);
    const { items } = await read(res);
    expect(items.map((i: { userId: string }) => i.userId)).toEqual([third.id, second.id, first.id]);
    expect(items.find((i: { userId: string }) => i.userId === second.id)).toMatchObject({ email: second.email, displayName: 'Customer 2', accountant: { userId: accountant.id, email: accountant.email }, paid: true });
    expect(items.find((i: { userId: string }) => i.userId === first.id)).toMatchObject({ paid: false });

    // Claimed (a password set): gone from the list.
    await h.store.users.setPassword(first.id, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', h.clock.now);
    expect((await read(await get(h, LIST, op.token))).items.map((i: { userId: string }) => i.userId)).not.toContain(first.id);
    expect((await read(await get(h, `${LIST}?limit=1`, op.token))).items).toHaveLength(1);
    expect((await get(h, `${LIST}?limit=0`, op.token)).status).toBe(422);
  });
});

describe('the operator provisioning routes sit behind the one operator gate', () => {
  it('answers 401 with no session', async () => {
    const h = harness();
    expect((await get(h, LIST)).status).toBe(401);
    expect((await h.app.request(approvalPath('00000000-0000-4000-8000-000000000000'), json({}, SAME_ORIGIN, 'PUT'))).status).toBe(401);
  });
});
