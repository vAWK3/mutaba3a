import { describe, expect, it } from 'vitest';
import { provisionUser } from './helpers/provision.js';
import { ADMIN, get, harness, json, minutes, operator, passwordSignIn, pendingSignup, person, post, read, withSession, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-462 (ADR-212 D1, D9, E5): the operator console's billing grants, feature flags and firm requests, end to end
 * through the real app. Each answers what the admin route answers for the same action (one action module), is
 * audited with the operator's id (`grantedBy` operator:<id>), needs a fresh passkey step-up to write, and never acts
 * on the operator's own account (E10, 409 OWN_ACCOUNT).
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000462';
const accountPath = (userId: string, rest: string) => `/v1/operator/accounts/${userId}/${rest}`;
const send = (h: Harness, method: string, path: string, token: string, body?: unknown) =>
  h.app.request(path, body === undefined ? { method, headers: withSession(token) } : json(body, withSession(token), method));
const adminSend = (h: Harness, method: string, path: string, body?: unknown) => h.app.request(path, body === undefined ? { method, headers: ADMIN } : json(body, ADMIN, method));
const GRANT = { tier: 'FREELANCER', reason: 'Pilot comp' } as const;
let seq = 0;

async function personalOf(h: Harness, userId: string) {
  const [personal] = await h.store.memberships.listByUser(userId);
  return personal!.organizationId;
}

/** Audit rows on one profile whose action starts with `prefix`, sorted by action: the clock stands still here, so rows have no order. */
async function auditOn(h: Harness, organizationId: string, prefix: string) {
  const items = (await h.store.audit.list(organizationId, {}, { limit: 100, cursor: null })).items;
  return items
    .filter((e) => e.action.startsWith(prefix))
    .map((e) => ({ action: e.action, actorType: e.actorType, actorId: e.actorId, metadata: e.metadata ?? null }))
    .sort((a, b) => a.action.localeCompare(b.action));
}

/** A person who owns a Business profile and asked for firm features on it (MUT-300's self-service request). */
async function ownedRequest(h: Harness) {
  const p = await person(h);
  const token = await passwordSignIn(h, p.email, p.password);
  const headers = { ...withSession(token), 'idempotency-key': `mut462-${++seq}` };
  const profile = await read(await h.app.request('/v1/profiles', json({ name: 'Studio', type: 'BUSINESS', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, headers)));
  expect((await h.app.request(`/v1/profiles/${profile.id}/firm-request`, json({}, { ...headers, 'idempotency-key': `mut462-${++seq}` }))).status).toBeLessThan(300);
  return { p, organizationId: profile.id as string };
}

/** An operator-made organization with two members, one of whom asked for firm features. */
async function operatorFirmRequest(h: Harness) {
  const firm = await read(await adminSend(h, 'POST', '/admin/v1/organizations', { name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }));
  const members = [];
  for (const name of ['Rana Saleh', 'Omar Haddad']) {
    const created = await provisionUser(h.app, { email: `member${++seq}@studio.example`, displayName: name, organizationId: firm.id, locale: 'en' });
    members.push({ id: created.user.id as string, email: created.user.email as string });
  }
  const requested = await h.store.organizations.requestFirm(firm.id, members[0]!.id, h.clock.now, { actorId: members[0]!.id, requestId: null });
  expect(requested.kind).toBe('requested');
  return { organizationId: firm.id as string, requester: members[0]!, other: members[1]! };
}

describe('MUT-462 billing grants on an account', () => {
  it('grants coverage with a reason and an expiry, lists it, and audits it with the operator on the person’s own profiles', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const expiresAt = new Date(h.clock.now.getTime() + 30 * 86_400_000).toISOString();

    const res = await post(h, accountPath(p.id, 'billing-grants'), op.token, { ...GRANT, expiresAt });
    expect(res.status).toBe(201);
    const grant = await read(res);
    expect(grant).toMatchObject({ userId: p.id, organizationId: null, tier: 'FREELANCER', reason: 'Pilot comp', expiresAt, grantedBy: `operator:${op.id}`, revokedAt: null });

    const list = await read(await get(h, accountPath(p.id, 'billing-grants'), op.token));
    expect(list.grants.map((g: Loose) => g.id)).toEqual([grant.id]);
    expect(list.stepUpUntil).toEqual(expect.any(String));

    const view = await read(await get(h, `/v1/operator/accounts/${p.id}`, op.token));
    expect(view.account.profiles[0].billing).toMatchObject({ source: 'OPERATOR', state: 'ACTIVE' });
    expect(await auditOn(h, await personalOf(h, p.id), 'billing.')).toEqual([
      { action: 'billing.grant_created', actorType: 'ADMIN', actorId: op.id, metadata: expect.objectContaining({ userId: p.id, tier: 'FREELANCER', reason: 'Pilot comp', expiresAt }) },
    ]);
  });

  it('revokes a grant (kept, revokedAt set), twice changes nothing, and audits it with the operator', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const grant = await read(await post(h, accountPath(p.id, 'billing-grants'), op.token, GRANT));

    const first = await send(h, 'DELETE', accountPath(p.id, `billing-grants/${grant.id}`), op.token);
    expect(first.status).toBe(200);
    expect(await read(first)).toMatchObject({ grant: { id: grant.id, revokedAt: h.clock.now.toISOString() }, revoked: true });
    expect(await read(await send(h, 'DELETE', accountPath(p.id, `billing-grants/${grant.id}`), op.token))).toMatchObject({ revoked: false });

    const actions = await auditOn(h, await personalOf(h, p.id), 'billing.');
    expect(actions.map((a) => [a.action, a.actorId])).toEqual([
      ['billing.grant_created', op.id],
      ['billing.grant_revoked', op.id],
    ]);
    expect((await read(await get(h, accountPath(p.id, 'billing-grants'), op.token))).grants[0]).toMatchObject({ id: grant.id, revokedAt: expect.any(String) });
  });

  it('answers 404 for a grant that belongs to someone else, and changes nothing', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const other = await person(h);
    const grant = await read(await post(h, accountPath(other.id, 'billing-grants'), op.token, GRANT));
    expect((await send(h, 'DELETE', accountPath(p.id, `billing-grants/${grant.id}`), op.token)).status).toBe(404);
    expect((await h.store.billing.getGrant(grant.id))?.revokedAt).toBeNull();
  });

  it('refuses an expiry in the past (422) and an unknown account (404 ACCOUNT_NOT_FOUND)', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const past = await post(h, accountPath(p.id, 'billing-grants'), op.token, { ...GRANT, expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(past.status).toBe(422);
    expect(await read(past)).toMatchObject({ error: { details: { field: 'expiresAt' } } });
    // A past expiry is refused before anyone is looked up (422 before 404), on both surfaces, as the CLI always did.
    const pastOnUnknown = { ...GRANT, expiresAt: '2026-01-01T00:00:00.000Z' };
    expect((await post(h, accountPath(UNKNOWN, 'billing-grants'), op.token, pastOnUnknown)).status).toBe(422);
    expect((await adminSend(h, 'POST', '/admin/v1/billing/grants', { userId: UNKNOWN, ...pastOnUnknown })).status).toBe(422);
    for (const res of [await post(h, accountPath(UNKNOWN, 'billing-grants'), op.token, GRANT), await get(h, accountPath(UNKNOWN, 'billing-grants'), op.token)]) {
      expect(res.status).toBe(404);
      expect(await read(res)).toMatchObject({ error: { code: 'NOT_FOUND', details: { reason: 'ACCOUNT_NOT_FOUND' } } });
    }
  });
});

describe('MUT-462 feature flags on an account', () => {
  it('turns a flag on and off, idempotently, audited with the operator, and the account view lists every flag there is', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);

    const view = await read(await get(h, `/v1/operator/accounts/${p.id}`, op.token));
    expect(view.account.availableFeatures).toEqual(['agent_access', 'receipt_reading']);

    const on = await send(h, 'PUT', accountPath(p.id, 'features/agent_access'), op.token);
    expect(on.status).toBe(200);
    expect(await read(on)).toMatchObject({ feature: 'agent_access', granted: true });
    expect(await read(await send(h, 'PUT', accountPath(p.id, 'features/agent_access'), op.token))).toMatchObject({ granted: false });
    expect((await read(await get(h, `/v1/operator/accounts/${p.id}`, op.token))).account.features).toEqual(['agent_access']);
    expect((await h.store.features.holders('agent_access')).find((x) => x.userId === p.id)).toBeDefined();

    expect(await read(await send(h, 'DELETE', accountPath(p.id, 'features/agent_access'), op.token))).toEqual({ feature: 'agent_access', revoked: true });
    expect(await read(await send(h, 'DELETE', accountPath(p.id, 'features/agent_access'), op.token))).toEqual({ feature: 'agent_access', revoked: false });

    const rows = await auditOn(h, await personalOf(h, p.id), 'user.feature_');
    expect(rows.map((r) => [r.action, r.actorType, r.actorId])).toEqual([
      ['user.feature_granted', 'ADMIN', op.id],
      ['user.feature_revoked', 'ADMIN', op.id],
    ]);
    expect(rows[0]?.metadata).toEqual({ feature: 'agent_access' });
    expect(await h.store.features.activeFor(p.id)).toEqual([]);
  });

  it('refuses an unknown flag (422) and a waiting signup (409 USER_PENDING_REVIEW), as the CLI does', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const unknown = await send(h, 'PUT', accountPath(p.id, 'features/time_travel'), op.token);
    expect(unknown.status).toBe(422);
    expect(await read(unknown)).toMatchObject({ error: { details: { field: 'feature' } } });
    const waiting = await pendingSignup(h);
    const pending = await send(h, 'PUT', accountPath(waiting.userId, 'features/agent_access'), op.token);
    expect(pending.status).toBe(409);
    expect(await read(pending)).toMatchObject({ error: { details: { reason: 'USER_PENDING_REVIEW' } } });
  });
});

describe('MUT-462 firm requests', () => {
  it('lists pending requests oldest first, with when the step-up lapses', async () => {
    const h = harness();
    const op = await operator(h);
    const owned = await ownedRequest(h);
    minutes(h, 1);
    const firm = await operatorFirmRequest(h);

    const res = await get(h, '/v1/operator/firm-requests', op.token);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.data.map((r: Loose) => [r.organizationId, r.owned])).toEqual([
      [owned.organizationId, true],
      [firm.organizationId, false],
    ]);
    expect(body.data[0]).toMatchObject({ name: 'Studio', requestedByUserId: owned.p.id, requestedByEmail: owned.p.email });
    expect(body.stepUpUntil).toEqual(expect.any(String));
  });

  it('shows one request with its members, for the owner picker (outside finding O7)', async () => {
    const h = harness();
    const op = await operator(h);
    const firm = await operatorFirmRequest(h);
    const res = await get(h, `/v1/operator/firm-requests/${firm.organizationId}`, op.token);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.request).toMatchObject({ organizationId: firm.organizationId, requestedByUserId: firm.requester.id, owned: false });
    expect(body.members).toEqual(
      expect.arrayContaining([
        { userId: firm.requester.id, email: firm.requester.email, displayName: 'Rana Saleh', role: expect.any(String), status: 'ACTIVE' },
        { userId: firm.other.id, email: firm.other.email, displayName: 'Omar Haddad', role: expect.any(String), status: 'ACTIVE' },
      ]),
    );
    expect(body.stepUpUntil).toEqual(expect.any(String));
  });

  it('answers 404 FIRM_REQUEST_NOT_FOUND for a profile with nothing pending, on the read and on both actions', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const personal = await personalOf(h, p.id);
    for (const res of [
      await get(h, `/v1/operator/firm-requests/${personal}`, op.token),
      await post(h, `/v1/operator/firm-requests/${personal}/enable`, op.token, {}),
      await post(h, `/v1/operator/firm-requests/${personal}/decline`, op.token),
    ]) {
      expect(res.status).toBe(404);
      expect(await read(res)).toMatchObject({ error: { code: 'NOT_FOUND', details: { reason: 'FIRM_REQUEST_NOT_FOUND' } } });
    }
  });

  it('enables an operator firm with the owners named; everyone else becomes BOOKKEEPER; audited with the operator', async () => {
    const h = harness();
    const op = await operator(h);
    const firm = await operatorFirmRequest(h);
    const res = await post(h, `/v1/operator/firm-requests/${firm.organizationId}/enable`, op.token, { ownerUserIds: [firm.requester.id] });
    expect(res.status).toBe(200);
    expect((await read(res)).organization).toMatchObject({ id: firm.organizationId, firm: { enabledAt: h.clock.now.toISOString(), requestedAt: null } });
    expect(await h.store.memberships.find(firm.requester.id, firm.organizationId)).toMatchObject({ role: 'OWNER' });
    expect(await h.store.memberships.find(firm.other.id, firm.organizationId)).toMatchObject({ role: 'BOOKKEEPER' });
    expect(await auditOn(h, firm.organizationId, 'firm.')).toEqual([
      { action: 'firm.enabled', actorType: 'ADMIN', actorId: op.id, metadata: { ownerUserIds: [firm.requester.id] } },
      expect.objectContaining({ action: 'firm.requested', actorType: 'USER' }),
    ]);
    expect((await read(await get(h, '/v1/operator/firm-requests', op.token))).data).toEqual([]);
  });

  it('refuses an operator firm with no owner (422) or an owner who is not a member (409 NOT_A_MEMBER), as the CLI does', async () => {
    const h = harness();
    const op = await operator(h);
    const firm = await operatorFirmRequest(h);
    const outsider = await person(h);
    const none = await post(h, `/v1/operator/firm-requests/${firm.organizationId}/enable`, op.token, {});
    expect(none.status).toBe(422);
    expect(await read(none)).toMatchObject({ error: { details: { field: 'ownerUserIds' } } });
    const notMember = await post(h, `/v1/operator/firm-requests/${firm.organizationId}/enable`, op.token, { ownerUserIds: [outsider.id] });
    expect(notMember.status).toBe(409);
    expect(await read(notMember)).toMatchObject({ error: { details: { reason: 'NOT_A_MEMBER' } } });
  });

  it('enables an owned Business profile in place: its owner stays OWNER, no owners needed', async () => {
    const h = harness();
    const op = await operator(h);
    const owned = await ownedRequest(h);
    const res = await post(h, `/v1/operator/firm-requests/${owned.organizationId}/enable`, op.token, {});
    expect(res.status).toBe(200);
    expect((await read(res)).organization).toMatchObject({ ownerUserId: owned.p.id, firm: { enabledAt: expect.any(String) } });
    expect(await h.store.memberships.find(owned.p.id, owned.organizationId)).toMatchObject({ role: 'OWNER' });
  });

  it('declines a request: it leaves the list, the profile stays as it was, audited with the operator', async () => {
    const h = harness();
    const op = await operator(h);
    const owned = await ownedRequest(h);
    const res = await post(h, `/v1/operator/firm-requests/${owned.organizationId}/decline`, op.token);
    expect(res.status).toBe(200);
    expect((await read(res)).organization).toMatchObject({ id: owned.organizationId, firm: { enabledAt: null, requestedAt: null } });
    expect((await auditOn(h, owned.organizationId, 'firm.')).find((e) => e.action === 'firm.request_declined')).toEqual({ action: 'firm.request_declined', actorType: 'ADMIN', actorId: op.id, metadata: null });
    expect((await read(await get(h, '/v1/operator/firm-requests', op.token))).data).toEqual([]);
  });
});

describe('MUT-462 the console’s rules hold for every new route', () => {
  it('every write needs a passkey step-up: a fresh password session is refused and nothing changes', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const owned = await ownedRequest(h);
    const grant = await read(await adminSend(h, 'POST', '/admin/v1/billing/grants', { userId: p.id, ...GRANT }));
    const stale = await passwordSignIn(h, op.email, op.password);
    for (const [method, path, body] of [
      ['POST', accountPath(p.id, 'billing-grants'), GRANT],
      ['DELETE', accountPath(p.id, `billing-grants/${grant.id}`), undefined],
      ['PUT', accountPath(p.id, 'features/agent_access'), undefined],
      ['DELETE', accountPath(p.id, 'features/agent_access'), undefined],
      ['POST', `/v1/operator/firm-requests/${owned.organizationId}/enable`, {}],
      ['POST', `/v1/operator/firm-requests/${owned.organizationId}/decline`, undefined],
    ] as const) {
      const res = await send(h, method, path, stale, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await read(res)).toMatchObject({ error: { code: 'RECENT_SIGN_IN_REQUIRED' } });
    }
    expect((await h.store.billing.listGrants({ userId: p.id })).map((g) => g.revokedAt)).toEqual([null]);
    expect(await h.store.features.activeFor(p.id)).toEqual([]);
    expect((await h.store.organizations.getById(owned.organizationId))?.firmRequestedAt).not.toBeNull();
  });

  it('a signed-in person who is not an operator gets 404 on every new route; signed out gets 401', async () => {
    const h = harness();
    const p = await person(h);
    const token = await passwordSignIn(h, p.email, p.password);
    const owned = await ownedRequest(h);
    const paths = [accountPath(p.id, 'billing-grants'), '/v1/operator/firm-requests', `/v1/operator/firm-requests/${owned.organizationId}`];
    for (const path of paths) {
      expect((await get(h, path, token)).status, path).toBe(404);
      expect((await h.app.request(path)).status, path).toBe(401);
    }
    expect((await post(h, `/v1/operator/firm-requests/${owned.organizationId}/decline`, token)).status).toBe(404);
  });

  it('never grants billing or a flag on the operator’s own account (409 OWN_ACCOUNT), and nothing changes', async () => {
    const h = harness();
    const op = await operator(h);
    for (const [method, path, body] of [
      ['POST', accountPath(op.id, 'billing-grants'), GRANT],
      ['PUT', accountPath(op.id, 'features/agent_access'), undefined],
      ['DELETE', accountPath(op.id, 'features/agent_access'), undefined],
    ] as const) {
      const res = await send(h, method, path, op.token, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(await read(res)).toMatchObject({ error: { details: { reason: 'OWN_ACCOUNT' } } });
    }
    expect(await h.store.billing.listGrants({ userId: op.id })).toEqual([]);
    expect(await h.store.features.activeFor(op.id)).toEqual([]);
  });

  it('an operator whose own trial lapsed still grants, flags and decides firm requests (ADR-212 D2)', async () => {
    const h = harness({ billingGate: true });
    const op = await operator(h);
    const p = await person(h);
    // An operator-made firm's request: making a profile through /v1/profiles would meet the gate itself.
    const firm = await operatorFirmRequest(h);
    await h.store.billing.setTrialStart(op.id, new Date(h.clock.now.getTime() - 31 * 24 * 60 * 60_000));
    const token = op.token;
    expect((await read(await get(h, '/v1/inbox', token))).error.code).toBe('SUBSCRIPTION_LAPSED');
    expect((await get(h, '/v1/operator/firm-requests', token)).status).toBe(200);
    expect((await get(h, accountPath(p.id, 'billing-grants'), token)).status).toBe(200);
    expect((await post(h, accountPath(p.id, 'billing-grants'), token, GRANT)).status).toBe(201);
    expect((await send(h, 'PUT', accountPath(p.id, 'features/agent_access'), token)).status).toBe(200);
    expect((await post(h, `/v1/operator/firm-requests/${firm.organizationId}/decline`, token)).status).toBe(200);
  });
});

const omit = (record: Loose, keys: string[]) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

describe('MUT-462 the same result as the CLI, the actor aside', () => {
  const strip = (body: Loose, ids: Record<string, string>) => {
    let text = JSON.stringify(body);
    for (const [from, to] of Object.entries(ids)) text = text.replaceAll(from, to);
    return JSON.parse(text);
  };

  it('a billing grant and its revoke answer what /admin/v1/billing/grants answers', async () => {
    const h = harness();
    const op = await operator(h);
    const viaAdmin = await person(h);
    const viaOperator = await person(h);
    const admin = await read(await adminSend(h, 'POST', '/admin/v1/billing/grants', { userId: viaAdmin.id, ...GRANT }));
    const console = await read(await post(h, accountPath(viaOperator.id, 'billing-grants'), op.token, GRANT));
    const ids = { [admin.id]: 'GRANT', [console.id]: 'GRANT', [viaAdmin.id]: 'USER', [viaOperator.id]: 'USER' };
    expect(strip({ ...console, grantedBy: 'BY' }, ids)).toEqual(strip({ ...admin, grantedBy: 'BY' }, ids));
    expect(admin.grantedBy).toBe('admin');

    const revokedAdmin = await read(await adminSend(h, 'DELETE', `/admin/v1/billing/grants/${admin.id}`));
    const revokedConsole = await read(await send(h, 'DELETE', accountPath(viaOperator.id, `billing-grants/${console.id}`), op.token));
    const noBy = (b: Loose) => strip({ ...b, grant: { ...b.grant, grantedBy: 'BY' } }, ids);
    expect(noBy(revokedConsole)).toEqual(noBy(revokedAdmin));

    const rows = async (userId: string) => (await auditOn(h, await personalOf(h, userId), 'billing.')).map((r) => strip({ ...r, actorId: 'ACTOR' }, ids));
    expect(await rows(viaOperator.id)).toEqual(await rows(viaAdmin.id));
  });

  it('a flag on and off answers what /admin/v1/users/{id}/features answers', async () => {
    const h = harness();
    const op = await operator(h);
    const viaAdmin = await person(h);
    const viaOperator = await person(h);
    for (const method of ['PUT', 'PUT', 'DELETE', 'DELETE']) {
      const admin = await read(await adminSend(h, method, `/admin/v1/users/${viaAdmin.id}/features/agent_access`));
      const console = await read(await send(h, method, accountPath(viaOperator.id, 'features/agent_access'), op.token));
      expect(console).toEqual(admin);
    }
  });

  it('enabling and declining a firm request answer what the admin organization routes answer', async () => {
    const h = harness();
    const op = await operator(h);
    const [a, b] = [await operatorFirmRequest(h), await operatorFirmRequest(h)];
    const admin = await read(await adminSend(h, 'PATCH', `/admin/v1/organizations/${a.organizationId}`, { firmEnabled: true, ownerUserIds: [a.requester.id] }));
    const console = await read(await post(h, `/v1/operator/firm-requests/${b.organizationId}/enable`, op.token, { ownerUserIds: [b.requester.id] }));
    const ids = (x: typeof a) => ({ [x.organizationId]: 'ORG', [x.requester.id]: 'OWNER' });
    const comparable = (body: Loose, x: typeof a) => {
      // The two firms differ only in what makes them two: name, slug, when each was made.
      return omit(strip(body, ids(x)).organization, ['name', 'slug', 'createdAt', 'updatedAt']);
    };
    expect(comparable(console, b)).toEqual(comparable(admin, a));

    const [c, d] = [await ownedRequest(h), await ownedRequest(h)];
    const declinedAdmin = await read(await adminSend(h, 'DELETE', `/admin/v1/organizations/${c.organizationId}/firm-request`));
    const declinedConsole = await read(await post(h, `/v1/operator/firm-requests/${d.organizationId}/decline`, op.token));
    const owned = (body: Loose, x: typeof c) => {
      return omit(strip(body, { [x.organizationId]: 'ORG', [x.p.id]: 'OWNER' }).organization, ['slug', 'createdAt', 'updatedAt']);
    };
    expect(owned(declinedConsole, d)).toEqual(owned(declinedAdmin, c));
  });
});
