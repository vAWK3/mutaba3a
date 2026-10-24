import { describe, expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { consoleLogger, createLocalApp } from '../createLocalApp.js';
import { mintLocalSession } from '../mintLocalSession.js';

/**
 * Not one of the plan's 11 mandated Phase B files, but the core of all of
 * them: proves `createLocalApp` + `mintLocalSession` actually answer a real
 * request end to end (auth wiring, route registration, the device-session
 * token), the way `transport.ts` depends on both working. Runs under Node's
 * real `node:crypto`/`Buffer` (Vitest doesn't apply `vite.config.ts`'s hosted
 * alias) — `platform-shim.test.ts` is what proves the browser shims those
 * aliases substitute are byte-identical, so this test's job is the wiring,
 * not the crypto.
 */
describe('createLocalApp + mintLocalSession', () => {
  it('GET /v1/me answers for the freshly minted local person', async () => {
    const store = new MemoryLedgerStore();
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const { token, user } = await mintLocalSession(store, now, 'ar');
    const app = createLocalApp({ store, now });

    const response = await app.fetch(new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${token}` } }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string; email: string }; profiles: unknown[] };
    expect(body.user.id).toBe(user.id);
    expect(body.user.email).toBe('local@device.invalid');
    expect(body.profiles).toHaveLength(1); // the one personal profile users.create wrote
  });

  it('holds a session to the rate limit it is given (MUT-291 R1)', async () => {
    const store = new MemoryLedgerStore();
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const { token } = await mintLocalSession(store, now, 'ar');
    const app = createLocalApp({ store, now, rateLimitPerMinute: 3 });
    const me = () => app.fetch(new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${token}` } }));

    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await me()).status);

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('with no limit, a carry-over replay of 12,000 requests is never refused (MUT-291 R1)', async () => {
    const store = new MemoryLedgerStore();
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const { token } = await mintLocalSession(store, now, 'ar');
    const app = createLocalApp({ store, now, rateLimitPerMinute: Infinity });
    const request = new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${token}` } });

    let refused = 0;
    for (let i = 0; i < 12_000; i++) if ((await app.fetch(request.clone())).status === 429) refused++;

    expect(refused).toBe(0);
  }, 60_000);

  it('rejects a request with no token', async () => {
    const store = new MemoryLedgerStore();
    const now = () => new Date('2026-01-01T00:00:00.000Z');
    const app = createLocalApp({ store, now });

    const response = await app.fetch(new Request('http://local/v1/me'));

    expect(response.status).toBe(401);
  });

  it('mints a fresh session every boot, finding the same person each time (the corrected two-step sequence)', async () => {
    const store = new MemoryLedgerStore();
    const now = () => new Date('2026-01-01T00:00:00.000Z');

    const first = await mintLocalSession(store, now);
    const second = await mintLocalSession(store, now);

    expect(second.user.id).toBe(first.user.id); // same person, not a second one created
    expect(second.token).not.toBe(first.token); // a new token every boot

    // Simulate a restore (sessionsById is excluded from snapshot/restore — ADR-097 §2.3.4): the first token must no
    // longer work after a restore, and a freshly minted one must.
    const restored = new MemoryLedgerStore();
    restored.restore(store.snapshot());
    const afterRestore = await mintLocalSession(restored, now);
    const restoredApp = createLocalApp({ store: restored, now });

    const withOldToken = await restoredApp.fetch(new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${second.token}` } }));
    expect(withOldToken.status).toBe(401);

    const withFreshToken = await restoredApp.fetch(new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${afterRestore.token}` } }));
    expect(withFreshToken.status).toBe(200);
  });

  it('sends a route failure to the browser console: signed out there is no Sentry and no server log to catch it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');

    consoleLogger().error({ err: failure, requestId: 'r1' }, 'Unhandled error');

    expect(spy).toHaveBeenCalledWith('[mutaba3a local]', { err: failure, requestId: 'r1' }, 'Unhandled error');
    spy.mockRestore();
  });

  it('still signs the local person in when the clock is now earlier than when they were created (review)', async () => {
    const store = new MemoryLedgerStore();
    const later = () => new Date('2027-01-01T00:00:00.000Z');
    const earlier = () => new Date('2026-01-01T00:00:00.000Z');
    await mintLocalSession(store, later); // created while the clock ran ahead, or restored from such a device
    const { token } = await mintLocalSession(store, earlier);
    const app = createLocalApp({ store, now: earlier });

    const response = await app.fetch(new Request('http://local/v1/me', { headers: { Authorization: `Bearer ${token}` } }));

    expect(response.status).toBe(200);
  });
});
