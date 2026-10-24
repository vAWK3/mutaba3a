import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { closureDeadline, GRACE_MS } from '../../accounts/closure.js';
import { StateConflict } from '../memory.js';
import type { AuditEventInput, CreateUserInput, LedgerStore, UserRecord } from '../ports.js';

/**
 * MUT-333 storage contract (ADR-188): closing an account, keeping it, and the hard delete.
 *
 *   requestClosure / cancelClosure: one transaction under the user-row lock; other sessions revoked at close.
 *   claim: R1, after it no cancel can win.  purge: D6 transfer, D7 anonymize, D8/R3 audit, D9/R4 person's rows.
 */
export function describeLedgerStoreAccountClosureContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const T0 = new Date(Date.UTC(2026, 9, 24, 10, 0, 0));
  const plus = (ms: number) => new Date(T0.getTime() + ms);
  const DAY = 86_400_000;
  const DUE = plus(GRACE_MS + 1000);
  const digest = () => `${unique()}${unique()}`.padEnd(64, '0').slice(0, 64);
  const userInput = (displayName: string, organizationId?: string): CreateUserInput => ({
    email: `close-${unique()}@studio.ps`,
    displayName,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    ...(organizationId ? { organizationId } : {}),
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: T0,
  });
  const audit = (organizationIds: string[], userId: string, action: string): AuditEventInput[] =>
    organizationIds.map((organizationId) => ({ organizationId, actorType: 'USER', actorId: userId, action, entityType: 'user', entityId: userId, requestId: null }));

  async function person(store: LedgerStore, organizationId?: string) {
    const created = await store.users.create(userInput(`Person ${unique()}`, organizationId));
    const session = await store.sessions.create({ userId: created.user.id, tokenDigest: digest(), kind: 'cookie', at: T0, idleExpiresAt: plus(DAY), absoluteExpiresAt: plus(DAY), userAgent: null });
    return { ...created, session };
  }

  async function close(store: LedgerStore, user: UserRecord, sessionId: string, at = T0, endedSubscriptionIds: string[] = []) {
    return store.users.requestClosure({ userId: user.id, at, deleteAfter: closureDeadline(at), endedSubscriptionIds, exceptSessionId: sessionId, audit: [] });
  }

  async function business(store: LedgerStore, ownerId: string) {
    const created = await store.organizations.createOwned(ownerId, { name: 'Studio', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: T0 }, 6, { actorId: ownerId, requestId: null });
    if (created.kind !== 'created') throw new Error('cap');
    return created.organization;
  }

  const expense = (store: LedgerStore, organizationId: string, createdByUserId: string) =>
    store.expenses.create({ organizationId, occurredOn: '2026-10-20', amountMinor: 1_000n, currency: 'ILS', title: 'Paper', vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId }, T0);

  describe(`${name} LedgerStore account-closure contract (MUT-333)`, () => {
    it('closes: sets the closure, revokes every other session (web and device), keeps this one, writes the audit', async () => {
      const store = await makeStore();
      const { user, session, personalOrganization } = await person(store);
      const phone = await store.sessions.create({ userId: user.id, tokenDigest: digest(), kind: 'device', at: T0, idleExpiresAt: plus(DAY), absoluteExpiresAt: plus(DAY), userAgent: null });
      const closed = await store.users.requestClosure({ userId: user.id, at: T0, deleteAfter: closureDeadline(T0), endedSubscriptionIds: ['sub_1'], exceptSessionId: session.id, audit: audit([personalOrganization.id], user.id, 'user.close_requested') });
      expect(closed?.closure).toEqual({ requestedAt: T0, deleteAfter: closureDeadline(T0), endedSubscriptionIds: ['sub_1'], purgeStartedAt: null, purgeLastTriedAt: null });
      expect((await store.users.getById(user.id))?.closure?.deleteAfter.toISOString()).toBe(closureDeadline(T0).toISOString());
      expect((await store.sessions.findByDigest(phone.tokenDigest))?.revokedReason).toBe('account_closing');
      expect((await store.sessions.findByDigest(session.tokenDigest))?.revokedAt).toBeNull();
      expect((await store.audit.listByOrganization(personalOrganization.id, 50)).some((e) => e.action === 'user.close_requested')).toBe(true);
    });

    it('refuses a second close and a close from a revoked session, writing nothing', async () => {
      const store = await makeStore();
      const { user, session } = await person(store);
      await close(store, user, session.id);
      await expect(close(store, user, session.id, plus(DAY))).rejects.toBeInstanceOf(StateConflict);
      expect((await store.users.getById(user.id))?.closure?.requestedAt.toISOString()).toBe(T0.toISOString());

      const other = await person(store);
      await store.sessions.revoke(other.session.id, 'signed_out', T0);
      await expect(close(store, other.user, other.session.id)).rejects.toBeInstanceOf(StateConflict);
      expect((await store.users.getById(other.user.id))?.closure).toBeNull();
      expect(await close(store, { ...user, id: randomUUID() }, session.id)).toBeNull();
    });

    it('keeps the account while the deadline is ahead, and returns the closure that ended', async () => {
      const store = await makeStore();
      const { user, session } = await person(store);
      await close(store, user, session.id, T0, ['sub_a']);
      const kept = await store.users.cancelClosure({ userId: user.id, at: plus(29 * DAY), audit: [] });
      expect(kept?.user.closure).toBeNull();
      expect(kept?.ended.endedSubscriptionIds).toEqual(['sub_a']);
      expect((await store.users.getById(user.id))?.closure).toBeNull();
      expect(await store.users.cancelClosure({ userId: user.id, at: plus(29 * DAY), audit: [] })).toBeNull();
    });

    it('can no longer be kept once the deadline passed, or once the hard delete claimed it (R1, R2)', async () => {
      const store = await makeStore();
      const late = await person(store);
      await close(store, late.user, late.session.id);
      expect(await store.users.cancelClosure({ userId: late.user.id, at: closureDeadline(T0), audit: [] })).toBeNull();
      expect((await store.users.getById(late.user.id))?.closure).not.toBeNull();

      const claimed = await person(store);
      await close(store, claimed.user, claimed.session.id);
      expect(await store.accountPurge.claim(claimed.user.id, DUE)).not.toBeNull();
      // Even an instance whose clock is a day behind can't keep it now.
      expect(await store.users.cancelClosure({ userId: claimed.user.id, at: plus(DAY), audit: [] })).toBeNull();
    });

    it('lists and claims only accounts whose grace ran out; a claim keeps its first instant (R1, R13, D19)', async () => {
      const store = await makeStore();
      const a = await person(store);
      const b = await person(store);
      await close(store, a.user, a.session.id);
      await close(store, b.user, b.session.id, plus(DAY));
      expect(await store.accountPurge.claim(a.user.id, plus(GRACE_MS - 1))).toBeNull();
      const dueIds = (await store.accountPurge.listDue(DUE, 100)).map((u) => u.id);
      expect(dueIds).toContain(a.user.id);
      expect(dueIds).not.toContain(b.user.id);

      const first = await store.accountPurge.claim(a.user.id, DUE);
      expect(first?.closure?.purgeStartedAt?.toISOString()).toBe(DUE.toISOString());
      const later = plus(GRACE_MS + 2 * DAY);
      const again = await store.accountPurge.claim(a.user.id, later);
      expect(again?.closure?.purgeStartedAt?.toISOString()).toBe(DUE.toISOString());
      expect(again?.closure?.purgeLastTriedAt?.toISOString()).toBe(later.toISOString());

      // Tried most recently goes to the back of the queue.
      const both = (await store.accountPurge.listDue(plus(GRACE_MS + 3 * DAY), 100)).map((u) => u.id).filter((id) => id === a.user.id || id === b.user.id);
      expect(both).toEqual([b.user.id, a.user.id]);
      const counts = await store.accountPurge.countClosing(DUE);
      expect(counts.closing).toBeGreaterThanOrEqual(2);
      expect(counts.due).toBeGreaterThanOrEqual(1);
    });

    it('purges nothing without a claim', async () => {
      const store = await makeStore();
      const { user, session } = await person(store);
      await close(store, user, session.id);
      expect(await store.accountPurge.purge(user.id, DUE)).toBeNull();
      expect(await store.users.getById(user.id)).not.toBeNull();
    });

    it('hard-deletes the account: its own profiles go, a shared one passes on, a firm keeps anonymized records (D6–D9, R3, R4)', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user, session, personalOrganization } = await person(store, firm.id);
      const partner = await person(store);
      const solo = await business(store, user.id);
      const shared = await business(store, user.id);
      expect((await store.memberships.grantOwner(partner.user.id, shared.id, T0, 3, { organizationId: shared.id, actorType: 'ADMIN', actorId: null, action: 'membership.granted', entityType: 'user', entityId: partner.user.id, metadata: { role: 'OWNER' }, requestId: null })).kind).toBe('granted');

      const mine = await expense(store, personalOrganization.id, user.id);
      await expense(store, solo.id, user.id);
      const onShared = await expense(store, shared.id, user.id);
      const partners = await expense(store, shared.id, partner.user.id);
      const inFirm = await expense(store, firm.id, user.id);
      const receipt = await store.expenseReceipts.create({ organizationId: firm.id, expenseId: inFirm.id, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-20', uploadedByUserId: user.id, requestId: null }, T0);
      const conversion = await store.conversions.create({ organizationId: firm.id, occurredOn: '2026-10-20', amountMinor: 100n, currency: 'USD', toAmountMinor: 360n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, T0);
      const group = await store.expenseGroups.create({ organizationId: firm.id, name: 'Trip', startOn: '2026-10-01', endOn: null, notes: null, createdByUserId: user.id }, T0);
      await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 500n, currency: 'ILS', occurredOn: '2026-10-20', note: 'taxi', captureSource: null }, T0);
      await store.users.acceptTerms({ userId: user.id, version: '2026-10-19', locale: 'en', textSha256: 'f'.repeat(64), surface: 'portal', clientRelease: null, at: T0, audit: audit([personalOrganization.id, firm.id], user.id, 'user.terms_accepted') });
      await store.audit.append({ organizationId: firm.id, actorType: 'ADMIN', actorId: null, action: 'user.created', entityType: 'user', entityId: user.id, metadata: { email: user.email, displayName: user.displayName }, requestId: null });
      await store.billing.createGrant({ id: randomUUID(), userId: user.id, organizationId: null, tier: 'FREELANCER', reason: 'pilot', expiresAt: null, grantedBy: 'admin', at: T0, audit: [] });
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount({ stripeCustomerId: customer, userId: user.id, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
      await store.billing.saveSubscription({ stripeCustomerId: customer, stripeSubscriptionId: `sub_${unique()}`, tier: 'FREELANCER', organizationId: null, status: 'canceled', currentPeriodEnd: plus(DAY), cancelAtPeriodEnd: false, priceLookupKey: null, founderUntil: null, stripeUpdatedAt: T0, at: T0, audit: { profileIds: [], source: 'webhook', eventId: null, requestId: null } });
      const signup = await store.accountSetup.issueSignup({ email: user.email, locale: 'en', domainClass: 'BUSINESS', domainReasons: [], tokenDigest: digest(), at: T0, expiresAt: plus(DAY) });

      await close(store, user, session.id);
      const plan = await store.accountPurge.planOf(user.id);
      expect(plan).toMatchObject({ userId: user.id, transfers: [{ organizationId: shared.id, toUserId: partner.user.id }], leaveProfileIds: [firm.id], stripeCustomerIds: [customer] });
      expect([...(plan?.deleteProfileIds ?? [])].sort()).toEqual([personalOrganization.id, solo.id].sort());
      expect(await store.users.getById(user.id)).not.toBeNull(); // planning writes nothing

      await store.accountPurge.claim(user.id, DUE);
      const outcome = await store.accountPurge.purge(user.id, DUE);
      expect(outcome).toMatchObject({ transfers: plan!.transfers, leaveProfileIds: [firm.id] });
      expect(outcome!.auditRowsScrubbed).toBeGreaterThanOrEqual(1);

      // The person and every row of theirs.
      expect(await store.users.getById(user.id)).toBeNull();
      expect(await store.users.findByEmail(user.email)).toBeNull();
      expect(await store.sessions.findByDigest(session.tokenDigest)).toBeNull();
      expect(await store.memberships.listByUser(user.id)).toEqual([]);
      expect(await store.inboxEntries.list(user.id, { limit: 10, cursor: null })).toMatchObject({ items: [] });
      expect(await store.users.latestTermsAcceptance(user.id)).toBeNull();
      expect(await store.billing.getAccount(customer)).toBeNull();
      expect(await store.billing.listGrants({ userId: user.id })).toEqual([]);
      expect(await store.accountSetup.findByDigest(signup.tokenDigest)).toBeNull();

      // Their own profiles, with everything in them, and their bucket prefixes queued.
      expect(await store.organizations.getById(personalOrganization.id)).toBeNull();
      expect(await store.organizations.getById(solo.id)).toBeNull();
      expect(await store.expenses.getById(personalOrganization.id, mine.id)).toBeNull();
      expect(await store.accountPurge.listStoragePurges(100)).toEqual(expect.arrayContaining([personalOrganization.id, solo.id]));

      // The shared profile passed to the partner, with every record; the closer's is anonymized.
      expect((await store.organizations.getById(shared.id))?.ownerUserId).toBe(partner.user.id);
      expect((await store.expenses.getById(shared.id, onShared.id))?.createdByUserId).toBeNull();
      expect((await store.expenses.getById(shared.id, partners.id))?.createdByUserId).toBe(partner.user.id);
      expect(await store.memberships.find(partner.user.id, shared.id)).not.toBeNull();

      // The firm keeps its records, anonymized, and an audit tombstone with nothing personal left in it.
      expect((await store.expenses.getById(firm.id, inFirm.id))?.createdByUserId).toBeNull();
      expect((await store.expenseReceipts.getById(firm.id, receipt.id))?.uploadedByUserId).toBeNull();
      expect((await store.conversions.getById(firm.id, conversion.id))?.createdByUserId).toBeNull();
      expect((await store.expenseGroups.getById(firm.id, group.id))?.createdByUserId).toBeNull();
      const firmAudit = await store.audit.listByOrganization(firm.id, 100);
      expect(firmAudit.some((e) => e.action === 'user.terms_accepted')).toBe(false);
      expect(firmAudit.find((e) => e.action === 'user.created')?.metadata ?? null).toBeNull();
      expect(firmAudit.some((e) => e.action === 'user.deleted' && e.entityId === user.id)).toBe(true);
      expect(JSON.stringify(firmAudit)).not.toContain(user.email);
      expect((await store.audit.listByOrganization(shared.id, 100)).some((e) => e.action === 'organization.owner_transferred')).toBe(true);

      // The partner is untouched.
      expect(await store.users.getById(partner.user.id)).not.toBeNull();
    });

    it('empties the storage queue one profile at a time', async () => {
      const store = await makeStore();
      const { user, session } = await person(store);
      await close(store, user, session.id);
      await store.accountPurge.claim(user.id, DUE);
      const outcome = await store.accountPurge.purge(user.id, DUE);
      const [first] = outcome!.deleteProfileIds;
      expect(await store.accountPurge.listStoragePurges(100)).toContain(first);
      await store.accountPurge.finishStoragePurge(first!);
      expect(await store.accountPurge.listStoragePurges(100)).not.toContain(first);
    });
  });
}
