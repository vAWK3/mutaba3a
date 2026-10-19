import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';
import { createLocalApp } from '../createLocalApp.js';
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
});
