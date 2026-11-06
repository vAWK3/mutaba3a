import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from '../attachments/storage.js';
import { CURRENT_TERMS } from '../legal.js';
import {
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
  type AccountantHarness,
  type Loose,
  type Person,
} from './helpers/accountants.js';

/**
 * MUT-575 (ADR-249): the accountant's client books, through the real app. Ended clients are computed (a revoke, or the
 * owner closing their account) and stay until removed; `/v1/clients` adds the month's stats; a client's feed is the
 * profile-scoped `/v1/profile-entries` behind selectProfile, and `/v1/entries` never mixes a client's rows in; a
 * receipt can be previewed inline. Numbers in the describe names are the plan's tests.
 */
const me = async (h: AccountantHarness, p: Person) => read(await h.app.request('/v1/me', { headers: p.auth }));
const clientsList = async (h: AccountantHarness, p: Person) => h.app.request('/v1/clients', { headers: p.auth });
const remove = (h: AccountantHarness, p: Person, profileId: string) => h.app.request(`/v1/clients/${profileId}`, { method: 'DELETE', headers: p.auth });
const feedOf = (h: AccountantHarness, p: Person, profileId: string, query = '') => h.app.request(`/v1/profile-entries${query}`, { headers: p.on(profileId) });
const grantsOf = async (h: AccountantHarness, owner: Person, profileId: string) => (await read(await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: owner.auth }))).items as Loose[];
const revokeAll = async (h: AccountantHarness, owner: Person, profileId: string) => {
  for (const g of await grantsOf(h, owner, profileId)) expect((await h.app.request(`/v1/profiles/${profileId}/accountants/${g.id}`, { method: 'DELETE', headers: owner.auth })).status).toBe(204);
};
const closeAccount = async (h: AccountantHarness, p: Person) => expect((await h.app.request('/v1/me/closure', json({ password: p.password }, p.auth))).status).toBe(200);
const later = (h: AccountantHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));
const accountantGrantActions = async (h: AccountantHarness, profileId: string) => (await h.store.audit.listByOrganization(profileId, 200)).filter((e) => e.action.startsWith('accountant.')).map((e) => e.action);

async function ownerWithProfile(h: AccountantHarness, name = 'Sader Studio', ownerName = 'Basel Sader') {
  const owner = await person(h, { displayName: ownerName });
  const profileId = await businessOf(h, owner, name);
  return { owner, profileId };
}

async function received(h: AccountantHarness, p: Person, profileId: string, occurredOn: string): Promise<string> {
  const res = await h.app.request('/v1/income', json({ kind: 'received', amount: '50.00', currency: 'ILS', occurredOn }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`income failed: ${res.status} ${await res.text()}`);
  return (await read(res)).id as string;
}

async function expenseDated(h: AccountantHarness, p: Person, profileId: string, occurredOn: string, title = 'Paper'): Promise<string> {
  const res = await h.app.request('/v1/expenses', json({ amount: '12.00', currency: 'ILS', occurredOn, title }, { ...p.on(profileId), ...idem() }));
  if (res.status !== 201) throw new Error(`expense failed: ${res.status} ${await res.text()}`);
  return (await read(res)).id as string;
}

describe('2. /v1/me clients (MUT-575)', () => {
  it('carries the extended shape for active and ended rows; the accept answer is active', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await person(h, { displayName: 'Hadi Accountant' });
    expect((await inviteAccountant(h, owner, profileId, acc.email)).status).toBe(201);
    const accepted = await acceptInvite(h, acc, inviteTokenFor(h, acc.email));
    const active = { profileId, name: 'Sader Studio', ownerName: 'Basel Sader', profileType: 'business', sharedSince: T0.toISOString(), status: 'active', endedReason: null, endedAt: null };
    expect(await read(accepted)).toEqual(active);
    expect((await me(h, acc)).clients).toEqual([active]);

    later(h, DAY);
    await revokeAll(h, owner, profileId);
    expect((await me(h, acc)).clients).toEqual([{ ...active, status: 'ended', endedReason: 'revoked', endedAt: h.now().toISOString() }]);
  });

  it('flag off: no clients field', async () => {
    const h = accountantHarness({ accountantAccess: false });
    const p = await person(h);
    expect('clients' in (await me(h, p))).toBe(false);
  });
});

describe('invite check carries the terms version (MUT-575, for MUT-562)', () => {
  it('answers the current terms version, which signup from the invite accepts first time', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    expect((await inviteAccountant(h, owner, profileId, 'new.accountant@books.ps')).status).toBe(201);
    const token = inviteTokenFor(h, 'new.accountant@books.ps');
    const check = await read(await h.app.request('/v1/accountant-invites/check', json({ token }, SAME_ORIGIN)));
    expect(check.termsVersion).toBe(CURRENT_TERMS.version);
    const signup = await h.app.request(
      '/v1/accountant-invites/signup',
      json({ token, password: 'a-long-enough-password', displayName: 'New Accountant', acceptedTermsVersion: check.termsVersion, turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }, SAME_ORIGIN),
    );
    expect(signup.status).toBe(201);
  });
});

describe('3. GET /v1/clients (MUT-575)', () => {
  it('lists the rows with this month’s entries in each profile’s timezone, the last activity, and null stats when ended', async () => {
    const h = accountantHarness();
    // 22:30 UTC on 31 October: still October in UTC, already 1 November in Jerusalem (UTC+2 after DST ends).
    h.setNow(new Date('2026-10-31T22:30:00Z'));
    const owner = await person(h, { displayName: 'Basel Sader' });
    const utc = (await read(await h.app.request('/v1/profiles', json({ name: 'Utc Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'UTC' }, { ...owner.auth, ...idem() })))).id as string;
    const jlm = await businessOf(h, owner, 'Jerusalem Studio');
    const gone = await businessOf(h, owner, 'Gone Studio');
    const acc = await shared(h, owner, utc);
    later(h, 1_000);
    await shared(h, owner, jlm, acc);
    later(h, 1_000);
    await shared(h, owner, gone, acc);

    await expenseDated(h, owner, utc, '2026-10-15');
    await expenseDated(h, owner, utc, '2026-10-31');
    await received(h, owner, utc, '2026-10-20');
    later(h, 60_000);
    const deleted = await expenseDated(h, owner, utc, '2026-10-10');
    expect((await h.app.request(`/v1/expenses/${deleted}`, { method: 'DELETE', headers: owner.on(utc) })).status).toBe(204);
    const undone = await received(h, owner, utc, '2026-10-12');
    expect((await h.app.request(`/v1/income/${undone}`, { method: 'DELETE', headers: owner.on(utc) })).status).toBe(204);
    await expenseDated(h, owner, jlm, '2026-10-31');
    later(h, 60_000);
    const lastJlm = h.now().toISOString();
    await expenseDated(h, owner, jlm, '2026-11-01');
    await revokeAll(h, owner, gone);

    const res = await clientsList(h, acc);
    expect(res.status).toBe(200);
    const { items } = await read(res);
    expect(items.map((i: Loose) => [i.name, i.status, i.entriesThisMonth])).toEqual([
      ['Utc Studio', 'active', 3],
      ['Jerusalem Studio', 'active', 1],
      ['Gone Studio', 'ended', null],
    ]);
    expect(items[1].lastActivityAt).toBe(lastJlm);
    // The newest live row on Utc Studio is the 10-20 payment, logged before the deleted and undone ones.
    expect(items[0].lastActivityAt).toBe('2026-10-31T22:30:02.000Z');
    expect(items[2]).toMatchObject({ entriesThisMonth: null, lastActivityAt: null, endedReason: 'revoked' });
    // The same rows as /v1/me, plus the stats.
    const withoutStats = (row: Loose) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'entriesThisMonth' && key !== 'lastActivityAt'));
    expect((await me(h, acc)).clients).toEqual(items.map(withoutStats));
  });

  it('a person who reads no client gets an empty list; the switch off answers 404', async () => {
    const h = accountantHarness();
    const p = await person(h);
    expect(await read(await clientsList(h, p))).toEqual({ items: [] });
    const off = accountantHarness({ accountantAccess: false });
    expect((await clientsList(off, await person(off))).status).toBe(404);
  });

  it('reads the stats in one call for every client, never a feed read per client', async () => {
    const h = accountantHarness();
    const acc = await person(h);
    // Ten owners' personal profiles (one person owns at most six).
    for (let i = 0; i < 10; i++) {
      const owner = await person(h);
      await shared(h, owner, owner.personalId, acc);
    }
    const calls = { activity: 0, list: 0 };
    const entries = h.store.entries;
    const { clientActivity, list } = entries;
    entries.clientActivity = (...args) => (calls.activity++, clientActivity.apply(entries, args));
    entries.list = (...args) => (calls.list++, list.apply(entries, args));
    expect((await read(await clientsList(h, acc))).items).toHaveLength(10);
    expect(calls).toEqual({ activity: 1, list: 0 });
    calls.activity = 0;
    await me(h, acc);
    expect(calls).toEqual({ activity: 0, list: 0 });
  });
});

describe('5. DELETE /v1/clients (MUT-575)', () => {
  it('an ACTIVE client: Stop reading leaves (LEFT, audited) and the row is gone', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    expect((await remove(h, acc, profileId)).status).toBe(204);
    expect((await me(h, acc)).clients).toEqual([]);
    expect(await accountantGrantActions(h, profileId)).toContain('accountant.left');
  });

  it('an ended client: Remove dismisses it with no audit row; gone from both lists, and stays gone', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    // Shared, revoked, re-shared and revoked again: two REVOKED grants, both dismissed by one Remove.
    await revokeAll(h, owner, profileId);
    await shared(h, owner, profileId, acc);
    await revokeAll(h, owner, profileId);
    expect((await me(h, acc)).clients).toHaveLength(1);
    const before = (await accountantGrantActions(h, profileId)).length;
    expect((await remove(h, acc, profileId)).status).toBe(204);
    expect(await accountantGrantActions(h, profileId)).toHaveLength(before);
    expect((await me(h, acc)).clients).toEqual([]);
    expect((await read(await clientsList(h, acc))).items).toEqual([]);
    expect((await me(h, acc)).clients).toEqual([]);
    expect((await remove(h, acc, profileId)).status).toBe(404);
  });

  it('a closing owner’s ACTIVE client: Remove leaves it (LEFT)', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    await closeAccount(h, owner);
    expect((await me(h, acc)).clients[0]).toMatchObject({ status: 'ended', endedReason: 'closed' });
    expect((await remove(h, acc, profileId)).status).toBe(204);
    expect((await me(h, acc)).clients).toEqual([]);
    expect(await accountantGrantActions(h, profileId)).toContain('accountant.left');
  });

  it('an unknown profile, or another accountant’s client, answers 404', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const acc = await shared(h, owner, profileId);
    await revokeAll(h, owner, profileId);
    const stranger = await person(h);
    expect((await remove(h, stranger, profileId)).status).toBe(404);
    expect((await remove(h, acc, '00000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await me(h, acc)).clients).toHaveLength(1);
  });
});

describe('6. a closing owner ends accountant access (MUT-575; changes MUT-559)', () => {
  it('closing → 404 and ended/closed; Keep my account → active and readable; the purge removes the row', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await expenseOn(h, owner, profileId, 'Shared paper');
    const acc = await shared(h, owner, profileId);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(profileId) })).status).toBe(200);

    later(h, 60_000);
    await closeAccount(h, owner);
    const closing = await h.app.request('/v1/expenses', { headers: acc.on(profileId) });
    expect(closing.status).toBe(404);
    expect((await read(closing)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });
    expect((await feedOf(h, acc, profileId)).status).toBe(404);
    expect((await me(h, acc)).clients).toEqual([expect.objectContaining({ profileId, status: 'ended', endedReason: 'closed', endedAt: h.now().toISOString() })]);

    expect((await h.app.request('/v1/me/closure', { method: 'DELETE', headers: owner.auth })).status).toBe(200);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(profileId) })).status).toBe(200);
    expect((await me(h, acc)).clients).toEqual([expect.objectContaining({ profileId, status: 'active', endedReason: null, endedAt: null })]);

    await closeAccount(h, owner);
    later(h, 30 * DAY + 60_000);
    const purged = await h.app.request('/jobs/v1/accounts/purge', { method: 'POST', headers: JOB });
    expect(await read(purged)).toMatchObject({ purged: 1, failed: 0 });
    expect((await me(h, acc)).clients).toEqual([]);
  });
});

describe('7. /v1/profile-entries as an accountant (MUT-575)', () => {
  async function client() {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const ids = {
      e1: await expenseDated(h, owner, profileId, '2026-10-01', 'Ink'),
      r1: await received(h, owner, profileId, '2026-10-05'),
      e2: await expenseDated(h, owner, profileId, '2026-10-20', 'Paper'),
      r2: await received(h, owner, profileId, '2026-11-02'),
    };
    const owed = await read(await h.app.request('/v1/income', json({ kind: 'owed', amount: '80.00', currency: 'ILS', occurredOn: '2026-10-10', customerId: (await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...owner.on(profileId), ...idem() })))).id }, { ...owner.on(profileId), ...idem() })));
    const conversion = await read(await h.app.request('/v1/conversions', json({ occurredOn: '2026-10-15', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' }, { ...owner.on(profileId), ...idem() })));
    const acc = await shared(h, owner, profileId);
    await expenseOn(h, acc, acc.personalId, 'My own lunch');
    return { h, owner, profileId, acc, ids: { ...ids, o1: owed.id as string, c1: conversion.id as string } };
  }
  const idsOf = (page: Loose) => page.items.map((i: Loose) => i.expense?.id ?? i.income?.id ?? i.conversion?.id);

  it('answers only the client’s rows, newest money date first, in the /v1/entries shape', async () => {
    const { h, acc, profileId, ids } = await client();
    const res = await feedOf(h, acc, profileId);
    expect(res.status).toBe(200);
    const page = await read(res);
    expect(idsOf(page)).toEqual([ids.r2, ids.e2, ids.c1, ids.o1, ids.r1, ids.e1]);
    expect(page.items.map((i: Loose) => i.kind)).toEqual(['received', 'expense', 'conversion', 'owed', 'received', 'expense']);
    expect(new Set(page.items.map((i: Loose) => i.profileId))).toEqual(new Set([profileId]));
    expect(JSON.stringify(page)).not.toContain('My own lunch');
    expect(page.nextCursor).toBeNull();
  });

  it('filters by kinds, each and combined', async () => {
    const { h, acc, profileId, ids } = await client();
    const kinds = async (q: string) => idsOf(await read(await feedOf(h, acc, profileId, q)));
    expect(await kinds('?kinds=expense')).toEqual([ids.e2, ids.e1]);
    expect(await kinds('?kinds=received')).toEqual([ids.r2, ids.r1]);
    expect(await kinds('?kinds=owed')).toEqual([ids.o1]);
    expect(await kinds('?kinds=conversion')).toEqual([ids.c1]);
    expect(await kinds('?kinds=expense&kinds=received')).toEqual([ids.r2, ids.e2, ids.r1, ids.e1]);
    expect((await feedOf(h, acc, profileId, '?kinds=invoice')).status).toBe(422);
    // No kind, or a from after the before: an empty page, never an error.
    const empty = { items: [], nextCursor: null };
    expect(await read(await feedOf(h, acc, profileId, '?kinds='))).toEqual(empty);
    expect(await read(await feedOf(h, acc, profileId, '?occurredFrom=2026-10-20&occurredBefore=2026-10-10'))).toEqual(empty);
  });

  it.each(['revoked', 'closing', 'dismissed', 'left'] as const)('a %s grant answers 404, including the next page of a feed read before the change', async (change) => {
    const { h, owner, acc, profileId } = await client();
    const first = await read(await feedOf(h, acc, profileId, '?limit=2'));
    expect(first.nextCursor).not.toBeNull();
    if (change === 'revoked' || change === 'dismissed') await revokeAll(h, owner, profileId);
    if (change === 'dismissed') expect((await remove(h, acc, profileId)).status).toBe(204);
    if (change === 'closing') await closeAccount(h, owner);
    if (change === 'left') expect((await remove(h, acc, profileId)).status).toBe(204);
    for (const query of ['', `?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`]) {
      const res = await feedOf(h, acc, profileId, query);
      expect(res.status, `${change} ${query}`).toBe(404);
      expect((await read(res)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });
    }
  });

  it('asking /v1/entries for the client by profileId answers 404 (the client feed is only /v1/profile-entries)', async () => {
    const { h, acc, profileId } = await client();
    const res = await h.app.request(`/v1/entries?profileId=${profileId}`, { headers: acc.auth });
    expect(res.status).toBe(404);
    expect((await h.app.request(`/v1/entries?profileId=${profileId}&order=occurredOn`, { headers: acc.auth })).status).toBe(404);
  });

  it('bounds by occurredFrom and occurredBefore, pages with a stable cursor, and caps the limit at 100', async () => {
    const { h, acc, profileId, ids } = await client();
    expect(idsOf(await read(await feedOf(h, acc, profileId, '?occurredFrom=2026-10-05&occurredBefore=2026-10-20')))).toEqual([ids.c1, ids.o1, ids.r1]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Loose = await read(await feedOf(h, acc, profileId, `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`));
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...idsOf(page));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([ids.r2, ids.e2, ids.c1, ids.o1, ids.r1, ids.e1]);
    expect((await feedOf(h, acc, profileId, '?limit=101')).status).toBe(422);
    expect((await feedOf(h, acc, profileId, '?limit=100')).status).toBe(200);
  });

  it('404 for a profile not shared, an ended grant and a revoke mid-session; every write is 403 ACCOUNTANT_READ_ONLY', async () => {
    const { h, owner, acc, profileId } = await client();
    const other = await businessOf(h, owner, 'Other Studio');
    const unshared = await feedOf(h, acc, other);
    expect(unshared.status).toBe(404);
    expect((await read(unshared)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await h.app.request('/v1/profile-entries', { method, headers: { ...acc.on(profileId), 'content-type': 'application/json' }, ...(method === 'DELETE' ? {} : { body: '{}' }) });
      // The route has only a GET: any other method is refused before routing finds nothing, or is not found at all.
      expect([403, 404, 405]).toContain(res.status);
      if (res.status === 403) expect((await read(res)).error.details).toEqual({ reason: 'ACCOUNTANT_READ_ONLY' });
    }
    const first = await read(await feedOf(h, acc, profileId, '?limit=2'));
    await revokeAll(h, owner, profileId);
    const next = await feedOf(h, acc, profileId, `?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
    expect(next.status).toBe(404);
    expect((await read(next)).error.details).toEqual({ reason: 'PROFILE_NOT_FOUND' });
  });
});

describe('8. never mixes (MUT-575)', () => {
  it('the accountant’s own /v1/entries has none of the client’s rows, and naming the client there is 404', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    await expenseOn(h, owner, profileId, 'Shared paper');
    const acc = await shared(h, owner, profileId);
    await expenseOn(h, acc, acc.personalId, 'My own lunch');
    const feed = JSON.stringify(await read(await h.app.request('/v1/entries', { headers: acc.auth })));
    expect(feed).toContain('My own lunch');
    expect(feed).not.toContain('Shared paper');
    expect(feed).not.toContain(profileId);
    const named = await h.app.request(`/v1/entries?profileId=${profileId}&order=occurredOn`, { headers: acc.auth });
    expect(named.status).toBe(404);
    // With the client named in the header too: /v1/entries is organization-independent and ignores it.
    const withHeader = JSON.stringify(await read(await h.app.request('/v1/entries', { headers: acc.on(profileId) })));
    expect(withHeader).not.toContain('Shared paper');
    const verdict = await h.app.request('/v1/summaries/verdict', { headers: acc.auth });
    expect(verdict.status).toBe(200);
    expect(JSON.stringify(await read(verdict))).not.toContain(profileId);
    // The client's feed, on the other hand, has the client's rows and none of the accountant's own.
    const client = JSON.stringify(await read(await feedOf(h, acc, profileId)));
    expect(client).toContain('Shared paper');
    expect(client).not.toContain('My own lunch');
  });
});

describe('9. /v1/profile-entries as an owner or member (MUT-575)', () => {
  it('pages exactly like /v1/entries?profileId=X&order=occurredOn (one builder)', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    for (let i = 1; i <= 7; i++) {
      await expenseDated(h, owner, profileId, `2026-10-${String(i * 3).padStart(2, '0')}`, `E${i}`);
      if (i % 2 === 0) await received(h, owner, profileId, `2026-10-${String(i * 3 + 1).padStart(2, '0')}`);
    }
    let a: string | null = null;
    let b: string | null = null;
    let pages = 0;
    do {
      const scoped: Loose = await read(await h.app.request(`/v1/profile-entries?limit=3${a ? `&cursor=${encodeURIComponent(a)}` : ''}`, { headers: owner.on(profileId) }));
      const across: Loose = await read(await h.app.request(`/v1/entries?profileId=${profileId}&order=occurredOn&limit=3${b ? `&cursor=${encodeURIComponent(b)}` : ''}`, { headers: owner.auth }));
      expect(scoped).toEqual(across);
      a = scoped.nextCursor;
      b = across.nextCursor;
      pages++;
    } while (a);
    expect(pages).toBe(4);
  });

  it('a LOCKED profile answers 402 to its member', async () => {
    const h = accountantHarness({ billingGate: true });
    const owner = await person(h);
    await h.store.billing.setTrialStart(owner.userId, new Date(T0.getTime() - 40 * DAY));
    const res = await h.app.request('/v1/profile-entries', { headers: owner.on(owner.personalId) });
    expect(res.status).toBe(402);
  });

  it('never posts a due installment', async () => {
    const h = accountantHarness();
    const { owner, profileId } = await ownerWithProfile(h);
    const customer = await h.store.customers.create({ organizationId: profileId, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: 'OUT_OF_SCOPE' }, h.now());
    const project = await h.store.projects.create({ organizationId: profileId, customerId: customer.id, name: 'Case', currency: 'ILS' }, h.now());
    const { agreement } = await h.store.agreements.create(
      {
        organizationId: profileId, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0,
        amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, agreementDate: '2026-11-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null,
        installments: [{ position: 1, label: 'I1', amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, grossMinor: 1_000n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
      },
      h.now(),
    );
    expect((await h.app.request('/v1/profile-entries', { headers: owner.on(profileId) })).status).toBe(200);
    expect((await h.store.agreements.listInstallments(profileId, agreement.id)).map((i) => i.receivableId)).toEqual([null]);
  });
});

describe('11. inline receipt preview (MUT-575 S4)', () => {
  it('signs inline only when asked; default and attachment unchanged; the accountant reads it; a bad value is 422', async () => {
    const storage = new MemoryAttachmentStorage();
    const h = accountantHarness({ attachments: storage });
    const { owner, profileId } = await ownerWithProfile(h);
    const expenseId = await expenseOn(h, owner, profileId, 'Ink');
    const created = await read(await h.app.request(`/v1/expenses/${expenseId}/receipts`, json({ filename: 'ink.pdf', mimeType: 'application/pdf', sizeBytes: 2048 }, { ...owner.on(profileId), ...idem() })));
    storage.put(new URL(created.upload.url).pathname.replace(/^\/+/, '').replace(/^upload\//, ''), { sizeBytes: 2048, contentType: 'application/pdf' });
    expect((await h.app.request(`/v1/expenses/${expenseId}/receipts/${created.receipt.id}/complete`, { method: 'POST', headers: owner.on(profileId) })).status).toBe(200);
    const path = `/v1/expenses/${expenseId}/receipts/${created.receipt.id}/download`;
    const acc = await shared(h, owner, profileId);

    const plain = await read(await h.app.request(path, { headers: owner.on(profileId) }));
    expect(plain.url).not.toContain('disposition=inline');
    expect((await read(await h.app.request(`${path}?disposition=attachment`, { headers: owner.on(profileId) }))).url).not.toContain('disposition=inline');
    const inline = await h.app.request(`${path}?disposition=inline`, { headers: acc.on(profileId) });
    expect(inline.status).toBe(200);
    expect(await read(inline)).toMatchObject({ filename: 'ink.pdf', mimeType: 'application/pdf', url: expect.stringContaining('disposition=inline') });
    expect((await h.app.request(`${path}?disposition=open`, { headers: owner.on(profileId) })).status).toBe(422);
  });
});
