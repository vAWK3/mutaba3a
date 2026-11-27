import { describe, expect, it } from 'vitest';
import { reminderDayDue } from '../accountants/unclaimed-sweep.js';
import { CURRENT_TERMS } from '../legal.js';
import { DAY, JOB, SAME_ORIGIN, accountantHarness, idem, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-767 (accountant channel, epic MUT-762; eng T6, R1): the daily sweep of accounts an accountant created that nobody
 * claimed. Clock-injected: reminders on days 3, 10, 30 and 53, each once, with a fresh link and the same code; one
 * digest a day per accountant; on day 60 an unpaid account is closed and the hourly purge deletes it; a paid one is
 * kept and flagged. A second run the same day does nothing more.
 */
const SWEEP = '/jobs/v1/accountants/unclaimed-sweep';
const PURGE = '/jobs/v1/accounts/purge';
const CUSTOMERS = '/v1/accountant/customers';

const sweep = (h: AccountantHarness) => h.app.request(SWEEP, { method: 'POST', headers: JOB });
const at = (h: AccountantHarness, days: number, t0: number) => h.setNow(new Date(t0 + days * DAY + 60_000));

async function approved(h: AccountantHarness): Promise<Person> {
  const accountant = await person(h, { sharing: false, displayName: 'Hadi Khatib' });
  await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
  return accountant;
}

async function customer(h: AccountantHarness, accountant: Person) {
  const email = `owner${Math.random().toString(36).slice(2, 8)}@cafe-nour.ps`;
  const res = await h.app.request(CUSTOMERS, json({ email, displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, { ...accountant.auth, ...idem() }));
  expect(res.status).toBe(201);
  const out = await read(res);
  return { userId: out.customer.userId as string, email, profileId: out.profile.id as string, code: out.claimCode as string };
}

const mailsTo = (h: AccountantHarness, to: string, template: string) => h.transport.list({ to }).filter((m) => m.template === template);
const tokenOf = (text: string) => /setup#([A-Za-z0-9_-]{43})/.exec(text)![1]!;

async function pay(h: AccountantHarness, userId: string) {
  await h.store.billing.saveAccount({ stripeCustomerId: `cus_${userId.slice(0, 8)}`, userId, country: 'IL', currency: 'ILS', at: h.now(), linkAudit: [] });
  await h.store.billing.saveSubscription({
    stripeCustomerId: `cus_${userId.slice(0, 8)}`, stripeSubscriptionId: `sub_${userId.slice(0, 8)}`, tier: 'SOLO', organizationId: null, status: 'active', currentPeriodEnd: new Date(h.now().getTime() + 400 * DAY),
    cancelAtPeriodEnd: false, priceLookupKey: 'solo_list_yearly_ils', founderUntil: null, stripeUpdatedAt: h.now(), at: h.now(),
    audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null },
  });
}

describe('reminderDayDue (MUT-767)', () => {
  it('sends only the latest day reached, once, and never an earlier one after a later', () => {
    expect(reminderDayDue(2, [])).toBeNull();
    expect(reminderDayDue(3, [])).toBe(3);
    expect(reminderDayDue(9, [3])).toBeNull();
    expect(reminderDayDue(12, [])).toBe(10);
    expect(reminderDayDue(31, [3])).toBe(30);
    expect(reminderDayDue(31, [30])).toBeNull();
    expect(reminderDayDue(59, [3, 10, 30])).toBe(53);
  });
});

describe('POST /jobs/v1/accountants/unclaimed-sweep (MUT-767)', () => {
  it('reminds the customer on day 3 once, with a fresh link that the same code still claims', async () => {
    const h = accountantHarness({ accountantProvisioning: true });
    const t0 = h.now().getTime();
    const accountant = await approved(h);
    const c = await customer(h, accountant);

    at(h, 2, t0);
    expect(await read(await sweep(h))).toMatchObject({ looked: 1, reminded: 0, removed: 0 });
    at(h, 3, t0);
    expect(await read(await sweep(h))).toMatchObject({ reminded: 1, digests: 1 });
    expect(await read(await sweep(h))).toMatchObject({ reminded: 0, digests: 0 });

    const reminders = mailsTo(h, c.email, 'customer-setup');
    expect(reminders).toHaveLength(2);
    expect(reminders[1]!.subject).toBe('Reminder: finish setting up “Café Nour” on MTB3A');
    expect((await h.store.audit.listByOrganization(c.profileId, 50)).filter((e) => e.action === 'accountant.customer_reminded')).toHaveLength(1);

    // One digest to the accountant, counts only.
    const [digest] = mailsTo(h, accountant.email, 'accountant-unclaimed-digest');
    expect(digest!.subject).toBe('1 customer hasn’t claimed their MTB3A account');
    expect(digest!.text).not.toContain(c.email);

    const res = await h.app.request('/v1/account-setup', json({ token: tokenOf(reminders[1]!.text), password: 'a-long-enough-password', acceptedTermsVersion: CURRENT_TERMS.version, claimCode: c.code }, SAME_ORIGIN));
    expect(res.status).toBe(200);
    at(h, 10, t0);
    expect(await read(await sweep(h))).toMatchObject({ looked: 0, reminded: 0 });
  });

  it('sends one digest per accountant for several customers, and none on a day with nothing to say', async () => {
    const h = accountantHarness({ accountantProvisioning: true });
    const t0 = h.now().getTime();
    const accountant = await approved(h);
    await customer(h, accountant);
    await customer(h, accountant);
    at(h, 3, t0);
    expect(await read(await sweep(h))).toMatchObject({ reminded: 2, digests: 1 });
    expect(mailsTo(h, accountant.email, 'accountant-unclaimed-digest')[0]!.subject).toBe('2 customers haven’t claimed their MTB3A accounts');
    at(h, 5, t0);
    expect(await read(await sweep(h))).toMatchObject({ reminded: 0, digests: 0 });
  });

  it('removes an unpaid account on day 60 through the purge, and keeps and flags a paid one', async () => {
    const h = accountantHarness({ accountantProvisioning: true });
    const t0 = h.now().getTime();
    const accountant = await approved(h);
    const unpaid = await customer(h, accountant);
    const paid = await customer(h, accountant);
    await pay(h, paid.userId);

    at(h, 59, t0);
    const before = await read(await sweep(h));
    expect(before).toMatchObject({ removed: 0, flagged: 0, reminded: 2 });
    const [digest] = mailsTo(h, accountant.email, 'accountant-unclaimed-digest');
    expect(digest!.text).toContain('1 of them hasn’t paid and is removed within a week.');

    at(h, 60, t0);
    expect(await read(await sweep(h))).toMatchObject({ looked: 2, removed: 1, flagged: 1 });
    expect(await read(await sweep(h))).toMatchObject({ looked: 1, removed: 0, flagged: 1 });
    expect((await h.store.users.getById(unpaid.userId))?.closure).not.toBeNull();
    expect((await h.store.audit.listByOrganization(accountant.personalId, 100)).map((e) => e.action)).toContain('accountant.customer_expired');

    // The hourly purge deletes it (profiles and grant with it); the paid one stays.
    const purged = await read(await h.app.request(PURGE, { method: 'POST', headers: JOB }));
    expect(purged.purged).toBe(1);
    expect(await h.store.users.getById(unpaid.userId)).toBeNull();
    expect(await h.store.accountantGrants.findActive(accountant.userId, unpaid.profileId)).toBeNull();
    expect(await h.store.users.getById(paid.userId)).not.toBeNull();
    const list = await read(await h.app.request(CUSTOMERS, { headers: accountant.auth }));
    expect(list.items.map((r: { userId: string }) => r.userId)).toEqual([paid.userId]);
  });

  it('never removes an account claimed meanwhile', async () => {
    const h = accountantHarness({ accountantProvisioning: true });
    const t0 = h.now().getTime();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    await h.store.users.setPassword(c.userId, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', h.now());
    at(h, 61, t0);
    expect(await read(await sweep(h))).toMatchObject({ looked: 0, removed: 0 });
    expect((await h.store.users.getById(c.userId))?.closure).toBeNull();
    expect(await h.store.provision.expireUnclaimed({ userId: c.userId, provisionedBefore: h.now(), at: h.now(), audit: [] })).toBe(false);
  });

  it('needs the job token, and answers 404 while the feature is off', async () => {
    const h = accountantHarness({ accountantProvisioning: true });
    expect((await h.app.request(SWEEP, { method: 'POST' })).status).toBe(401);
    const off = accountantHarness({ accountantProvisioning: false });
    expect((await off.app.request(SWEEP, { method: 'POST', headers: JOB })).status).toBe(404);
  });
});
