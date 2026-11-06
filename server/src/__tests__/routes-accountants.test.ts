import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_INVITE_TTL_MS, ACCOUNTANTS_PER_PROFILE_DEFAULT } from '../accountants/grants.js';
import {
  ADMIN,
  DAY,
  JOB,
  SAME_ORIGIN,
  T0,
  acceptInvite,
  accountantHarness,
  businessOf,
  expenseOn,
  idem,
  inviteAccountant,
  inviteTokenFor,
  json,
  person,
  read,
  shared,
  signedIn,
  signupFromInvite,
  type AccountantHarness,
  type Loose,
  type Person,
} from './helpers/accountants.js';

/**
 * MUT-559 (ADR-245): an owner invites an accountant to one profile; the accountant reads it, nothing more, until the
 * owner revokes or the accountant leaves. Through the real app: invites, the accept rule (D4), signup from an invite,
 * isolation from everything else, the lapse gate, account closure, the audit and the dark-launch switch.
 */
const hour = 3_600_000;
const later = (h: AccountantHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));
const me = async (h: AccountantHarness, p: Person) => read(await h.app.request('/v1/me', { headers: p.auth }));
const listOf = async (h: AccountantHarness, owner: Person, profileId: string) => read(await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: owner.auth }));
const auditOf = async (h: AccountantHarness, profileId: string) => (await h.store.audit.listByOrganization(profileId, 200)).filter((e) => e.action.startsWith('accountant.'));

async function ownerWithProfile(h: AccountantHarness) {
  const owner = await person(h, { displayName: 'Basel Sader' });
  const profileId = await businessOf(h, owner, 'Sader Studio');
  return { owner, profileId };
}

describe('the owner invites (MUT-559)', () => {
  it('creates a pending grant, lists it, and mails the invite in English and Arabic with the token in the fragment', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const res = await inviteAccountant(h, owner, profileId, '  Hadi@Books.PS ');
    expect(res.status).toBe(201);
    const grant = await read(res);
    expect(grant).toMatchObject({ email: 'hadi@books.ps', status: 'pending', name: null, acceptedAt: null, lastViewedAt: null });
    expect(new Date(grant.expiresAt).getTime()).toBe(T0.getTime() + ACCOUNTANT_INVITE_TTL_MS);
    expect((await listOf(h, owner, profileId)).items).toEqual([grant]);

    const [mail] = h.transport.list({ to: 'hadi@books.ps' });
    expect(mail).toMatchObject({ template: 'accountant-invite', locale: 'en' });
    expect(mail!.text).toContain('Basel Sader');
    expect(mail!.text).toContain('Sader Studio');
    expect(mail!.text).toMatch(/http:\/\/localhost\/accountant-invite#[A-Za-z0-9_-]{43}/);
    expect(mail!.text).not.toMatch(/accountant-invite\?/);

    expect((await inviteAccountant(h, owner, profileId, 'rana@books.ps', 'ar')).status).toBe(201);
    const [ar] = h.transport.list({ to: 'rana@books.ps' });
    expect(ar).toMatchObject({ template: 'accountant-invite', locale: 'ar' });
    expect(ar!.subject).toMatch(/[؀-ۿ]/);
  });

  it('refuses a second invite to the same address (409 ALREADY_INVITED), past the cap (409 ACCOUNTANT_LIMIT), and yourself (422 SELF_INVITE)', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    expect((await inviteAccountant(h, owner, profileId, 'hadi@books.ps')).status).toBe(201);
    const dup = await inviteAccountant(h, owner, profileId, 'HADI@books.ps');
    expect(dup.status).toBe(409);
    expect((await read(dup)).error.details).toEqual({ reason: 'ALREADY_INVITED' });

    for (let i = 1; i < ACCOUNTANTS_PER_PROFILE_DEFAULT; i++) expect((await inviteAccountant(h, owner, profileId, `a${i}@books.ps`)).status).toBe(201);
    const capped = await inviteAccountant(h, owner, profileId, 'one-more@books.ps');
    expect(capped.status).toBe(409);
    expect((await read(capped)).error.details).toEqual({ reason: 'ACCOUNTANT_LIMIT', limit: ACCOUNTANTS_PER_PROFILE_DEFAULT });

    const self = await inviteAccountant(h, owner, profileId, owner.email.toUpperCase());
    expect(self.status).toBe(422);
    expect((await read(self)).error.details).toEqual({ reason: 'SELF_INVITE' });
    const bad = await inviteAccountant(h, owner, profileId, 'not-an-address');
    expect(bad.status).toBe(422);
  });

  it('only an owner invites: a stranger gets 404, a firm member who doesn’t own it 403 NOT_OWNER', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const stranger = await person(h);
    expect((await inviteAccountant(h, stranger, profileId, 'x@books.ps')).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: stranger.auth })).status).toBe(404);

    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    expect((await h.app.request(`/admin/v1/users/${owner.userId}/memberships`, json({ organizationId: firm.id }, ADMIN))).status).toBe(201);
    const refused = await inviteAccountant(h, owner, firm.id, 'x@books.ps');
    expect(refused.status).toBe(403);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'NOT_OWNER' });
  });

  it('rate-limits invites per person', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    let last = 0;
    for (let i = 0; i < 40 && last !== 429; i++) {
      const res = await inviteAccountant(h, owner, profileId, owner.email);
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('a 14-day-old invite is expired: listed as such, refused on accept (404), and replaceable by a new one', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await person(h);
    await inviteAccountant(h, owner, profileId, acc.email);
    const token = inviteTokenFor(h, acc.email);
    later(h, 14 * DAY + 1000);
    expect((await listOf(h, owner, profileId)).items.map((g: Loose) => g.status)).toEqual(['expired']);
    const check = await read(await h.app.request('/v1/accountant-invites/check', json({ token }, SAME_ORIGIN)));
    expect(check.expired).toBe(true);
    expect((await acceptInvite(h, acc, token)).status).toBe(404);
    expect((await inviteAccountant(h, owner, profileId, acc.email)).status).toBe(201);
    expect((await acceptInvite(h, acc, inviteTokenFor(h, acc.email))).status).toBe(200);
  });

  it('revoking ends the accountant’s next request (404 PROFILE_NOT_FOUND), and hides the grant from the list', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(profileId) })).status).toBe(200);
    const [grant] = (await listOf(h, owner, profileId)).items;
    expect(grant).toMatchObject({ status: 'active', email: acc.email, name: 'Hadi Accountant' });

    expect((await h.app.request(`/v1/profiles/${profileId}/accountants/${grant.id}`, { method: 'DELETE', headers: owner.auth })).status).toBe(204);
    const after = await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(after.status).toBe(404);
    expect((await read(after)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });
    expect((await listOf(h, owner, profileId)).items).toEqual([]);
    expect((await h.app.request(`/v1/profiles/${profileId}/accountants/${grant.id}`, { method: 'DELETE', headers: owner.auth })).status).toBe(404);
    expect((await me(h, acc)).clients).toEqual([]);
  });

  it('the accountant leaves: gone from /v1/me clients, and the profile answers 404', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    expect((await me(h, acc)).clients).toEqual([{ profileId, name: 'Sader Studio', ownerName: 'Basel Sader', sharedSince: T0.toISOString() }]);
    expect((await h.app.request(`/v1/clients/${profileId}`, { method: 'DELETE', headers: acc.auth })).status).toBe(204);
    expect((await me(h, acc)).clients).toEqual([]);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(profileId) })).status).toBe(404);
    expect((await h.app.request(`/v1/clients/${profileId}`, { method: 'DELETE', headers: acc.auth })).status).toBe(404);
  });
});

describe('who may accept (MUT-559 D4)', () => {
  async function invitedAs(inviteEmail: string, acceptorEmail: string) {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    expect((await inviteAccountant(h, owner, profileId, inviteEmail)).status).toBe(201);
    const acceptor = await person(h, { email: acceptorEmail });
    const res = await acceptInvite(h, acceptor, inviteTokenFor(h, inviteEmail));
    return { h, owner, profileId, acceptor, res };
  }

  it('the exact address → ACTIVE, and the response names the client', async () => {
    const { res, profileId } = await invitedAs('hadi@books.ps', 'hadi@books.ps');
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ profileId, name: 'Sader Studio', ownerName: 'Basel Sader', sharedSince: T0.toISOString() });
  });

  it('a colleague on the same professional domain → ACTIVE', async () => {
    const { res } = await invitedAs('a@firm.com', 'b@firm.com');
    expect(res.status).toBe(200);
  });

  it.each([
    ['the same free-webmail domain', 'a.accountant@gmail.com', 'b.accountant@gmail.com'],
    ['a subdomain', 'a@firm.com', 'b@mail.firm.com'],
    ['a different domain', 'a@firm.com', 'a@other.com'],
  ])('%s → 403 INVITE_EMAIL_MISMATCH with the invite address masked', async (_label, invited, acceptor) => {
    const { res, h, acceptor: p, profileId } = await invitedAs(invited, acceptor);
    expect(res.status).toBe(403);
    const body = await read(res);
    expect(body.error.code).toBe('INVITE_EMAIL_MISMATCH');
    expect(body.error.details.maskedEmail).not.toBe(invited);
    expect(body.error.details.maskedEmail).toMatch(/\*/);
    expect((await h.app.request('/v1/expenses', { headers: p.on(profileId) })).status).toBe(404);
  });

  it('two accepts at once: one ACTIVE, the other 404', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await person(h, { email: 'hadi@books.ps' });
    await inviteAccountant(h, owner, profileId, acc.email);
    const token = inviteTokenFor(h, acc.email);
    const other = await signedIn(h, acc.email, acc.password, acc.userId, acc.personalId);
    const results = await Promise.all([acceptInvite(h, acc, token), acceptInvite(h, other, token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect((await me(h, acc)).clients).toHaveLength(1);
  });

  it('someone who already belongs to the profile gets 409, and a used token 404', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const coOwner = await person(h);
    expect((await h.app.request(`/admin/v1/users/${coOwner.userId}/memberships`, json({ organizationId: profileId, role: 'OWNER' }, ADMIN))).status).toBe(201);
    await inviteAccountant(h, owner, profileId, coOwner.email);
    const res = await acceptInvite(h, coOwner, inviteTokenFor(h, coOwner.email));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'ALREADY_HAS_ACCESS' });

    const acc = await shared(h, owner, profileId);
    const used = await acceptInvite(h, acc, inviteTokenFor(h, acc.email));
    expect(used.status).toBe(404);
  });

  it('check answers the same 404 for unknown, used and revoked tokens, and never takes the token in a path', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await inviteAccountant(h, owner, profileId, 'hadi@books.ps');
    const token = inviteTokenFor(h, 'hadi@books.ps');
    const ok = await h.app.request('/v1/accountant-invites/check', json({ token }, SAME_ORIGIN));
    expect(ok.status).toBe(200);
    expect(await read(ok)).toMatchObject({ profileName: 'Sader Studio', ownerName: 'Basel Sader', expired: false });
    expect((await read(await h.app.request('/v1/accountant-invites/check', json({ token }, SAME_ORIGIN)))).maskedEmail).toMatch(/^h\*+@books\.ps$/);

    const unknown = await h.app.request('/v1/accountant-invites/check', json({ token: 'A'.repeat(43) }, SAME_ORIGIN));
    const [grant] = (await listOf(h, owner, profileId)).items;
    await h.app.request(`/v1/profiles/${profileId}/accountants/${grant.id}`, { method: 'DELETE', headers: owner.auth });
    const revoked = await h.app.request('/v1/accountant-invites/check', json({ token }, SAME_ORIGIN));
    expect(unknown.status).toBe(404);
    expect(revoked.status).toBe(404);
    expect((await read(unknown)).error.message).toBe((await read(revoked)).error.message);

    const doc = await read(await h.app.request('/openapi.json'));
    const paths = Object.keys(doc.paths).filter((p) => p.includes('accountant') || p.includes('clients'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => /\{token\}/i.test(p))).toEqual([]);
  });
});

describe('signing up from an invite (MUT-559)', () => {
  it('creates an ACTIVE account with no signup review, its personal profile, and an ACTIVE grant', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await inviteAccountant(h, owner, profileId, 'new.accountant@gmail.com', 'ar');
    const res = await signupFromInvite(h, inviteTokenFor(h, 'new.accountant@gmail.com'));
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body).toMatchObject({ email: 'new.accountant@gmail.com', status: 'ACTIVE', client: { profileId, name: 'Sader Studio', ownerName: 'Basel Sader' } });

    const user = (await h.store.users.findByEmail('new.accountant@gmail.com'))!;
    expect(user).toMatchObject({ status: 'ACTIVE', locale: 'ar' });
    expect(await h.store.signupReviews.findByUser(user.id)).toBeNull();
    const memberships = await h.store.memberships.listByUser(user.id);
    expect(memberships).toHaveLength(1);
    const personal = (await h.store.organizations.getById(memberships[0]!.organizationId))!;
    expect(personal.personalOwnerUserId).toBe(user.id);
    // The new account signs in like any other and reads the client.
    const acc = await signedIn(h, user.email, 'a-long-enough-password', user.id, personal.id);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(profileId) })).status).toBe(200);
    expect((await read(await h.app.request('/v1/me', { headers: acc.auth }))).profiles.map((p: Loose) => p.id)).toEqual([personal.id]);
  });

  it('refuses an address that already has an account (409 ACCOUNT_EXISTS) and leaves the invite pending', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const existing = await person(h);
    await inviteAccountant(h, owner, profileId, existing.email);
    const res = await signupFromInvite(h, inviteTokenFor(h, existing.email));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toEqual({ reason: 'ACCOUNT_EXISTS' });
    expect((await listOf(h, owner, profileId)).items.map((g: Loose) => g.status)).toEqual(['pending']);
  });

  it('refuses a stale terms version and an unknown token', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await inviteAccountant(h, owner, profileId, 'n@books.ps');
    expect((await signupFromInvite(h, inviteTokenFor(h, 'n@books.ps'), { acceptedTermsVersion: '1999-01-01' })).status).toBe(409);
    expect((await signupFromInvite(h, 'B'.repeat(43))).status).toBe(404);
  });
});

describe('isolation (MUT-559)', () => {
  it('an accountant reaches only the shared profile: another of the owner’s is 404, and their feed, verdict and profile reads never include it', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const other = await businessOf(h, owner, 'Other Studio');
    await expenseOn(h, owner, profileId, 'Shared paper');
    await expenseOn(h, owner, other, 'Private rent');
    const acc = await shared(h, owner, profileId);
    await expenseOn(h, acc, acc.personalId, 'My own lunch');

    const otherRes = await h.app.request('/v1/expenses', { headers: acc.on(other) });
    expect(otherRes.status).toBe(404);
    expect((await read(otherRes)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });

    const sharedRead = await read(await h.app.request('/v1/expenses', { headers: acc.on(profileId) }));
    expect(sharedRead.items.map((e: Loose) => e.title)).toEqual(['Shared paper']);

    const feed = await read(await h.app.request('/v1/entries', { headers: acc.auth }));
    expect(JSON.stringify(feed)).not.toContain('Shared paper');
    expect(JSON.stringify(feed)).toContain('My own lunch');
    const verdict = await h.app.request('/v1/summaries/verdict', { headers: acc.auth });
    expect(verdict.status).toBe(200);
    expect(JSON.stringify(await read(verdict))).not.toContain(profileId);

    const profiles = (await me(h, acc)).profiles.map((p: Loose) => p.id);
    expect(profiles).toEqual([acc.personalId]);
    expect((await h.app.request(`/v1/profiles/${profileId}`, json({ name: 'Mine now' }, { ...acc.auth, 'if-match': '1' }, 'PATCH'))).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${profileId}/type-change?to=PERSONAL`, { headers: acc.auth })).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: acc.auth })).status).toBe(404);
  });

  it('an accountant can’t write the shared profile: 403 READ_ONLY_PROFILE, ACCOUNTANT_READ_ONLY', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    const res = await h.app.request('/v1/expenses', json({ amount: '1.00', currency: 'ILS', occurredOn: '2026-11-01' }, { ...acc.on(profileId), ...idem() }));
    expect(res.status).toBe(403);
    expect((await read(res)).error).toMatchObject({ code: 'READ_ONLY_PROFILE', details: { reason: 'ACCOUNTANT_READ_ONLY' } });
  });
});

describe('personal profiles (MUT-559 amends MUT-120 decision 3)', () => {
  it('an owner may share their built-in personal profile; the operator’s co-owner grant there is still 409 PERSONAL_PROFILE', async () => {
    const h = accountantHarness();
    const owner = await person(h, { displayName: 'Basel Sader' });
    const acc = await person(h);
    expect((await inviteAccountant(h, owner, owner.personalId, acc.email)).status).toBe(201);
    expect((await acceptInvite(h, acc, inviteTokenFor(h, acc.email))).status).toBe(200);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(owner.personalId) })).status).toBe(200);

    const grant = await h.app.request(`/admin/v1/users/${acc.userId}/memberships`, json({ organizationId: owner.personalId, role: 'OWNER' }, ADMIN));
    expect(grant.status).toBe(409);
    expect((await read(grant)).error.details.reason).toBe('PERSONAL_PROFILE');
  });
});

describe('the lapse gate (MUT-559)', () => {
  async function lapsed(trialDaysAgo: number) {
    const h = accountantHarness({ billingGate: true });
    const owner = await person(h, { displayName: 'Basel Sader' });
    const acc = await person(h);
    // Shared while the owner's trial runs, then the trial is moved back so the profile has lapsed.
    await h.store.billing.setTrialStart(owner.userId, new Date(T0.getTime() - 3 * DAY));
    await h.store.billing.setTrialStart(acc.userId, new Date(T0.getTime() - 3 * DAY));
    await shared(h, owner, owner.personalId, acc);
    await h.store.billing.setTrialStart(owner.userId, new Date(T0.getTime() - trialDaysAgo * DAY));
    return { h, owner, acc };
  }

  it('owner READ_ONLY: the accountant reads; a write is refused', async () => {
    const { h, owner, acc } = await lapsed(20);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(owner.personalId) })).status).toBe(200);
    expect((await h.app.request('/v1/expenses', json({ amount: '1.00', currency: 'ILS', occurredOn: '2026-11-01' }, { ...acc.on(owner.personalId), ...idem() }))).status).toBe(403);
  });

  it('owner LOCKED: the accountant still reads (gated as read-only), and a write is 403', async () => {
    const { h, owner, acc } = await lapsed(40);
    // The owner is locked out of their own reads...
    expect((await h.app.request('/v1/expenses', { headers: owner.on(owner.personalId) })).status).toBe(402);
    // ...the accountant keeps read.
    expect((await h.app.request('/v1/expenses', { headers: acc.on(owner.personalId) })).status).toBe(200);
    const write = await h.app.request('/v1/expenses', json({ amount: '1.00', currency: 'ILS', occurredOn: '2026-11-01' }, { ...acc.on(owner.personalId), ...idem() }));
    expect(write.status).toBe(403);
    expect((await read(write)).error.details).toEqual({ reason: 'ACCOUNTANT_READ_ONLY' });
  });
});

describe('closing an account (MUT-559)', () => {
  async function purge(h: AccountantHarness, p: Person) {
    expect((await h.app.request('/v1/me/closure', json({ password: p.password }, p.auth))).status).toBe(200);
    later(h, 30 * DAY + 60_000);
    const res = await h.app.request('/jobs/v1/accounts/purge', { method: 'POST', headers: JOB });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ purged: 1, failed: 0 });
  }

  it('the owner’s purge removes their profile’s grants and is never blocked by them', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const acc = await shared(h, owner, owner.personalId);
    await inviteAccountant(h, owner, owner.personalId, 'pending@books.ps');
    await purge(h, owner);
    expect(await h.store.accountantGrants.listActiveByAccountant(acc.userId)).toEqual([]);
    expect((await me(h, acc)).clients).toEqual([]);
  });

  it('the accountant’s purge removes their grants; the owner’s profile stays', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    await purge(h, acc);
    expect((await listOf(h, owner, profileId)).items).toEqual([]);
    expect(await h.store.organizations.getById(profileId)).not.toBeNull();
  });
});

describe('the audit and last viewed (MUT-559)', () => {
  it('writes invited, accepted, revoked and left rows on the profile', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    expect((await h.app.request(`/v1/clients/${profileId}`, { method: 'DELETE', headers: acc.auth })).status).toBe(204);
    await inviteAccountant(h, owner, profileId, 'later@books.ps');
    const [pending] = (await listOf(h, owner, profileId)).items;
    await h.app.request(`/v1/profiles/${profileId}/accountants/${pending.id}`, { method: 'DELETE', headers: owner.auth });
    const actions = (await auditOf(h, profileId)).map((e) => e.action);
    for (const action of ['accountant.invited', 'accountant.accepted', 'accountant.left', 'accountant.revoked']) expect(actions).toContain(action);
    // No address or name in the audit metadata.
    for (const e of await auditOf(h, profileId)) expect(JSON.stringify(e.metadata ?? {})).not.toMatch(/@/);
  });

  it('stamps lastViewedAt at most once an hour, and writes accountant.viewed at most once a UTC day', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    const viewedAt = async () => (await listOf(h, owner, profileId)).items[0].lastViewedAt;
    const viewed = async () => (await auditOf(h, profileId)).filter((e) => e.action === 'accountant.viewed').length;

    await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(await viewedAt()).toBe(T0.toISOString());
    later(h, 20 * 60_000);
    await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(await viewedAt()).toBe(T0.toISOString());
    later(h, hour);
    await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(await viewedAt()).toBe(h.now().toISOString());
    expect(await viewed()).toBe(1);
    later(h, DAY);
    await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(await viewed()).toBe(2);
  });
});

describe('the dark-launch switch (MUT-559)', () => {
  it('off: every new route answers 404, /v1/me has no clients, and a grant opens nothing', async () => {
    const on = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(on);
    const acc = await shared(on, owner, profileId);
    expect((await me(on, acc)).clients).toHaveLength(1);

    const off = accountantHarness({ accountantAccess: false });
    const o = await person(off);
    expect((await inviteAccountant(off, o, o.personalId, 'x@books.ps')).status).toBe(404);
    expect((await off.app.request(`/v1/profiles/${o.personalId}/accountants`, { headers: o.auth })).status).toBe(404);
    expect((await off.app.request(`/v1/profiles/${o.personalId}/accountants/00000000-0000-4000-8000-000000000001`, { method: 'DELETE', headers: o.auth })).status).toBe(404);
    expect((await off.app.request('/v1/accountant-invites/check', json({ token: 'A'.repeat(43) }, SAME_ORIGIN))).status).toBe(404);
    expect((await off.app.request('/v1/accountant-invites/accept', json({ token: 'A'.repeat(43) }, o.auth))).status).toBe(404);
    expect((await signupFromInvite(off, 'A'.repeat(43))).status).toBe(404);
    expect((await off.app.request(`/v1/clients/${o.personalId}`, { method: 'DELETE', headers: o.auth })).status).toBe(404);
    expect('clients' in (await me(off, o))).toBe(false);

    // A grant written while the switch was on opens nothing once it is off.
    const grantee = await person(off);
    const invited = await off.store.accountantGrants.invite({ organizationId: o.personalId, inviteEmail: grantee.email, locale: 'en', invitedByUserId: o.userId, tokenDigest: 'd'.repeat(64), at: T0, expiresAt: new Date(T0.getTime() + DAY), max: 5, auditFor: () => [] });
    if (invited.kind !== 'created') throw new Error('invite failed');
    await off.store.accountantGrants.accept({ tokenDigest: 'd'.repeat(64), accountantUserId: grantee.userId, at: T0, auditFor: () => [] });
    expect((await off.app.request('/v1/expenses', { headers: grantee.on(o.personalId) })).status).toBe(404);
  });
});
