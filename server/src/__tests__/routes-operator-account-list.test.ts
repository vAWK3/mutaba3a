import { describe, expect, it } from 'vitest';
import { provisionUser } from './helpers/provision.js';
import { ADMIN, get, harness, minutes, operator, passwordSignIn, person, post, read, withSession, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-527 (ADR-212 E10 amendment): the operator console lists every account (newest sign-in first, paged, `q` a partial
 * match on the email or name), and an operator may switch features on their own account with the same passkey step-up
 * as anyone's. Everything else on their own account stays refused (409 OWN_ACCOUNT).
 */
const LIST = '/v1/operator/accounts';
const send = (h: Harness, method: string, path: string, token: string) => h.app.request(path, { method, headers: withSession(token) });
const featurePath = (userId: string, feature: string) => `/v1/operator/accounts/${userId}/features/${feature}`;

async function named(h: Harness, email: string, displayName: string) {
  const created = await provisionUser(h.app, { email, displayName, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  return { id: created.user.id as string, email, password: created.password as string };
}

async function personalOf(h: Harness, userId: string) {
  const [personal] = await h.store.memberships.listByUser(userId);
  return personal!.organizationId;
}

describe('MUT-527 the account list', () => {
  it('lists every account without a search, newest sign-in first, never-signed-in last (newest created first)', async () => {
    const h = harness();
    const op = await operator(h);
    minutes(h, 1);
    const quiet = await named(h, 'quiet@studio.example', 'Quiet');
    minutes(h, 1);
    const quieter = await named(h, 'quieter@studio.example', 'Quieter');
    minutes(h, 1);
    const active = await named(h, 'active@studio.example', 'Active');
    await passwordSignIn(h, active.email, active.password);
    expect((await h.app.request(`/admin/v1/users/${active.id}/features/receipt_reading`, { method: 'PUT', headers: ADMIN })).status).toBe(200);

    const res = await get(h, LIST, op.token);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.data.map((a: Loose) => a.id)).toEqual([active.id, op.id, quieter.id, quiet.id]);
    expect(body.data[0]).toEqual({
      id: active.id,
      email: 'active@studio.example',
      displayName: 'Active',
      status: 'ACTIVE',
      operator: false,
      lastSignInAt: h.clock.now.toISOString(),
      features: ['receipt_reading'],
    });
    expect(body.data[1]).toMatchObject({ id: op.id, operator: true });
    expect(body.data[3]).toMatchObject({ lastSignInAt: null, features: [] });
    expect(body.nextCursor).toBeNull();
    expect(body.stepUpUntil).toEqual(expect.any(String));
  });

  it('paginates with limit and cursor; every account appears once', async () => {
    const h = harness();
    const op = await operator(h);
    for (let i = 0; i < 4; i++) {
      minutes(h, 1);
      await person(h);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(h, `${LIST}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, op.token);
      expect(res.status).toBe(200);
      const body: Loose = await read(res);
      expect(body.data.length).toBeLessThanOrEqual(2);
      seen.push(...body.data.map((a: Loose) => a.id as string));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe(op.id);
  });

  it('defaults to 50 and refuses a limit over 100 or a cursor it did not issue (422)', async () => {
    const h = harness();
    const op = await operator(h);
    expect((await get(h, `${LIST}?limit=101`, op.token)).status).toBe(422);
    expect((await get(h, `${LIST}?limit=0`, op.token)).status).toBe(422);
    expect((await get(h, `${LIST}?cursor=not-a-cursor`, op.token)).status).toBe(422);
    expect((await get(h, `${LIST}?limit=100`, op.token)).status).toBe(200);
  });

  it('q matches any part of the email or the display name, ignoring case', async () => {
    const h = harness();
    const op = await operator(h);
    const byEmail = await named(h, 'basel.s@studio.example', 'Someone');
    const byName = await named(h, 'rana@studio.example', 'Rana Basel');
    await named(h, 'nobody@studio.example', 'Nobody');
    const ids = async (q: string) => ((await read(await get(h, `${LIST}?q=${encodeURIComponent(q)}`, op.token))).data as Loose[]).map((a) => a.id).sort();
    // The operator's own address is basel<n>@studio.example (the harness), so it matches "basel" too.
    expect(await ids('basel')).toEqual([byEmail.id, byName.id, op.id].sort());
    expect(await ids('BASEL.S')).toEqual([byEmail.id]);
    expect(await ids('rana b')).toEqual([byName.id]);
    expect(await ids('zzz')).toEqual([]);
    // A blank q lists everyone.
    expect((await ids('   ')).length).toBe(4);
  });

  it('keeps the exact email lookup as it was', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const body = await read(await get(h, `${LIST}?email=${encodeURIComponent(p.email.toUpperCase())}`, op.token));
    expect(body).toEqual({ account: { id: p.id, email: p.email, displayName: 'Basel Sader', status: 'ACTIVE' }, stepUpUntil: expect.any(String) });
  });

  it('a signed-in person who is not an operator gets 404; signed out gets 401', async () => {
    const h = harness();
    await operator(h);
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    expect((await get(h, LIST, token)).status).toBe(404);
    expect((await get(h, `${LIST}?q=basel`, token)).status).toBe(404);
    expect((await h.app.request(LIST)).status).toBe(401);
  });
});

describe('MUT-527 the operator’s own features (E10 amendment)', () => {
  it('switches a feature on and off on their own account with the step-up, audited like anyone’s', async () => {
    const h = harness();
    const op = await operator(h);
    const on = await send(h, 'PUT', featurePath(op.id, 'receipt_reading'), op.token);
    expect(on.status).toBe(200);
    expect(await read(on)).toMatchObject({ feature: 'receipt_reading', granted: true });
    expect(await h.store.features.activeFor(op.id)).toEqual(['receipt_reading']);

    const off = await send(h, 'DELETE', featurePath(op.id, 'receipt_reading'), op.token);
    expect(off.status).toBe(200);
    expect(await read(off)).toMatchObject({ feature: 'receipt_reading', revoked: true });
    expect(await h.store.features.activeFor(op.id)).toEqual([]);

    const audit = (await h.store.audit.list(await personalOf(h, op.id), {}, { limit: 100, cursor: null })).items
      .filter((e) => e.action.startsWith('user.feature_'))
      .map((e) => [e.action, e.actorId, e.entityId, e.metadata])
      .sort();
    expect(audit).toEqual([
      ['user.feature_granted', op.id, op.id, { feature: 'receipt_reading' }],
      ['user.feature_revoked', op.id, op.id, { feature: 'receipt_reading' }],
    ]);
  });

  it('refuses a self switch without a fresh step-up (403 RECENT_SIGN_IN_REQUIRED), and nothing changes', async () => {
    const h = harness();
    const op = await operator(h);
    for (const method of ['PUT', 'DELETE']) {
      const res = await send(h, method, featurePath(op.id, 'receipt_reading'), op.passwordToken);
      expect([method, res.status, (await read(res)).error.code]).toEqual([method, 403, 'RECENT_SIGN_IN_REQUIRED']);
    }
    expect(await h.store.features.activeFor(op.id)).toEqual([]);
  });

  it('still refuses disable, sign out everywhere, the setup link and billing grants on their own account (409 OWN_ACCOUNT)', async () => {
    const h = harness();
    const op = await operator(h);
    for (const action of ['disable', 'sessions/revoke', 'setup-link', 'billing-grants']) {
      const res = await post(h, `/v1/operator/accounts/${op.id}/${action}`, op.token, action === 'billing-grants' ? { tier: 'FREELANCER', reason: 'Self' } : {});
      expect([action, res.status, (await read(res)).error.details?.reason]).toEqual([action, 409, 'OWN_ACCOUNT']);
    }
    expect((await h.store.users.getById(op.id))?.status).toBe('ACTIVE');
    expect(await h.store.billing.listGrants({ userId: op.id })).toEqual([]);
  });
});

describe('MUT-527 the account view says since when and when a passkey was last used', () => {
  it('carries operatorSince and passkeyLastUsedAt', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const mine = (await read(await get(h, `/v1/operator/accounts/${op.id}`, op.token))).account;
    expect(mine.operatorSince).toEqual(expect.any(String));
    expect(mine.passkeyLastUsedAt).toEqual(expect.any(String));
    const theirs = (await read(await get(h, `/v1/operator/accounts/${p.id}`, op.token))).account;
    expect(theirs).toMatchObject({ operatorSince: null, passkeyLastUsedAt: null });
  });
});
