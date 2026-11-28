import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { FakePushSender } from '../push/fake-sender.js';
import type { PushOutcome } from '../push/ports.js';
import { createPushService } from '../push/service.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { DAY, JOB, accountantHarness, idem, json, person, read, signedIn, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-780 (ADR-350..352): a signed-in phone registers its push token and removes it; signing out removes it; the
 * unclaimed sweep pushes the accountant on the digest's days, counts only, with the customer a tap opens.
 */
const PUSH = '/v1/push-devices';
const SWEEP = '/jobs/v1/accountants/unclaimed-sweep';
const CUSTOMERS = '/v1/accountant/customers';

function pushHarness(outcome?: (token: string) => PushOutcome, withPush = true) {
  const store = new MemoryLedgerStore();
  const sender = new FakePushSender(outcome ? (d) => outcome(d.token) : undefined);
  const push = createPushService({ store, sender, logger: pino({ level: 'silent' }) });
  const h = accountantHarness({ store, accountantProvisioning: true, ...(withPush ? { push } : {}) });
  return { h, sender, store };
}

const register = (p: Person, body: unknown = { platform: 'ios', token: 'fcm-token-1' }) => json(body, p.auth);
const live = (h: AccountantHarness, userId: string) => h.store.pushDevices.listLive(userId, h.now());

async function approvedAccountant(h: AccountantHarness, locale: 'en' | 'ar' = 'en'): Promise<Person> {
  const accountant = await person(h, { sharing: false, displayName: 'Hadi Khatib', locale });
  await h.store.provision.setApproval({ userId: accountant.userId, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: h.now() });
  return accountant;
}

async function addCustomer(h: AccountantHarness, accountant: Person): Promise<string> {
  const email = `owner${Math.random().toString(36).slice(2, 8)}@cafe-nour.ps`;
  const res = await h.app.request(CUSTOMERS, json({ email, displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' }, { ...accountant.auth, ...idem() }));
  expect(res.status).toBe(201);
  return (await read(res)).customer.userId as string;
}

const sweep = (h: AccountantHarness) => h.app.request(SWEEP, { method: 'POST', headers: JOB });

describe('POST /v1/push-devices and DELETE /v1/push-devices (MUT-780)', () => {
  it('answers 404 while push is not configured, and 401 without a session', async () => {
    const { h } = pushHarness(undefined, false);
    const p = await person(h);
    expect((await h.app.request(PUSH, register(p))).status).toBe(404);
    expect((await h.app.request(PUSH, { method: 'DELETE', headers: p.auth })).status).toBe(404);
    const on = pushHarness();
    expect((await on.h.app.request(PUSH, json({ platform: 'ios', token: 't' }))).status).toBe(401);
  });

  it('registers the token for the session, idempotently, and never reads it back', async () => {
    const { h } = pushHarness();
    const p = await person(h);
    const res = await h.app.request(PUSH, register(p));
    expect(res.status).toBe(204);
    expect(await h.app.request(PUSH, register(p))).toHaveProperty('status', 204);
    const devices = await live(h, p.userId);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ platform: 'ios', token: 'fcm-token-1', environment: 'production' });
    expect((await h.app.request(PUSH, { headers: p.auth })).status).toBe(404);
  });

  it('replaces this session’s token when it rotates', async () => {
    const { h } = pushHarness();
    const p = await person(h);
    await h.app.request(PUSH, register(p));
    await h.app.request(PUSH, register(p, { platform: 'ios', token: 'fcm-token-2', environment: 'sandbox' }));
    expect(await live(h, p.userId)).toMatchObject([{ token: 'fcm-token-2', environment: 'sandbox' }]);
  });

  it('keeps one token per phone session: two phones both get one, and a token handed to another person moves', async () => {
    const { h } = pushHarness();
    const a = await person(h);
    const phone2 = await signedIn(h, a.email, a.password, a.userId, a.personalId);
    await h.app.request(PUSH, register(a, { platform: 'ios', token: 'phone-1' }));
    await h.app.request(PUSH, register(phone2, { platform: 'android', token: 'phone-2' }));
    expect((await live(h, a.userId)).map((d) => d.token).sort()).toEqual(['phone-1', 'phone-2']);
    const b = await person(h);
    await h.app.request(PUSH, register(b, { platform: 'ios', token: 'phone-1' }));
    expect((await live(h, a.userId)).map((d) => d.token)).toEqual(['phone-2']);
    expect((await live(h, b.userId)).map((d) => d.token)).toEqual(['phone-1']);
  });

  it('refuses a bad body', async () => {
    const { h } = pushHarness();
    const p = await person(h);
    expect((await h.app.request(PUSH, register(p, { platform: 'windows', token: 'x' }))).status).toBe(422);
    expect((await h.app.request(PUSH, register(p, { platform: 'ios', token: '' }))).status).toBe(422);
    expect((await h.app.request(PUSH, register(p, { platform: 'ios', token: 'x', extra: 1 }))).status).toBe(422);
  });

  it('removes this session’s token only, and is quiet when there is none', async () => {
    const { h } = pushHarness();
    const a = await person(h);
    const phone2 = await signedIn(h, a.email, a.password, a.userId, a.personalId);
    await h.app.request(PUSH, register(a, { platform: 'ios', token: 'phone-1' }));
    await h.app.request(PUSH, register(phone2, { platform: 'android', token: 'phone-2' }));
    expect((await h.app.request(PUSH, { method: 'DELETE', headers: a.auth })).status).toBe(204);
    expect((await live(h, a.userId)).map((d) => d.token)).toEqual(['phone-2']);
    expect((await h.app.request(PUSH, { method: 'DELETE', headers: a.auth })).status).toBe(204);
  });

  it('signing out removes the token, and a signed-out phone gets no push', async () => {
    const { h, sender } = pushHarness();
    const accountant = await approvedAccountant(h);
    await addCustomer(h, accountant);
    await h.app.request(PUSH, register(accountant));
    expect(await live(h, accountant.userId)).toHaveLength(1);
    expect((await h.app.request('/v1/device-sessions/current', { method: 'DELETE', headers: accountant.auth })).status).toBe(204);
    expect(await live(h, accountant.userId)).toHaveLength(0);
    expect(await h.store.pushDevices.removeForSession('00000000-0000-4000-8000-000000000000')).toBe(false);
    h.setNow(new Date(h.now().getTime() + 3 * DAY + 60_000));
    const out = await read(await sweep(h));
    expect(out).toMatchObject({ reminded: 1, pushed: 0 });
    expect(sender.deliveries).toHaveLength(0);
  });

  it('a session revoked another way keeps its row but never receives a push', async () => {
    const { h, sender } = pushHarness();
    const accountant = await approvedAccountant(h);
    await addCustomer(h, accountant);
    await h.app.request(PUSH, register(accountant));
    const [device] = await live(h, accountant.userId);
    await h.store.sessions.revoke(device!.sessionId, 'password_changed', h.now());
    expect(await live(h, accountant.userId)).toHaveLength(0);
    h.setNow(new Date(h.now().getTime() + 3 * DAY + 60_000));
    expect(await read(await sweep(h))).toMatchObject({ pushed: 0 });
    expect(sender.deliveries).toHaveLength(0);
  });
});

describe('the unclaimed sweep’s phone push (MUT-780, ADR-352)', () => {
  it('pushes the accountant once on the day the digest is due: counts only, the reminded customer in the data', async () => {
    const { h, sender } = pushHarness();
    const t0 = h.now().getTime();
    const accountant = await approvedAccountant(h);
    await h.app.request(PUSH, register(accountant));
    const customerId = await addCustomer(h, accountant);

    h.setNow(new Date(t0 + 2 * DAY + 60_000));
    expect(await read(await sweep(h))).toMatchObject({ reminded: 0, pushed: 0 });
    expect(sender.deliveries).toHaveLength(0);

    h.setNow(new Date(t0 + 3 * DAY + 60_000));
    expect(await read(await sweep(h))).toMatchObject({ reminded: 1, digests: 1, pushed: 1, failed: 0 });
    expect(sender.deliveries).toHaveLength(1);
    const [sent] = sender.deliveries;
    expect(sent).toMatchObject({ platform: 'ios', token: 'fcm-token-1', title: 'MTB3A', body: '1 customer hasn’t claimed their account', data: { kind: 'unclaimed_digest', customerUserId: customerId } });
    expect(JSON.stringify(sent)).not.toMatch(/Samer|Caf|@cafe-nour/);

    expect(await read(await sweep(h))).toMatchObject({ reminded: 0, digests: 0, pushed: 0 });
    expect(sender.deliveries).toHaveLength(1);
  });

  it('words the push in the accountant’s language', async () => {
    const { h, sender } = pushHarness();
    const t0 = h.now().getTime();
    const accountant = await approvedAccountant(h, 'ar');
    await h.app.request(PUSH, register(accountant, { platform: 'android', token: 'fcm-ar' }));
    await addCustomer(h, accountant);
    h.setNow(new Date(t0 + 3 * DAY + 60_000));
    await sweep(h);
    expect(sender.deliveries[0]).toMatchObject({ platform: 'android', title: 'متابعة', body: 'زبون واحد لم يستلم حسابه' });
  });

  it('sends nothing when push is dark or the accountant has no device, and counts a refusing platform as failed work, not a failed run', async () => {
    const dark = pushHarness(undefined, false);
    const t0 = dark.h.now().getTime();
    const a1 = await approvedAccountant(dark.h);
    await addCustomer(dark.h, a1);
    dark.h.setNow(new Date(t0 + 3 * DAY + 60_000));
    expect(await read(await sweep(dark.h))).toMatchObject({ digests: 1, pushed: 0 });

    const none = pushHarness();
    const a2 = await approvedAccountant(none.h);
    await addCustomer(none.h, a2);
    none.h.setNow(new Date(t0 + 3 * DAY + 60_000));
    expect(await read(await sweep(none.h))).toMatchObject({ digests: 1, pushed: 0, failed: 0 });
    expect(none.sender.deliveries).toHaveLength(0);

    const failing = pushHarness(() => 'failed');
    const a3 = await approvedAccountant(failing.h);
    await failing.h.app.request(PUSH, register(a3));
    await addCustomer(failing.h, a3);
    failing.h.setNow(new Date(t0 + 3 * DAY + 60_000));
    expect(await read(await sweep(failing.h))).toMatchObject({ reminded: 1, digests: 1, pushed: 0, failed: 0 });
    expect(await live(failing.h, a3.userId)).toHaveLength(1);
  });

  it('drops a token the platform says is gone', async () => {
    const { h } = pushHarness(() => 'invalid_token');
    const t0 = h.now().getTime();
    const accountant = await approvedAccountant(h);
    await h.app.request(PUSH, register(accountant));
    await addCustomer(h, accountant);
    h.setNow(new Date(t0 + 3 * DAY + 60_000));
    expect(await read(await sweep(h))).toMatchObject({ pushed: 0 });
    expect(await live(h, accountant.userId)).toHaveLength(0);
  });
});
