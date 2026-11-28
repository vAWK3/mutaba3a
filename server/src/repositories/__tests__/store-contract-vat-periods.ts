import { describe, expect, it } from 'vitest';
import { GRACE_MS } from '../../accounts/closure.js';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-782 storage contract (ADR-343): a client's chosen VAT period, each period announced exactly once, the client's
 * Done and the accountant's review as guarded transitions, the follow-up queue, and the profiles the daily sweep walks.
 * Run against the memory store and Postgres.
 */
export function describeLedgerStoreVatPeriodContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  describe(`${name} LedgerStore VAT period contract`, () => {
    const unique = () => Math.random().toString(36).slice(2, 10);
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 28, 9, minute, 0));
    const userInput = (prefix: string, passwordHash: string | null = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'): CreateUserInput => ({
      email: `${prefix}-${unique()}@firm-${unique()}.ps`,
      displayName: prefix,
      passwordHash,
      locale: 'ar',
      personal: { name: `Personal ${prefix}`, slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
    /** A client: a claimed owner and their profile. */
    async function client(store: LedgerStore) {
      const { user, personalOrganization } = await store.users.create(userInput('owner'));
      return { ownerId: user.id, organizationId: personalOrganization.id, email: user.email };
    }
    /** An accountant with an ACTIVE grant on the profile. */
    async function accountantOn(store: LedgerStore, organizationId: string, ownerId: string) {
      const { user } = await store.users.create(userInput('acct'));
      const tokenDigest = `t-${unique()}${unique()}`;
      const invited = await store.accountantGrants.invite({ organizationId, inviteEmail: user.email, locale: 'ar', invitedByUserId: ownerId, tokenDigest, at: at(1), expiresAt: at(60 * 24 * 14), max: 5, auditFor: () => [] });
      expect(invited.kind).toBe('created');
      const accepted = await store.accountantGrants.accept({ tokenDigest, accountantUserId: user.id, at: at(2), auditFor: () => [] });
      expect(accepted?.kind).toBe('accepted');
      return { accountantId: user.id };
    }
    const audit = (organizationId: string, action: string): AuditEventInput[] => [{ organizationId, actorType: 'SYSTEM', actorId: null, action, entityType: 'vat_period', entityId: null, requestId: null }];

    it('remembers the accountant\'s chosen kind and replaces it', async () => {
      const store = await makeStore();
      const { organizationId, ownerId } = await client(store);
      expect(await store.vatPeriods.settingOf(organizationId)).toBeNull();
      await store.vatPeriods.setKind({ organizationId, kind: 'MONTHLY', userId: ownerId, at: at(3) });
      expect(await store.vatPeriods.settingOf(organizationId)).toBe('MONTHLY');
      await store.vatPeriods.setKind({ organizationId, kind: 'NONE', userId: ownerId, at: at(4), audit: audit(organizationId, 'vat_period.kind_set') });
      expect(await store.vatPeriods.settingOf(organizationId)).toBe('NONE');
    });

    it('announces a period once: the second call inserts nothing, even raced', async () => {
      const store = await makeStore();
      const { organizationId } = await client(store);
      const input = { organizationId, periodKey: '2026-B5', at: at(5), followUpDueAt: at(60 * 24 * 5), audit: audit(organizationId, 'vat_period.announced') };
      const results = await Promise.all([store.vatPeriods.announce(input), store.vatPeriods.announce(input), store.vatPeriods.announce(input)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await store.vatPeriods.recordOf(organizationId, '2026-B5')).toMatchObject({ state: 'OPEN', followUpDueAt: at(60 * 24 * 5), followUpSentAt: null, note: null });
      expect(await store.vatPeriods.recordOf(organizationId, '2026-B4')).toBeNull();
    });

    it('latestOf answers each profile\'s most recently announced period in one call', async () => {
      const store = await makeStore();
      const a = await client(store);
      const b = await client(store);
      const none = await client(store);
      await store.vatPeriods.announce({ organizationId: a.organizationId, periodKey: '2026-B4', at: at(5), followUpDueAt: at(100) });
      await store.vatPeriods.announce({ organizationId: a.organizationId, periodKey: '2026-B5', at: at(10), followUpDueAt: at(200) });
      await store.vatPeriods.announce({ organizationId: b.organizationId, periodKey: '2026-M10', at: at(6), followUpDueAt: at(100) });
      const latest = await store.vatPeriods.latestOf([a.organizationId, b.organizationId, none.organizationId]);
      expect(latest.get(a.organizationId)?.periodKey).toBe('2026-B5');
      expect(latest.get(b.organizationId)?.periodKey).toBe('2026-M10');
      expect(latest.has(none.organizationId)).toBe(false);
      expect((await store.vatPeriods.latestOf([])).size).toBe(0);
    });

    it('viewsOf answers each profile\'s chosen kind, issuer facts and latest period together', async () => {
      const store = await makeStore();
      const a = await client(store);
      const b = await client(store);
      await store.vatPeriods.setKind({ organizationId: a.organizationId, kind: 'YEARLY', userId: a.ownerId, at: at(3) });
      await store.vatPeriods.announce({ organizationId: a.organizationId, periodKey: '2026-Y', at: at(5), followUpDueAt: at(100) });
      const views = await store.vatPeriods.viewsOf([a.organizationId, b.organizationId]);
      expect(views.get(a.organizationId)).toMatchObject({ chosenKind: 'YEARLY', dealerType: null, country: null, latest: { periodKey: '2026-Y', state: 'OPEN' } });
      expect(views.get(b.organizationId)).toEqual({ chosenKind: null, dealerType: null, country: null, latest: null });
      expect((await store.vatPeriods.viewsOf([])).size).toBe(0);
    });

    describe('transitions', () => {
      async function open(store: LedgerStore) {
        const c = await client(store);
        await store.vatPeriods.announce({ organizationId: c.organizationId, periodKey: '2026-B5', at: at(5), followUpDueAt: at(60 * 24 * 5) });
        return c;
      }
      const key = '2026-B5';

      it('Done moves OPEN to CLIENT_DONE; Done again changes nothing', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await open(store);
        expect(await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(10) })).toBe('done');
        expect(await store.vatPeriods.recordOf(organizationId, key)).toMatchObject({ state: 'CLIENT_DONE', doneAt: at(10), doneByUserId: ownerId });
        expect(await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(11) })).toBe('unchanged');
        expect((await store.vatPeriods.recordOf(organizationId, key))?.doneAt).toEqual(at(10));
      });

      it('Done on an unknown period is not_found', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await client(store);
        expect(await store.vatPeriods.markDone({ organizationId, periodKey: '2026-B1', userId: ownerId, at: at(10) })).toBe('not_found');
      });

      it('the accountant confirms from OPEN or CLIENT_DONE; CONFIRMED is final', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await open(store);
        await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(10) });
        expect(await store.vatPeriods.review({ organizationId, periodKey: key, userId: ownerId, decision: 'CONFIRMED', note: null, at: at(12), followUpDueAt: null })).toBe('ok');
        expect(await store.vatPeriods.recordOf(organizationId, key)).toMatchObject({ state: 'CONFIRMED', reviewedAt: at(12), reviewedByUserId: ownerId, followUpDueAt: null });
        expect(await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(13) })).toBe('state');
        expect(await store.vatPeriods.review({ organizationId, periodKey: key, userId: ownerId, decision: 'MORE_NEEDED', note: 'x', at: at(14), followUpDueAt: at(900) })).toBe('state');
      });

      it('the accountant can confirm straight from OPEN', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await open(store);
        expect(await store.vatPeriods.review({ organizationId, periodKey: key, userId: ownerId, decision: 'CONFIRMED', note: null, at: at(12), followUpDueAt: null })).toBe('ok');
      });

      it('Ask for more keeps the note, re-arms the follow-up, and the client can say Done again', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await open(store);
        await store.vatPeriods.markFollowUpSent(organizationId, key, at(20));
        await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(21) });
        expect(await store.vatPeriods.review({ organizationId, periodKey: key, userId: ownerId, decision: 'MORE_NEEDED', note: 'October fuel', at: at(22), followUpDueAt: at(60 * 24 * 5) })).toBe('ok');
        expect(await store.vatPeriods.recordOf(organizationId, key)).toMatchObject({ state: 'MORE_NEEDED', note: 'October fuel', followUpDueAt: at(60 * 24 * 5), followUpSentAt: null });
        expect(await store.vatPeriods.markDone({ organizationId, periodKey: key, userId: ownerId, at: at(23) })).toBe('done');
        expect((await store.vatPeriods.recordOf(organizationId, key))?.state).toBe('CLIENT_DONE');
      });

      it('review on an unknown period is not_found', async () => {
        const store = await makeStore();
        const { organizationId, ownerId } = await client(store);
        expect(await store.vatPeriods.review({ organizationId, periodKey: key, userId: ownerId, decision: 'CONFIRMED', note: null, at: at(12), followUpDueAt: null })).toBe('not_found');
      });
    });

    describe('follow-ups', () => {
      it('markFollowUpSent stamps the period; Ask for more re-arms it; Done and Confirm leave nothing due', async () => {
        const store = await makeStore();
        const c = await client(store);
        const key = '2026-M10';
        await store.vatPeriods.announce({ organizationId: c.organizationId, periodKey: key, at: at(5), followUpDueAt: at(100) });
        await store.vatPeriods.markFollowUpSent(c.organizationId, key, at(101));
        expect(await store.vatPeriods.recordOf(c.organizationId, key)).toMatchObject({ followUpDueAt: at(100), followUpSentAt: at(101) });
        await store.vatPeriods.review({ organizationId: c.organizationId, periodKey: key, userId: c.ownerId, decision: 'MORE_NEEDED', note: null, at: at(110), followUpDueAt: at(200) });
        expect(await store.vatPeriods.recordOf(c.organizationId, key)).toMatchObject({ followUpDueAt: at(200), followUpSentAt: null });
        await store.vatPeriods.review({ organizationId: c.organizationId, periodKey: key, userId: c.ownerId, decision: 'CONFIRMED', note: null, at: at(120), followUpDueAt: null });
        expect((await store.vatPeriods.recordOf(c.organizationId, key))?.followUpDueAt).toBeNull();
      });
    });

    it('forgets who acted when that person is purged, keeping the profile\'s records', async () => {
      const store = await makeStore();
      const c = await client(store);
      const { accountantId } = await accountantOn(store, c.organizationId, c.ownerId);
      await store.vatPeriods.announce({ organizationId: c.organizationId, periodKey: '2026-B5', at: at(5), followUpDueAt: at(100) });
      await store.vatPeriods.markDone({ organizationId: c.organizationId, periodKey: '2026-B5', userId: c.ownerId, at: at(10) });
      await store.vatPeriods.review({ organizationId: c.organizationId, periodKey: '2026-B5', userId: accountantId, decision: 'CONFIRMED', note: null, at: at(12), followUpDueAt: null });
      const closeAt = at(20);
      const due = new Date(closeAt.getTime() + GRACE_MS + 1000);
      const session = await store.sessions.create({ userId: accountantId, tokenDigest: `s-${unique()}${unique()}`, kind: 'cookie', at: closeAt, idleExpiresAt: due, absoluteExpiresAt: due, userAgent: null });
      await store.users.requestClosure({ userId: accountantId, at: closeAt, deleteAfter: new Date(closeAt.getTime() + GRACE_MS), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] });
      expect(await store.accountPurge.claim(accountantId, due)).not.toBeNull();
      expect(await store.accountPurge.purge(accountantId, due)).not.toBeNull();
      const record = await store.vatPeriods.recordOf(c.organizationId, '2026-B5');
      expect(record).toMatchObject({ state: 'CONFIRMED', doneByUserId: c.ownerId, reviewedByUserId: null });
    });

    describe('sweepTargets', () => {
      it('walks profiles that have an ACTIVE accountant and a claimed owner, with both sides\' addresses', async () => {
        const store = await makeStore();
        const shared = await client(store);
        const { accountantId } = await accountantOn(store, shared.organizationId, shared.ownerId);
        const alone = await client(store);
        await store.vatPeriods.setKind({ organizationId: shared.organizationId, kind: 'MONTHLY', userId: accountantId, at: at(3) });

        const all: string[] = [];
        let after: string | undefined;
        for (;;) {
          const page = await store.vatPeriods.sweepTargets({ limit: 1, after });
          if (page.length === 0) break;
          const row = page[0]!;
          all.push(row.organizationId);
          if (row.organizationId === shared.organizationId) {
            expect(row.chosenKind).toBe('MONTHLY');
            expect(row.dealerType).toBeNull();
            expect(row.country).toBeNull();
            expect(row.timezone).toBe('Asia/Jerusalem');
            expect(row.owners.map((o) => o.userId)).toEqual([shared.ownerId]);
            expect(row.accountants.map((a) => a.userId)).toEqual([accountantId]);
            expect(row.owners[0]).toMatchObject({ email: shared.email, locale: 'ar' });
          }
          after = row.organizationId;
        }
        expect(all).toContain(shared.organizationId);
        expect(all).not.toContain(alone.organizationId);
        expect([...all].sort()).toEqual(all);
      });
    });
  });
}
