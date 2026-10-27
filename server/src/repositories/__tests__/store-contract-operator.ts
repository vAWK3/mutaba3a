import { describe, expect, it } from 'vitest';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-459 storage contract (ADR-208): the operator mark on a person, a session's passkey step-up, and the step-up
 * challenge bound to one person. A change audits in its own transaction; a call that changes nothing writes no audit
 * row. A step-up never touches credentialsVerifiedAt (it guards the password-change revocation, MUT-238). Run against
 * the memory store and Postgres.
 */
export function describeLedgerStoreOperatorContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 9, minute, 0));
  const userInput = (): CreateUserInput => ({
    email: `operator-${unique()}@studio.ps`,
    displayName: 'Basel Sader',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const audit = (organizationId: string, userId: string, action: string): AuditEventInput => ({
    organizationId,
    actorType: 'ADMIN',
    actorId: null,
    action,
    entityType: 'user',
    entityId: userId,
    requestId: 'req-mut459',
  });
  const operatorAudit = async (store: LedgerStore, organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('user.operator_')).map((e) => e.action);
  const session = async (store: LedgerStore, userId: string) =>
    store.sessions.create({ userId, tokenDigest: `digest-${unique()}`, kind: 'cookie', at: at(1), idleExpiresAt: at(50), absoluteExpiresAt: at(59), userAgent: null });

  describe(`${name} LedgerStore operator contract (MUT-459)`, () => {
    it('a person is no operator until marked; marking audits once and marking again changes nothing', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      expect((await store.users.getById(user.id))?.operatorAt).toBeNull();

      const first = await store.users.setOperator({ userId: user.id, operator: true, at: at(2), audit: [audit(personal.id, user.id, 'user.operator_granted')] });
      expect(first).toMatchObject({ changed: true, user: { id: user.id, operatorAt: at(2) } });
      const again = await store.users.setOperator({ userId: user.id, operator: true, at: at(3), audit: [audit(personal.id, user.id, 'user.operator_granted')] });
      expect(again).toMatchObject({ changed: false, user: { operatorAt: at(2) } });
      expect(await operatorAudit(store, personal.id)).toEqual(['user.operator_granted']);
    });

    it('unmarking clears the mark once; unmarking a non-operator changes and audits nothing', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      const none = await store.users.setOperator({ userId: user.id, operator: false, at: at(1), audit: [audit(personal.id, user.id, 'user.operator_revoked')] });
      expect(none).toMatchObject({ changed: false, user: { operatorAt: null } });

      await store.users.setOperator({ userId: user.id, operator: true, at: at(2), audit: [] });
      const revoked = await store.users.setOperator({ userId: user.id, operator: false, at: at(3), audit: [audit(personal.id, user.id, 'user.operator_revoked')] });
      expect(revoked).toMatchObject({ changed: true, user: { operatorAt: null } });
      expect(await operatorAudit(store, personal.id)).toEqual(['user.operator_revoked']);
    });

    it('answers null for an unknown person and stores nothing', async () => {
      const store = await makeStore();
      expect(await store.users.setOperator({ userId: '00000000-0000-4000-8000-000000000459', operator: true, at: at(1), audit: [] })).toBeNull();
    });

    it('a step-up stamps stepUpAt on a live session and leaves credentialsVerifiedAt alone', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const s = await session(store, user.id);
      expect(s.stepUpAt).toBeNull();

      expect(await store.sessions.markStepUp(s.id, at(5))).toBe(true);
      const after = await store.sessions.findByDigest(s.tokenDigest);
      expect(after).toMatchObject({ stepUpAt: at(5), credentialsVerifiedAt: at(1) });
    });

    it('a step-up on a revoked session changes nothing (a revoked session stays revoked)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const s = await session(store, user.id);
      await store.sessions.revoke(s.id, 'password_changed', at(3));

      expect(await store.sessions.markStepUp(s.id, at(5))).toBe(false);
      expect(await store.sessions.findByDigest(s.tokenDigest)).toMatchObject({ stepUpAt: null, revokedReason: 'password_changed' });
    });

    it('a step-up challenge is bound to its person: only that person, with that purpose, once', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const other = await store.users.create(userInput());
      const { id } = await store.passkeys.createChallenge({ challenge: 's1', purpose: 'step_up', userId: user.id, at: at(0), expiresAt: at(5) });

      expect(await store.passkeys.consumeChallenge(id, 'authentication', null, at(1))).toBeNull();
      expect(await store.passkeys.consumeChallenge(id, 'step_up', other.user.id, at(1))).toBeNull();
      expect(await store.passkeys.consumeChallenge(id, 'step_up', user.id, at(1))).toEqual({ challenge: 's1' });
      expect(await store.passkeys.consumeChallenge(id, 'step_up', user.id, at(1))).toBeNull();

      const sign = await store.passkeys.createChallenge({ challenge: 'a1', purpose: 'authentication', userId: null, at: at(0), expiresAt: at(5) });
      expect(await store.passkeys.consumeChallenge(sign.id, 'step_up', user.id, at(1))).toBeNull();
    });

    it('an expired step-up challenge is refused, and a creation challenge never passes as a step-up', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const late = await store.passkeys.createChallenge({ challenge: 's2', purpose: 'step_up', userId: user.id, at: at(0), expiresAt: at(5) });
      expect(await store.passkeys.consumeChallenge(late.id, 'step_up', user.id, at(5))).toBeNull();
      const creation = await store.passkeys.createChallenge({ challenge: 'c1', purpose: 'creation', userId: user.id, at: at(0), expiresAt: at(5) });
      expect(await store.passkeys.consumeChallenge(creation.id, 'step_up', user.id, at(1))).toBeNull();
      expect(await store.passkeys.consumeChallenge(creation.id, 'creation', user.id, at(1))).toEqual({ challenge: 'c1' });
    });

    it('a passkey sign-in session starts stepped up; a password one does not; a password-change rotation drops the stamp', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const passkey = await store.passkeys.create({ userId: user.id, credentialId: `cred-${unique()}`, publicKey: new Uint8Array([1]), signCount: 0, transports: [], deviceType: 'multiDevice', backedUp: true, aaguid: '00000000-0000-0000-0000-000000000000', name: 'Key', at: at(0), limit: 10, audit: [] });
      const byPasskey = await store.sessions.create({ userId: user.id, tokenDigest: `digest-${unique()}`, kind: 'cookie', at: at(1), idleExpiresAt: at(50), absoluteExpiresAt: at(59), userAgent: null, passkeyId: passkey.id });
      expect(byPasskey.stepUpAt).toEqual(at(1));
      expect((await session(store, user.id)).stepUpAt).toBeNull();

      const rotatedDigest = `digest-${unique()}`;
      await store.users.changePassword({ userId: user.id, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$bmV3', verifiedPasswordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', exceptSessionId: byPasskey.id, rotation: { tokenDigest: rotatedDigest, idleMs: 60 * 60_000 }, at: at(12), audit: [] });
      expect(await store.sessions.findByDigest(rotatedDigest)).toMatchObject({ passkeyId: passkey.id, stepUpAt: null });
    });

    it('remove with keepOne never takes the last passkey, even when two removals race', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const key = () => store.passkeys.create({ userId: user.id, credentialId: `cred-${unique()}`, publicKey: new Uint8Array([1]), signCount: 0, transports: [], deviceType: 'multiDevice', backedUp: true, aaguid: '00000000-0000-0000-0000-000000000000', name: 'Key', at: at(0), limit: 10, audit: [] });
      const [a, b] = [await key(), await key()];
      const s = await session(store, user.id);
      const results = await Promise.allSettled([a, b].map((p) => store.passkeys.remove({ userId: user.id, id: p.id, exceptSessionId: s.id, at: at(2), audit: [], keepOne: true })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as { reason?: string }).reason)).toEqual(['LAST_PASSKEY']);
      expect(await store.passkeys.listByUser(user.id)).toHaveLength(1);
    });

    it('a password change that keeps its session also drops the stamp (re-review C)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const s = await session(store, user.id);
      await store.sessions.markStepUp(s.id, at(2));
      await store.users.changePassword({ userId: user.id, passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$bmV3', verifiedPasswordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', exceptSessionId: s.id, at: at(3), audit: [] });
      expect(await store.sessions.findByDigest(s.tokenDigest)).toMatchObject({ stepUpAt: null, revokedAt: null });
    });
  });
}
