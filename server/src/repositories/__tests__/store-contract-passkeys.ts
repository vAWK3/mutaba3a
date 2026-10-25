import { describe, expect, it } from 'vitest';
import type { StateConflict} from '../memory.js';
import { ForeignKeyViolation, UniqueViolation } from '../memory.js';
import type { CreatePasskeyInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-115 storage contract: passkeys and their single-use challenges (plan §3.1, D5, D12, A2). Run against the
 * memory store and Postgres (`test:db`), so the two agree on the cap, the atomic consume and revoke-on-remove.
 */
export function describeLedgerStorePasskeysContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 9, minute, 0));
  const digest = () => unique().padEnd(64, '0').slice(0, 64);

  async function person(store: LedgerStore): Promise<{ user: UserRecord; organizationId: string }> {
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
    return { user, organizationId: org.id };
  }

  const passkey = (userId: string, overrides: Partial<CreatePasskeyInput> = {}): CreatePasskeyInput => ({
    userId,
    credentialId: `cred-${unique()}${unique()}`,
    publicKey: new Uint8Array([1, 2, 3, 4]),
    signCount: 0,
    transports: ['internal', 'hybrid'],
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
    name: 'iCloud Keychain',
    at: at(1),
    limit: 10,
    audit: [],
    ...overrides,
  });

  const session = (store: LedgerStore, userId: string, passkeyId?: string) =>
    store.sessions.create({
      userId,
      tokenDigest: digest(),
      kind: 'device',
      at: at(2),
      idleExpiresAt: at(50),
      absoluteExpiresAt: at(59),
      userAgent: null,
      ...(passkeyId ? { passkeyId } : {}),
    });

  describe(`${name} LedgerStore passkeys contract (MUT-115)`, () => {
    it('creates, lists oldest first, finds by credential id and keeps the key bytes and a uint32 counter', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const first = await store.passkeys.create(passkey(user.id, { signCount: 4_294_967_295 }));
      const second = await store.passkeys.create(passkey(user.id, { at: at(3), name: 'Chrome on Mac', deviceType: 'singleDevice', backedUp: false }));
      expect(first).toMatchObject({ userId: user.id, name: 'iCloud Keychain', signCount: 4_294_967_295, lastUsedAt: null, transports: ['internal', 'hybrid'] });
      expect(Array.from(first.publicKey)).toEqual([1, 2, 3, 4]);
      expect((await store.passkeys.listByUser(user.id)).map((p) => p.id)).toEqual([first.id, second.id]);
      expect((await store.passkeys.findByCredentialId(second.credentialId))?.deviceType).toBe('singleDevice');
      expect(await store.passkeys.findByCredentialId('nope')).toBeNull();
    });

    it('refuses a duplicate credential id, an unknown person and the eleventh passkey', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const first = await store.passkeys.create(passkey(user.id, { limit: 2 }));
      await expect(store.passkeys.create(passkey(user.id, { credentialId: first.credentialId }))).rejects.toBeInstanceOf(UniqueViolation);
      await expect(store.passkeys.create(passkey('00000000-0000-4000-8000-000000000000'))).rejects.toBeInstanceOf(ForeignKeyViolation);
      await store.passkeys.create(passkey(user.id, { limit: 2 }));
      await expect(store.passkeys.create(passkey(user.id, { limit: 2 }))).rejects.toMatchObject({ reason: 'PASSKEY_LIMIT' } satisfies Partial<StateConflict>);
      expect(await store.passkeys.listByUser(user.id)).toHaveLength(2);
    });

    it('writes the audit rows with the passkey', async () => {
      const store = await makeStore();
      const { user, organizationId } = await person(store);
      const audit = [{ organizationId, actorType: 'USER' as const, actorId: user.id, action: 'user.passkey_added', entityType: 'user', entityId: user.id, requestId: 'r1' }];
      await store.passkeys.create(passkey(user.id, { audit }));
      expect((await store.audit.listByOrganization(organizationId, 20)).some((e) => e.action === 'user.passkey_added')).toBe(true);
    });

    it("renames only the person's own passkey and records a use", async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const other = await person(store);
      const p = await store.passkeys.create(passkey(user.id));
      expect(await store.passkeys.rename(other.user.id, p.id, 'Mine now')).toBeNull();
      expect((await store.passkeys.rename(user.id, p.id, 'Work phone'))?.name).toBe('Work phone');
      await store.passkeys.recordUse(p.id, 7, at(9));
      const used = await store.passkeys.findByCredentialId(p.credentialId);
      expect(used).toMatchObject({ name: 'Work phone', signCount: 7 });
      expect(used?.lastUsedAt?.toISOString()).toBe(at(9).toISOString());
    });

    it('removing a passkey revokes the sessions it opened, except the caller’s, in one write', async () => {
      const store = await makeStore();
      const { user, organizationId } = await person(store);
      const p = await store.passkeys.create(passkey(user.id));
      const keep = await store.passkeys.create(passkey(user.id));
      const opened = await session(store, user.id, p.id);
      const caller = await session(store, user.id, p.id);
      const byOther = await session(store, user.id, keep.id);
      const byPassword = await session(store, user.id);
      expect(opened.passkeyId).toBe(p.id);
      expect(byPassword.passkeyId).toBeNull();

      const other = await person(store);
      expect(await store.passkeys.remove({ userId: other.user.id, id: p.id, exceptSessionId: caller.id, at: at(10), audit: [] })).toBeNull();

      const audit = [{ organizationId, actorType: 'USER' as const, actorId: user.id, action: 'user.passkey_removed', entityType: 'user', entityId: user.id, requestId: 'r2' }];
      const removed = await store.passkeys.remove({ userId: user.id, id: p.id, exceptSessionId: caller.id, at: at(10), audit });
      expect(removed).toMatchObject({ passkey: { id: p.id }, revokedSessions: 1 });
      expect(await store.passkeys.findByCredentialId(p.credentialId)).toBeNull();
      expect(await store.sessions.findByDigest(opened.tokenDigest)).toMatchObject({ revokedReason: 'passkey_removed' });
      expect((await store.sessions.findByDigest(caller.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.sessions.findByDigest(byOther.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.sessions.findByDigest(byPassword.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.audit.listByOrganization(organizationId, 20)).some((e) => e.action === 'user.passkey_removed')).toBe(true);
      expect(await store.passkeys.remove({ userId: user.id, id: p.id, exceptSessionId: caller.id, at: at(11), audit: [] })).toBeNull();
    });

    describe('the "Add a passkey" suggestion (MUT-370)', () => {
      const HIDDEN_UNTIL = new Date(at(4).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      it('a person who never answered: nothing stored, no passkeys; an unknown person: null', async () => {
        const store = await makeStore();
        const { user } = await person(store);
        expect(await store.passkeys.promptOf(user.id)).toEqual({ prompt: { notNowCount: 0, hiddenUntil: null }, passkeys: 0 });
        expect(await store.passkeys.promptOf('00000000-0000-4000-8000-000000000000')).toBeNull();
        expect(await store.passkeys.answerPrompt('00000000-0000-4000-8000-000000000000', 'not-now', at(4))).toBeNull();
      });

      it('Not now is stored, and the passkey count comes with it', async () => {
        const store = await makeStore();
        const { user } = await person(store);
        const answered = await store.passkeys.answerPrompt(user.id, 'not-now', at(4));
        expect(answered).toEqual({ prompt: { notNowCount: 1, hiddenUntil: HIDDEN_UNTIL }, passkeys: 0 });
        expect(await store.passkeys.promptOf(user.id)).toEqual(answered);
      });

      it('a Not now while the person holds a passkey spends nothing, and the count says so', async () => {
        const store = await makeStore();
        const { user } = await person(store);
        await store.passkeys.create(passkey(user.id));
        expect(await store.passkeys.answerPrompt(user.id, 'not-now', at(4))).toEqual({ prompt: { notNowCount: 0, hiddenUntil: null }, passkeys: 1 });
      });

      it('two concurrent Not nows spend one offer', async () => {
        const store = await makeStore();
        const { user } = await person(store);
        await Promise.all([1, 2, 3].map(() => store.passkeys.answerPrompt(user.id, 'not-now', at(4))));
        expect((await store.passkeys.promptOf(user.id))?.prompt).toEqual({ notNowCount: 1, hiddenUntil: HIDDEN_UNTIL });
      });

      it("one person's answer is never another's", async () => {
        const store = await makeStore();
        const { user } = await person(store);
        const other = await person(store);
        await store.passkeys.answerPrompt(user.id, 'not-now', at(4));
        expect((await store.passkeys.promptOf(other.user.id))?.prompt).toEqual({ notNowCount: 0, hiddenUntil: null });
      });
    });

    describe('challenges', () => {
      it('consumes a sign-in challenge once, and never after it expires', async () => {
        const store = await makeStore();
        const { id } = await store.passkeys.createChallenge({ challenge: 'abc', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
        expect(await store.passkeys.consumeChallenge(id, 'authentication', null, at(1))).toEqual({ challenge: 'abc' });
        expect(await store.passkeys.consumeChallenge(id, 'authentication', null, at(1))).toBeNull();
        const late = await store.passkeys.createChallenge({ challenge: 'def', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
        expect(await store.passkeys.consumeChallenge(late.id, 'authentication', null, at(5))).toBeNull();
      });

      it('refuses the wrong purpose and another person’s creation challenge, without consuming it', async () => {
        const store = await makeStore();
        const { user } = await person(store);
        const other = await person(store);
        const { id } = await store.passkeys.createChallenge({ challenge: 'c1', purpose: 'creation', userId: user.id, at: at(0), expiresAt: at(5) });
        expect(await store.passkeys.consumeChallenge(id, 'authentication', null, at(1))).toBeNull();
        expect(await store.passkeys.consumeChallenge(id, 'creation', other.user.id, at(1))).toBeNull();
        expect(await store.passkeys.consumeChallenge(id, 'creation', user.id, at(1))).toEqual({ challenge: 'c1' });
        const auth = await store.passkeys.createChallenge({ challenge: 'a1', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
        expect(await store.passkeys.consumeChallenge(auth.id, 'creation', user.id, at(1))).toBeNull();
      });

      it('of two concurrent consumes exactly one wins', async () => {
        const store = await makeStore();
        const { id } = await store.passkeys.createChallenge({ challenge: 'race', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
        const results = await Promise.all([1, 2, 3].map(() => store.passkeys.consumeChallenge(id, 'authentication', null, at(1))));
        expect(results.filter((r) => r !== null)).toHaveLength(1);
      });

      it('prunes only challenges that expired before the cut-off', async () => {
        const store = await makeStore();
        const old = await store.passkeys.createChallenge({ challenge: 'old', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
        const fresh = await store.passkeys.createChallenge({ challenge: 'new', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(30) });
        expect(await store.passkeys.pruneChallenges(at(10))).toBeGreaterThanOrEqual(1);
        expect(await store.passkeys.consumeChallenge(old.id, 'authentication', null, at(1))).toBeNull();
        expect(await store.passkeys.consumeChallenge(fresh.id, 'authentication', null, at(11))).toEqual({ challenge: 'new' });
      });
    });
  });
}
