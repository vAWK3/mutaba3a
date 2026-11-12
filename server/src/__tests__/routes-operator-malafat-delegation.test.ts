import { describe, expect, it } from 'vitest';
import { SCOPES } from '../auth/scopes.js';
import { ADMIN, harness, json, operator, post, read, type Harness } from './helpers/operator-harness.js';

/** MUT-593 (ADR-254 D10): the operator's per-firm switch for Malafat acting as each member. */

let seq = 0;

async function malafatFed(h: Harness) {
  const tenant = `tenant-op-${++seq}`;
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, ADMIN)));
  const bind = await h.app.request('/v1/integration/bind', json({ provider: 'MALAFAT', externalTenantId: tenant, displayName: 'Firm' }, { authorization: `Bearer ${key.secret}`, 'idempotency-key': `bind-${tenant}-0001` }));
  expect(bind.status).toBe(201);
  return { id: org.id as string, tenant };
}

const path = (organizationId: string) => `/v1/operator/organizations/${organizationId}/malafat-delegation`;

describe('POST /v1/operator/organizations/{id}/malafat-delegation', () => {
  it('turns it on and off, audited as the operator', async () => {
    const h = harness({ malafatDelegation: true });
    const op = await operator(h);
    const firm = await malafatFed(h);
    const on = await post(h, path(firm.id), op.token, { enabled: true });
    expect(on.status).toBe(200);
    expect(await read(on)).toMatchObject({ organizationId: firm.id, tenantId: firm.tenant, delegationEnabledAt: expect.any(String), grantsRevoked: 0 });
    const off = await read(await post(h, path(firm.id), op.token, { enabled: false }));
    expect(off).toMatchObject({ delegationEnabledAt: null, grantsRevoked: 0 });
    const actions = (await h.store.audit.listByOrganization(firm.id, 50)).filter((e) => e.action.startsWith('organization.malafat_delegation')).map((e) => ({ action: e.action, actorType: e.actorType, actorId: e.actorId }));
    expect(actions).toEqual(
      expect.arrayContaining([
        { action: 'organization.malafat_delegation_enabled', actorType: 'ADMIN', actorId: op.id },
        { action: 'organization.malafat_delegation_disabled', actorType: 'ADMIN', actorId: op.id },
      ]),
    );
  });

  it('refuses a profile Malafat doesn’t feed', async () => {
    const h = harness({ malafatDelegation: true });
    const op = await operator(h);
    const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Plain', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const res = await post(h, path(org.id), op.token, { enabled: true });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'NOT_MALAFAT_FED' });
  });

  it('is dark (404) while MALAFAT_DELEGATION is off', async () => {
    const h = harness();
    const op = await operator(h);
    const firm = await malafatFed(h);
    expect((await post(h, path(firm.id), op.token, { enabled: true })).status).toBe(404);
  });
});
