import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { connectDelegated, delegatedHarness, lawyer, malafatFirm, type DelegatedHarness, type MalafatFirm } from './helpers/delegated.js';
import { ADMIN, connect, initialize, tool, toolError, type Person } from './helpers/oauth-agent.js';

/**
 * MUT-598 (ADR-254 D11, brief §4.6): Malafat's connector forwards MTB3A's tools to /mcp with the person's delegated
 * token. The tools reach the tenant's firm only, never the person's own profiles or inbox; `agent_access` still
 * applies; every §4.7 revocation ends /mcp as it ends /v1.
 */

const expenseArgs = (profileId: string, extra: Record<string, unknown> = {}) => ({ destination: { kind: 'profile', profileId }, amount: '45.90', currency: 'ILS', occurredOn: '2026-10-20', idempotencyKey: randomUUID(), ...extra });

async function setup() {
  const h = await delegatedHarness();
  const firm = await malafatFirm(h);
  const p = await lawyer(h, firm);
  expect((await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const conn = await connectDelegated(h, p, firm);
  const bearer = { authorization: `Bearer ${conn.access_token}` };
  return { h, firm, p, conn, bearer };
}

const mcpStatus = async (h: DelegatedHarness, bearer: Record<string, string>) => (await initialize(h, bearer)).status;

describe('Malafat’s connector on /mcp (AC1)', () => {
  it('lists the tenant’s firm and nothing of the person’s own', async () => {
    const { h, firm, bearer } = await setup();
    const out = await tool(h, bearer, 'list_profiles');
    expect((out.items as Array<{ id: string }>).map((i) => i.id)).toEqual([firm.organizationId]);
  });

  it('a forwarded write reaches the firm, audited as the person via Malafat', async () => {
    const { h, firm, p, bearer } = await setup();
    const out = await tool(h, bearer, 'add_expense', expenseArgs(firm.organizationId, { vendor: 'Court fees' }));
    expect(out.outcome).toBe('created');
    const rows = (await h.store.audit.listByOrganization(firm.organizationId, 100)).filter((e) => e.entityId === out.expense.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toMatchObject({ actorType: 'USER', actorId: p.userId, metadata: expect.objectContaining({ via: 'malafat' }) });
  });

  it('is refused on the person’s own profile and inbox', async () => {
    const { h, p, bearer } = await setup();
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(p.personalId))).toContain('NOT_FOUND');
    expect(await toolError(h, bearer, 'list_inbox')).toContain('NOT_FOUND');
  });

  it('acts only for a partner (the OWNER role Malafat’s sync gives, D3)', async () => {
    const h = await delegatedHarness();
    const firm = await malafatFirm(h);
    const bookkeeper = await lawyer(h, firm, 'OFFICE_ADMIN');
    expect((await h.store.memberships.find(bookkeeper.userId, firm.organizationId))?.role).toBe('BOOKKEEPER');
    expect((await h.app.request(`/admin/v1/users/${bookkeeper.userId}/features/agent_access`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    const conn = await connectDelegated(h, bookkeeper, firm);
    const bearer = { authorization: `Bearer ${conn.access_token}` };
    expect((await tool(h, bearer, 'list_profiles')).items).toEqual([]);
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(firm.organizationId))).toContain('NOT_FOUND');
  });

  it('still needs the person’s agent_access', async () => {
    const { h, p, bearer } = await setup();
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/agent_access`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);
    expect(await mcpStatus(h, bearer)).toBe(403);
  });

  it('an agent’s own token still sees the person’s profiles, not the firm', async () => {
    const { h, p } = await setup();
    const agent = await connect(h, p);
    const out = await tool(h, agent.bearer, 'list_profiles');
    expect((out.items as Array<{ id: string }>).map((i) => i.id)).toEqual([p.personalId]);
  });
});

describe('every revocation ends /mcp on the next call (AC2, §4.7)', () => {
  const revocations: Array<[string, (h: DelegatedHarness, p: Person, firm: MalafatFirm) => unknown]> = [
    ['the person revokes Malafat in Connected apps', async (h, p) => {
      const list = (await (await h.app.request('/v1/me/connected-apps', { headers: p.cookie })).json()) as { items: Array<{ grantId: string }> };
      return h.app.request(`/v1/me/connected-apps/${list.items[0]!.grantId}`, { method: 'DELETE', headers: p.cookie });
    }],
    ['the firm disconnects Malafat', (h, _p, firm) => h.store.integrations.disconnect(firm.integrationId, h.now())],
    ['the per-firm switch goes off', (h, _p, firm) => h.store.integrations.setDelegation({ id: firm.integrationId, enabled: false, by: null, at: h.now(), audit: [] })],
    ['the operator disables the client', (h) => h.app.request(`/admin/v1/oauth/confidential-clients/${h.clientId}/disable`, { method: 'POST', headers: ADMIN })],
    ['the operator disables the account', (h, p) => h.app.request(`/admin/v1/users/${p.userId}/disable`, { method: 'POST', headers: ADMIN })],
  ];

  for (const [name, revoke] of revocations) {
    it(name, async () => {
      const { h, firm, p, bearer } = await setup();
      expect(await mcpStatus(h, bearer)).toBe(200);
      await revoke(h, p, firm);
      expect(await mcpStatus(h, bearer)).toBe(401);
    });
  }

  it('the person leaves the firm: the tools no longer see it', async () => {
    const { h, firm, p, bearer } = await setup();
    await h.store.memberships.revoke(p.userId, firm.organizationId);
    expect((await tool(h, bearer, 'list_profiles')).items).toEqual([]);
    expect(await toolError(h, bearer, 'add_expense', expenseArgs(firm.organizationId))).toContain('NOT_FOUND');
  });
});
