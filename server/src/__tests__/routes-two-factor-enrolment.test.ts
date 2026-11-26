import { describe, expect, it } from 'vitest';
import { stepOf, totpAt } from '../auth/totp.js';
import { ADMIN, accountantHarness, businessOf, json, person, read, signedIn, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-710 (ADR-274 D8, D9, AC1): turning two-step sign-in on (app or email), the proof it needs, the recovery codes,
 * switching, new codes and turning it off, with the notice mailed each time.
 */
const ISSUER = { legalName: 'Barmajiyat Ltd.', vatId: '123456782', dealerType: 'COMPANY', city: 'Nazareth' };

const enrol = (h: AccountantHarness, p: Person, body: Record<string, unknown>) => h.app.request('/v1/me/two-factor/enrolment', json(body, p.auth));
const confirm = (h: AccountantHarness, p: Person, body: Record<string, unknown>) => h.app.request('/v1/me/two-factor/enrolment/confirm', json(body, p.auth));
const codeNow = (h: AccountantHarness, secret: string) => totpAt(secret, stepOf(h.now()));
const mails = (h: AccountantHarness, to: string, template: string) => h.transport.list({ to }).filter((m) => m.template === template);
const lastCode = (h: AccountantHarness, to: string) => h.transport.list({ to }).at(-1)?.text.match(/^\d{6}$/m)?.[0] ?? '';

async function turnOnApp(h: AccountantHarness, p: Person): Promise<{ secret: string; codes: string[] }> {
  const started = await read(await enrol(h, p, { method: 'totp', currentPassword: p.password }));
  const done = await confirm(h, p, { enrolmentToken: started.enrolmentToken, code: codeNow(h, started.secret) });
  expect(done.status).toBe(201);
  return { secret: started.secret, codes: (await read(done)).recoveryCodes };
}

async function manageChallenge(h: AccountantHarness, p: Person): Promise<string> {
  const res = await h.app.request('/v1/me/two-factor/challenge', json({}, p.auth));
  expect(res.status).toBe(201);
  return (await read(res)).challengeToken;
}

describe('turning it on (MUT-710 AC1, D8)', () => {
  it('the app method: a secret, its address and a QR code; the code turns it on, answers 10 codes, keeps this session and signs out the others', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const other = await signedIn(h, p.email, p.password, p.userId, p.personalId);
    const started = await read(await enrol(h, p, { method: 'totp', currentPassword: p.password }));
    expect(started).toMatchObject({ method: 'totp', emailCodeRequired: false, secret: expect.stringMatching(/^[A-Z2-7]{32}$/), otpauthUri: expect.stringContaining('otpauth://totp/MTB3A') });
    expect(started.qrSvg).toMatch(/^<svg/);

    const wrong = await read(await confirm(h, p, { enrolmentToken: started.enrolmentToken, code: codeNow(h, started.secret) === '000000' ? '111111' : '000000' }));
    expect(wrong.error).toMatchObject({ code: 'TWO_FACTOR_CODE_WRONG', details: { triesLeft: 4 } });
    const done = await confirm(h, p, { enrolmentToken: started.enrolmentToken, code: codeNow(h, started.secret) });
    expect(done.status).toBe(201);
    expect((await read(done)).recoveryCodes).toHaveLength(10);

    expect((await read(await h.app.request('/v1/me', { headers: p.auth }))).user.twoFactor).toEqual({ enabled: true, method: 'totp', recoveryCodesLeft: 10, requiredForIssuing: false });
    expect((await h.app.request('/v1/me', { headers: other.auth })).status).toBe(401);
    expect(mails(h, p.email, 'two-factor-changed')).toHaveLength(1);
  });

  it('needs the current password', async () => {
    const h = accountantHarness();
    const p = await person(h);
    expect((await read(await enrol(h, p, { method: 'totp', currentPassword: 'not-my-password' }))).error.code).toBe('CURRENT_PASSWORD_WRONG');
  });

  it('the email method confirms with the mailed code', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const started = await read(await enrol(h, p, { method: 'email', currentPassword: p.password }));
    expect(started).toMatchObject({ method: 'email', emailHint: expect.any(String) });
    expect((await confirm(h, p, { enrolmentToken: started.enrolmentToken, code: lastCode(h, p.email) })).status).toBe(201);
    expect((await read(await h.app.request('/v1/me/two-factor', { headers: p.auth }))).method).toBe('email');
  });

  it('two confirmations at once turn it on once (D8 row lock + single-use challenge)', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const started = await read(await enrol(h, p, { method: 'totp', currentPassword: p.password }));
    const code = codeNow(h, started.secret);
    const both = await Promise.all([confirm(h, p, { enrolmentToken: started.enrolmentToken, code }), confirm(h, p, { enrolmentToken: started.enrolmentToken, code })]);
    expect(both.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await h.store.twoFactor.recoveryCodesLeft(p.userId)).toBe(10);
  });
});

describe('while it is on (MUT-710 D8, D9)', () => {
  it('switching method needs the current second step too', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const { codes } = await turnOnApp(h, p);
    expect((await read(await enrol(h, p, { method: 'email', currentPassword: p.password }))).error.code).toBe('TWO_FACTOR_REQUIRED');
    const challengeToken = await manageChallenge(h, p);
    const started = await read(await enrol(h, p, { method: 'email', currentPassword: p.password, challengeToken, recoveryCode: codes[0] }));
    expect((await confirm(h, p, { enrolmentToken: started.enrolmentToken, code: lastCode(h, p.email) })).status).toBe(201);
    expect((await read(await h.app.request('/v1/me/two-factor', { headers: p.auth }))).method).toBe('email');
    expect(mails(h, p.email, 'two-factor-changed')).toHaveLength(2);
  });

  it('new recovery codes replace the old ones', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const { codes } = await turnOnApp(h, p);
    const fresh = await h.app.request('/v1/me/two-factor/recovery-codes', json({ currentPassword: p.password, challengeToken: await manageChallenge(h, p), recoveryCode: codes[0] }, p.auth));
    expect(fresh.status).toBe(201);
    const challengeToken = await manageChallenge(h, p);
    expect((await read(await h.app.request('/v1/me/two-factor/recovery-codes', json({ currentPassword: p.password, challengeToken, recoveryCode: codes[1] }, p.auth)))).error.code).toBe('TWO_FACTOR_CODE_WRONG');
  });

  it('turning it off needs the second step, and is refused while the person issues documents', async () => {
    const h = accountantHarness({ twoFactorIssuingGate: true });
    const p = await person(h);
    const { codes } = await turnOnApp(h, p);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    const profileId = await businessOf(h, p);
    expect((await h.app.request('/v1/issuer', json(ISSUER, p.on(profileId), 'PUT'))).status).toBe(200);
    expect((await read(await h.app.request('/v1/me/two-factor', { headers: p.auth }))).requiredForIssuing).toBe(true);
    const off = (body: Record<string, unknown>) => h.app.request('/v1/me/two-factor', { ...json(body, p.auth), method: 'DELETE' });
    expect((await read(await off({ currentPassword: p.password, challengeToken: await manageChallenge(h, p), recoveryCode: codes[0] }))).error.code).toBe('TWO_FACTOR_REQUIRED_FOR_ISSUING');

    const q = await person(h);
    const mine = await turnOnApp(h, q);
    expect((await read(await h.app.request('/v1/me/two-factor', { ...json({ currentPassword: q.password }, q.auth), method: 'DELETE' }))).error.code).toBe('TWO_FACTOR_REQUIRED');
    const res = await h.app.request('/v1/me/two-factor', { ...json({ currentPassword: q.password, challengeToken: await manageChallenge(h, q), recoveryCode: mine.codes[0] }, q.auth), method: 'DELETE' });
    expect(res.status).toBe(204);
    expect((await read(await h.app.request('/v1/me/two-factor', { headers: q.auth }))).enabled).toBe(false);
  });
});

describe('with the issuing gate off (TWO_FACTOR_ISSUING_GATE_ENABLED, the default)', () => {
  it('issuing requires nothing, so a person who issues can still turn it off', async () => {
    const h = accountantHarness();
    const p = await person(h);
    const { codes } = await turnOnApp(h, p);
    expect((await h.app.request(`/admin/v1/users/${p.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
    const profileId = await businessOf(h, p);
    expect((await h.app.request('/v1/issuer', json(ISSUER, p.on(profileId), 'PUT'))).status).toBe(200);
    expect((await read(await h.app.request('/v1/me/two-factor', { headers: p.auth }))).requiredForIssuing).toBe(false);
    expect((await read(await h.app.request('/v1/me', { headers: p.auth }))).user.twoFactor.requiredForIssuing).toBe(false);
    const res = await h.app.request('/v1/me/two-factor', { ...json({ currentPassword: p.password, challengeToken: await manageChallenge(h, p), recoveryCode: codes[0] }, p.auth), method: 'DELETE' });
    expect(res.status).toBe(204);
  });
});

describe('the operator reset (MUT-710 D9)', () => {
  it('turns it off, signs the person out, audits it as ADMIN and mails a notice; a second reset says it is off', async () => {
    const h = accountantHarness();
    const p = await person(h);
    await turnOnApp(h, p);
    const res = await h.app.request(`/admin/v1/users/${p.userId}/two-factor`, { method: 'DELETE', headers: ADMIN });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ reset: true, revoked: 1 });
    expect(await h.store.twoFactor.get(p.userId)).toBeNull();
    expect((await h.app.request('/v1/me', { headers: p.auth })).status).toBe(401);
    const events = (await h.store.audit.list(p.personalId, {}, { limit: 50, cursor: null })).items;
    expect(events.find((e) => e.action === 'user.two_factor_reset_by_operator')).toMatchObject({ actorType: 'ADMIN', metadata: { method: 'totp' } });
    expect(mails(h, p.email, 'two-factor-changed')).toHaveLength(2);
    expect((await read(await h.app.request(`/admin/v1/users/${p.userId}/two-factor`, { method: 'DELETE', headers: ADMIN }))).error.details.reason).toBe('TWO_FACTOR_OFF');
  });
});
