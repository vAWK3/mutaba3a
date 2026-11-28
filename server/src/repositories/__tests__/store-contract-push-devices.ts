import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation } from '../memory.js';
import type { LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-780 (ADR-351) storage contract: one push token per session, unique across sessions, live sessions only. Run
 * against the memory store and Postgres (`test:db`), so the two agree on replacement and on what "live" means.
 */
export function describeLedgerStorePushDevicesContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 28, 9, minute, 0));

  async function person(store: LedgerStore): Promise<UserRecord> {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await store.users.create({
      email: `p-${unique()}@firm.ps`,
      displayName: 'Nour',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      organizationId: org.id,
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
    return user;
  }

  const session = (store: LedgerStore, userId: string, overrides: { idleExpiresAt?: Date; absoluteExpiresAt?: Date } = {}) =>
    store.sessions.create({ userId, tokenDigest: unique().padEnd(64, '0').slice(0, 64), kind: 'device', at: at(1), idleExpiresAt: at(50), absoluteExpiresAt: at(59), userAgent: null, ...overrides });

  describe(`${name} LedgerStore push devices contract (MUT-780)`, () => {
    it('registers a token for a session and replaces it when the session registers another', async () => {
      const store = await makeStore();
      const user = await person(store);
      const s = await session(store, user.id);
      await store.pushDevices.register({ userId: user.id, sessionId: s.id, platform: 'ios', token: `t-${unique()}`, environment: 'sandbox', at: at(2) });
      const next = `t-${unique()}`;
      await store.pushDevices.register({ userId: user.id, sessionId: s.id, platform: 'ios', token: next, environment: 'production', at: at(3) });
      const live = await store.pushDevices.listLive(user.id, at(4));
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ userId: user.id, sessionId: s.id, platform: 'ios', token: next, environment: 'production' });
    });

    it('lets one person hold a token per session, and moves a token to the session that registers it last', async () => {
      const store = await makeStore();
      const a = await person(store);
      const b = await person(store);
      const [a1, a2, b1] = [await session(store, a.id), await session(store, a.id), await session(store, b.id)];
      const shared = `t-${unique()}`;
      await store.pushDevices.register({ userId: a.id, sessionId: a1.id, platform: 'ios', token: shared, environment: 'production', at: at(2) });
      await store.pushDevices.register({ userId: a.id, sessionId: a2.id, platform: 'android', token: `t-${unique()}`, environment: 'production', at: at(3) });
      expect(await store.pushDevices.listLive(a.id, at(4))).toHaveLength(2);
      await store.pushDevices.register({ userId: b.id, sessionId: b1.id, platform: 'ios', token: shared, environment: 'production', at: at(5) });
      expect(await store.pushDevices.listLive(a.id, at(6))).toHaveLength(1);
      expect((await store.pushDevices.listLive(b.id, at(6)))[0]?.token).toBe(shared);
    });

    it('lists only devices of live sessions: not revoked, inside both deadlines', async () => {
      const store = await makeStore();
      const user = await person(store);
      const revoked = await session(store, user.id);
      const idle = await session(store, user.id, { idleExpiresAt: at(10) });
      const absolute = await session(store, user.id, { absoluteExpiresAt: at(12) });
      const ok = await session(store, user.id);
      for (const s of [revoked, idle, absolute, ok]) await store.pushDevices.register({ userId: user.id, sessionId: s.id, platform: 'android', token: `t-${unique()}`, environment: 'production', at: at(2) });
      await store.sessions.revoke(revoked.id, 'signed_out', at(3));
      expect((await store.pushDevices.listLive(user.id, at(20))).map((d) => d.sessionId)).toEqual([ok.id]);
    });

    it('removes by session, and by id for tokens a send found invalid', async () => {
      const store = await makeStore();
      const user = await person(store);
      const [s1, s2] = [await session(store, user.id), await session(store, user.id)];
      await store.pushDevices.register({ userId: user.id, sessionId: s1.id, platform: 'ios', token: `t-${unique()}`, environment: 'production', at: at(2) });
      await store.pushDevices.register({ userId: user.id, sessionId: s2.id, platform: 'ios', token: `t-${unique()}`, environment: 'production', at: at(3) });
      expect(await store.pushDevices.removeForSession(s1.id)).toBe(true);
      expect(await store.pushDevices.removeForSession(s1.id)).toBe(false);
      const [left] = await store.pushDevices.listLive(user.id, at(4));
      expect(await store.pushDevices.removeByIds([])).toBe(0);
      expect(await store.pushDevices.removeByIds([left!.id])).toBe(1);
      expect(await store.pushDevices.listLive(user.id, at(4))).toHaveLength(0);
    });

    it('refuses a session that does not exist', async () => {
      const store = await makeStore();
      const user = await person(store);
      await expect(store.pushDevices.register({ userId: user.id, sessionId: '00000000-0000-4000-8000-000000000000', platform: 'ios', token: `t-${unique()}`, environment: 'production', at: at(2) })).rejects.toBeInstanceOf(ForeignKeyViolation);
    });
  });
}
