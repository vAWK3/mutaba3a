import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation } from '../memory.js';
import type { AuditEventInput, IssueSetupLinkInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-235 storage contract: one-time setup links (ADR-088). A link is claimed
 * inside the transaction that sets the password, so a refused or lost redeem
 * writes nothing; issuing locks the person's row, so they never hold two open links.
 */
export function describeLedgerStoreAccountSetupContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 16, hour, 0, 0));
  const digest = () => unique().padEnd(64, '0').slice(0, 64);
  const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const NEW_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$bmV3';

  async function person(store: LedgerStore, passwordHash: string | null = null): Promise<{ user: UserRecord; orgIds: string[] }> {
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
    orgIds.map((organizationId) => ({ organizationId, actorType: 'ADMIN', actorId: null, action, entityType: 'user', entityId: userId, requestId: null }));

  const issueInput = (userId: string, overrides: Partial<IssueSetupLinkInput> = {}): IssueSetupLinkInput => ({
    userId,
    tokenDigest: digest(),
    purpose: 'SETUP',
    at: at(1),
    expiresAt: at(73),
    lock: false,
    audit: [],
    ...overrides,
  });

  async function openSession(store: LedgerStore, userId: string) {
    return store.sessions.create({ userId, tokenDigest: digest(), kind: 'cookie', at: at(1), idleExpiresAt: at(2), absoluteExpiresAt: at(9), userAgent: null });
  }

  describe(`${name} LedgerStore account-setup contract (MUT-235)`, () => {
    it('stores a user created without a password as null', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      expect(user.passwordHash).toBeNull();
      expect((await store.users.getById(user.id))?.passwordHash).toBeNull();
    });

    it('issues a link and finds it by digest', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET' }));
      expect(link).toMatchObject({ userId: user.id, purpose: 'RESET', usedAt: null, cancelledAt: null });
      expect(link.expiresAt.toISOString()).toBe(at(73).toISOString());
      expect((await store.accountSetup.findByDigest(link.tokenDigest))?.id).toBe(link.id);
      expect(await store.accountSetup.findByDigest(digest())).toBeNull();
    });

    it('refuses a link for an unknown user', async () => {
      const store = await makeStore();
      await expect(store.accountSetup.issue(issueInput('00000000-0000-4000-8000-000000000000'))).rejects.toBeInstanceOf(ForeignKeyViolation);
    });

    it("a new link cancels the person's open links and leaves other people's alone", async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const { user: other } = await person(store);
      const first = await store.accountSetup.issue(issueInput(user.id));
      const others = await store.accountSetup.issue(issueInput(other.id));
      await store.accountSetup.issue(issueInput(user.id, { at: at(2) }));
      expect((await store.accountSetup.findByDigest(first.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(2).toISOString());
      expect((await store.accountSetup.findByDigest(others.tokenDigest))?.cancelledAt).toBeNull();
    });

    it('a used link stays used when a newer one is issued', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const first = await store.accountSetup.issue(issueInput(user.id));
      await store.accountSetup.redeem({ tokenDigest: first.tokenDigest, passwordHash: NEW_HASH, at: at(2), audit: [] });
      await store.accountSetup.issue(issueInput(user.id, { at: at(3) }));
      const after = await store.accountSetup.findByDigest(first.tokenDigest);
      expect(after?.usedAt?.toISOString()).toBe(at(2).toISOString());
      expect(after?.cancelledAt).toBeNull();
    });

    it('issue writes its audit rows; without lock it leaves the password and sessions alone', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store, HASH);
      const session = await openSession(store, user.id);
      await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET', audit: auditFor(orgIds, user.id, 'user.setup_link_issued') }));
      expect((await store.users.getById(user.id))?.passwordHash).toBe(HASH);
      expect((await store.sessions.findByDigest(session.tokenDigest))?.revokedAt).toBeNull();
      for (const orgId of orgIds) {
        expect((await store.audit.listByOrganization(orgId, 10)).map((e) => e.action)).toContain('user.setup_link_issued');
      }
    });

    it('issue with lock clears the password and revokes every session', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const cookie = await openSession(store, user.id);
      const device = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'device', at: at(1), idleExpiresAt: at(9), absoluteExpiresAt: at(9), userAgent: null });
      await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET', lock: true, at: at(4) }));
      expect((await store.users.getById(user.id))?.passwordHash).toBeNull();
      for (const s of [cookie, device]) {
        const found = await store.sessions.findByDigest(s.tokenDigest);
        expect(found?.revokedAt?.toISOString()).toBe(at(4).toISOString());
        expect(found?.revokedReason).toBe('setup_link_lock');
      }
    });

    it('redeem sets the password, clears the lockout, revokes every session and writes its audit rows', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store, HASH);
      await store.users.recordFailedSignIn(user.id, at(1), at(5));
      const session = await openSession(store, user.id);
      const link = await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET' }));
      const redeemed = await store.accountSetup.redeem({
        tokenDigest: link.tokenDigest,
        passwordHash: NEW_HASH,
        at: at(3),
        audit: auditFor(orgIds, user.id, 'user.password_set'),
      });
      expect(redeemed).toMatchObject({ id: user.id, passwordHash: NEW_HASH, failedSignIns: 0, lockedUntil: null });
      expect(redeemed?.passwordChangedAt.toISOString()).toBe(at(3).toISOString());
      expect((await store.accountSetup.findByDigest(link.tokenDigest))?.usedAt?.toISOString()).toBe(at(3).toISOString());
      const revoked = await store.sessions.findByDigest(session.tokenDigest);
      expect(revoked?.revokedAt?.toISOString()).toBe(at(3).toISOString());
      expect(revoked?.revokedReason).toBe('password_set');
      for (const orgId of orgIds) {
        expect((await store.audit.listByOrganization(orgId, 10)).map((e) => e.action)).toContain('user.password_set');
      }
    });

    describe('a refused redeem returns null and writes nothing', () => {
      async function refused(setup: (store: LedgerStore, user: UserRecord) => Promise<{ tokenDigest: string; at: Date }>) {
        const store = await makeStore();
        const { user, orgIds } = await person(store, HASH);
        const { tokenDigest, at: when } = await setup(store, user);
        // Opened after setup, which may itself redeem the link once.
        const session = await openSession(store, user.id);
        const before = await store.users.getById(user.id);
        const auditBefore = await Promise.all(orgIds.map((orgId) => store.audit.listByOrganization(orgId, 50)));
        const result = await store.accountSetup.redeem({ tokenDigest, passwordHash: NEW_HASH, at: when, audit: auditFor(orgIds, user.id, 'user.password_set') });
        expect(result).toBeNull();
        expect((await store.users.getById(user.id))?.passwordHash).toBe(before?.passwordHash);
        expect((await store.sessions.findByDigest(session.tokenDigest))?.revokedAt).toBeNull();
        const auditAfter = await Promise.all(orgIds.map((orgId) => store.audit.listByOrganization(orgId, 50)));
        expect(auditAfter.map((rows) => rows.length)).toEqual(auditBefore.map((rows) => rows.length));
      }

      it('a second use', () =>
        refused(async (store, user) => {
          const link = await store.accountSetup.issue(issueInput(user.id));
          await store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: HASH, at: at(2), audit: [] });
          return { tokenDigest: link.tokenDigest, at: at(3) };
        }));

      it('at the expiry instant', () =>
        refused(async (store, user) => {
          const link = await store.accountSetup.issue(issueInput(user.id));
          return { tokenDigest: link.tokenDigest, at: at(73) };
        }));

      it('a link a newer one cancelled', () =>
        refused(async (store, user) => {
          const link = await store.accountSetup.issue(issueInput(user.id));
          await store.accountSetup.issue(issueInput(user.id, { at: at(2) }));
          return { tokenDigest: link.tokenDigest, at: at(3) };
        }));

      it('an unknown digest', () => refused(async () => ({ tokenDigest: digest(), at: at(3) })));

      it('a disabled person', () =>
        refused(async (store, user) => {
          const link = await store.accountSetup.issue(issueInput(user.id));
          await store.users.setStatus(user.id, 'DISABLED', at(2));
          return { tokenDigest: link.tokenDigest, at: at(3) };
        }));
    });

    it('just before expiry still redeems', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      const justBefore = new Date(at(73).getTime() - 1);
      expect(await store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: justBefore, audit: [] })).not.toBeNull();
    });

    it('of two concurrent redeems of one link, exactly one wins', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      const results = await Promise.all([
        store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: HASH, at: at(2), audit: [] }),
        store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: at(2), audit: [] }),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const winner = results.find((r) => r !== null);
      expect((await store.users.getById(user.id))?.passwordHash).toBe(winner?.passwordHash);
    });

    it('two concurrent issues for one person leave exactly one open link', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const [a, b] = await Promise.all([store.accountSetup.issue(issueInput(user.id)), store.accountSetup.issue(issueInput(user.id))]);
      const open = [];
      for (const link of [a, b]) {
        const found = await store.accountSetup.findByDigest(link.tokenDigest);
        if (found && found.cancelledAt === null && found.usedAt === null) open.push(found);
      }
      expect(open).toHaveLength(1);
    });
  });
}
