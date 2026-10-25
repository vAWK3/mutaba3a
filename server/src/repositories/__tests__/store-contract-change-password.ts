import { describe, expect, it } from 'vitest';
import { StateConflict, UniqueViolation } from '../memory.js';
import type { AuditEventInput, ChangePasswordInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-237 storage contract: a signed-in person changes their own password.
 * One transaction under the same row-lock discipline ADR-088 §7a added for
 * `--lock`/redeem (`store-contract-account-setup.ts`): the person's row is held
 * while the hash is replaced, so a sign-in racing this call either commits
 * first (and its session is then among the ones revoked) or sees the new hash
 * and is refused, never a session minted against the password just replaced.
 */
export function describeLedgerStoreChangePasswordContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 16, hour, 0, 0));
  const digest = () => unique().padEnd(64, '0').slice(0, 64);
  const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const NEW_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$bmV3';

  async function person(store: LedgerStore, passwordHash: string | null = HASH): Promise<{ user: UserRecord; orgIds: string[] }> {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user, memberships } = await store.users.create({
      email: `p-${unique()}@firm.ps`,
      displayName: 'Nour',
      passwordHash,
      locale: 'en',
      organizationId: org.id,
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
    return { user, orgIds: memberships.map((m) => m.organizationId) };
  }

  const auditFor = (orgIds: string[], userId: string, action: string): AuditEventInput[] =>
    orgIds.map((organizationId) => ({ organizationId, actorType: 'USER', actorId: userId, action, entityType: 'user', entityId: userId, requestId: null }));

  async function openSession(store: LedgerStore, userId: string, kind: 'cookie' | 'device' = 'cookie') {
    return store.sessions.create({ userId, tokenDigest: digest(), kind, at: at(1), idleExpiresAt: at(2), absoluteExpiresAt: at(9), userAgent: null });
  }

  const input = (overrides: Partial<ChangePasswordInput> & Pick<ChangePasswordInput, 'userId' | 'exceptSessionId'>): ChangePasswordInput => ({
    passwordHash: NEW_HASH,
    verifiedPasswordHash: HASH,
    at: at(3),
    audit: [],
    ...overrides,
  });

  describe(`${name} LedgerStore change-password contract (MUT-237)`, () => {
    it('sets the password, stamps passwordChangedAt and clears a lockout', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      await store.users.recordFailedSignIn(user.id, at(1), at(5));
      const current = await openSession(store, user.id);
      const changed = await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id }));
      expect(changed).toMatchObject({ id: user.id, passwordHash: NEW_HASH, failedSignIns: 0, lockedUntil: null });
      expect(changed?.passwordChangedAt.toISOString()).toBe(at(3).toISOString());
    });

    it('revokes every other session, web and device, and keeps the current one live', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const current = await openSession(store, user.id, 'cookie');
      const otherWeb = await openSession(store, user.id, 'cookie');
      const device = await openSession(store, user.id, 'device');
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id }));
      expect((await store.sessions.findByDigest(current.tokenDigest))?.revokedAt).toBeNull();
      for (const s of [otherWeb, device]) {
        const found = await store.sessions.findByDigest(s.tokenDigest);
        expect(found?.revokedAt?.toISOString()).toBe(at(3).toISOString());
        expect(found?.revokedReason).toBe('password_changed');
      }
    });

    it('re-stamps the kept session as verified against the new password, leaving its start and deadlines alone', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const current = await openSession(store, user.id, 'device');
      const other = await openSession(store, user.id, 'cookie');
      expect(current.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id }));
      const kept = await store.sessions.findByDigest(current.tokenDigest);
      // The session middleware refuses a session verified before passwordChangedAt; the kept one is now verified at it.
      expect(kept?.credentialsVerifiedAt.toISOString()).toBe(at(3).toISOString());
      expect(kept?.createdAt.toISOString()).toBe(at(1).toISOString());
      expect(kept?.idleExpiresAt.toISOString()).toBe(at(2).toISOString());
      expect(kept?.absoluteExpiresAt.toISOString()).toBe(at(9).toISOString());
      expect((await store.sessions.findByDigest(other.tokenDigest))?.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
    });

    it("refuses another person's session named as the one to keep, and touches neither person", async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const mine = await openSession(store, user.id);
      const { user: stranger } = await person(store, HASH);
      const theirs = await openSession(store, stranger.id);
      await expect(store.users.changePassword(input({ userId: user.id, exceptSessionId: theirs.id }))).rejects.toBeInstanceOf(StateConflict);
      const found = await store.sessions.findByDigest(theirs.tokenDigest);
      expect(found?.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
      expect(found?.revokedAt).toBeNull();
      expect((await store.sessions.findByDigest(mine.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.users.getById(user.id))?.passwordHash).toBe(HASH);
    });

    // MUT-238 review: two changes can each verify the old password before either takes the lock. Under the lock the
    // second sees that the hash it verified is gone (and that the first revoked its session) and writes nothing.
    it('refuses when the stored hash is no longer the one the caller verified, and writes nothing', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store, HASH);
      const current = await openSession(store, user.id);
      const other = await openSession(store, user.id);
      await expect(
        store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id, verifiedPasswordHash: NEW_HASH, audit: auditFor(orgIds, user.id, 'user.password_changed') })),
      ).rejects.toBeInstanceOf(StateConflict);
      const unchanged = await store.users.getById(user.id);
      expect(unchanged?.passwordHash).toBe(HASH);
      expect(unchanged?.passwordChangedAt.toISOString()).toBe(user.passwordChangedAt.toISOString());
      expect((await store.sessions.findByDigest(other.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.sessions.findByDigest(current.tokenDigest))?.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
      for (const orgId of orgIds) {
        expect((await store.audit.listByOrganization(orgId, 10)).map((e) => e.action)).not.toContain('user.password_changed');
      }
    });

    it("refuses when the caller's own session was revoked meanwhile, and writes nothing", async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const current = await openSession(store, user.id);
      const other = await openSession(store, user.id);
      await store.sessions.revoke(current.id, 'password_changed', at(2));
      await expect(store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id }))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.users.getById(user.id))?.passwordHash).toBe(HASH);
      expect((await store.sessions.findByDigest(other.tokenDigest))?.revokedAt).toBeNull();
    });

    it('a second change that verified the same old password loses to the first: the first stays, its session stays live', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const phone = await openSession(store, user.id, 'device');
      const portal = await openSession(store, user.id, 'cookie');
      const SECOND_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c2Vjb25k';
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: portal.id }));
      await expect(store.users.changePassword(input({ userId: user.id, exceptSessionId: phone.id, passwordHash: SECOND_HASH }))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.users.getById(user.id))?.passwordHash).toBe(NEW_HASH);
      expect((await store.sessions.findByDigest(portal.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.sessions.findByDigest(phone.tokenDigest))?.revokedReason).toBe('password_changed');
    });

    // MUT-262 (TD-158): with `rotation`, the kept session is replaced by a new one under a new digest, so a leaked copy
    // of the caller's own token stops working too. A new row (not a digest swap): the middleware's stale path revokes
    // by the old digest's id, which must not be the session the person keeps.
    describe('rotating the kept session (MUT-262)', () => {
      const IDLE_MS = 3_600_000;

      it('revokes the kept session as password_rotated and opens a live one under the new digest, same kind, agent, passkey and absolute deadline', async () => {
        const store = await makeStore();
        const { user } = await person(store, HASH);
        const current = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'device', at: at(1), idleExpiresAt: at(2), absoluteExpiresAt: at(9), userAgent: 'MTB3A/1.0' });
        const other = await openSession(store, user.id, 'cookie');
        const rotated = digest();
        await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id, rotation: { tokenDigest: rotated, idleMs: IDLE_MS } }));
        const old = await store.sessions.findByDigest(current.tokenDigest);
        expect(old?.revokedAt?.toISOString()).toBe(at(3).toISOString());
        expect(old?.revokedReason).toBe('password_rotated');
        expect((await store.sessions.findByDigest(other.tokenDigest))?.revokedReason).toBe('password_changed');
        const fresh = await store.sessions.findByDigest(rotated);
        expect(fresh).toMatchObject({ userId: user.id, kind: 'device', userAgent: 'MTB3A/1.0', passkeyId: null, revokedAt: null, revokedReason: null });
        expect(fresh?.id).not.toBe(current.id);
        expect(fresh?.absoluteExpiresAt.toISOString()).toBe(at(9).toISOString());
        for (const field of ['createdAt', 'credentialsVerifiedAt', 'lastSeenAt'] as const) expect(fresh?.[field].toISOString()).toBe(at(3).toISOString());
        expect(fresh?.idleExpiresAt.toISOString()).toBe(new Date(at(3).getTime() + IDLE_MS).toISOString());
      });

      it('never extends the absolute deadline: idle is clamped to it', async () => {
        const store = await makeStore();
        const { user } = await person(store, HASH);
        const current = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'cookie', at: at(1), idleExpiresAt: at(2), absoluteExpiresAt: at(4), userAgent: null });
        const rotated = digest();
        await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id, rotation: { tokenDigest: rotated, idleMs: 30 * 86_400_000 } }));
        const fresh = await store.sessions.findByDigest(rotated);
        expect(fresh?.absoluteExpiresAt.toISOString()).toBe(at(4).toISOString());
        expect(fresh?.idleExpiresAt.toISOString()).toBe(at(4).toISOString());
      });

      it('a digest that already exists fails the whole change: password, kept session and other sessions untouched', async () => {
        const store = await makeStore();
        const { user, orgIds } = await person(store, HASH);
        const current = await openSession(store, user.id, 'device');
        const other = await openSession(store, user.id, 'cookie');
        await expect(
          store.users.changePassword(
            input({ userId: user.id, exceptSessionId: current.id, rotation: { tokenDigest: other.tokenDigest, idleMs: IDLE_MS }, audit: auditFor(orgIds, user.id, 'user.password_changed') }),
          ),
        ).rejects.toBeInstanceOf(UniqueViolation);
        const unchanged = await store.users.getById(user.id);
        expect(unchanged?.passwordHash).toBe(HASH);
        expect(unchanged?.passwordChangedAt.toISOString()).toBe(user.passwordChangedAt.toISOString());
        const kept = await store.sessions.findByDigest(current.tokenDigest);
        expect(kept?.revokedAt).toBeNull();
        expect(kept?.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
        const untouched = await store.sessions.findByDigest(other.tokenDigest);
        expect(untouched?.revokedAt).toBeNull();
        expect(untouched?.userId).toBe(user.id);
        for (const orgId of orgIds) {
          expect((await store.audit.listByOrganization(orgId, 10)).map((e) => e.action)).not.toContain('user.password_changed');
        }
      });

      it('carries the passkey that opened the session, so removing that passkey can still revoke it', async () => {
        const store = await makeStore();
        const { user } = await person(store, HASH);
        const passkey = await store.passkeys.create({
          userId: user.id,
          credentialId: unique(),
          publicKey: new Uint8Array([1, 2, 3]),
          signCount: 0,
          transports: [],
          deviceType: 'multiDevice',
          backedUp: true,
          aaguid: '00000000-0000-0000-0000-000000000000',
          name: 'iPhone',
          at: at(0),
          limit: 10,
          audit: [],
        });
        const current = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'cookie', at: at(1), idleExpiresAt: at(2), absoluteExpiresAt: at(9), userAgent: null, passkeyId: passkey.id });
        const rotated = digest();
        await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id, rotation: { tokenDigest: rotated, idleMs: IDLE_MS } }));
        expect((await store.sessions.findByDigest(rotated))?.passkeyId).toBe(passkey.id);
      });

      it('a second change loses to a first that rotated: the first one\'s new session stays live, nothing else is written', async () => {
        const store = await makeStore();
        const { user } = await person(store, HASH);
        const phone = await openSession(store, user.id, 'device');
        const portal = await openSession(store, user.id, 'cookie');
        const rotated = digest();
        const SECOND_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c2Vjb25k';
        await store.users.changePassword(input({ userId: user.id, exceptSessionId: portal.id, rotation: { tokenDigest: rotated, idleMs: IDLE_MS } }));
        await expect(
          store.users.changePassword(input({ userId: user.id, exceptSessionId: phone.id, passwordHash: SECOND_HASH, at: at(4), rotation: { tokenDigest: digest(), idleMs: IDLE_MS } })),
        ).rejects.toBeInstanceOf(StateConflict);
        expect((await store.users.getById(user.id))?.passwordHash).toBe(NEW_HASH);
        expect((await store.sessions.findByDigest(rotated))?.revokedAt).toBeNull();
        // The rotated-out session cannot be named as the one to keep either.
        await expect(store.users.changePassword(input({ userId: user.id, exceptSessionId: portal.id, verifiedPasswordHash: NEW_HASH, at: at(5) }))).rejects.toBeInstanceOf(StateConflict);
      });
    });

    it('writes its audit rows', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store, HASH);
      const current = await openSession(store, user.id);
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id, audit: auditFor(orgIds, user.id, 'user.password_changed') }));
      for (const orgId of orgIds) {
        expect((await store.audit.listByOrganization(orgId, 10)).map((e) => e.action)).toContain('user.password_changed');
      }
    });

    it('returns null for an unknown user and writes nothing', async () => {
      const store = await makeStore();
      const result = await store.users.changePassword(input({ userId: '00000000-0000-4000-8000-000000000000', exceptSessionId: digest() }));
      expect(result).toBeNull();
    });

    it("a session tied to the old hash cannot be created once this call's lock has committed", async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const current = await openSession(store, user.id);
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: current.id }));
      await expect(
        store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'cookie', at: at(4), idleExpiresAt: at(9), absoluteExpiresAt: at(9), userAgent: null, verifiedPasswordHash: HASH }),
      ).rejects.toBeInstanceOf(StateConflict);
    });
  });
}
