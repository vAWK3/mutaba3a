import { describe, expect, it } from 'vitest';
import type { AuditEventInput, EmailDomainClass, LedgerStore } from '../ports.js';

/**
 * MUT-367 storage contract (ADR-159 §7a, ADR-178): the operator's signup review queue. A PENDING_REVIEW redeem writes
 * its review row in the same transaction; approve opens the account and starts the trial; decline hard-deletes the
 * empty account (D12, D28) and keeps the review with no person; decisions never race each other.
 */
export function describeLedgerStoreSignupReviewContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 24, hour, 0, 0));
  const digest = () => `${unique()}${unique()}`.padEnd(64, '0').slice(0, 64);
  const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const TERMS = { version: '2026-10-19', locale: 'ar' as const, textSha256: 'f'.repeat(64), surface: 'portal' as const, clientRelease: null };
  const approvedAudit = (personalOrganizationId: string): AuditEventInput[] => [
    { organizationId: personalOrganizationId, actorType: 'ADMIN', actorId: null, action: 'user.signup_approved', entityType: 'signup_review', entityId: personalOrganizationId, requestId: 'req-a' },
  ];

  /** A redeemed SIGNUP link that opened a PENDING_REVIEW account, as the route writes it. */
  async function pendingSignup(store: LedgerStore, options: { classification?: EmailDomainClass; reasons?: string[]; hour?: number } = {}) {
    const email = `p-${unique()}@gmail.com`;
    const classification = options.classification ?? 'WEBMAIL';
    const reasons = options.reasons ?? ['webmail'];
    const hour = options.hour ?? 2;
    const link = await store.accountSetup.issueSignup({ email, locale: 'ar', tokenDigest: digest(), at: at(hour - 1), expiresAt: at(hour + 20), domainClass: classification, domainReasons: reasons });
    const created = await store.accountSetup.redeemSignup({
      tokenDigest: link.tokenDigest,
      passwordHash: HASH,
      at: at(hour),
      displayName: 'Rana',
      personal: { name: 'شخصي', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      status: 'PENDING_REVIEW',
      review: { domain: 'gmail.com', classification, reasons },
      trialStartsAt: null,
      terms: TERMS,
      auditFor: ({ userId, personalOrganizationId }) => [
        { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'user.signed_up', entityType: 'user', entityId: userId, requestId: 'req-s' },
      ],
    });
    expect(created).not.toBeNull();
    return { email, link, ...created! };
  }

  describe(`${name} LedgerStore signup-review contract (MUT-367)`, () => {
    it('a PENDING_REVIEW redeem writes its review with the account, and the queue lists it oldest first with its person', async () => {
      const store = await makeStore();
      const older = await pendingSignup(store, { hour: 2 });
      const newer = await pendingSignup(store, { classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'], hour: 3 });
      expect(older.user.status).toBe('PENDING_REVIEW');
      expect((await store.billing.summaryOf(older.user.id)).trialStartedAt).toBeNull();
      expect(await store.signupReviews.findByUser(newer.user.id)).toMatchObject({ userId: newer.user.id, domain: 'gmail.com', classification: 'BUSINESS_UNVERIFIED', reasons: ['rdap-age-12d'], decision: null, notifiedAt: null });

      const page = await store.signupReviews.list({ state: 'pending', limit: 200, cursor: null });
      const mine = page.items.filter((r) => [older.user.id, newer.user.id].includes(r.userId!));
      expect(mine.map((r) => r.userId)).toEqual([older.user.id, newer.user.id]);
      expect(mine[0]!.person).toEqual({ email: older.email, displayName: 'Rana', locale: 'ar' });
    });

    it('pages with a cursor', async () => {
      const store = await makeStore();
      await pendingSignup(store, { hour: 4 });
      await pendingSignup(store, { hour: 5 });
      const first = await store.signupReviews.list({ state: 'pending', limit: 1, cursor: null });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = await store.signupReviews.list({ state: 'pending', limit: 1, cursor: first.nextCursor });
      expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    });

    it('approve opens the account, starts the trial at approval, decides the review and audits on the personal profile', async () => {
      const store = await makeStore();
      const p = await pendingSignup(store);
      const result = await store.signupReviews.approve({ userId: p.user.id, at: at(9), decidedBy: 'admin-token', auditFor: approvedAudit });
      expect(result).toMatchObject({ kind: 'approved', user: { id: p.user.id, status: 'ACTIVE' }, review: { decision: 'APPROVED', decidedBy: 'admin-token' } });
      expect((await store.users.getById(p.user.id))?.status).toBe('ACTIVE');
      expect((await store.billing.summaryOf(p.user.id)).trialStartedAt?.toISOString()).toBe(at(9).toISOString());
      expect((await store.audit.listByOrganization(p.personalOrganization.id, 10)).map((e) => e.action)).toContain('user.signup_approved');
      // Decided once: a second approve or a decline is already_decided, and nothing changes.
      expect(await store.signupReviews.approve({ userId: p.user.id, at: at(10), decidedBy: 'admin-token', auditFor: approvedAudit })).toMatchObject({ kind: 'already_decided' });
      expect(await store.signupReviews.decline({ userId: p.user.id, at: at(10), decidedBy: 'admin-token' })).toMatchObject({ kind: 'already_decided' });
      expect((await store.users.getById(p.user.id))?.status).toBe('ACTIVE');
    });

    it('an unknown person, or one with no review, is not_found', async () => {
      const store = await makeStore();
      const { user } = await store.users.create({ email: `o-${unique()}@studio.example`, displayName: 'Op', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
      expect(await store.signupReviews.approve({ userId: user.id, at: at(1), decidedBy: 'admin-token', auditFor: approvedAudit })).toEqual({ kind: 'not_found' });
      expect(await store.signupReviews.decline({ userId: '00000000-0000-4000-8000-000000000000', at: at(1), decidedBy: 'admin-token' })).toEqual({ kind: 'not_found' });
    });

    it('decline deletes the account, its profile, every link (a used recovery link too) and the address’s SIGNUP rows; the review stays with no person', async () => {
      const store = await makeStore();
      const p = await pendingSignup(store);
      // D9: a pending person recovers; the used RESET link must not block the delete (RESTRICT).
      const reset = await store.accountSetup.issue({ userId: p.user.id, tokenDigest: digest(), purpose: 'RESET', at: at(3), expiresAt: at(4), lock: false, mailed: true, audit: [] });
      expect(await store.accountSetup.redeem({ tokenDigest: reset.tokenDigest, passwordHash: HASH, at: at(3), audit: [], terms: TERMS, termsAudit: [] })).not.toBeNull();
      await store.accountSetup.issue({ userId: p.user.id, tokenDigest: digest(), purpose: 'RESET', at: at(3), expiresAt: at(4), lock: false, mailed: true, audit: [] });

      const result = await store.signupReviews.decline({ userId: p.user.id, at: at(9), decidedBy: 'admin-token' });
      expect(result).toMatchObject({ kind: 'declined', person: { email: p.email, locale: 'ar' }, review: { userId: null, decision: 'DECLINED', domain: 'gmail.com', reasons: ['webmail'] } });
      expect(await store.users.getById(p.user.id)).toBeNull();
      expect(await store.users.findByEmail(p.email)).toBeNull();
      expect(await store.organizations.getById(p.personalOrganization.id)).toBeNull();
      expect(await store.accountSetup.findByDigest(p.link.tokenDigest)).toBeNull();
      expect(await store.accountSetup.findByDigest(reset.tokenDigest)).toBeNull();
      expect(await store.signupReviews.findByUser(p.user.id)).toBeNull();
      const decided = await store.signupReviews.list({ state: 'decided', limit: 200, cursor: null });
      expect(decided.items.find((r) => r.id === (result as { review: { id: string } }).review.id)).toMatchObject({ userId: null, person: null, decision: 'DECLINED' });

      // The address can sign up again.
      const again = await store.accountSetup.issueSignup({ email: p.email, locale: 'ar', tokenDigest: digest(), at: at(10), expiresAt: at(20), domainClass: 'WEBMAIL', domainReasons: ['webmail'] });
      expect(await store.accountSetup.findByDigest(again.tokenDigest)).toMatchObject({ email: p.email, cancelledAt: null });
    });

    it('decline refuses an account that holds anything else, and deletes nothing', async () => {
      const store = await makeStore();
      const p = await pendingSignup(store);
      await store.billing.createGrant({ id: crypto.randomUUID(), userId: p.user.id, organizationId: null, tier: 'FREELANCER', reason: 'pilot', expiresAt: null, grantedBy: 'admin', at: at(3), audit: [] });
      expect(await store.signupReviews.decline({ userId: p.user.id, at: at(9), decidedBy: 'admin-token' })).toEqual({ kind: 'not_empty' });
      expect((await store.users.getById(p.user.id))?.status).toBe('PENDING_REVIEW');
      expect(await store.organizations.getById(p.personalOrganization.id)).not.toBeNull();
      expect(await store.signupReviews.findByUser(p.user.id)).toMatchObject({ decision: null });
    });

    it('of a concurrent approve and decline, exactly one decides', async () => {
      const store = await makeStore();
      const p = await pendingSignup(store);
      const [approved, declined] = await Promise.all([
        store.signupReviews.approve({ userId: p.user.id, at: at(9), decidedBy: 'admin-token', auditFor: approvedAudit }),
        store.signupReviews.decline({ userId: p.user.id, at: at(9), decidedBy: 'admin-token' }),
      ]);
      const kinds = [approved.kind, declined.kind].sort();
      expect(kinds.filter((k) => k === 'approved' || k === 'declined')).toHaveLength(1);
    });

    it('digest facts count every open review and name the unannounced ones; markNotified stamps only those still unstamped', async () => {
      const store = await makeStore();
      const before = await store.signupReviews.digestFacts();
      const a = await pendingSignup(store);
      const b = await pendingSignup(store);
      const facts = await store.signupReviews.digestFacts();
      expect(facts.pending).toBe(before.pending + 2);
      const ids = [(await store.signupReviews.findByUser(a.user.id))!.id, (await store.signupReviews.findByUser(b.user.id))!.id];
      expect(facts.unannounced).toEqual(expect.arrayContaining(ids));
      expect(await store.signupReviews.markNotified([ids[0]!], at(5))).toBe(1);
      expect(await store.signupReviews.markNotified([ids[0]!], at(6))).toBe(0);
      expect((await store.signupReviews.findByUser(a.user.id))?.notifiedAt?.toISOString()).toBe(at(5).toISOString());
      expect((await store.signupReviews.digestFacts()).unannounced).not.toContain(ids[0]);
    });
  });
}
