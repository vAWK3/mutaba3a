import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation, StateConflict, UniqueViolation } from '../memory.js';
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

  const TERMS = { version: '2026-10-19', locale: 'en' as const, textSha256: 'f'.repeat(64), surface: 'portal' as const };
  /** Redeems that are about the link, not the terms: an acceptance with no audit rows. */
  const NO_NEW_TERMS = { terms: TERMS, termsAudit: [] as AuditEventInput[] };

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
      await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: first.tokenDigest, passwordHash: NEW_HASH, at: at(2), audit: [] });
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
      const locked = await store.users.getById(user.id);
      expect(locked?.passwordHash).toBeNull();
      // Review fix: stamping the change makes the session check refuse a session a racing sign-in inserts after the lock.
      expect(locked?.passwordChangedAt.toISOString()).toBe(at(4).toISOString());
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
        ...NO_NEW_TERMS,
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
        const result = await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest, passwordHash: NEW_HASH, at: when, audit: auditFor(orgIds, user.id, 'user.password_set') });
        expect(result).toBeNull();
        expect((await store.users.getById(user.id))?.passwordHash).toBe(before?.passwordHash);
        expect((await store.sessions.findByDigest(session.tokenDigest))?.revokedAt).toBeNull();
        const auditAfter = await Promise.all(orgIds.map((orgId) => store.audit.listByOrganization(orgId, 50)));
        expect(auditAfter.map((rows) => rows.length)).toEqual(auditBefore.map((rows) => rows.length));
      }

      it('a second use', () =>
        refused(async (store, user) => {
          const link = await store.accountSetup.issue(issueInput(user.id));
          await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: HASH, at: at(2), audit: [] });
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

    it('disabling a person cancels their open links, so re-enabling does not revive one', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      await store.users.setStatus(user.id, 'DISABLED', at(2));
      expect((await store.accountSetup.findByDigest(link.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(2).toISOString());
      await store.users.setStatus(user.id, 'ACTIVE', at(3));
      expect(await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: at(4), audit: [] })).toBeNull();
    });

    it('a user created with a setup link gets it in the same transaction', async () => {
      const store = await makeStore();
      const tokenDigest = digest();
      const { user } = await store.users.create({
        email: `p-${unique()}@firm.ps`,
        displayName: 'Nour',
        passwordHash: null,
        locale: 'en',
        personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        setupLink: { tokenDigest, purpose: 'SETUP', expiresAt: at(73) },
        at: at(1),
      });
      expect(await store.accountSetup.findByDigest(tokenDigest)).toMatchObject({ userId: user.id, purpose: 'SETUP', usedAt: null, cancelledAt: null });
    });

    it('a create whose link cannot be stored leaves no user behind', async () => {
      const store = await makeStore();
      const { user: first } = await person(store);
      const taken = await store.accountSetup.issue(issueInput(first.id));
      const email = `p-${unique()}@firm.ps`;
      await expect(
        store.users.create({
          email,
          displayName: 'Nour',
          passwordHash: null,
          locale: 'en',
          personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
          setupLink: { tokenDigest: taken.tokenDigest, purpose: 'SETUP', expiresAt: at(73) },
          at: at(1),
        }),
      ).rejects.toBeInstanceOf(UniqueViolation);
      expect(await store.users.findByEmail(email)).toBeNull();
    });

    it('a session tied to the verified hash is created only while that hash and an active status still hold', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      const session = (overrides: { verifiedPasswordHash?: string } = {}) =>
        store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'device', at: at(1), idleExpiresAt: at(9), absoluteExpiresAt: at(9), userAgent: null, ...overrides });
      await expect(session({ verifiedPasswordHash: HASH })).resolves.toMatchObject({ userId: user.id });
      await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET', lock: true, at: at(2) }));
      await expect(session({ verifiedPasswordHash: HASH })).rejects.toBeInstanceOf(StateConflict);
      const link = await store.accountSetup.issue(issueInput(user.id, { at: at(3) }));
      await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: at(4), audit: [] });
      await expect(session({ verifiedPasswordHash: HASH })).rejects.toBeInstanceOf(StateConflict);
      await store.users.setStatus(user.id, 'DISABLED', at(5));
      await expect(session({ verifiedPasswordHash: NEW_HASH })).rejects.toBeInstanceOf(StateConflict);
    });

    it('issue refuses a person who is no longer active, and writes nothing', async () => {
      const store = await makeStore();
      const { user } = await person(store, HASH);
      await store.users.setStatus(user.id, 'DISABLED', at(1));
      const input = issueInput(user.id, { at: at(2) });
      await expect(store.accountSetup.issue(input)).rejects.toBeInstanceOf(StateConflict);
      expect(await store.accountSetup.findByDigest(input.tokenDigest)).toBeNull();
    });

    it('just before expiry still redeems', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      const justBefore = new Date(at(73).getTime() - 1);
      expect(await store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: justBefore, audit: [] })).not.toBeNull();
    });

    it('of two concurrent redeems of one link, exactly one wins', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      const results = await Promise.all([
        store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: HASH, at: at(2), audit: [] }),
        store.accountSetup.redeem({ ...NO_NEW_TERMS, tokenDigest: link.tokenDigest, passwordHash: NEW_HASH, at: at(2), audit: [] }),
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

  describe(`${name} LedgerStore terms acceptance contract (MUT-324)`, () => {
    const termsAuditCount = async (store: LedgerStore, orgId: string) =>
      (await store.audit.list(orgId, { action: 'user.terms_accepted' }, { limit: 50, cursor: null })).items.length;

    it('accepts once per version: a repeat keeps the first row and writes no second audit', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store);
      const audit = auditFor(orgIds.slice(0, 1), user.id, 'user.terms_accepted');
      // Review pass 2: the store answers only whether the row is new; nobody needs the row read back
      expect(await store.users.acceptTerms({ userId: user.id, ...TERMS, at: at(2), audit })).toEqual({ created: true });
      expect(await store.users.acceptTerms({ userId: user.id, ...TERMS, locale: 'ar', at: at(3), audit })).toEqual({ created: false });
      const kept = await store.users.latestTermsAcceptance(user.id);
      expect(kept).toMatchObject({ userId: user.id, ...TERMS, locale: 'en' });
      expect(kept?.acceptedAt.toISOString()).toBe(at(2).toISOString());
      expect(await termsAuditCount(store, orgIds[0]!)).toBe(1);
    });

    it('the latest acceptance is the highest version, and null before any', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      expect(await store.users.latestTermsAcceptance(user.id)).toBeNull();
      await store.users.acceptTerms({ userId: user.id, ...TERMS, version: '2026-12-01', at: at(2), audit: [] });
      await store.users.acceptTerms({ userId: user.id, ...TERMS, version: '2026-10-19', at: at(3), audit: [] });
      expect((await store.users.latestTermsAcceptance(user.id))?.version).toBe('2026-12-01');
    });

    it('lists every person by email with their latest accepted version, null for someone who accepted none', async () => {
      const store = await makeStore();
      const { user: behind } = await person(store);
      const { user: never } = await person(store);
      await store.users.acceptTerms({ userId: behind.id, ...TERMS, version: '2026-10-19', at: at(2), audit: [] });
      await store.users.acceptTerms({ userId: behind.id, ...TERMS, version: '2026-12-01', at: at(3), audit: [] });
      const rows = (await store.users.listLatestTermsVersions()).filter((r) => r.userId === behind.id || r.userId === never.id);
      const expected = [
        { userId: behind.id, email: behind.email, status: behind.status, latestVersion: '2026-12-01' },
        { userId: never.id, email: never.email, status: never.status, latestVersion: null },
      ].sort((a, b) => (a.email < b.email ? -1 : 1));
      expect(rows).toEqual(expected);
    });

    it('refuses an acceptance for an unknown user', async () => {
      const store = await makeStore();
      await expect(store.users.acceptTerms({ userId: '00000000-0000-4000-8000-000000000000', ...TERMS, at: at(2), audit: [] })).rejects.toBeInstanceOf(
        ForeignKeyViolation,
      );
    });

    it('a redeem records the acceptance with the password; a reset redeem afterwards keeps it and writes no second audit', async () => {
      const store = await makeStore();
      const { user, orgIds } = await person(store);
      const termsAudit = auditFor(orgIds.slice(0, 1), user.id, 'user.terms_accepted');
      const setup = await store.accountSetup.issue(issueInput(user.id));
      expect(await store.accountSetup.redeem({ tokenDigest: setup.tokenDigest, passwordHash: HASH, at: at(2), audit: [], terms: TERMS, termsAudit })).not.toBeNull();
      const reset = await store.accountSetup.issue(issueInput(user.id, { purpose: 'RESET', at: at(3) }));
      expect(await store.accountSetup.redeem({ tokenDigest: reset.tokenDigest, passwordHash: NEW_HASH, at: at(4), audit: [], terms: TERMS, termsAudit })).not.toBeNull();
      expect((await store.users.getById(user.id))?.passwordHash).toBe(NEW_HASH);
      expect((await store.users.latestTermsAcceptance(user.id))?.acceptedAt.toISOString()).toBe(at(2).toISOString());
      expect(await termsAuditCount(store, orgIds[0]!)).toBe(1);
    });

    it('a refused redeem records no acceptance', async () => {
      const store = await makeStore();
      const { user } = await person(store);
      const link = await store.accountSetup.issue(issueInput(user.id));
      expect(await store.accountSetup.redeem({ tokenDigest: link.tokenDigest, passwordHash: HASH, at: at(80), audit: [], terms: TERMS, termsAudit: [] })).toBeNull();
      expect(await store.users.latestTermsAcceptance(user.id)).toBeNull();
    });
  });
}
