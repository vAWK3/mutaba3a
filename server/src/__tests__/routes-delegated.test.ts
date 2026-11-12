import { describe, expect, it } from 'vitest';
import {
  addExpense,
  assertion,
  ASSERTION_TYPE,
  authorizeDelegated,
  connectDelegated,
  delegatedHarness,
  lawyer,
  MALAFAT_CB,
  malafatFirm,
  refreshDelegated,
  signingKey,
  V1,
  type DelegatedHarness,
} from './helpers/delegated.js';
import { ADMIN, connect, form, json, ORIGIN, person, read, VERIFIER } from './helpers/oauth-agent.js';

/** MUT-593 (ADR-254): Malafat calls /v1 as the person, with a tenant-bound delegated token. */

const later = (h: DelegatedHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));

async function setup() {
  const h = await delegatedHarness();
  const firm = await malafatFirm(h);
  const p = await lawyer(h, firm);
  const conn = await connectDelegated(h, p, firm);
  return { h, firm, p, conn };
}

describe('a delegated call (AC1, ADR-254 §4.2)', () => {
  it('reaches an opted-in route on the firm profile as the person, audited via Malafat', async () => {
    const { h, firm, p, conn } = await setup();
    const res = await addExpense(h, conn.headers());
    expect(res.status).toBe(201);
    const expense = await read(res);
    const rows = (await h.store.audit.listByOrganization(firm.organizationId, 100)).filter((e) => e.entityId === expense.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ actorType: 'USER', actorId: p.userId, metadata: expect.objectContaining({ via: 'malafat' }) });
    expect((await h.app.request('/v1/expenses', { headers: conn.headers() })).status).toBe(200);
  });

  it('is the same 404 on the person’s own profiles as on one that was never theirs', async () => {
    const { h, p, conn } = await setup();
    const own = await h.app.request('/v1/expenses', { headers: conn.headers(p.personalId) });
    expect(own.status).toBe(404);
    expect((await read(own)).error).toMatchObject({ code: 'NOT_FOUND', details: { reason: 'PROFILE_NOT_FOUND' } });
    const stranger = await malafatFirm(h);
    expect((await h.app.request('/v1/expenses', { headers: conn.headers(stranger.organizationId) })).status).toBe(404);
    expect((await addExpense(h, conn.headers(p.personalId))).status).toBe(404);
  });

  it('is refused on routes that do not declare it, whatever the profile', async () => {
    const { h, p, conn } = await setup();
    const auth = { authorization: conn.headers().authorization! };
    const refused: Array<[string, RequestInit]> = [
      ['/v1/me/password', json({ currentPassword: p.password, newPassword: 'another long passphrase here' }, auth)],
      ['/v1/sessions/current', { method: 'DELETE', headers: auth }],
      ['/v1/oauth/grants', { headers: auth }],
      ['/v1/me/connected-apps', { headers: auth }],
      ['/v1/entries', { headers: auth }],
      ['/v1/summaries/verdict', { headers: auth }],
      ['/v1/customers', { headers: conn.headers() }],
      ['/v1/records-export', { headers: conn.headers() }],
    ];
    for (const [path, init] of refused) {
      const res = await h.app.request(path, init);
      expect(res.status, path).toBe(403);
      expect((await read(res)).error.code, path).toBe('PRINCIPAL_NOT_ACCEPTED');
    }
  });

  it('/v1/me lists only the tenant’s profile and none of the person’s own standing', async () => {
    const { h, firm, conn } = await setup();
    const me = await read(await h.app.request('/v1/me', { headers: { authorization: conn.headers().authorization! } }));
    expect(me.profiles.map((x: { id: string }) => x.id)).toEqual([firm.organizationId]);
    expect(me).not.toHaveProperty('clients');
    expect(me.user).not.toHaveProperty('operator');
    expect(me.billingStanding).toBeNull();
  });

  it('keeps the person’s firm role: a write the session may not make, Malafat may not make either', async () => {
    const { h, firm, p, conn } = await setup();
    const asSession = await h.app.request('/v1/conversions', { headers: { ...p.cookie, 'x-mutaba3a-profile': firm.organizationId } });
    const asMalafat = await h.app.request('/v1/conversions', { headers: conn.headers() });
    expect(asMalafat.status).toBe(asSession.status);
  });
});

describe('the organization key (AC2)', () => {
  it('cannot mint a delegated token or use one route meant for the person', async () => {
    const { h, firm } = await setup();
    // As the client assertion, and as the client.
    const minted = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: 'mrt_x', client_assertion_type: ASSERTION_TYPE, client_assertion: firm.orgKey }));
    expect(minted.status).toBe(401);
    expect((await read(minted)).error).toBe('invalid_client');
    // On the person's routes: it was never one of the principals.
    const expenses = await h.app.request('/v1/expenses', { headers: { authorization: `Bearer ${firm.orgKey}` } });
    expect(expenses.status).toBe(403);
  });

  it('a delegated token never opens /mcp, and an agent’s token never opens a delegated route', async () => {
    const { h, p, conn } = await setup();
    const mcp = await h.app.request('/mcp', { method: 'POST', headers: { authorization: conn.headers().authorization!, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(mcp.status).toBe(401);
    await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN });
    const agent = await connect(h, p);
    const res = await h.app.request('/v1/expenses', { headers: { ...agent.bearer, 'x-mutaba3a-profile': p.personalId } });
    expect(res.status).toBe(401);
  });
});

describe('the confidential client at the token endpoint (ADR-197 §5)', () => {
  it('must prove itself on the code exchange and on every refresh', async () => {
    const { h, conn } = await setup();
    const bare = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: conn.refresh_token }));
    expect(bare.status).toBe(401);
    const stranger = await signingKey();
    const forged = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: conn.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h, { privateKey: stranger.privateKey }) }));
    expect(forged.status).toBe(401);
    const replayed = await assertion(h);
    const first = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: conn.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: replayed }));
    expect(first.status).toBe(200);
    const again = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: (await read(first)).refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: replayed }));
    expect(again.status).toBe(401);
  });

  it('rotates refresh tokens, and a reused one ends the grant', async () => {
    const { h, conn } = await setup();
    const rotated = await refreshDelegated(h, conn.refresh_token);
    expect(rotated.status).toBe(200);
    const next = await read(rotated);
    expect((await addExpense(h, { authorization: `Bearer ${next.access_token}`, 'x-mutaba3a-profile': conn.headers()['x-mutaba3a-profile']! })).status).toBe(201);
    later(h, 60_000);
    const reused = await refreshDelegated(h, conn.refresh_token);
    expect(reused.status).toBe(400);
    expect((await read(reused)).error).toBe('invalid_grant');
    expect((await addExpense(h, { authorization: `Bearer ${next.access_token}`, 'x-mutaba3a-profile': conn.headers()['x-mutaba3a-profile']! })).status).toBe(401);
  });

  it('a routine key rotation keeps every connection; the new key signs, the old one no longer does (R4)', async () => {
    const { h, conn } = await setup();
    const next = await signingKey('k1');
    const old = h.privateKey;
    h.rotate(next.jwk);
    expect((await addExpense(h, conn.headers())).status).toBe(201);
    const withOld = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: conn.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h, { privateKey: old }) }));
    expect(withOld.status).toBe(401);
    const withNew = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: conn.refresh_token, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h, { privateKey: next.privateKey }) }));
    expect(withNew.status).toBe(200);
  });

  it('a public client can neither ask for /v1 nor send an assertion', async () => {
    const h = await delegatedHarness();
    const reg = await h.app.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }));
    const publicId = (await read(reg)).client_id as string;
    const query = new URLSearchParams({ response_type: 'code', client_id: publicId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: V1 });
    const res = await h.app.request(`/oauth/authorize?${query.toString()}`);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_target');
    const token = await h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: publicId, refresh_token: 'mrt_x', client_assertion_type: ASSERTION_TYPE, client_assertion: 'x.y.z' }));
    expect(token.status).toBe(401);
  });
});

describe('consent names one firm the person is in (R6)', () => {
  it('refuses a tenant the person is not a member of, and one whose switch is off', async () => {
    const h = await delegatedHarness();
    const firm = await malafatFirm(h);
    const other = await malafatFirm(h);
    const dark = await malafatFirm(h, { enabled: false });
    const p = await lawyer(h, firm);
    await h.store.memberships.grant(p.userId, dark.organizationId, h.now());
    for (const tenant of [other.tenant, dark.tenant]) {
      const started = await authorizeDelegated(h, tenant);
      const requestId = new URL(started.headers.get('location') ?? '', ORIGIN).searchParams.get('request') ?? '';
      const described = await read(await h.app.request(`/v1/oauth/requests/${requestId}`, { headers: p.cookie }));
      expect(described).toMatchObject({ client: { kind: 'CONFIDENTIAL' }, agentAccess: false });
      const decided = await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie));
      expect(decided.status).toBe(403);
    }
  });

  it('needs the tenant named, and a resource only this client may ask for', async () => {
    const h = await delegatedHarness();
    const noTenant = await h.app.request(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: h.clientId, redirect_uri: MALAFAT_CB, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: V1 }).toString()}`);
    expect(new URL(noTenant.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_request');
    const mcp = await authorizeDelegated(h, 'tenant-x', { resource: `${ORIGIN}/mcp` });
    expect(new URL(mcp.headers.get('location') ?? '').searchParams.get('error')).toBe('invalid_target');
  });
});

describe('each revocation ends access on the next call (ADR-254 §4.7)', () => {
  it('the person revokes Malafat in Connected apps', async () => {
    const { h, p, conn, firm } = await setup();
    const list = await read(await h.app.request('/v1/me/connected-apps', { headers: p.cookie }));
    expect(list.items).toEqual([expect.objectContaining({ clientName: 'Malafat', tenantId: firm.tenant, firmName: expect.stringContaining('Sader Law Office') })]);
    const del = await h.app.request(`/v1/me/connected-apps/${list.items[0].grantId}`, { method: 'DELETE', headers: p.cookie });
    expect(del.status).toBe(204);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
    expect((await read(await h.app.request('/v1/me/connected-apps', { headers: p.cookie }))).items).toEqual([]);
  });

  it('the person is removed from the firm', async () => {
    const { h, p, conn, firm } = await setup();
    await h.store.memberships.revoke(p.userId, firm.organizationId);
    expect((await addExpense(h, conn.headers())).status).toBe(404);
  });

  it('the firm disconnects Malafat, and reconnecting revives nothing', async () => {
    const { h, conn, firm } = await setup();
    const res = await h.app.request('/v1/integration/disconnect', json({}, { authorization: `Bearer ${firm.orgKey}`, 'idempotency-key': 'disc-0000000001' }));
    expect(res.status).toBe(200);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
    const integration = await h.store.integrations.findByProviderAndTenant('MALAFAT', firm.tenant);
    await h.store.integrations.connect({ organizationId: firm.organizationId, provider: 'MALAFAT', externalTenantId: firm.tenant, displayName: 'again', connectedByApiKeyId: integration!.connectedByApiKeyId ?? '', at: h.now() });
    expect((await addExpense(h, conn.headers())).status).toBe(401);
  });

  it('a password change ends it (DF2)', async () => {
    const { h, p, conn } = await setup();
    const res = await h.app.request('/v1/me/password', json({ currentPassword: p.password, newPassword: 'a different long passphrase' }, p.cookie));
    expect(res.status).toBeLessThan(300);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
  });

  it('the operator disables the account (DF2)', async () => {
    const { h, p, conn } = await setup();
    expect((await h.app.request(`/admin/v1/users/${p.userId}/disable`, { method: 'POST', headers: ADMIN })).status).toBe(200);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
  });

  it('the operator signs the person out everywhere (DF2)', async () => {
    const { h, p, conn } = await setup();
    expect((await h.app.request(`/admin/v1/users/${p.userId}/sessions/revoke`, { method: 'POST', headers: ADMIN })).status).toBe(200);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
  });

  it('the per-firm switch goes off, and back on revives nothing', async () => {
    const { h, conn, firm } = await setup();
    const off = await h.store.integrations.setDelegation({ id: firm.integrationId, enabled: false, by: null, at: h.now(), audit: [] });
    expect(off?.grantsRevoked).toBe(1);
    expect((await addExpense(h, conn.headers())).status).toBe(401);
    await h.store.integrations.setDelegation({ id: firm.integrationId, enabled: true, by: null, at: h.now(), audit: [] });
    expect((await addExpense(h, conn.headers())).status).toBe(401);
  });

  it('the operator disables the client', async () => {
    const { h, conn } = await setup();
    const res = await h.app.request(`/admin/v1/oauth/confidential-clients/${h.clientId}/disable`, { method: 'POST', headers: ADMIN });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ grantsRevoked: 1, disabledAt: expect.any(String) });
    expect((await addExpense(h, conn.headers())).status).toBe(401);
    expect((await refreshDelegated(h, conn.refresh_token)).status).toBe(401);
  });

  it('revoking agent_access leaves Malafat connected (the flag governs agents only)', async () => {
    const { h, p, conn } = await setup();
    await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN });
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);
    expect((await addExpense(h, conn.headers())).status).toBe(201);
  });
});

describe('the global switch (MALAFAT_DELEGATION)', () => {
  it('off: no confidential client is served, and Connected apps answers 404', async () => {
    const h = await delegatedHarness({ malafatDelegation: false });
    const firm = await malafatFirm(h);
    const res = await authorizeDelegated(h, firm.tenant);
    expect(res.headers.get('location')).toContain('error=invalid_client');
    const p = await person(h, { flag: false });
    expect((await h.app.request('/v1/me/connected-apps', { headers: p.cookie })).status).toBe(404);
    const token = await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: h.clientId, code: 'mac_x', code_verifier: VERIFIER, redirect_uri: MALAFAT_CB, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h) }));
    expect(token.status).toBe(401);
  });

  it('the agents list never shows Malafat, and Connected apps never shows an agent', async () => {
    const { h, p } = await setup();
    await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN });
    await connect(h, p);
    const agents = await read(await h.app.request('/v1/oauth/grants', { headers: p.cookie }));
    expect(agents.items.map((g: { clientName: string }) => g.clientName)).toEqual(['Claude']);
    const apps = await read(await h.app.request('/v1/me/connected-apps', { headers: p.cookie }));
    expect(apps.items.map((g: { clientName: string }) => g.clientName)).toEqual(['Malafat']);
  });
});

describe('a period download minted as the person (ADR-248, MUT-593)', () => {
  it('streams while the connection lives, and dies with it', async () => {
    const h = await delegatedHarness({ periodDownloads: true });
    const firm = await malafatFirm(h);
    const p = await lawyer(h, firm);
    const conn = await connectDelegated(h, p, firm);
    const mint = async () => {
      const res = await h.app.request('/v1/period-downloads/ticket?type=report&from=2026-10&to=2026-10', { headers: conn.headers() });
      expect(res.status).toBe(200);
      return (await read(res)).ticket as string;
    };
    const stream = (ticket: string) => h.app.request('/v1/period-downloads/stream', json({ ticket }));
    expect((await stream(await mint())).status).toBe(200);
    const ticket = await mint();
    const list = await read(await h.app.request('/v1/me/connected-apps', { headers: p.cookie }));
    await h.app.request(`/v1/me/connected-apps/${list.items[0].grantId}`, { method: 'DELETE', headers: p.cookie });
    expect((await stream(ticket)).status).toBe(404);
  });
});
