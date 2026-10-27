import { describe, expect, it } from 'vitest';
import { provisionUser, setupTokenOf } from './helpers/provision.js';
import { ADMIN, get, harness, json, minutes, operator, passwordSignIn, pendingSignup, person, post, read, SAME_ORIGIN, type Harness, type Loose } from './helpers/operator-harness.js';

/**
 * MUT-461 (ADR-212 D1, D5, E10): the operator console's accounts, end to end through the real app. Find by exact
 * email, the account view, and the account actions — disable/enable, sign out everywhere, a one-time setup link —
 * answering what /admin/v1/users answers for the same action (one action module), audited with the operator's id,
 * behind the passkey step-up, and never on the operator's own account.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000461';
const accountsPath = (userId: string, action = '') => `/v1/operator/accounts/${userId}${action ? `/${action}` : ''}`;

async function personalOf(h: Harness, userId: string) {
  const [personal] = await h.store.memberships.listByUser(userId);
  return personal!.organizationId;
}

/** The person's audit rows on their personal profile, oldest first, after `since` (row ids already seen). */
async function auditOf(h: Harness, userId: string, prefix = 'user.', since: ReadonlySet<string> = new Set()) {
  const items = (await h.store.audit.list(await personalOf(h, userId), {}, { limit: 100, cursor: null })).items;
  return items.filter((e) => e.action.startsWith(prefix) && !since.has(e.id)).map((e) => ({ action: e.action, actorType: e.actorType, actorId: e.actorId, metadata: e.metadata ?? null }));
}
const auditIds = async (h: Harness, userId: string) => new Set((await h.store.audit.list(await personalOf(h, userId), {}, { limit: 100, cursor: null })).items.map((e) => e.id));

describe('MUT-461 find an account by email', () => {
  it('matches the normalised address exactly, and says when the step-up lapses', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const res = await get(h, `/v1/operator/accounts?email=${encodeURIComponent(`  ${p.email.toUpperCase()} `)}`, op.token);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.account).toEqual({ id: p.id, email: p.email, displayName: 'Basel Sader', status: 'ACTIVE' });
    expect(Date.parse(body.stepUpUntil)).toBeGreaterThan(h.clock.now.getTime());
  });

  it('answers 200 { account: null } for an address with no account (never a 404: design 3A), and nothing for a prefix (D5)', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    expect(await read(await get(h, '/v1/operator/accounts?email=nobody%40studio.example', op.token))).toMatchObject({ account: null });
    expect(await read(await get(h, `/v1/operator/accounts?email=${encodeURIComponent(p.email.slice(0, 6))}`, op.token))).toMatchObject({ account: null });
    expect((await get(h, '/v1/operator/accounts', op.token)).status).toBe(422);
  });
});

describe('MUT-461 the account view', () => {
  it('shows status, last sign-in, passkeys, flags, live devices and agents, and each profile with its billing', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    await passwordSignIn(h, p.email, p.password);
    await passwordSignIn(h, p.email, p.password);
    expect((await h.app.request(`/admin/v1/users/${p.id}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);

    const res = await get(h, accountsPath(p.id), op.token);
    expect(res.status).toBe(200);
    const { account, stepUpUntil } = await read(res);
    expect(stepUpUntil).toEqual(expect.any(String));
    expect(account).toMatchObject({
      id: p.id,
      email: p.email,
      status: 'ACTIVE',
      closing: false,
      operator: false,
      lastSignInAt: h.clock.now.toISOString(),
      passkeyCount: 0,
      features: ['agent_access'],
      activeSessionCount: 2,
      agentGrantCount: 0,
    });
    const personal = await personalOf(h, p.id);
    expect(account.profiles).toEqual([
      expect.objectContaining({ id: personal, role: 'OWNER', personal: true, owned: true, firmEnabledAt: null, firmRequestedAt: null, billing: expect.objectContaining({ state: expect.any(String), source: expect.any(String) }) }),
    ]);
    // The view never carries a credential or a link.
    expect(JSON.stringify(account)).not.toMatch(/passwordHash|setup#|tokenDigest/);
  });

  it('shows an operator as one, with their passkey', async () => {
    const h = harness();
    const op = await operator(h);
    expect((await read(await get(h, accountsPath(op.id), op.token))).account).toMatchObject({ operator: true, passkeyCount: 1 });
  });

  it('answers 404 NOT_FOUND with reason ACCOUNT_NOT_FOUND for an account that does not exist', async () => {
    const h = harness();
    const op = await operator(h);
    const res = await get(h, accountsPath(UNKNOWN), op.token);
    expect(res.status).toBe(404);
    expect((await read(res)).error).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'ACCOUNT_NOT_FOUND' } });
  });
});

describe('MUT-461 account actions from the operator console', () => {
  it('every action needs a passkey step-up: a fresh password session is refused and nothing changes', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    for (const action of ['disable', 'enable', 'sessions/revoke', 'setup-link']) {
      const res = await post(h, accountsPath(p.id, action), op.passwordToken);
      expect([action, res.status, (await read(res)).error.code]).toEqual([action, 403, 'RECENT_SIGN_IN_REQUIRED']);
    }
    expect((await h.store.users.getById(p.id))?.status).toBe('ACTIVE');
    expect(await auditOf(h, p.id, 'user.disabled')).toEqual([]);
  });

  it('disable signs the person out everywhere, says how many, blocks sign-in, and is audited with the operator', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const theirs = await passwordSignIn(h, p.email, p.password);

    const res = await post(h, accountsPath(p.id, 'disable'), op.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ user: { id: p.id, status: 'DISABLED' }, sessionsRevoked: 1, agentGrantsRevoked: 0 });
    expect((await get(h, '/v1/me', theirs)).status).toBe(401);
    expect((await h.app.request('/v1/sessions', json({ email: p.email, password: p.password }, SAME_ORIGIN))).status).toBe(401);
    expect(await auditOf(h, p.id, 'user.disabled')).toEqual([{ action: 'user.disabled', actorType: 'ADMIN', actorId: op.id, metadata: null }]);

    // Disabling again changes nothing and audits nothing; enabling opens the account again, audited.
    expect(await read(await post(h, accountsPath(p.id, 'disable'), op.token))).toMatchObject({ user: { status: 'DISABLED' }, sessionsRevoked: 0 });
    minutes(h, 1);
    expect(await read(await post(h, accountsPath(p.id, 'enable'), op.token))).toMatchObject({ user: { status: 'ACTIVE' }, sessionsRevoked: 0, agentGrantsRevoked: 0 });
    expect((await auditOf(h, p.id)).filter((e) => e.action === 'user.disabled' || e.action === 'user.enabled').map((e) => [e.action, e.actorId])).toEqual([
      ['user.disabled', op.id],
      ['user.enabled', op.id],
    ]);
  });

  it('refuses to disable a signup waiting for review (409 USER_PENDING_REVIEW), as the CLI does', async () => {
    const h = harness();
    const op = await operator(h);
    const waiting = await pendingSignup(h);
    const res = await post(h, accountsPath(waiting.userId, 'disable'), op.token);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'USER_PENDING_REVIEW' });
  });

  it('sign out everywhere ends every live session, says how many, and is audited with the operator', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const one = await passwordSignIn(h, p.email, p.password);
    await passwordSignIn(h, p.email, p.password);

    const res = await post(h, accountsPath(p.id, 'sessions/revoke'), op.token);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ revoked: 2, agentGrantsRevoked: 0 });
    expect((await get(h, '/v1/me', one)).status).toBe(401);
    // The password still works (4A: "the password still works").
    expect((await h.app.request('/v1/sessions', json({ email: p.email, password: p.password }, SAME_ORIGIN))).status).toBe(201);
    expect(await auditOf(h, p.id, 'user.sessions_revoked')).toEqual([{ action: 'user.sessions_revoked', actorType: 'ADMIN', actorId: op.id, metadata: { revoked: 2, agentGrantsRevoked: 0 } }]);
  });

  it('a setup link is returned once, works, is audited with the operator, and the view never shows it again', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const before = await auditIds(h, p.id);
    const res = await post(h, accountsPath(p.id, 'setup-link'), op.token, {});
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body).toMatchObject({ user: { id: p.id }, lock: false, setupLink: { purpose: 'RESET', url: expect.stringMatching(/^http:\/\/localhost\/setup#/) } });
    expect(JSON.stringify(await read(await get(h, accountsPath(p.id), op.token)))).not.toContain(setupTokenOf(body.setupLink.url));
    expect(await auditOf(h, p.id, 'user.setup_link_issued', before)).toEqual([
      { action: 'user.setup_link_issued', actorType: 'ADMIN', actorId: op.id, metadata: { purpose: 'RESET', expiresAt: body.setupLink.expiresAt } },
    ]);
    const check = await h.app.request('/v1/account-setup/check', json({ token: setupTokenOf(body.setupLink.url) }, SAME_ORIGIN));
    expect(await read(check)).toMatchObject({ state: 'valid', email: p.email });
  });

  it('a setup link with lock stops the password and signs the person out now (a suspected takeover)', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    const theirs = await passwordSignIn(h, p.email, p.password);
    const res = await post(h, accountsPath(p.id, 'setup-link'), op.token, { lock: true, validHours: 24 });
    expect(await read(res)).toMatchObject({ lock: true, setupLink: { expiresAt: new Date(h.clock.now.getTime() + 24 * 3_600_000).toISOString() } });
    expect((await get(h, '/v1/me', theirs)).status).toBe(401);
    expect((await h.app.request('/v1/sessions', json({ email: p.email, password: p.password }, SAME_ORIGIN))).status).toBe(401);
  });

  it('refuses a setup link for a disabled account (409 USER_DISABLED), as the CLI does', async () => {
    const h = harness();
    const op = await operator(h);
    const p = await person(h);
    await post(h, accountsPath(p.id, 'disable'), op.token);
    const res = await post(h, accountsPath(p.id, 'setup-link'), op.token);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'USER_DISABLED' });
  });

  it('answers 404 ACCOUNT_NOT_FOUND to every action on an account that does not exist', async () => {
    const h = harness();
    const op = await operator(h);
    for (const action of ['disable', 'enable', 'sessions/revoke', 'setup-link']) {
      const res = await post(h, accountsPath(UNKNOWN, action), op.token);
      expect([action, res.status, (await read(res)).error.details?.reason]).toEqual([action, 404, 'ACCOUNT_NOT_FOUND']);
    }
  });
});

describe('MUT-461 integration keys (/qa-reconcile D1)', () => {
  it("an API key's /v1/audit never lists a person's sign-out everywhere; the profile's own audit does", async () => {
    const h = harness();
    const op = await operator(h);
    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Haddad Law', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const apiKey = await read(await h.app.request(`/admin/v1/organizations/${firm.id}/api-keys`, json({ name: 'Malafat', scopes: ['audit:read'] }, ADMIN)));
    const key = { authorization: `Bearer ${apiKey.secret}` };
    const created = await provisionUser(h.app, { email: 'staff@haddad.example', displayName: 'Rami Staff', organizationId: firm.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const userId = created.user.id as string;
    await passwordSignIn(h, 'staff@haddad.example', created.password as string);
    expect((await post(h, accountsPath(userId, 'sessions/revoke'), op.token)).status).toBe(200);

    const firmAudit = (await h.store.audit.list(firm.id, {}, { limit: 100, cursor: null })).items.map((e) => e.action);
    expect(firmAudit).toContain('user.sessions_revoked');
    const listed = await read(await h.app.request('/v1/audit?limit=200', { headers: key }));
    expect(listed.items.filter((e: { action: string }) => e.action === 'user.sessions_revoked')).toEqual([]);
    expect(await read(await h.app.request('/v1/audit?action=user.sessions_revoked', { headers: key }))).toMatchObject({ items: [] });
  });
});

describe('MUT-461 the lapse gate leaves the console open (ADR-212 D2)', () => {
  it('an operator whose own trial lapsed still finds, views and acts on an account', async () => {
    const h = harness({ billingGate: true });
    const op = await operator(h);
    const p = await person(h);
    await h.store.billing.setTrialStart(op.id, new Date(h.clock.now.getTime() - 31 * 24 * 60 * 60_000));
    expect((await read(await get(h, '/v1/inbox', op.token))).error.code).toBe('SUBSCRIPTION_LAPSED');
    expect((await get(h, `/v1/operator/accounts?email=${encodeURIComponent(p.email)}`, op.token)).status).toBe(200);
    expect((await get(h, accountsPath(p.id), op.token)).status).toBe(200);
    for (const action of ['sessions/revoke', 'setup-link', 'disable', 'enable']) {
      expect([action, (await post(h, accountsPath(p.id, action), op.token)).status]).toEqual([action, 200]);
    }
  });
});

describe('MUT-461 self-protection (E10)', () => {
  it('an operator cannot disable, sign out or reset their own account here (409 OWN_ACCOUNT), and nothing changes', async () => {
    const h = harness();
    const op = await operator(h);
    for (const action of ['disable', 'enable', 'sessions/revoke', 'setup-link']) {
      const res = await post(h, accountsPath(op.id, action), op.token, { lock: true });
      expect([action, res.status, (await read(res)).error.details?.reason]).toEqual([action, 409, 'OWN_ACCOUNT']);
    }
    expect((await get(h, '/v1/me', op.token)).status).toBe(200);
    expect((await h.store.users.getById(op.id))?.status).toBe('ACTIVE');
  });

  it('an operator can act on another operator', async () => {
    const h = harness();
    const op = await operator(h);
    const other = await operator(h);
    expect(await read(await post(h, accountsPath(other.id, 'sessions/revoke'), op.token))).toMatchObject({ revoked: 2 });
  });
});

describe('MUT-461 the same result as the CLI (/admin/v1/users), the actor aside', () => {
  const adminPost = (h: Harness, path: string, body: unknown = {}) => h.app.request(path, json(body, ADMIN));

  it('disable, enable, sign out everywhere and a setup link answer what the admin routes answer', async () => {
    const h = harness();
    const op = await operator(h);
    const viaAdmin = await person(h);
    const viaOperator = await person(h);
    for (const p of [viaAdmin, viaOperator]) await passwordSignIn(h, p.email, p.password);
    const provisioned = { admin: await auditIds(h, viaAdmin.id), operator: await auditIds(h, viaOperator.id) };
    const strip = (body: Loose) => JSON.parse(JSON.stringify(body).replaceAll(viaAdmin.id, 'ID').replaceAll(viaOperator.id, 'ID').replaceAll(viaAdmin.email, 'EMAIL').replaceAll(viaOperator.email, 'EMAIL'));

    const sessionsAdmin = await read(await adminPost(h, `/admin/v1/users/${viaAdmin.id}/sessions/revoke`));
    const sessionsOperator = await read(await post(h, accountsPath(viaOperator.id, 'sessions/revoke'), op.token));
    expect(sessionsOperator).toEqual(sessionsAdmin);

    const linkAdmin = await read(await adminPost(h, `/admin/v1/users/${viaAdmin.id}/setup-link`, { validHours: 24 }));
    const linkOperator = await read(await post(h, accountsPath(viaOperator.id, 'setup-link'), op.token, { validHours: 24 }));
    const withoutUrl = (body: Loose) => strip({ ...body, setupLink: { ...body.setupLink, url: 'URL' } });
    expect(withoutUrl(linkOperator)).toEqual(withoutUrl(linkAdmin));

    for (const verb of ['disable', 'enable']) {
      const admin = await read(await adminPost(h, `/admin/v1/users/${viaAdmin.id}/${verb}`));
      const viaConsole = await read(await post(h, accountsPath(viaOperator.id, verb), op.token));
      // The console's answer is the admin one plus what a disable ended (design 4A).
      expect(strip({ user: viaConsole.user })).toEqual(strip(admin));
      expect(Object.keys(viaConsole).sort()).toEqual(['agentGrantsRevoked', 'sessionsRevoked', 'user']);
    }

    // The same audit trail, row for row, after provisioning; only the actor's id differs (the token records none).
    // Sorted: the clock stands still here, so rows written in one instant have no order.
    const adminRows = await auditOf(h, viaAdmin.id, 'user.', provisioned.admin);
    const operatorRows = await auditOf(h, viaOperator.id, 'user.', provisioned.operator);
    expect(adminRows.length).toBeGreaterThanOrEqual(4);
    const comparable = (rows: typeof adminRows) => strip(rows.map((row) => JSON.stringify({ ...row, actorId: 'ACTOR' }))).sort();
    expect(comparable(operatorRows)).toEqual(comparable(adminRows));
    expect(new Set(adminRows.map((e) => e.actorId))).toEqual(new Set([null]));
    expect(new Set(operatorRows.map((e) => e.actorId))).toEqual(new Set([op.id]));
  });
});
