import { describe, expect, it } from 'vitest';
import { closureDeadline } from '../../accounts/closure.js';
import type { AccountantGrantRecord, AuditEventInput, CreateUserInput, LedgerStore, TermsAcceptanceInput } from '../ports.js';

/**
 * MUT-559 storage contract (ADR-245): accountant grants. One live invite per profile and address, a cap on live grants,
 * a conditional accept that exactly one of two racers wins, signup-and-accept in one transaction, revoke and leave, and
 * the account purge taking grants both ways. Run against the memory store and Postgres.
 */
export function describeLedgerStoreAccountantGrantsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 6, 9, minute, 0));
  const DAY = 86_400_000;
  const userInput = (prefix = 'owner'): CreateUserInput => ({
    email: `${prefix}-${unique()}@firm-${unique()}.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const audit = (organizationId: string, action: string) => (grant: AccountantGrantRecord): AuditEventInput[] => [
    { organizationId, actorType: 'USER', actorId: grant.invitedByUserId, action, entityType: 'accountant_grant', entityId: grant.id, metadata: {}, requestId: 'req-mut559' },
  ];
  const terms: TermsAcceptanceInput = { version: '2026-10-01', locale: 'en', textSha256: 'a'.repeat(64), surface: 'portal', clientRelease: null };

  async function owner(store: LedgerStore) {
    const { user, personalOrganization } = await store.users.create(userInput());
    return { userId: user.id, profileId: personalOrganization.id };
  }
  /** Closes the account due at once, claims and purges it; the plan must not be blocked. */
  async function purge(store: LedgerStore, userId: string, minute: number) {
    const session = await store.sessions.create({ userId, tokenDigest: `s-${unique()}`, kind: 'cookie', at: at(minute), idleExpiresAt: at(minute + 30), absoluteExpiresAt: at(minute + 30), userAgent: null });
    expect(await store.users.requestClosure({ userId, at: at(minute), deleteAfter: closureDeadline(at(minute)), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] })).not.toBeNull();
    const due = new Date(closureDeadline(at(minute)).getTime() + 60_000);
    expect(await store.accountPurge.claim(userId, due)).not.toBeNull();
    expect((await store.accountPurge.planOf(userId))?.blockedProfileIds).toEqual([]);
    expect(await store.accountPurge.purge(userId, due)).not.toBeNull();
  }
  const invite = (store: LedgerStore, o: { userId: string; profileId: string }, email: string, minute = 1, max = 5) =>
    store.accountantGrants.invite({
      organizationId: o.profileId,
      inviteEmail: email,
      locale: 'en',
      invitedByUserId: o.userId,
      tokenDigest: `digest-${unique()}`,
      at: at(minute),
      expiresAt: new Date(at(minute).getTime() + 14 * DAY),
      max,
      auditFor: audit(o.profileId, 'accountant.invited'),
    });

  describe(`${name} LedgerStore accountant grants (MUT-559)`, () => {
    it('invites once per address, refuses a second live invite, and lists only live grants', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const email = `acc-${unique()}@books.ps`;
      const first = await invite(store, o, email);
      expect(first.kind).toBe('created');
      expect(await invite(store, o, email, 2)).toEqual({ kind: 'already_invited' });
      const listed = await store.accountantGrants.listByOrganization(o.profileId);
      expect(listed.map((g) => g.inviteEmail)).toEqual([email]);
      expect(listed[0]).toMatchObject({ status: 'PENDING', invitedByUserId: o.userId, accountantUserId: null, acceptedAt: null });
      const events = (await store.audit.listByOrganization(o.profileId, 50)).filter((e) => e.action === 'accountant.invited');
      expect(events).toHaveLength(1);
    });

    it('caps live grants per profile', async () => {
      const store = await makeStore();
      const o = await owner(store);
      for (let i = 0; i < 2; i++) expect((await invite(store, o, `cap-${i}-${unique()}@books.ps`, 1, 2)).kind).toBe('created');
      expect(await invite(store, o, `cap-x-${unique()}@books.ps`, 1, 2)).toEqual({ kind: 'limit', count: 2 });
    });

    it('lets an expired invite to the same address be replaced', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const email = `exp-${unique()}@books.ps`;
      expect((await invite(store, o, email, 1)).kind).toBe('created');
      const later = await store.accountantGrants.invite({
        organizationId: o.profileId, inviteEmail: email, locale: 'ar', invitedByUserId: o.userId, tokenDigest: `digest-${unique()}`,
        at: new Date(at(1).getTime() + 15 * DAY), expiresAt: new Date(at(1).getTime() + 29 * DAY), max: 5, auditFor: audit(o.profileId, 'accountant.invited'),
      });
      expect(later.kind).toBe('created');
      const listed = await store.accountantGrants.listByOrganization(o.profileId);
      expect(listed.map((g) => g.locale)).toEqual(['ar']);
    });

    it('accepts conditionally: one of two concurrent accepts wins, an expired or used token never does', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const b = (await store.users.create(userInput('acc'))).user;
      const created = await invite(store, o, a.email);
      if (created.kind !== 'created') throw new Error('invite failed');
      const digest = created.grant.tokenDigest!;
      const accept = (userId: string, minute: number) => store.accountantGrants.accept({ tokenDigest: digest, accountantUserId: userId, at: at(minute), auditFor: audit(o.profileId, 'accountant.accepted') });
      const results = await Promise.all([accept(a.id, 2), accept(b.id, 2)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const winner = results.find((r) => r !== null)!;
      expect(winner).toMatchObject({ status: 'ACTIVE', tokenDigest: null, acceptedAt: at(2) });
      expect(await accept(a.id, 3)).toBeNull();
      expect(await store.accountantGrants.findActive(winner.accountantUserId!, o.profileId)).toMatchObject({ id: winner.id });
      expect((await store.accountantGrants.listActiveByAccountant(winner.accountantUserId!)).map((g) => g.id)).toEqual([winner.id]);

      const late = await invite(store, o, `late-${unique()}@books.ps`, 4);
      if (late.kind !== 'created') throw new Error('invite failed');
      expect(await store.accountantGrants.accept({ tokenDigest: late.grant.tokenDigest!, accountantUserId: a.id, at: new Date(at(4).getTime() + 15 * DAY), auditFor: audit(o.profileId, 'accountant.accepted') })).toBeNull();
    });

    it('refuses a second ACTIVE grant for the same accountant on one profile', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const one = await invite(store, o, `one-${unique()}@books.ps`);
      const two = await invite(store, o, `two-${unique()}@books.ps`);
      if (one.kind !== 'created' || two.kind !== 'created') throw new Error('invite failed');
      const auditFor = audit(o.profileId, 'accountant.accepted');
      expect(await store.accountantGrants.accept({ tokenDigest: one.grant.tokenDigest!, accountantUserId: a.id, at: at(2), auditFor })).not.toBeNull();
      expect(await store.accountantGrants.accept({ tokenDigest: two.grant.tokenDigest!, accountantUserId: a.id, at: at(3), auditFor })).toBeNull();
    });

    it('revokes and leaves, and an ended grant is no longer listed or found', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const created = await invite(store, o, a.email);
      if (created.kind !== 'created') throw new Error('invite failed');
      await store.accountantGrants.accept({ tokenDigest: created.grant.tokenDigest!, accountantUserId: a.id, at: at(2), auditFor: audit(o.profileId, 'accountant.accepted') });
      const left = await store.accountantGrants.leave({ organizationId: o.profileId, accountantUserId: a.id, at: at(3), auditFor: audit(o.profileId, 'accountant.left') });
      expect(left).toMatchObject({ status: 'LEFT', revokedAt: at(3) });
      expect(await store.accountantGrants.findActive(a.id, o.profileId)).toBeNull();
      expect(await store.accountantGrants.leave({ organizationId: o.profileId, accountantUserId: a.id, at: at(4), auditFor: audit(o.profileId, 'accountant.left') })).toBeNull();

      const pending = await invite(store, o, `rev-${unique()}@books.ps`, 5);
      if (pending.kind !== 'created') throw new Error('invite failed');
      const revoked = await store.accountantGrants.revoke({ organizationId: o.profileId, grantId: pending.grant.id, at: at(6), auditFor: audit(o.profileId, 'accountant.revoked') });
      expect(revoked).toMatchObject({ status: 'REVOKED', tokenDigest: null });
      expect(await store.accountantGrants.findByDigest(pending.grant.tokenDigest!)).toBeNull();
      expect(await store.accountantGrants.revoke({ organizationId: o.profileId, grantId: pending.grant.id, at: at(7), auditFor: audit(o.profileId, 'accountant.revoked') })).toBeNull();
      expect(await store.accountantGrants.listByOrganization(o.profileId)).toEqual([]);
      // A re-invite after leaving can be accepted again by the same person.
      const again = await invite(store, o, a.email, 8);
      if (again.kind !== 'created') throw new Error('invite failed');
      expect(await store.accountantGrants.accept({ tokenDigest: again.grant.tokenDigest!, accountantUserId: a.id, at: at(9), auditFor: audit(o.profileId, 'accountant.accepted') })).toMatchObject({ status: 'ACTIVE' });
    });

    it('stamps lastViewedAt with its audit row on an ACTIVE grant only', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const created = await invite(store, o, a.email);
      if (created.kind !== 'created') throw new Error('invite failed');
      const viewed = async () => (await store.audit.listByOrganization(o.profileId, 50)).filter((e) => e.action === 'accountant.viewed').length;
      // A pending invite is never "viewed".
      await store.accountantGrants.touchViewed({ grantId: created.grant.id, at: at(8), audit: audit(o.profileId, 'accountant.viewed')(created.grant) });
      expect((await store.accountantGrants.listByOrganization(o.profileId))[0]?.lastViewedAt).toBeNull();
      expect(await viewed()).toBe(0);
      await store.accountantGrants.accept({ tokenDigest: created.grant.tokenDigest!, accountantUserId: a.id, at: at(8), auditFor: () => [] });
      await store.accountantGrants.touchViewed({ grantId: created.grant.id, at: at(9), audit: audit(o.profileId, 'accountant.viewed')(created.grant) });
      expect((await store.accountantGrants.listByOrganization(o.profileId))[0]?.lastViewedAt).toEqual(at(9));
      expect(await viewed()).toBe(1);
    });

    it('signs up and accepts in one step: ACTIVE, no review, a personal profile; an existing address or used token refuses', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const email = `new-${unique()}@books.ps`;
      const created = await invite(store, o, email);
      if (created.kind !== 'created') throw new Error('invite failed');
      const input = (digest: string) => ({
        tokenDigest: digest, at: at(2), passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', displayName: 'Hadi Accountant',
        personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, terms,
        auditFor: ({ userId, grant }: { userId: string; grant: AccountantGrantRecord }): AuditEventInput[] => [{ organizationId: grant.organizationId, actorType: 'USER', actorId: userId, action: 'accountant.accepted', entityType: 'accountant_grant', entityId: grant.id, metadata: {}, requestId: null }],
      });
      const result = await store.accountantGrants.signupAndAccept(input(created.grant.tokenDigest!));
      if (result.kind !== 'created') throw new Error(`signup failed: ${result.kind}`);
      expect(result.user).toMatchObject({ email, status: 'ACTIVE' });
      expect(result.personalOrganization.personalOwnerUserId).toBe(result.user.id);
      expect(result.grant).toMatchObject({ status: 'ACTIVE', accountantUserId: result.user.id });
      expect(await store.signupReviews.findByUser(result.user.id)).toBeNull();
      // Decision A: no trial; the account is entitled only once it subscribes or the operator grants it.
      expect((await store.billing.summaryOf(result.user.id)).trialStartedAt).toBeNull();
      expect(await store.memberships.find(result.user.id, o.profileId)).toBeNull();
      expect(await store.accountantGrants.signupAndAccept(input(created.grant.tokenDigest!))).toEqual({ kind: 'unusable' });

      const taken = (await store.users.create(userInput('taken'))).user;
      const second = await invite(store, o, taken.email, 3);
      if (second.kind !== 'created') throw new Error('invite failed');
      expect(await store.accountantGrants.signupAndAccept(input(second.grant.tokenDigest!))).toEqual({ kind: 'account_exists' });
      expect((await store.accountantGrants.findByDigest(second.grant.tokenDigest!))?.status).toBe('PENDING');
    });

    it('purging an address’s owner takes only the invites still pending to it, never a grant a colleague accepted', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const invited = (await store.users.create(userInput('invited'))).user;
      const colleague = (await store.users.create(userInput('colleague'))).user;
      const accepted = await invite(store, o, invited.email);
      if (accepted.kind !== 'created') throw new Error('invite failed');
      await store.accountantGrants.accept({ tokenDigest: accepted.grant.tokenDigest!, accountantUserId: colleague.id, at: at(2), auditFor: () => [] });
      const other = await owner(store);
      expect((await invite(store, other, invited.email)).kind).toBe('created');
      await purge(store, invited.id, 3);
      expect(await store.accountantGrants.findActive(colleague.id, o.profileId)).toMatchObject({ id: accepted.grant.id, inviteEmail: invited.email });
      expect(await store.accountantGrants.listByOrganization(other.profileId)).toEqual([]);
    });

    it('a profile deleted by the purge takes its grants; the accountant’s purge takes theirs (and never blocks)', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const created = await invite(store, o, a.email);
      if (created.kind !== 'created') throw new Error('invite failed');
      await store.accountantGrants.accept({ tokenDigest: created.grant.tokenDigest!, accountantUserId: a.id, at: at(2), auditFor: audit(o.profileId, 'accountant.accepted') });

      // The accountant closes and is purged first: the owner's profile stays, without the grant.
      await purge(store, a.id, 3);
      expect(await store.accountantGrants.findActive(a.id, o.profileId)).toBeNull();
      expect(await store.accountantGrants.listByOrganization(o.profileId)).toEqual([]);

      // The owner's own purge deletes the profile and every grant on it, pending ones included, without blocking.
      expect((await invite(store, o, `p-${unique()}@books.ps`, 6)).kind).toBe('created');
      await purge(store, o.userId, 7);
      expect(await store.accountantGrants.listByOrganization(o.profileId)).toEqual([]);
    });
  });
}
