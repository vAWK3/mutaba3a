import { describe, expect, it } from 'vitest';
import { s256Challenge } from '../oauth/protocol.js';
import type { MalafatRole } from '../repositories/ports.js';
import { delegatedHarness, malafatFirm, type DelegatedHarness, type MalafatFirm } from './helpers/delegated.js';
import { COOKIE, json, ORIGIN, person, read, SAME_ORIGIN, VERIFIER } from './helpers/oauth-agent.js';

/** MUT-595 (ADR-254 D1, D4, D5, D8, DF1): Sign in with Malafat, against a fake Malafat firm (MAL-1539's contract). */

interface MalafatPerson {
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
function fakeMalafat() {
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

async function setup(options: { firm?: boolean; enabled?: boolean } = {}) {
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

const APP_VERIFIER = 'b'.repeat(43);
const fragmentOf = (location: string) => new URLSearchParams(location.split('#')[1] ?? '');

/** /start → Malafat → /callback; the result code (or error) the client's return carries. */
async function roundTrip(h: DelegatedHarness, options: { client?: 'web' | 'app'; tenant?: string; code?: string; malafatError?: string } = {}) {
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

const exchange = (h: DelegatedHarness, result: string, extra: Record<string, string> = {}, headers: Record<string, string> = SAME_ORIGIN) => h.app.request('/v1/auth/malafat/exchange', json({ result, ...extra }, headers));
const consent = (h: DelegatedHarness, body: Record<string, unknown>, headers: Record<string, string> = SAME_ORIGIN) => h.app.request('/v1/auth/malafat/consent', json(body, headers));
const NEW_ACCOUNT = { defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' };

async function seat(h: DelegatedHarness, firm: MalafatFirm, sub: string, role: MalafatRole = 'PARTNER') {
  firm.seats.push({ subject: sub, email: `${sub}@sader.law`, role });
  await h.store.externalIdentities.syncMembers({ organizationId: firm.organizationId, tenantId: firm.tenant, members: firm.seats, at: h.now(), audit: [] });
}

describe('Malafat round trip (MAL-1539)', () => {
  it('sends the person to their firm’s Malafat with PKCE and state, and keeps nothing of Malafat’s', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    const { start, location } = await roundTrip(h);
    const url = new URL(start);
    expect(url.origin).toBe('https://sader.malafat.app');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', client_id: 'mtb3a', redirect_uri: `${ORIGIN}/v1/auth/malafat/callback`, scope: 'openid email profile', code_challenge_method: 'S256' });
    expect(location).toMatch(new RegExp(`^${ORIGIN}/malafat/return#result=`));
    expect(malafat.state.calls).toEqual(['POST /api/oauth/token', 'GET /api/oauth/userinfo', 'POST /api/oauth/revoke']);
  });

  it.each([
    ['a refusal at Malafat', { malafatError: 'access_denied' }, 'access_denied'],
    ['a code Malafat doesn’t know', { code: 'bad' }, 'malafat_unavailable'],
  ] as const)('%s comes back as #error=', async (_name, options, error) => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    expect((await roundTrip(h, options)).fragment.get('error')).toBe(error);
  });

  it('refuses an address that isn’t a firm’s slug, and a state it didn’t issue', async () => {
    const { h } = await setup();
    expect((await roundTrip(h, { tenant: 'evil.example.com/x' })).fragment.get('error')).toBe('office_not_found');
    const forged = await h.app.request('/v1/auth/malafat/callback?state=forged&code=ok');
    expect(fragmentOf(forged.headers.get('location') ?? '').get('error')).toBe('state_invalid');
  });

  it('a state works once', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    const start = await h.app.request('/v1/auth/malafat/start?tenant=sader');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await h.app.request(`/v1/auth/malafat/callback?state=${state}&code=ok`);
    const again = await h.app.request(`/v1/auth/malafat/callback?state=${state}&code=ok`);
    expect(fragmentOf(again.headers.get('location') ?? '').get('error')).toBe('state_invalid');
  });

  it('the office preflight answers for a firm and 404s otherwise', async () => {
    const { h } = await setup();
    expect(await read(await h.app.request('/v1/auth/malafat/office?tenant=sader'))).toEqual({ host: 'sader.malafat.app' });
    expect((await h.app.request('/v1/auth/malafat/office?tenant=nobody')).status).toBe(404);
  });
});

describe('the three first sign-ins (AC1)', () => {
  it('a new person: consent creates an ACTIVE account with the normal trial and no review, links, claims the seat, signs in', async () => {
    const { h, firm, malafat, who } = await setup();
    await seat(h, firm!, 'mal-user-1');
    malafat.state.who = who();
    const { fragment } = await roundTrip(h);
    const step = await read(await exchange(h, fragment.get('result') ?? ''));
    expect(step).toMatchObject({ state: 'needs_consent', creates: true, office: { name: 'Sader Law Office' }, email: 'rana@sader.law' });
    // Nothing exists before consent (R8).
    expect(await h.store.users.findByEmail('rana@sader.law')).toBeNull();
    const done = await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT });
    expect(done.status).toBe(200);
    expect(done.headers.get('set-cookie')).toContain(`${COOKIE}=`);
    const body = await read(done);
    expect(body.state).toBe('signed_in');
    expect(body.me.profiles.map((p: { id: string }) => p.id)).toContain(firm!.organizationId);
    const user = (await h.store.users.findByEmail('rana@sader.law'))!;
    expect(user).toMatchObject({ status: 'ACTIVE', displayName: 'Rana Sader', locale: 'ar' });
    expect((await h.store.memberships.find(user.id, firm!.organizationId))?.role).toBe('OWNER');
    expect((await h.store.externalIdentities.findBySubject('MALAFAT', firm!.tenant, 'mal-user-1'))?.userId).toBe(user.id);
  });

  it('an existing account on that email: linked only after its own password, never by email alone (D4)', async () => {
    const { h, firm, malafat, who } = await setup();
    const existing = await person(h, { flag: false });
    const email = (await h.store.users.getById(existing.userId))!.email;
    malafat.state.who = who({ email });
    const { fragment } = await roundTrip(h);
    const step = await read(await exchange(h, fragment.get('result') ?? ''));
    expect(step).toMatchObject({ state: 'needs_link', email });
    // Consent without the proof is refused, and nothing is linked.
    expect((await consent(h, { ticket: step.ticket })).status).toBe(404);
    expect((await h.app.request('/v1/auth/malafat/link', json({ ticket: step.ticket, password: 'not the password' }, SAME_ORIGIN))).status).toBe(401);
    expect(await h.store.externalIdentities.findBySubject('MALAFAT', firm!.tenant, 'mal-user-1')).toBeNull();
    const linked = await read(await h.app.request('/v1/auth/malafat/link', json({ ticket: step.ticket, password: existing.password }, SAME_ORIGIN)));
    expect(linked).toMatchObject({ state: 'needs_consent', creates: false });
    const done = await read(await consent(h, { ticket: step.ticket }));
    expect(done.me.user.id).toBe(existing.userId);
    expect((await h.store.externalIdentities.findBySubject('MALAFAT', firm!.tenant, 'mal-user-1'))?.userId).toBe(existing.userId);
  });

  it('a linked person is signed in straight away, without consent again', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    const first = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    await consent(h, { ticket: first.ticket, ...NEW_ACCOUNT });
    const again = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    expect(again.state).toBe('signed_in');
    expect(again.me.user.email).toBe('rana@sader.law');
  });
});

describe('the phone (client=app, R1–R4)', () => {
  it('returns to mutaba3a://auth/malafat and needs the verifier of its challenge; the code burns on the first try', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    const { location, fragment } = await roundTrip(h, { client: 'app' });
    expect(location).toMatch(/^mutaba3a:\/\/auth\/malafat#result=/);
    const result = fragment.get('result') ?? '';
    expect((await exchange(h, result, { app_verifier: VERIFIER }, {})).status).toBe(404);
    expect((await exchange(h, result, { app_verifier: APP_VERIFIER }, {})).status).toBe(404);
    const next = await roundTrip(h, { client: 'app' });
    const step = await read(await exchange(h, next.fragment.get('result') ?? '', { app_verifier: APP_VERIFIER }, {}));
    expect(step.state).toBe('needs_consent');
    const done = await read(await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT }, {}));
    expect(done.state).toBe('signed_in');
    expect(done.token).toMatch(/^mds_/);
  });

  it('a phone start without a challenge goes back with #error=state_invalid', async () => {
    const { h } = await setup();
    const res = await h.app.request('/v1/auth/malafat/start?tenant=sader&client=app');
    expect(res.headers.get('location')).toBe('mutaba3a://auth/malafat#error=state_invalid');
  });
});

describe('edges', () => {
  it('works with the firm’s Malafat access switch off, and for a firm not bound to MTB3A at all (AC3)', async () => {
    for (const options of [{ enabled: false }, { firm: false }]) {
      const { h, malafat, who } = await setup(options);
      malafat.state.who = who();
      const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
      const done = await read(await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT }));
      expect(done.state).toBe('signed_in');
      expect(done.me.profiles.length).toBeGreaterThan(0);
    }
  });

  it('409 IDENTITY_LINKED_ELSEWHERE when the Malafat person became another account’s meanwhile; nothing created', async () => {
    const { h, firm, malafat, who } = await setup();
    malafat.state.who = who();
    const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    const other = await person(h, { flag: false });
    await h.store.externalIdentities.link({ provider: 'MALAFAT', tenantId: firm!.tenant, subject: 'mal-user-1', userId: other.userId, email: 'x@sader.law', malafatRole: 'PARTNER', organizationId: firm!.organizationId, at: h.now(), audit: [] });
    const res = await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT });
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'IDENTITY_LINKED_ELSEWHERE' });
    expect(await h.store.users.findByEmail('rana@sader.law')).toBeNull();
  });

  it('a new account needs a currency and a timezone; terms, when sent, must be current', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    expect((await consent(h, { ticket: step.ticket })).status).toBe(422);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT, acceptedTermsVersion: 'old' })).status).toBe(409);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT })).status).toBe(200);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT })).status).toBe(404);
  });

  it('a Malafat that is down comes back as #error=malafat_unavailable', async () => {
    const { h, malafat, who } = await setup();
    malafat.state.who = who();
    malafat.state.down = true;
    expect((await roundTrip(h)).fragment.get('error')).toBe('malafat_unavailable');
  });
});

describe('the switch (MALAFAT_SIGN_IN)', () => {
  it('off: every route answers 404 and the doors say so', async () => {
    const h = await delegatedHarness();
    expect((await h.app.request('/v1/auth/malafat/start?tenant=sader')).status).toBe(404);
    expect((await read(await h.app.request('/v1/self-service'))).malafatSignIn).toBe(false);
    const { h: on } = await setup();
    expect((await read(await on.app.request('/v1/self-service'))).malafatSignIn).toBe(true);
  });
});
