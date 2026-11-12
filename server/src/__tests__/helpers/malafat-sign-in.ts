import { expect } from 'vitest';
import { s256Challenge } from '../../oauth/protocol.js';
import type { MalafatRole } from '../../repositories/ports.js';
import { delegatedHarness, malafatFirm, type DelegatedHarness, type MalafatFirm } from './delegated.js';
import { json, SAME_ORIGIN } from './oauth-agent.js';

/** MUT-595/596: a fake Malafat firm (MAL-1539's contract) and the Sign in with Malafat round trip, for route tests. */

export interface MalafatPerson {
  sub: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  role: MalafatRole;
  email: string;
  email_verified: true;
  name: string | null;
  locale: string | null;
}

/** A fake Malafat: `code` 'ok' signs in as `who`; anything else is refused. Records what MTB3A sent it. */
export function fakeMalafat() {
  const state = { who: null as MalafatPerson | null, down: false, calls: [] as string[] };
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    state.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (state.down) throw new Error('network down');
    if (url.pathname === '/.well-known/oauth-authorization-server') return url.hostname.startsWith('sader.') ? Response.json({ issuer: url.origin }) : new Response('', { status: 404 });
    if (url.pathname === '/api/oauth/token') {
      const body = new URLSearchParams(String(init?.body));
      return body.get('code') === 'ok' && body.get('client_id') === 'mtb3a' && body.get('code_verifier') ? Response.json({ access_token: 'm-at', refresh_token: 'm-rt', token_type: 'Bearer' }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    if (url.pathname === '/api/oauth/userinfo') return state.who ? Response.json(state.who) : Response.json({ error: 'invalid_token' }, { status: 401 });
    if (url.pathname === '/api/oauth/revoke') return new Response(null, { status: 200 });
    return new Response('', { status: 404 });
  }) as typeof globalThis.fetch;
  return { state, config: { originTemplate: 'https://{slug}.malafat.app', clientId: 'mtb3a', fetch } };
}

export async function malafatSetup(options: { firm?: boolean; enabled?: boolean } = {}) {
  const malafat = fakeMalafat();
  const h = await delegatedHarness({ malafatSignIn: malafat.config });
  const firm = options.firm === false ? null : await malafatFirm(h, { enabled: options.enabled ?? true });
  const who = (overrides: Partial<MalafatPerson> = {}): MalafatPerson => ({
    sub: 'mal-user-1',
    tenant_id: firm?.tenant ?? 'tenant-unbound',
    tenant_slug: 'sader',
    tenant_name: 'Sader Law Office',
    role: 'PARTNER',
    email: 'rana@sader.law',
    email_verified: true,
    name: 'Rana Sader',
    locale: 'ar',
    ...overrides,
  });
  return { h, firm, malafat, who };
}

export const APP_VERIFIER = 'b'.repeat(43);
export const fragmentOf = (location: string) => new URLSearchParams(location.split('#')[1] ?? '');

/** /start → Malafat → /callback; the result code (or error) the client's return carries. */
export async function roundTrip(h: DelegatedHarness, options: { client?: 'web' | 'app'; tenant?: string; code?: string; malafatError?: string } = {}) {
  const client = options.client ?? 'web';
  const query = new URLSearchParams({ tenant: options.tenant ?? 'sader', client, ...(client === 'app' ? { app_challenge: s256Challenge(APP_VERIFIER) } : {}) });
  const start = await h.app.request(`/v1/auth/malafat/start?${query.toString()}`);
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get('location') ?? '');
  if (authorize.protocol !== 'https:' || !authorize.pathname.endsWith('/oauth/authorize')) return { start: authorize.toString(), fragment: fragmentOf(start.headers.get('location') ?? '') };
  const state = authorize.searchParams.get('state') ?? '';
  const back = new URLSearchParams({ state, ...(options.malafatError ? { error: options.malafatError } : { code: options.code ?? 'ok' }) });
  const callback = await h.app.request(`/v1/auth/malafat/callback?${back.toString()}`);
  expect(callback.status).toBe(302);
  const location = callback.headers.get('location') ?? '';
  return { start: authorize.toString(), location, fragment: fragmentOf(location) };
}

export const exchange = (h: DelegatedHarness, result: string, extra: Record<string, string> = {}, headers: Record<string, string> = SAME_ORIGIN) => h.app.request('/v1/auth/malafat/exchange', json({ result, ...extra }, headers));
export const consent = (h: DelegatedHarness, body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) => h.app.request('/v1/auth/malafat/consent', json(body, headers));
export const NEW_ACCOUNT = { defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' };

export async function seat(h: DelegatedHarness, firm: MalafatFirm, sub: string, role: MalafatRole = 'PARTNER') {
  firm.seats.push({ subject: sub, email: `${sub}@sader.law`, role });
  await h.store.externalIdentities.syncMembers({ organizationId: firm.organizationId, tenantId: firm.tenant, members: firm.seats, at: h.now(), audit: [] });
}

