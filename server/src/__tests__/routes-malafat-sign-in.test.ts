import { describe, expect, it } from 'vitest';
import { APP_VERIFIER, consent, exchange, fragmentOf, malafatSetup, NEW_ACCOUNT, roundTrip, seat } from './helpers/malafat-sign-in.js';
import { delegatedHarness } from './helpers/delegated.js';
import { COOKIE, json, ORIGIN, person, read, SAME_ORIGIN, VERIFIER } from './helpers/oauth-agent.js';

/** MUT-595 (ADR-254 D1, D4, D5, D8, DF1): Sign in with Malafat, against a fake Malafat firm (MAL-1539's contract). */

describe('Malafat round trip (MAL-1539)', () => {
  it('sends the person to their firm’s Malafat with PKCE and state, and keeps nothing of Malafat’s', async () => {
    const { h, malafat, who } = await malafatSetup();
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
    const { h, malafat, who } = await malafatSetup();
    malafat.state.who = who();
    expect((await roundTrip(h, options)).fragment.get('error')).toBe(error);
  });

  it('refuses an address that isn’t a firm’s slug, and a state it didn’t issue', async () => {
    const { h } = await malafatSetup();
    expect((await roundTrip(h, { tenant: 'evil.example.com/x' })).fragment.get('error')).toBe('office_not_found');
    const forged = await h.app.request('/v1/auth/malafat/callback?state=forged&code=ok');
    expect(fragmentOf(forged.headers.get('location') ?? '').get('error')).toBe('state_invalid');
  });

  it('a state works once', async () => {
    const { h, malafat, who } = await malafatSetup();
    malafat.state.who = who();
    const start = await h.app.request('/v1/auth/malafat/start?tenant=sader');
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    await h.app.request(`/v1/auth/malafat/callback?state=${state}&code=ok`);
    const again = await h.app.request(`/v1/auth/malafat/callback?state=${state}&code=ok`);
    expect(fragmentOf(again.headers.get('location') ?? '').get('error')).toBe('state_invalid');
  });

  it('the office preflight answers for a firm and 404s otherwise', async () => {
    const { h } = await malafatSetup();
    expect(await read(await h.app.request('/v1/auth/malafat/office?tenant=sader'))).toEqual({ host: 'sader.malafat.app' });
    expect((await h.app.request('/v1/auth/malafat/office?tenant=nobody')).status).toBe(404);
  });
});

describe('the three first sign-ins (AC1)', () => {
  it('a new person: consent creates an ACTIVE account with the normal trial and no review, links, claims the seat, signs in', async () => {
    const { h, firm, malafat, who } = await malafatSetup();
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

  it('MUT-596: a web result code works only in the browser that started the sign-in (login CSRF)', async () => {
    const { h, firm, malafat, who } = await malafatSetup();
    await seat(h, firm!, 'mal-user-1');
    malafat.state.who = who();
    const { fragment } = await roundTrip(h);
    // Someone else's browser (another flow's cookie, or none) opening the link: refused, and the code is spent.
    const elsewhere = await exchange(h, fragment.get('result') ?? '', {}, { ...SAME_ORIGIN, cookie: 'mtb3a_malafat_flow=someone-elses-state' });
    expect(elsewhere.status).toBe(404);
    expect((await read(elsewhere)).error.details).toMatchObject({ reason: 'MALAFAT_RESULT_INVALID' });
    expect((await exchange(h, fragment.get('result') ?? '')).status).toBe(404);
    // The starting browser, on a fresh round trip: it goes through, and the cookie is cleared.
    const again = await roundTrip(h);
    const ok = await exchange(h, again.fragment.get('result') ?? '');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('set-cookie')).toMatch(/mtb3a_malafat_flow=;/);
  });

  it('MUT-596: the consent names the current terms; agreeing there means the terms aren’t asked again after', async () => {
    const { h, firm, malafat, who } = await malafatSetup();
    await seat(h, firm!, 'mal-user-1');
    malafat.state.who = who();
    const { fragment } = await roundTrip(h);
    const step = await read(await exchange(h, fragment.get('result') ?? ''));
    expect(step.termsVersion).toEqual(expect.any(String));
    const done = await read(await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT, acceptedTermsVersion: step.termsVersion }));
    expect(done.me.terms).toEqual({ version: step.termsVersion, accepted: true });
  });

  it('an existing account on that email: linked only after its own password, never by email alone (D4)', async () => {
    const { h, firm, malafat, who } = await malafatSetup();
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
    const { h, malafat, who } = await malafatSetup();
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
    const { h, malafat, who } = await malafatSetup();
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
    const { h } = await malafatSetup();
    const res = await h.app.request('/v1/auth/malafat/start?tenant=sader&client=app');
    expect(res.headers.get('location')).toBe('mutaba3a://auth/malafat#error=state_invalid');
  });
});

describe('edges', () => {
  it('works with the firm’s Malafat access switch off, and for a firm not bound to MTB3A at all (AC3)', async () => {
    for (const options of [{ enabled: false }, { firm: false }]) {
      const { h, malafat, who } = await malafatSetup(options);
      malafat.state.who = who();
      const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
      const done = await read(await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT }));
      expect(done.state).toBe('signed_in');
      expect(done.me.profiles.length).toBeGreaterThan(0);
    }
  });

  it('409 IDENTITY_LINKED_ELSEWHERE when the Malafat person became another account’s meanwhile; nothing created', async () => {
    const { h, firm, malafat, who } = await malafatSetup();
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
    const { h, malafat, who } = await malafatSetup();
    malafat.state.who = who();
    const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    expect((await consent(h, { ticket: step.ticket })).status).toBe(422);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT, acceptedTermsVersion: 'old' })).status).toBe(409);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT })).status).toBe(200);
    expect((await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT })).status).toBe(404);
  });

  it('a Malafat that is down comes back as #error=malafat_unavailable', async () => {
    const { h, malafat, who } = await malafatSetup();
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
    const { h: on } = await malafatSetup();
    expect((await read(await on.app.request('/v1/self-service'))).malafatSignIn).toBe(true);
  });
});
