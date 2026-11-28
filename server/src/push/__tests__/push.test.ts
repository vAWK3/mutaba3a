import { generateKeyPairSync, createVerify } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { FcmPushSender, fcmMessage, outcomeOfError, parseServiceAccount, signAssertion } from '../fcm-sender.js';
import { renderPush } from '../messages.js';
import { createPushService, DISABLED_PUSH } from '../service.js';
import { FakePushSender } from '../fake-sender.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';

const logger = pino({ level: 'silent' });

describe('renderPush (MUT-780)', () => {
  it('words the digest in English and Arabic, with the Arabic counted noun', () => {
    expect(renderPush('unclaimed_digest', { waiting: 1, removingSoon: 0 }, 'en')).toEqual({ title: 'MTB3A', body: '1 customer hasn’t claimed their account' });
    expect(renderPush('unclaimed_digest', { waiting: 4, removingSoon: 2 }, 'en').body).toBe('4 customers haven’t claimed their accounts · 2 removed within a week');
    expect(renderPush('unclaimed_digest', { waiting: 1, removingSoon: 0 }, 'ar')).toEqual({ title: 'متابعة', body: 'زبون واحد لم يستلم حسابه' });
    expect(renderPush('unclaimed_digest', { waiting: 2, removingSoon: 0 }, 'ar').body).toBe('زبونان لم يستلما حسابيهما');
    expect(renderPush('unclaimed_digest', { waiting: 5, removingSoon: 1 }, 'ar').body).toBe('5 زبائن لم يستلموا حساباتهم · 1 تُحذف خلال أسبوع');
    expect(renderPush('unclaimed_digest', { waiting: 12, removingSoon: 0 }, 'ar').body).toBe('12 زبونًا لم يستلموا حساباتهم');
  });
});

describe('createPushService (MUT-780)', () => {
  async function seeded() {
    const store = new MemoryLedgerStore();
    const org = await store.organizations.create({ name: 'Firm', slug: 'firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const at = new Date('2026-11-28T09:00:00Z');
    const { user } = await store.users.create({
      email: 'a@firm.ps', displayName: 'A', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', locale: 'ar', organizationId: org.id,
      personal: { name: 'P', slug: 'p', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at,
    });
    const session = (digest: string) =>
      store.sessions.create({ userId: user.id, tokenDigest: digest.padEnd(64, '0'), kind: 'device', at, idleExpiresAt: new Date(at.getTime() + 864e5), absoluteExpiresAt: new Date(at.getTime() + 864e5), userAgent: null });
    return { store, user, at, session };
  }

  it('sends to every live device, localised, with the kind added to the data', async () => {
    const { store, user, at, session } = await seeded();
    const s1 = await session('a');
    const s2 = await session('b');
    await store.pushDevices.register({ userId: user.id, sessionId: s1.id, platform: 'ios', token: 't1', environment: 'production', at });
    await store.pushDevices.register({ userId: user.id, sessionId: s2.id, platform: 'android', token: 't2', environment: 'production', at });
    const sender = new FakePushSender();
    const result = await createPushService({ store, sender, logger }).notifyUser(user.id, { kind: 'unclaimed_digest', vars: { waiting: 1, removingSoon: 0 }, data: { customerUserId: 'c1' } }, at);
    expect(result).toEqual({ sent: 2, failed: 0, removed: 0 });
    expect(sender.deliveries.map((d) => d.token).sort()).toEqual(['t1', 't2']);
    expect(sender.deliveries[0]).toMatchObject({ title: 'متابعة', data: { kind: 'unclaimed_digest', customerUserId: 'c1' } });
  });

  it('removes tokens the platform refuses for good, keeps the ones that failed, and survives a sender that throws', async () => {
    const { store, user, at, session } = await seeded();
    const [s1, s2, s3] = [await session('a'), await session('b'), await session('c')];
    for (const [s, token] of [[s1, 'gone'], [s2, 'flaky'], [s3, 'boom']] as const) await store.pushDevices.register({ userId: user.id, sessionId: s.id, platform: 'ios', token, environment: 'production', at });
    const sender = {
      send: async (d: { token: string }) => {
        if (d.token === 'boom') throw new Error('network');
        return d.token === 'gone' ? ('invalid_token' as const) : ('failed' as const);
      },
    };
    const result = await createPushService({ store, sender, logger }).notifyUser(user.id, { kind: 'unclaimed_digest', vars: { waiting: 1, removingSoon: 0 }, data: {} }, at);
    expect(result).toEqual({ sent: 0, failed: 2, removed: 1 });
    expect((await store.pushDevices.listLive(user.id, at)).map((d) => d.token).sort()).toEqual(['boom', 'flaky']);
  });

  it('does nothing for a person with no device or an unknown person, and the disabled service never sends', async () => {
    const { store, user, at } = await seeded();
    const sender = new FakePushSender();
    const service = createPushService({ store, sender, logger });
    expect(await service.notifyUser(user.id, { kind: 'unclaimed_digest', vars: {}, data: {} }, at)).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(await service.notifyUser('00000000-0000-4000-8000-000000000000', { kind: 'unclaimed_digest', vars: {}, data: {} }, at)).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(sender.deliveries).toHaveLength(0);
    expect(DISABLED_PUSH.enabled).toBe(false);
  });
});

describe('FcmPushSender (MUT-780)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const account = parseServiceAccount(JSON.stringify({ client_email: 'push@proj.iam.gserviceaccount.com', private_key: privateKey }));
  const delivery = { platform: 'ios' as const, token: 'tok', title: 'MTB3A', body: 'b', data: { kind: 'unclaimed_digest' } };

  it('parses a service account and refuses a broken one without echoing it', () => {
    expect(account.tokenUri).toBe('https://oauth2.googleapis.com/token');
    expect(() => parseServiceAccount('{nope')).toThrow('not valid JSON');
    expect(() => parseServiceAccount('{"client_email":"x"}')).toThrow('needs client_email and private_key');
  });

  it('signs an RS256 assertion Google can verify', () => {
    const jwt = signAssertion(account, 1_700_000_000);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toMatchObject({ iss: account.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  function fakeFetch(answers: Array<{ status: number; body?: unknown }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const a = answers.shift() ?? { status: 500 };
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('exchanges the assertion once, reuses the access token, and posts the message to the project', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'ya29.x', expires_in: 3600 } }, { status: 200 }, { status: 200 }]);
    const sender = new FcmPushSender({ projectId: 'proj', account, fetch: impl, now: () => new Date('2026-11-28T09:00:00Z') });
    expect(await sender.send(delivery)).toBe('sent');
    expect(await sender.send(delivery)).toBe('sent');
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[1]!.url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.x');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ message: fcmMessage(delivery) });
    expect(fcmMessage(delivery)).toMatchObject({ token: 'tok', notification: { title: 'MTB3A', body: 'b' }, data: { kind: 'unclaimed_digest' } });
  });

  it('maps the answers: unregistered is invalid, others keep the token, a failed token exchange is failed', async () => {
    const unreg = fakeFetch([{ status: 200, body: { access_token: 'a', expires_in: 3600 } }, { status: 404, body: { error: { details: [{ errorCode: 'UNREGISTERED' }] } } }]);
    expect(await new FcmPushSender({ projectId: 'p', account, fetch: unreg.impl }).send(delivery)).toBe('invalid_token');
    const down = fakeFetch([{ status: 200, body: { access_token: 'a', expires_in: 3600 } }, { status: 503 }]);
    expect(await new FcmPushSender({ projectId: 'p', account, fetch: down.impl }).send(delivery)).toBe('failed');
    const noAuth = fakeFetch([{ status: 401 }]);
    expect(await new FcmPushSender({ projectId: 'p', account, fetch: noAuth.impl }).send(delivery)).toBe('failed');
    expect(outcomeOfError(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } }))).toBe('failed');
    expect(outcomeOfError(502, '<html>bad gateway</html>')).toBe('failed');
  });

  it('without a key it takes the runtime identity from the metadata server', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'adc-token', expires_in: 3000 } }, { status: 200 }]);
    const sender = new FcmPushSender({ projectId: 'mtb3a-barmajiyat', fetch: impl });
    expect(await sender.send(delivery)).toBe('sent');
    expect(calls[0]!.url).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');
    expect((calls[0]!.init.headers as Record<string, string>)['metadata-flavor']).toBe('Google');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer adc-token');
    expect(calls[1]!.url).toContain('/projects/mtb3a-barmajiyat/');
  });

  it('asks Google for a new access token once the old one is about to end', async () => {
    let now = new Date('2026-11-28T09:00:00Z');
    const { impl, calls } = fakeFetch([{ status: 200, body: { access_token: 'one', expires_in: 3600 } }, { status: 200 }, { status: 200, body: { access_token: 'two', expires_in: 3600 } }, { status: 200 }]);
    const sender = new FcmPushSender({ projectId: 'p', account, fetch: impl, now: () => now });
    await sender.send(delivery);
    now = new Date(now.getTime() + 3600_000 - 30_000);
    await sender.send(delivery);
    expect(calls.map((c) => c.url.includes('oauth2'))).toEqual([true, false, true, false]);
  });
});
