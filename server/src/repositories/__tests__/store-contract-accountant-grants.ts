import { describe, expect, it } from 'vitest';
import { closureDeadline } from '../../accounts/closure.js';
import type { AcceptAccountantResult, AccountantGrantRecord, AuditEventInput, CreateUserInput, LedgerStore, TermsAcceptanceInput } from '../ports.js';

/**
 * MUT-559 storage contract (ADR-245): accountant grants. One live invite per profile and address, a cap on live grants,
 * a conditional accept that exactly one of two racers wins, signup-and-accept in one transaction, revoke and leave, and
 * the account purge taking grants both ways. Run against the memory store and Postgres.
 */
export function describeLedgerStoreAccountantGrantsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  /** MUT-565: `accept` answers `{ kind: 'accepted', grant }`; the grant, or null for a lost or refused accept. */
  const grantOf = (result: AcceptAccountantResult | null): AccountantGrantRecord | null => (result?.kind === 'accepted' ? result.grant : null);
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
      const accept = async (userId: string, minute: number) => grantOf(await store.accountantGrants.accept({ tokenDigest: digest, accountantUserId: userId, at: at(minute), auditFor: audit(o.profileId, 'accountant.accepted') }));
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
      expect(await store.accountantGrants.accept({ tokenDigest: again.grant.tokenDigest!, accountantUserId: a.id, at: at(9), auditFor: audit(o.profileId, 'accountant.accepted') })).toMatchObject({ kind: 'accepted', grant: { status: 'ACTIVE' } });
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
    it('MUT-575: listForAccountant — ACTIVE and undismissed REVOKED grants; dismiss hides every REVOKED one on the profile', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const o2 = await owner(store);
      const a = (await store.users.create(userInput('acc'))).user;
      const accepted = async (on: { userId: string; profileId: string }, minute: number) => {
        const created = await invite(store, on, a.email, minute);
        if (created.kind !== 'created') throw new Error('invite failed');
        const grant = grantOf(await store.accountantGrants.accept({ tokenDigest: created.grant.tokenDigest!, accountantUserId: a.id, at: at(minute + 1), auditFor: audit(on.profileId, 'accountant.accepted') }));
        return grant!;
      };
      const first = await accepted(o, 1);
      // A new grant reads dismissedAt null.
      expect(first.dismissedAt).toBeNull();
      await store.accountantGrants.revoke({ organizationId: o.profileId, grantId: first.id, at: at(3), auditFor: audit(o.profileId, 'accountant.revoked') });
      const second = await accepted(o, 4);
      await store.accountantGrants.revoke({ organizationId: o.profileId, grantId: second.id, at: at(6), auditFor: audit(o.profileId, 'accountant.revoked') });
      const other = await accepted(o2, 7);
      expect((await store.accountantGrants.listForAccountant(a.id)).map((g) => `${g.organizationId}:${g.status}`).sort()).toEqual(
        [`${o.profileId}:REVOKED`, `${o.profileId}:REVOKED`, `${o2.profileId}:ACTIVE`].sort(),
      );

      // Nothing to dismiss on an ACTIVE grant; both REVOKED ones go at once, and a second dismiss finds none.
      expect(await store.accountantGrants.dismiss({ organizationId: o2.profileId, accountantUserId: a.id, at: at(9) })).toBe(0);
      expect(await store.accountantGrants.dismiss({ organizationId: o.profileId, accountantUserId: a.id, at: at(9) })).toBe(2);
      expect(await store.accountantGrants.dismiss({ organizationId: o.profileId, accountantUserId: a.id, at: at(10) })).toBe(0);
      expect((await store.accountantGrants.listForAccountant(a.id)).map((g) => g.id)).toEqual([other.id]);

      // LEFT is never listed; dismissal leaves REVOKED in place as history (who ended access).
      await store.accountantGrants.leave({ organizationId: o2.profileId, accountantUserId: a.id, at: at(11), auditFor: audit(o2.profileId, 'accountant.left') });
      expect(await store.accountantGrants.listForAccountant(a.id)).toEqual([]);
      expect(await store.accountantGrants.dismiss({ organizationId: o2.profileId, accountantUserId: a.id, at: at(12) })).toBe(0);
    });

    // ---- MUT-565 (ADR-251): the cap at accept, and a grant's rank ------------------------------------------------
    /** An ACTIVE grant for `a` on a fresh owner's profile, accepted at `minute`. */
    async function activeFor(store: LedgerStore, a: { id: string }, minute: number) {
      const o = await owner(store);
      const created = await invite(store, o, `cap-${unique()}@books.ps`, minute);
      if (created.kind !== 'created') throw new Error('invite failed');
      const result = await store.accountantGrants.accept({ tokenDigest: created.grant.tokenDigest!, accountantUserId: a.id, at: at(minute), auditFor: () => [] });
      if (result?.kind !== 'accepted') throw new Error('accept failed');
      return result.grant;
    }

    it('MUT-565: at maxActive nothing is written: the invite stays PENDING with its token, and accepts once there is room', async () => {
      const store = await makeStore();
      const a = (await store.users.create(userInput('acc'))).user;
      const held = [await activeFor(store, a, 1), await activeFor(store, a, 2), await activeFor(store, a, 3)];
      const o = await owner(store);
      const fourth = await invite(store, o, `fourth-${unique()}@books.ps`, 4);
      if (fourth.kind !== 'created') throw new Error('invite failed');
      const digest = fourth.grant.tokenDigest!;
      const accept = (maxActive: number | null, minute: number) => store.accountantGrants.accept({ tokenDigest: digest, accountantUserId: a.id, at: at(minute), maxActive, auditFor: audit(o.profileId, 'accountant.accepted') });

      expect(await accept(3, 5)).toEqual({ kind: 'cap_reached', active: 3 });
      expect(await store.accountantGrants.findByDigest(digest)).toMatchObject({ status: 'PENDING', tokenDigest: digest, accountantUserId: null });
      expect((await store.audit.listByOrganization(o.profileId, 50)).filter((e) => e.action === 'accountant.accepted')).toHaveLength(0);
      // A pending invite elsewhere never counts; an unusable token is still null, not cap_reached.
      expect(await store.accountantGrants.accept({ tokenDigest: 'no-such-digest', accountantUserId: a.id, at: at(5), maxActive: 3, auditFor: () => [] })).toBeNull();

      // The plan lifts the cap: the same token now accepts.
      expect(await accept(100, 6)).toMatchObject({ kind: 'accepted', grant: { status: 'ACTIVE', accountantUserId: a.id } });

      // A leave frees a place under the free cap too.
      const store2 = await makeStore();
      const b = (await store2.users.create(userInput('acc'))).user;
      const bHeld = [await activeFor(store2, b, 1), await activeFor(store2, b, 2), await activeFor(store2, b, 3)];
      await store2.accountantGrants.leave({ organizationId: bHeld[1]!.organizationId, accountantUserId: b.id, at: at(4), auditFor: () => [] });
      const o2 = await owner(store2);
      const next = await invite(store2, o2, `next-${unique()}@books.ps`, 5);
      if (next.kind !== 'created') throw new Error('invite failed');
      expect(await store2.accountantGrants.accept({ tokenDigest: next.grant.tokenDigest!, accountantUserId: b.id, at: at(6), maxActive: 3, auditFor: () => [] })).toMatchObject({ kind: 'accepted' });
      expect(held).toHaveLength(3);
    });

    it('MUT-565: two parallel accepts at 2 of 3: one is accepted, the other refused at the cap', async () => {
      const store = await makeStore();
      const a = (await store.users.create(userInput('acc'))).user;
      await activeFor(store, a, 1);
      await activeFor(store, a, 2);
      const [x, y] = [await owner(store), await owner(store)];
      const ix = await invite(store, x, `x-${unique()}@books.ps`, 3);
      const iy = await invite(store, y, `y-${unique()}@books.ps`, 3);
      if (ix.kind !== 'created' || iy.kind !== 'created') throw new Error('invite failed');
      const results = await Promise.all(
        [ix, iy].map((i) => store.accountantGrants.accept({ tokenDigest: i.grant.tokenDigest!, accountantUserId: a.id, at: at(4), maxActive: 3, auditFor: () => [] })),
      );
      expect(results.map((r) => r?.kind).sort()).toEqual(['accepted', 'cap_reached']);
      expect(await store.accountantGrants.listActiveByAccountant(a.id)).toHaveLength(3);
    });

    it('MUT-565: countActiveBefore ranks a grant among the ACTIVE ones by accept time, then id', async () => {
      const store = await makeStore();
      const a = (await store.users.create(userInput('acc'))).user;
      const g1 = await activeFor(store, a, 1);
      const g2 = await activeFor(store, a, 2);
      const g3 = await activeFor(store, a, 3);
      const g4 = await activeFor(store, a, 4);
      expect(await Promise.all([g1, g2, g3, g4].map((g) => store.accountantGrants.countActiveBefore(a.id, g)))).toEqual([0, 1, 2, 3]);
      await store.accountantGrants.leave({ organizationId: g2.organizationId, accountantUserId: a.id, at: at(5), auditFor: () => [] });
      expect(await store.accountantGrants.countActiveBefore(a.id, g4)).toBe(2);
      // Another accountant's grants never count.
      const b = (await store.users.create(userInput('acc'))).user;
      await activeFor(store, b, 0);
      expect(await store.accountantGrants.countActiveBefore(a.id, g1)).toBe(0);
    });

    it('MUT-565 review: a client whose owner is closing takes no place: not counted at accept, not ranked', async () => {
      const store = await makeStore();
      const a = (await store.users.create(userInput('acc'))).user;
      const g1 = await activeFor(store, a, 1);
      const g2 = await activeFor(store, a, 2);
      const closingGrant = await activeFor(store, a, 3);
      const closing = (await store.organizations.getById(closingGrant.organizationId))!;
      const ownerId = closing.ownerUserId ?? closing.personalOwnerUserId!;
      const session = await store.sessions.create({ userId: ownerId, tokenDigest: `s-${unique()}`, kind: 'cookie', at: at(4), idleExpiresAt: at(30), absoluteExpiresAt: at(30), userAgent: null });
      expect(await store.users.requestClosure({ userId: ownerId, at: at(4), deleteAfter: closureDeadline(at(4)), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] })).not.toBeNull();
      // 2 live + 1 closing: the next accept is free (maxActive 3).
      const o4 = await owner(store);
      const fourth = await invite(store, o4, `fourth-${unique()}@books.ps`, 5);
      if (fourth.kind !== 'created') throw new Error('invite failed');
      const accepted = await store.accountantGrants.accept({ tokenDigest: fourth.grant.tokenDigest!, accountantUserId: a.id, at: at(5), maxActive: 3, auditFor: () => [] });
      if (accepted?.kind !== 'accepted') throw new Error(`expected a free accept, got ${JSON.stringify(accepted)}`);
      const g4 = accepted.grant;
      expect(await store.accountantGrants.countActiveBefore(a.id, g4)).toBe(2);
      const o = await owner(store);
      const next = await invite(store, o, `next-${unique()}@books.ps`, 6);
      if (next.kind !== 'created') throw new Error('invite failed');
      // 2 live + 1 closing + g4 = 3 live: at the cap of 3 the next is refused, and its count names only the live ones.
      expect(await store.accountantGrants.accept({ tokenDigest: next.grant.tokenDigest!, accountantUserId: a.id, at: at(7), maxActive: 3, auditFor: () => [] })).toEqual({ kind: 'cap_reached', active: 3 });
      expect([g1, g2].length).toBe(2);
    });
  });
}
