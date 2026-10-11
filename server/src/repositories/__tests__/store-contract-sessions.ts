import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation, UniqueViolation } from '../memory.js';
import type { CreateSessionInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-38 storage contract: server-side browser sessions (hosted-portal.md
 * §4.1–4.2). The store keeps only the HMAC digest of a session token; revoking
 * is a write that wins once, so a replayed cookie meets a revoked record.
 */
export function describeLedgerStoreSessionsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 9, minute, 0));
  const digest = () => unique().padEnd(64, '0').slice(0, 64);

  async function user(store: LedgerStore): Promise<UserRecord> {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user: created } = await store.users.create({
      email: `p-${unique()}@firm.ps`,
      displayName: 'Nour',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      organizationId: org.id,
      at: at(0),
    });
    return created;
  }

  const input = (userId: string, overrides: Partial<CreateSessionInput> = {}): CreateSessionInput => ({
    userId,
    tokenDigest: digest(),
    at: at(0),
    idleExpiresAt: at(120),
    absoluteExpiresAt: at(720),
    userAgent: 'Mozilla/5.0',
    ...overrides,
  });

  describe(`${name} LedgerStore sessions contract (MUT-38)`, () => {
    it('creates and finds a session by digest', async () => {
      const store = await makeStore();
      const u = await user(store);
      const created = await store.sessions.create(input(u.id));
      expect(created).toMatchObject({ userId: u.id, revokedAt: null, revokedReason: null, userAgent: 'Mozilla/5.0' });
      expect(created.lastSeenAt.toISOString()).toBe(at(0).toISOString());
      const found = await store.sessions.findByDigest(created.tokenDigest);
      expect(found?.id).toBe(created.id);
      expect(found?.idleExpiresAt.toISOString()).toBe(at(120).toISOString());
      expect(found?.absoluteExpiresAt.toISOString()).toBe(at(720).toISOString());
      expect(await store.sessions.findByDigest(digest())).toBeNull();
    });

    it('refuses a duplicate digest and an unknown user', async () => {
      const store = await makeStore();
      const u = await user(store);
      const first = await store.sessions.create(input(u.id));
      await expect(store.sessions.create(input(u.id, { tokenDigest: first.tokenDigest }))).rejects.toBeInstanceOf(UniqueViolation);
      await expect(store.sessions.create(input('00000000-0000-4000-8000-000000000000'))).rejects.toBeInstanceOf(ForeignKeyViolation);
    });

    it('touch moves lastSeenAt and the idle deadline', async () => {
      const store = await makeStore();
      const u = await user(store);
      const s = await store.sessions.create(input(u.id));
      await store.sessions.touch(s.id, at(30), at(150));
      const found = await store.sessions.findByDigest(s.tokenDigest);
      expect(found?.lastSeenAt.toISOString()).toBe(at(30).toISOString());
      expect(found?.idleExpiresAt.toISOString()).toBe(at(150).toISOString());
    });

    it('revoke wins once; an unknown id is null', async () => {
      const store = await makeStore();
      const u = await user(store);
      const s = await store.sessions.create(input(u.id));
      const first = await store.sessions.revoke(s.id, 'signed_out', at(10));
      expect(first?.revokedAt?.toISOString()).toBe(at(10).toISOString());
      const again = await store.sessions.revoke(s.id, 'other', at(20));
      expect(again?.revokedReason).toBe('signed_out');
      expect(again?.revokedAt?.toISOString()).toBe(at(10).toISOString());
      expect(await store.sessions.revoke('00000000-0000-4000-8000-000000000000', 'x', at(1))).toBeNull();
    });

    it('revokeAllForUser revokes only that user’s live sessions and counts them', async () => {
      const store = await makeStore();
      const a = await user(store);
      const b = await user(store);
      const a1 = await store.sessions.create(input(a.id));
      const a2 = await store.sessions.create(input(a.id));
      const b1 = await store.sessions.create(input(b.id));
      await store.sessions.revoke(a2.id, 'signed_out', at(5));
      expect(await store.sessions.revokeAllForUser(a.id, 'password_reset', at(10))).toBe(1);
      expect((await store.sessions.findByDigest(a1.tokenDigest))?.revokedReason).toBe('password_reset');
      expect((await store.sessions.findByDigest(a2.tokenDigest))?.revokedReason).toBe('signed_out');
      expect((await store.sessions.findByDigest(b1.tokenDigest))?.revokedAt).toBeNull();
    });

    it('records failed sign-ins and a lock, then a successful sign-in clears them', async () => {
      const store = await makeStore();
      const u = await user(store);
      await store.users.recordFailedSignIn(u.id, at(1), null);
      const locked = await store.users.recordFailedSignIn(u.id, at(2), at(17));
      expect(locked).toMatchObject({ failedSignIns: 2 });
      expect(locked?.lockedUntil?.toISOString()).toBe(at(17).toISOString());
      const signedIn = await store.users.recordSignIn(u.id, at(20));
      expect(signedIn).toMatchObject({ failedSignIns: 0, lockedUntil: null });
      expect(signedIn?.lastSignInAt?.toISOString()).toBe(at(20).toISOString());
      expect(await store.users.recordSignIn('00000000-0000-4000-8000-000000000000', at(20))).toBeNull();
    });

    it('accepts the USER audit actor', async () => {
      const store = await makeStore();
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'UTC' });
      const event = await store.audit.append({ organizationId: org.id, actorType: 'USER', actorId: '00000000-0000-4000-8000-000000000001', action: 'user.signed_in', entityType: 'user', entityId: null, requestId: null });
      expect(event.actorType).toBe('USER');
    });
  });
}
