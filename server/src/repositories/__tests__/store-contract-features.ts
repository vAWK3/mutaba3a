import { describe, expect, it } from 'vitest';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-433 storage contract (ADR-196): per-user feature flags. One row per person and feature, re-opened by a grant
 * after a revoke; a write that changes something audits in its own transaction, one that changes nothing writes no
 * audit row, and two racing writes change it once (eng review C3). Run against the memory store and Postgres.
 */
export function describeLedgerStoreFeaturesContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 9, minute, 0));
  const userInput = (): CreateUserInput => ({
    email: `features-${unique()}@studio.ps`,
    displayName: 'Rana Saleh',
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
    metadata: { feature: 'agent_access' },
    requestId: 'req-mut433',
  });
  const featureAudit = async (store: LedgerStore, organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('user.feature_')).map((e) => e.action);
  const grantOf = (organizationId: string, userId: string, minute: number) => ({
    userId,
    feature: 'agent_access',
    grantedBy: 'admin',
    at: at(minute),
    audit: [audit(organizationId, userId, 'user.feature_granted')],
  });
  const revokeOf = (organizationId: string, userId: string, minute: number) => ({
    userId,
    feature: 'agent_access',
    at: at(minute),
    audit: [audit(organizationId, userId, 'user.feature_revoked')],
  });

  describe(`${name} LedgerStore features contract (MUT-433)`, () => {
    it('has no features until granted; a grant shows, audited once; granting again changes nothing', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      expect(await store.features.activeFor(user.id)).toEqual([]);

      const first = await store.features.grant(grantOf(personal.id, user.id, 1));
      expect(first).toMatchObject({ granted: true, grant: { userId: user.id, feature: 'agent_access', grantedBy: 'admin', grantedAt: at(1), revokedAt: null } });
      expect(await store.features.activeFor(user.id)).toEqual(['agent_access']);

      const again = await store.features.grant(grantOf(personal.id, user.id, 2));
      expect(again).toMatchObject({ granted: false, grant: { grantedAt: at(1), revokedAt: null } });
      expect(await featureAudit(store, personal.id)).toEqual(['user.feature_granted']);
    });

    it('revokes once; a grant after it re-opens the same row from the new instant', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      await store.features.grant(grantOf(personal.id, user.id, 1));

      expect(await store.features.revoke(revokeOf(personal.id, user.id, 2))).toEqual({ revoked: true });
      expect(await store.features.activeFor(user.id)).toEqual([]);
      expect(await store.features.revoke(revokeOf(personal.id, user.id, 3))).toEqual({ revoked: false });

      const reopened = await store.features.grant(grantOf(personal.id, user.id, 4));
      expect(reopened).toMatchObject({ granted: true, grant: { grantedAt: at(4), revokedAt: null } });
      expect(await store.features.activeFor(user.id)).toEqual(['agent_access']);
      expect((await featureAudit(store, personal.id)).sort()).toEqual(['user.feature_granted', 'user.feature_granted', 'user.feature_revoked']);
    });

    it('a revoke of a feature never granted changes nothing and audits nothing', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      expect(await store.features.revoke(revokeOf(personal.id, user.id, 1))).toEqual({ revoked: false });
      expect(await featureAudit(store, personal.id)).toEqual([]);
    });

    it('two racing grants write one row and one audit row; two racing revokes, one revoke (C3)', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create(userInput());
      const grants = await Promise.all([store.features.grant(grantOf(personal.id, user.id, 1)), store.features.grant(grantOf(personal.id, user.id, 1))]);
      expect(grants.filter((g) => g.granted)).toHaveLength(1);
      const revokes = await Promise.all([store.features.revoke(revokeOf(personal.id, user.id, 2)), store.features.revoke(revokeOf(personal.id, user.id, 2))]);
      expect(revokes.filter((r) => r.revoked)).toHaveLength(1);
      expect((await featureAudit(store, personal.id)).sort()).toEqual(['user.feature_granted', 'user.feature_revoked']);
    });

    it('lists the current holders, oldest grant first, with their email', async () => {
      const store = await makeStore();
      const a = await store.users.create(userInput());
      const b = await store.users.create(userInput());
      const c = await store.users.create(userInput());
      await store.features.grant(grantOf(b.personalOrganization.id, b.user.id, 2));
      await store.features.grant(grantOf(a.personalOrganization.id, a.user.id, 1));
      await store.features.grant(grantOf(c.personalOrganization.id, c.user.id, 3));
      await store.features.revoke(revokeOf(c.personalOrganization.id, c.user.id, 4));

      const mine = (await store.features.holders('agent_access')).filter((h) => [a.user.id, b.user.id, c.user.id].includes(h.userId));
      expect(mine).toEqual([
        { userId: a.user.id, email: a.user.email, grantedAt: at(1) },
        { userId: b.user.id, email: b.user.email, grantedAt: at(2) },
      ]);
    });
  });
}
