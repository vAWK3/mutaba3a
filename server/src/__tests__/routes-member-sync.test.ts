import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SCOPES } from '../auth/scopes.js';
import type { MalafatRole } from '../repositories/ports.js';
import { addExpense, connectDelegated, delegatedHarness, malafatFirm, type DelegatedHarness, type MalafatFirm } from './helpers/delegated.js';
import { ADMIN, connect, json, person, read, tool, type Person } from './helpers/oauth-agent.js';

/** MUT-594 (ADR-254 D2, D3, D7, DF3, decision 7): Malafat syncs a firm's members; partners own the firm. */

type Seat = { subject: string; email: string; role: MalafatRole };

const sync = (h: DelegatedHarness, firm: MalafatFirm, members: Seat[]) =>
  h.app.request('/v1/integration/members', json({ members }, { authorization: `Bearer ${firm.orgKey}`, 'idempotency-key': `sync-${randomUUID()}` }, 'PUT'));

async function setup() {
  const h = await delegatedHarness({ accountantAccess: true, shareLinks: true });
  const firm = await malafatFirm(h);
  return { h, firm };
}

/** A Malafat person who has signed in to MTB3A with Malafat (MUT-595 calls the same claim). */
async function seated(h: DelegatedHarness, firm: MalafatFirm, subject: string) {
  const p = await person(h, { flag: false });
  const claimed = await h.store.externalIdentities.claim({ provider: 'MALAFAT', tenantId: firm.tenant, subject, userId: p.userId, at: h.now(), audit: [] });
  expect(claimed.claimed).toBe(true);
  await h.store.features.grant({ userId: p.userId, feature: 'accountant_access', grantedBy: 'test', at: h.now(), audit: [] });
  return p;
}

const on = (p: Person, profileId: string) => ({ ...p.cookie, 'x-mutaba3a-profile': profileId });
const invite = (h: DelegatedHarness, p: Person, profileId: string) => h.app.request(`/v1/profiles/${profileId}/accountants`, json({ email: `acc-${randomUUID().slice(0, 8)}@books.ps` }, p.cookie));
const shareLink = (h: DelegatedHarness, p: Person, profileId: string) => h.app.request(`/v1/profiles/${profileId}/share-links`, json({ period: 'LAST_1_MONTH', expiresInDays: 7, pin: '2468' }, p.cookie));

describe('PUT /v1/integration/members', () => {
  it('adds pending seats, and a first sign-in claims one as a membership with the D3 role', async () => {
    const { h, firm } = await setup();
    const res = await sync(h, firm, [
      { subject: 'm-1', email: 'rana@sader.law', role: 'PARTNER' },
      { subject: 'm-2', email: 'omar@sader.law', role: 'ASSOCIATE' },
    ]);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ added: 2, changed: 0, removed: 0, pending: 2 });
    const rana = await seated(h, firm, 'm-1');
    expect((await h.store.memberships.find(rana.userId, firm.organizationId))?.role).toBe('OWNER');
    expect(await read(await sync(h, firm, [
      { subject: 'm-1', email: 'rana@sader.law', role: 'PARTNER' },
      { subject: 'm-2', email: 'omar@sader.law', role: 'OFFICE_ADMIN' },
    ]))).toEqual({ added: 0, changed: 1, removed: 0, pending: 1 });
    expect((await h.store.organizations.getById(firm.organizationId))?.memberSyncAt).toBeInstanceOf(Date);
  });

  it('two first sign-ins claim a seat once', async () => {
    const { h, firm } = await setup();
    await sync(h, firm, [{ subject: 'm-1', email: 'rana@sader.law', role: 'PARTNER' }]);
    const a = await person(h, { flag: false });
    const b = await person(h, { flag: false });
    const claims = await Promise.all([a, b].map((p) => h.store.externalIdentities.claim({ provider: 'MALAFAT', tenantId: firm.tenant, subject: 'm-1', userId: p.userId, at: h.now(), audit: [] })));
    expect(claims.filter((c) => c.claimed)).toHaveLength(1);
  });

  it('leaves alone a member made in MTB3A before the first sync (never matched by email, D4)', async () => {
    const { h, firm } = await setup();
    const legacy = await person(h, { flag: false });
    await h.store.memberships.grant(legacy.userId, firm.organizationId, h.now());
    expect(await read(await sync(h, firm, []))).toEqual({ added: 0, changed: 0, removed: 0, pending: 0 });
    expect(await h.store.memberships.find(legacy.userId, firm.organizationId)).not.toBeNull();
  });

  it('needs a CONNECTED tenant, and each subject once', async () => {
    const { h, firm } = await setup();
    const dup = await sync(h, firm, [{ subject: 'm-1', email: 'a@sader.law', role: 'PARTNER' }, { subject: 'm-1', email: 'b@sader.law', role: 'INTERN' }]);
    expect(dup.status).toBe(422);
    // A firm with a key but never bound to a tenant.
    const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Unbound', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, ADMIN)));
    const res = await sync(h, { ...firm, orgKey: key.secret as string }, []);
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'NOT_CONNECTED' });
  });

  it('is the key’s alone: a person’s session or Malafat’s delegated token is refused', async () => {
    const { h, firm } = await setup();
    await sync(h, firm, [{ subject: 'm-1', email: 'rana@sader.law', role: 'PARTNER' }]);
    const rana = await seated(h, firm, 'm-1');
    const res = await h.app.request('/v1/integration/members', json({ members: [] }, { ...on(rana, firm.organizationId), 'idempotency-key': 'sync-by-session-1' }, 'PUT'));
    expect(res.status).toBe(403);
  });
});

describe('partners own the Malafat firm (decision 7, AC: owner gates)', () => {
  async function partnerAndAssociate() {
    const { h, firm } = await setup();
    await sync(h, firm, [
      { subject: 'p-1', email: 'rana@sader.law', role: 'PARTNER' },
      { subject: 'a-1', email: 'omar@sader.law', role: 'ASSOCIATE' },
    ]);
    return { h, firm, partner: await seated(h, firm, 'p-1'), associate: await seated(h, firm, 'a-1') };
  }

  it('a PARTNER invites an accountant and makes a share link; an ASSOCIATE gets 403', async () => {
    const { h, firm, partner, associate } = await partnerAndAssociate();
    expect((await invite(h, partner, firm.organizationId)).status).toBe(201);
    expect((await shareLink(h, partner, firm.organizationId)).status).toBe(201);
    expect((await h.app.request(`/v1/profiles/${firm.organizationId}/accountants`, { headers: partner.cookie })).status).toBe(200);
    expect((await h.app.request(`/v1/profiles/${firm.organizationId}/share-links`, { headers: partner.cookie })).status).toBe(200);
    for (const res of [await invite(h, associate, firm.organizationId), await shareLink(h, associate, firm.organizationId)]) {
      expect(res.status).toBe(403);
      expect((await read(res)).error.details).toMatchObject({ reason: 'NOT_OWNER' });
    }
  });

  it('the firm’s name, type and members stay Malafat’s, even for a partner', async () => {
    const { h, firm, partner, associate } = await partnerAndAssociate();
    const refused: Array<[string, RequestInit]> = [
      [`/v1/profiles/${firm.organizationId}`, json({ name: 'Renamed' }, { ...partner.cookie, 'if-match': '1' }, 'PATCH')],
      [`/v1/profiles/${firm.organizationId}/type-change?to=PERSONAL`, { headers: partner.cookie }],
      [`/v1/profiles/${firm.organizationId}/firm-request`, json({}, { ...partner.cookie, 'idempotency-key': 'firm-req-000001' })],
      [`/v1/profiles/${firm.organizationId}/owners/${partner.userId}`, { method: 'DELETE', headers: { ...partner.cookie, 'idempotency-key': 'leave-0000000001' } }],
      [`/v1/profiles/${firm.organizationId}/owners/${associate.userId}`, { method: 'DELETE', headers: { ...partner.cookie, 'idempotency-key': 'remove-000000001' } }],
    ];
    for (const [path, init] of refused) {
      const res = await h.app.request(path, init);
      expect(res.status, path).toBe(403);
      expect((await read(res)).error.details, path).toMatchObject({ reason: 'MANAGED_IN_MALAFAT' });
    }
  });

  it('a partner’s own Claude connector never sees the firm (§4.6)', async () => {
    const { h, firm, partner } = await partnerAndAssociate();
    await h.app.request(`/admin/v1/users/${partner.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN });
    const agent = await connect(h, partner);
    const out = await tool(h, agent.bearer, 'list_profiles');
    expect((out.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(firm.organizationId);
  });

  it('a role change takes effect at once: a partner made an associate is no longer an owner', async () => {
    const { h, firm, partner } = await partnerAndAssociate();
    await sync(h, firm, [
      { subject: 'p-1', email: 'rana@sader.law', role: 'ASSOCIATE' },
      { subject: 'a-1', email: 'omar@sader.law', role: 'ASSOCIATE' },
    ]);
    expect((await shareLink(h, partner, firm.organizationId)).status).toBe(403);
  });
});

describe('a removal ends access on the next call (DF3)', () => {
  it('the membership goes, and Malafat’s token for that person on that firm ends', async () => {
    const { h, firm } = await setup();
    await sync(h, firm, [{ subject: 'p-1', email: 'rana@sader.law', role: 'PARTNER' }]);
    const rana = await seated(h, firm, 'p-1');
    const conn = await connectDelegated(h, rana, firm);
    expect((await addExpense(h, conn.headers())).status).toBe(201);
    expect(await read(await sync(h, firm, []))).toEqual({ added: 0, changed: 0, removed: 1, pending: 0 });
    expect(await h.store.memberships.find(rana.userId, firm.organizationId)).toBeNull();
    expect((await addExpense(h, conn.headers())).status).toBe(401);
    expect((await h.app.request('/v1/expenses', { headers: on(rana, firm.organizationId) })).status).toBe(404);
    // Listed again: the link survives, the membership comes back without a new sign-in.
    expect(await read(await sync(h, firm, [{ subject: 'p-1', email: 'rana@sader.law', role: 'PARTNER' }]))).toEqual({ added: 1, changed: 0, removed: 0, pending: 0 });
    expect((await h.store.memberships.find(rana.userId, firm.organizationId))?.role).toBe('OWNER');
  });
});

describe('the per-firm switch turns firm features on (ADR-254 §4.4)', () => {
  it('sets firmEnabledAt when Malafat access is turned on', async () => {
    const h = await delegatedHarness();
    const firm = await malafatFirm(h, { enabled: false });
    expect((await h.store.organizations.getById(firm.organizationId))?.firmEnabledAt).toBeNull();
    await h.store.integrations.setDelegation({ id: firm.integrationId, enabled: true, by: null, at: h.now(), audit: [] });
    expect((await h.store.organizations.getById(firm.organizationId))?.firmEnabledAt).toBeInstanceOf(Date);
  });
});
