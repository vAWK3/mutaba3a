import { describe, expect, it } from 'vitest';
import { isLocalHttpUrl, remoteKeys } from '../oauth/client-assertion.js';
import { delegatedHarness, malafatFirm } from './helpers/delegated.js';
import { ADMIN, harness, json, read } from './helpers/oauth-agent.js';

/**
 * MUT-596: what lets the local Malafat QA stub stand in for Malafat as a confidential client: http keys and redirects
 * on this machine only under OAUTH_CLIENT_LOCAL_HTTP, and the admin twin of the operator's per-firm switch.
 */

const STUB = 'http://sader.lvh.me:3939';
const register = (h: ReturnType<typeof harness>, urls: { redirect: string; jwks: string }) =>
  h.app.request('/admin/v1/oauth/confidential-clients', json({ name: 'Malafat (QA stub)', redirectUris: [urls.redirect], jwksUri: urls.jwks }, ADMIN));

describe('a confidential client on this machine', () => {
  it('is refused over http unless OAUTH_CLIENT_LOCAL_HTTP is on', async () => {
    const urls = { redirect: `${STUB}/mtb3a/callback`, jwks: `${STUB}/.well-known/mtb3a-jwks.json` };
    expect((await register(harness({ malafatDelegation: true }), urls)).status).toBe(422);
    const res = await register(harness({ malafatDelegation: true, oauthClientLocalHttp: true }), urls);
    expect(res.status).toBe(201);
    expect(await read(res)).toMatchObject({ jwksUri: urls.jwks, redirectUris: [urls.redirect] });
  });

  it('is never plain http beyond this machine, even with the flag', async () => {
    const res = await register(harness({ malafatDelegation: true, oauthClientLocalHttp: true }), { redirect: 'http://malafat.example/cb', jwks: 'http://malafat.example/jwks.json' });
    expect(res.status).toBe(422);
  });

  it('local means loopback or *.lvh.me over http', () => {
    expect(isLocalHttpUrl(`${STUB}/x`)).toBe(true);
    expect(isLocalHttpUrl('http://localhost:3939/x')).toBe(true);
    expect(isLocalHttpUrl('http://127.0.0.1/x')).toBe(true);
    expect(isLocalHttpUrl('https://sader.lvh.me/x')).toBe(false);
    expect(isLocalHttpUrl('http://lvh.me.evil.example/x')).toBe(false);
    expect(isLocalHttpUrl('not a url')).toBe(false);
  });

  it('keys are fetched over http only when allowed, and only from this machine', () => {
    expect(() => remoteKeys(`${STUB}/jwks.json`)).toThrow(/https/);
    expect(() => remoteKeys('http://malafat.example/jwks.json', { localHttp: true })).toThrow(/https/);
    expect(() => remoteKeys(`${STUB}/jwks.json`, { localHttp: true })).not.toThrow();
  });
});

describe("the admin twin of the operator's Malafat switch", () => {
  const set = (h: { app: { request: (url: string, init: RequestInit) => Response | Promise<Response> } }, organizationId: string, enabled: boolean) =>
    h.app.request(`/admin/v1/organizations/${organizationId}/malafat-delegation`, json({ enabled }, ADMIN));

  it('turns delegation on for a firm Malafat feeds', async () => {
    const h = await delegatedHarness();
    const firm = await malafatFirm(h, { enabled: false });
    const res = await set(h, firm.organizationId, true);
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ organizationId: firm.organizationId, tenantId: firm.tenant, delegationEnabledAt: expect.any(String) });
  });

  it('refuses a profile Malafat does not feed', async () => {
    const h = await delegatedHarness();
    const org = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Elsewhere', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const res = await set(h, org.id as string, true);
    expect(res.status).toBe(409);
    expect(await read(res)).toMatchObject({ error: { details: { reason: 'NOT_MALAFAT_FED' } } });
  });

  it('answers 404 while MALAFAT_DELEGATION is off, like the operator route', async () => {
    const h = await delegatedHarness({ malafatDelegation: false });
    const firm = await malafatFirm(h, { enabled: false });
    expect((await set(h, firm.organizationId, true)).status).toBe(404);
  });
});
