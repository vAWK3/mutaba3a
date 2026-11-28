import { describe, expect, it } from 'vitest';
import { CURRENT_TERMS } from '../legal.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { DAY, SAME_ORIGIN, accountantHarness, idem, json, person, read, type AccountantHarness, type Person } from './helpers/accountants.js';
import { OK_ONLY } from './helpers/operator-harness.js';

/**
 * MUT-765 (accountant channel, epic MUT-762; eng T4, CEO ACCT-6 and ACCT-10, R6): the claim step and the accountant's
 * setup actions. A provisioned link needs the six-digit code the accountant said (five wrong tries lock it); the
 * accountant can send a fresh link and code or change the address while the customer has not claimed, at most five a
 * day; after the claim only his read grant remains. Operator links and recovery are unchanged, and recovery never
 * hands out a code-less link for an unclaimed provisioned account.
 */
const CUSTOMERS = '/v1/accountant/customers';
const PASSWORD = 'a-long-enough-password';
const generous = () => new SlidingWindowRateLimiter(1000);

function harness() {
  return accountantHarness({
    accountantProvisioning: true,
    signInIpLimiter: generous(),
    selfService: { signupEnabled: true, turnstile: OK_ONLY, ipLimiter: generous(), addressMinuteLimiter: generous(), addressDayLimiter: generous(), floors: { signupMs: 1, recoveryMs: 1 } },
  });
}

async function approved(h: AccountantHarness): Promise<Person> {
  const accountant = await person(h, { sharing: false, displayName: 'Hadi Khatib' });
  await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
  return accountant;
}

const tokenIn = (text: string) => /setup#([A-Za-z0-9_-]{43})/.exec(text)![1]!;
const lastToken = (h: AccountantHarness, to: string) => tokenIn(h.transport.list({ to }).filter((m) => m.template === 'customer-setup').at(-1)!.text);

/** A customer created by `accountant`: their id, address, profile, the claim code and the mailed token. */
async function customer(h: AccountantHarness, accountant: Person) {
  const email = `owner${Math.random().toString(36).slice(2, 8)}@cafe-nour.ps`;
  const res = await h.app.request(CUSTOMERS, json({ email, displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, { ...accountant.auth, ...idem() }));
  expect(res.status).toBe(201);
  const out = await read(res);
  return { userId: out.customer.userId as string, email, profileId: out.profile.id as string, code: out.claimCode as string, token: lastToken(h, email) };
}

const check = (h: AccountantHarness, token: string) => h.app.request('/v1/account-setup/check', json({ token }, SAME_ORIGIN));
const tryCode = (h: AccountantHarness, token: string, claimCode: string) => h.app.request('/v1/account-setup/claim-code', json({ token, claimCode }, SAME_ORIGIN));
const redeem = (h: AccountantHarness, token: string, extra: Record<string, unknown> = {}) =>
  h.app.request('/v1/account-setup', json({ token, password: PASSWORD, acceptedTermsVersion: CURRENT_TERMS.version, ...extra }, SAME_ORIGIN));
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
const reissue = (h: AccountantHarness, who: Person, userId: string, key = idem()) => h.app.request(`${CUSTOMERS}/${userId}/link`, json({}, { ...who.auth, ...key }));
const changeEmail = (h: AccountantHarness, who: Person, userId: string, email: string) => h.app.request(`${CUSTOMERS}/${userId}/email`, json({ email }, { ...who.auth, ...idem() }, 'PUT'));

describe('the claim step (MUT-765)', () => {
  it('names the accountant and the business on the check, and asks for the code', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    const out = await read(await check(h, c.token));
    expect(out).toMatchObject({ state: 'valid', email: c.email, claim: { accountantName: 'Hadi Khatib', businessName: 'Café Nour', codeLocked: false } });
  });

  it('mails the link naming the accountant and the business, never the code', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    const [mail] = h.transport.list({ to: c.email });
    expect(mail).toMatchObject({ template: 'customer-setup', locale: 'en' });
    expect(mail!.subject).toBe('Hadi Khatib set up “Café Nour” for you on MTB3A');
    expect(mail!.text).not.toContain(c.code);
    expect((await h.store.provision.setupLinkOf(c.userId))?.mailStatus).toBe('SENT');
  });

  it('accepts the right code (spaces ignored) and refuses a redeem without it', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    expect((await tryCode(h, c.token, `${c.code.slice(0, 3)} ${c.code.slice(3)}`)).status).toBe(200);
    const missing = await redeem(h, c.token);
    expect(missing.status).toBe(422);
    expect((await read(missing)).error.details.fields).toEqual(['claimCode']);
    expect((await h.store.users.getById(c.userId))?.passwordHash).toBeNull();
  });

  it('claims with the code: password set, address verified, audited on the business profile, setup actions closed', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    const res = await redeem(h, c.token, { claimCode: c.code });
    expect(res.status).toBe(200);
    const user = await h.store.users.getById(c.userId);
    expect(user?.passwordHash).not.toBeNull();
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect((await h.store.audit.listByOrganization(c.profileId, 50)).map((e) => e.action)).toContain('accountant.customer_claimed');
    // ACCT-10: only the read grant remains.
    const after = await reissue(h, accountant, c.userId);
    expect(after.status).toBe(403);
    expect((await read(after)).error.code).toBe('CUSTOMER_CLAIMED');
    expect((await h.store.accountantGrants.findActive(accountant.userId, c.profileId))?.status).toBe('ACTIVE');
    // MUT-771 (plan T9): his read access still works after the claim: the business is on his desk, shared and active.
    const desk = await read(await h.app.request('/v1/clients', { headers: accountant.auth }));
    expect(desk.items.map((row: { profileId: string; status: string }) => [row.profileId, row.status])).toContainEqual([c.profileId, 'active']);
    // The used link is dead.
    expect((await redeem(h, c.token, { claimCode: c.code })).status).toBe(410);
  });

  it('counts wrong codes, then locks on the fifth, even against the right code', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    for (let left = 4; left >= 1; left--) {
      const res = await tryCode(h, c.token, wrong(c.code));
      expect(res.status).toBe(403);
      expect((await read(res)).error).toMatchObject({ code: 'CLAIM_CODE_WRONG', details: { triesLeft: left } });
    }
    const fifth = await redeem(h, c.token, { claimCode: wrong(c.code) });
    expect((await read(fifth)).error.code).toBe('CLAIM_CODE_LOCKED');
    expect((await read(await tryCode(h, c.token, c.code))).error.code).toBe('CLAIM_CODE_LOCKED');
    expect((await read(await redeem(h, c.token, { claimCode: c.code }))).error.code).toBe('CLAIM_CODE_LOCKED');
    expect((await read(await check(h, c.token))).claim.codeLocked).toBe(true);
    expect((await h.store.users.getById(c.userId))?.passwordHash).toBeNull();
  });

  it('refuses an expired link (14 days)', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    h.setNow(new Date(h.now().getTime() + 14 * DAY + 1000));
    expect((await read(await check(h, c.token))).state).toBe('expired');
    expect((await redeem(h, c.token, { claimCode: c.code })).status).toBe(410);
  });

  it('MUT-769: a dead provisioned link says it was an accountant’s (ask him), to its holder only; an operator link does not', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    await reissue(h, accountant, c.userId);
    expect(await read(await check(h, c.token))).toEqual({ state: 'superseded', purpose: 'SETUP', provisioned: true });
    h.setNow(new Date(h.now().getTime() + 14 * DAY + 1000));
    expect(await read(await check(h, lastToken(h, c.email)))).toEqual({ state: 'expired', purpose: 'SETUP', provisioned: true });
    // An unknown token names nothing.
    expect(await read(await check(h, 'A'.repeat(43)))).toEqual({ state: 'invalid' });

    const plain = await person(h, { sharing: false });
    const issued = await h.app.request(`/admin/v1/users/${plain.userId}/setup-link`, json({ validHours: 1 }, { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' }));
    const token = tokenIn((await read(issued)).setupLink.url);
    h.setNow(new Date(h.now().getTime() + 2 * 60 * 60 * 1000));
    expect(await read(await check(h, token))).toEqual({ state: 'expired', purpose: 'RESET' });
  });

  it('leaves an operator link without a code (409 NO_CLAIM_CODE on the code route)', async () => {
    const h = harness();
    const plain = await person(h, { sharing: false });
    const issued = await h.app.request(`/admin/v1/users/${plain.userId}/setup-link`, json({}, { 'x-admin-token': 'test-admin-token-with-at-least-32-characters' }));
    expect(issued.status).toBe(200);
    const token = tokenIn((await read(issued)).setupLink.url);
    expect((await read(await check(h, token))).claim).toBeUndefined();
    expect((await read(await tryCode(h, token, '123456'))).error.details.reason).toBe('NO_CLAIM_CODE');
    expect((await redeem(h, token)).status).toBe(200);
  });

  it('never mails a code-less recovery link for an unclaimed provisioned account, and keeps the accountant’s link', async () => {
    const h = harness();
    const c = await customer(h, await approved(h));
    const res = await h.app.request('/v1/account-recovery', json({ email: c.email, turnstileToken: 'ok' }, SAME_ORIGIN));
    expect(res.status).toBe(202);
    expect(h.transport.list({ to: c.email }).map((m) => m.template)).toEqual(['customer-setup']);
    expect((await read(await check(h, c.token))).state).toBe('valid');
  });
});

describe('the accountant’s setup actions (MUT-765)', () => {
  it('sends a fresh link and code: the old ones die, the new code is in the first answer only', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    const key = idem();
    const res = await reissue(h, accountant, c.userId, key);
    expect(res.status).toBe(200);
    const out = await read(res);
    expect(out).toMatchObject({ email: c.email, mailSent: true });
    expect(out.claimCode).toMatch(/^\d{6}$/);
    const fresh = lastToken(h, c.email);
    expect(fresh).not.toBe(c.token);
    expect((await read(await check(h, c.token))).state).toBe('superseded');
    // The old code does not open the new link unless it happens to be the same digits.
    if (out.claimCode !== c.code) expect((await tryCode(h, fresh, c.code)).status).toBe(403);
    expect((await tryCode(h, fresh, out.claimCode)).status).toBe(200);

    const replay = await reissue(h, accountant, c.userId, key);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect((await read(replay)).claimCode).toBeUndefined();
    expect(h.transport.list({ to: c.email }).filter((m) => m.template === 'customer-setup')).toHaveLength(2);
    expect((await h.store.audit.listByOrganization(c.profileId, 50)).map((e) => e.action)).toContain('accountant.customer_link_reissued');
  });

  it('unlocks a locked code by a fresh one', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    for (let i = 0; i < 5; i++) await tryCode(h, c.token, wrong(c.code));
    const out = await read(await reissue(h, accountant, c.userId));
    expect((await redeem(h, lastToken(h, c.email), { claimCode: out.claimCode })).status).toBe(200);
  });

  it('allows five fresh links a day per customer, then 429 until the next UTC day', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    h.setNow(new Date(h.now().getTime() + 1000));
    for (let i = 0; i < 5; i++) expect((await reissue(h, accountant, c.userId)).status).toBe(200);
    const sixth = await reissue(h, accountant, c.userId);
    expect(sixth.status).toBe(429);
    expect((await read(sixth)).error.details).toMatchObject({ limit: 'REISSUE_PER_DAY', max: 5 });
    expect(sixth.headers.get('retry-after')).toBeTruthy();
    h.setNow(new Date(h.now().getTime() + DAY));
    expect((await reissue(h, accountant, c.userId)).status).toBe(200);
  });

  it('changes the address: the old link and code die, the old address is told, the new one gets a fresh link', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    const res = await changeEmail(h, accountant, c.userId, 'Fixed@Cafe-Nour.ps');
    expect(res.status).toBe(200);
    const out = await read(res);
    expect(out.email).toBe('fixed@cafe-nour.ps');
    expect((await read(await check(h, c.token))).state).toBe('superseded');
    expect(h.transport.list({ to: c.email }).map((m) => m.template)).toEqual(['customer-setup', 'customer-setup-cancelled']);
    const fresh = lastToken(h, 'fixed@cafe-nour.ps');
    expect((await redeem(h, fresh, { claimCode: out.claimCode })).status).toBe(200);
    expect((await h.store.users.getById(c.userId))?.email).toBe('fixed@cafe-nour.ps');
    expect((await h.store.audit.listByOrganization(c.profileId, 50)).map((e) => e.action)).toContain('accountant.customer_email_changed');
  });

  it('refuses an address another account holds, and a throwaway one', async () => {
    const h = harness();
    const accountant = await approved(h);
    const c = await customer(h, accountant);
    const taken = await changeEmail(h, accountant, c.userId, accountant.email);
    expect(taken.status).toBe(409);
    expect((await read(taken)).error.details.reason).toBe('EMAIL_TAKEN');
    const throwaway = await changeEmail(h, accountant, c.userId, 'x@mailinator.com');
    expect(throwaway.status).toBe(422);
    expect((await read(await check(h, c.token))).state).toBe('valid');
  });

  it('is 404 for another accountant’s customer and for an unknown id; 403 when not approved', async () => {
    const h = harness();
    const a = await approved(h);
    const b = await approved(h);
    const c = await customer(h, a);
    expect((await reissue(h, b, c.userId)).status).toBe(404);
    expect((await changeEmail(h, b, c.userId, 'other@cafe-nour.ps')).status).toBe(404);
    expect((await reissue(h, a, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    await h.store.provision.setApproval({ userId: a.userId, enabled: false, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
    expect((await read(await reissue(h, a, c.userId))).error.code).toBe('ACCOUNTANT_NOT_APPROVED');
  });

  it('lists the accountant’s customers with their state, newest first, paged', async () => {
    const h = harness();
    const accountant = await approved(h);
    const first = await customer(h, accountant);
    h.setNow(new Date(h.now().getTime() + 60_000));
    const second = await customer(h, accountant);
    h.setNow(new Date(h.now().getTime() + 60_000));
    const third = await customer(h, accountant);
    await redeem(h, first.token, { claimCode: first.code });
    for (let i = 0; i < 5; i++) await tryCode(h, second.token, wrong(second.code));

    const page = await read(await h.app.request(`${CUSTOMERS}?limit=2`, { headers: accountant.auth }));
    expect(page.items.map((r: { userId: string }) => r.userId)).toEqual([third.userId, second.userId]);
    expect(page.items.map((r: { state: string }) => r.state)).toEqual(['awaiting_claim', 'code_locked']);
    expect(page.items[0]).toMatchObject({ profile: { id: third.profileId, name: 'Café Nour' }, link: { mailStatus: 'SENT' } });
    const rest = await read(await h.app.request(`${CUSTOMERS}?limit=2&before=${encodeURIComponent(page.nextBefore)}`, { headers: accountant.auth }));
    expect(rest.items).toHaveLength(1);
    expect(rest.items[0]).toMatchObject({ userId: first.userId, state: 'claimed', link: null });
    expect(rest.nextBefore).toBeNull();

    h.setNow(new Date(h.now().getTime() + 15 * DAY));
    const later = await read(await h.app.request(CUSTOMERS, { headers: accountant.auth }));
    expect(later.items.find((r: { userId: string }) => r.userId === third.userId).state).toBe('link_expired');
    // Another accountant sees none of them.
    const other = await approved(h);
    expect((await read(await h.app.request(CUSTOMERS, { headers: other.auth }))).items).toEqual([]);
  });

  it('answers 404 on every setup route while the feature is off', async () => {
    const h = accountantHarness({ accountantProvisioning: false });
    const accountant = await approved(h);
    expect((await h.app.request(CUSTOMERS, { headers: accountant.auth })).status).toBe(404);
    expect((await reissue(h, accountant, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await changeEmail(h, accountant, '00000000-0000-4000-8000-000000000000', 'a@cafe-nour.ps')).status).toBe(404);
  });
});
