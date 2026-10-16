import { describe, expect, it } from 'vitest';
import { StateConflict } from '../memory.js';
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

    it("never re-stamps another person's session named as the one to keep", async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const { user: stranger } = await person(store, HASH);
      const theirs = await openSession(store, stranger.id);
      await store.users.changePassword(input({ userId: user.id, exceptSessionId: theirs.id }));
      const found = await store.sessions.findByDigest(theirs.tokenDigest);
      expect(found?.credentialsVerifiedAt.toISOString()).toBe(at(1).toISOString());
      expect(found?.revokedAt).toBeNull();
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
