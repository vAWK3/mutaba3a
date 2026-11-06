import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { closureDeadline } from '../../accounts/closure.js';
import type { AuditEventInput, CreateUserInput, LedgerStore, ShareLinkRecord } from '../ports.js';

/**
 * MUT-560 storage contract (ADR-247): share links. The live-link cap per profile, the failed-PIN count that parallel
 * guesses can't push past the lock, the viewer cap that parallel unlocks can't push past 3, returning viewers keeping
 * their slot, revoke, and the account purge (the profile's links go; a creator's link on a surviving profile stays
 * with no creator). Run against the memory store and Postgres.
 */
export function describeLedgerStoreShareLinksContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 6, 9, minute, 0));
  const DAY = 86_400_000;
  const userInput = (): CreateUserInput => ({
    email: `owner-${unique()}@firm-${unique()}.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const audit = (action: string) => (link: Pick<ShareLinkRecord, 'id' | 'organizationId'>): AuditEventInput[] => [
    { organizationId: link.organizationId, actorType: 'USER', actorId: null, action, entityType: 'share_link', entityId: link.id, metadata: {}, requestId: 'req-mut560' },
  ];

  async function owner(store: LedgerStore) {
    const { user, personalOrganization } = await store.users.create(userInput());
    return { userId: user.id, profileId: personalOrganization.id };
  }
  const create = (store: LedgerStore, o: { userId: string; profileId: string }, options: { minute?: number; max?: number; days?: number } = {}) =>
    store.shareLinks.create({
      id: randomUUID(),
      organizationId: o.profileId,
      createdByUserId: o.userId,
      tokenDigest: `link-${unique()}${unique()}`,
      pinHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      period: 'LAST_1_MONTH',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      expiresAt: new Date(at(options.minute ?? 1).getTime() + (options.days ?? 7) * DAY),
      at: at(options.minute ?? 1),
      max: options.max ?? 10,
      auditFor: audit('share_link.created'),
    });
  async function created(store: LedgerStore, o: { userId: string; profileId: string }) {
    const result = await create(store, o);
    if (result.kind !== 'created') throw new Error('not created');
    return result.link;
  }
  const addViewer = (store: LedgerStore, linkId: string, options: { previous?: string | null; digest?: string; minute?: number; max?: number } = {}) =>
    store.shareLinks.addOrRotateViewer({
      linkId,
      previousTokenDigest: options.previous ?? null,
      tokenDigest: options.digest ?? `viewer-${unique()}${unique()}`,
      accessExpiresAt: new Date(at(options.minute ?? 2).getTime() + 8 * 3_600_000),
      at: at(options.minute ?? 2),
      max: options.max ?? 3,
      auditFor: () => [],
    });
  async function purge(store: LedgerStore, userId: string, minute: number) {
    const session = await store.sessions.create({ userId, tokenDigest: `s-${unique()}`, kind: 'cookie', at: at(minute), idleExpiresAt: at(minute + 30), absoluteExpiresAt: at(minute + 30), userAgent: null });
    expect(await store.users.requestClosure({ userId, at: at(minute), deleteAfter: closureDeadline(at(minute)), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] })).not.toBeNull();
    const due = new Date(closureDeadline(at(minute)).getTime() + 60_000);
    expect(await store.accountPurge.claim(userId, due)).not.toBeNull();
    expect((await store.accountPurge.planOf(userId))?.blockedProfileIds).toEqual([]);
    expect(await store.accountPurge.purge(userId, due)).not.toBeNull();
  }

  describe(`${name} LedgerStore share links (MUT-560)`, () => {
    it('creates, finds by digest with its viewer count, lists live links oldest first, and audits in the same step', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      expect(link).toMatchObject({ organizationId: o.profileId, createdByUserId: o.userId, period: 'LAST_1_MONTH', periodFrom: '2026-10-01', periodTo: '2026-10-31', failedPinAttempts: 0, lockedAt: null, revokedAt: null, lastOpenedAt: null });
      expect(await store.shareLinks.findByTokenDigest(link.tokenDigest)).toEqual({ ...link, viewers: 0 });
      expect(await store.shareLinks.findByTokenDigest('nope')).toBeNull();
      const second = await created(store, o);
      expect((await store.shareLinks.listRecentByOrganization(o.profileId, at(3))).map((l) => l.id)).toEqual([link.id, second.id].sort((a, b) => (a < b ? -1 : 1)));
      const events = (await store.audit.listByOrganization(o.profileId, 50)).filter((e) => e.action === 'share_link.created');
      expect(events).toHaveLength(2);
    });

    it('caps live links per profile; revoked and expired ones don’t count', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const a = await created(store, o);
      expect((await create(store, o, { max: 2 })).kind).toBe('created');
      expect(await create(store, o, { max: 2 })).toEqual({ kind: 'limit', count: 2 });
      expect(await store.shareLinks.revoke({ organizationId: o.profileId, linkId: a.id, at: at(2), auditFor: audit('share_link.revoked') })).toMatchObject({ id: a.id, revokedAt: at(2) });
      expect((await create(store, o, { max: 2, minute: 3 })).kind).toBe('created');
      // Eight days on, every 7-day link has expired: none count.
      expect((await create(store, o, { max: 1, minute: 8 * 24 * 60 })).kind).toBe('created');
      // Links still live at `since` only: the 7-day ones ended before it.
      expect(await store.shareLinks.listRecentByOrganization(o.profileId, at(8 * 24 * 60 + 1))).toHaveLength(1);
    });

    it('revokes only a live link on its own profile', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const other = await owner(store);
      const link = await created(store, o);
      expect(await store.shareLinks.revoke({ organizationId: other.profileId, linkId: link.id, at: at(2), auditFor: audit('share_link.revoked') })).toBeNull();
      expect(await store.shareLinks.revoke({ organizationId: o.profileId, linkId: link.id, at: at(2), auditFor: audit('share_link.revoked') })).not.toBeNull();
      expect(await store.shareLinks.revoke({ organizationId: o.profileId, linkId: link.id, at: at(3), auditFor: audit('share_link.revoked') })).toBeNull();
      // Revoked at minute 2: still listed from a `since` before it, gone from one after it.
      expect((await store.shareLinks.listRecentByOrganization(o.profileId, at(1))).map((l) => l.id)).toEqual([link.id]);
      expect(await store.shareLinks.listRecentByOrganization(o.profileId, at(4))).toEqual([]);
    });

    it('counts wrong PINs one by one and locks at the limit, auditing the lock once', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const wrong = () => store.shareLinks.recordFailedPin({ linkId: link.id, at: at(5), maxAttempts: 3, lockAudit: audit('share_link.locked') });
      expect(await wrong()).toEqual({ failedPinAttempts: 1, locked: false });
      expect(await wrong()).toEqual({ failedPinAttempts: 2, locked: false });
      expect(await wrong()).toEqual({ failedPinAttempts: 3, locked: true });
      expect(await wrong()).toBeNull();
      expect(await store.shareLinks.findByTokenDigest(link.tokenDigest)).toMatchObject({ failedPinAttempts: 3, lockedAt: at(5) });
      expect((await store.audit.listByOrganization(o.profileId, 50)).filter((e) => e.action === 'share_link.locked')).toHaveLength(1);
    });

    it('parallel wrong PINs never count past the lock', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const results = await Promise.all(Array.from({ length: 8 }, () => store.shareLinks.recordFailedPin({ linkId: link.id, at: at(5), maxAttempts: 5, lockAudit: audit('share_link.locked') })));
      expect(results.filter((r) => r !== null)).toHaveLength(5);
      expect(results.filter((r) => r?.locked)).toHaveLength(1);
      expect((await store.shareLinks.findByTokenDigest(link.tokenDigest))?.failedPinAttempts).toBe(5);
    });

    it('adds viewers up to the cap, numbers them, stamps lastOpenedAt, and refuses the next', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const numbers: number[] = [];
      for (let i = 0; i < 3; i++) {
        const added = await addViewer(store, link.id);
        if (added.kind !== 'added') throw new Error(added.kind);
        numbers.push(added.viewerNumber);
      }
      expect(numbers).toEqual([1, 2, 3]);
      expect(await addViewer(store, link.id)).toEqual({ kind: 'limit' });
      expect(await store.shareLinks.findByTokenDigest(link.tokenDigest)).toMatchObject({ viewers: 3, lastOpenedAt: at(2) });
    });

    it('a returning viewer keeps its slot under a rotated token, even at the cap; the old token stops resolving', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const first = `viewer-${unique()}${unique()}`;
      expect((await addViewer(store, link.id, { digest: first })).kind).toBe('added');
      await addViewer(store, link.id);
      await addViewer(store, link.id);
      const rotatedDigest = `viewer-${unique()}${unique()}`;
      const rotated = await addViewer(store, link.id, { previous: first, digest: rotatedDigest, minute: 30 });
      expect(rotated).toMatchObject({ kind: 'rotated', viewer: { tokenDigest: rotatedDigest, accessExpiresAt: new Date(at(30).getTime() + 8 * 3_600_000) } });
      expect(await store.shareLinks.findViewerByDigest(first)).toBeNull();
      expect(await store.shareLinks.findViewerByDigest(rotatedDigest)).toMatchObject({ link: { id: link.id }, viewer: { tokenDigest: rotatedDigest } });
      expect((await store.shareLinks.findByTokenDigest(link.tokenDigest))?.viewers).toBe(3);
      // A viewer token of another link is no viewer of this one: stale, never a slot here.
      const other = await created(store, o);
      const elsewhere = `viewer-${unique()}${unique()}`;
      await addViewer(store, other.id, { digest: elsewhere });
      expect(await addViewer(store, link.id, { previous: elsewhere })).toEqual({ kind: 'stale' });
    });

    it('a previous token that matches no viewer of the link is stale: nothing is added, even below the cap', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      expect(await addViewer(store, link.id, { previous: `gone-${unique()}` })).toEqual({ kind: 'stale' });
      expect((await store.shareLinks.findByTokenDigest(link.tokenDigest))?.viewers).toBe(0);
    });

    it('two parallel re-unlocks with the same old token: one rotates, the other is stale; at 3 viewers neither hits the cap', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const old = `viewer-${unique()}${unique()}`;
      await addViewer(store, link.id, { digest: old });
      await addViewer(store, link.id);
      await addViewer(store, link.id);
      const results = await Promise.all([addViewer(store, link.id, { previous: old, minute: 9 }), addViewer(store, link.id, { previous: old, minute: 9 })]);
      expect(results.map((r) => r.kind).sort()).toEqual(['rotated', 'stale']);
      expect((await store.shareLinks.findByTokenDigest(link.tokenDigest))?.viewers).toBe(3);
    });

    it('the right PIN racing the 5th wrong one: the link ends locked, and a viewer is added only if it got in first', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      for (let i = 0; i < 4; i++) await store.shareLinks.recordFailedPin({ linkId: link.id, at: at(5), maxAttempts: 5, lockAudit: () => [] });
      const [wrong, right] = await Promise.all([
        store.shareLinks.recordFailedPin({ linkId: link.id, at: at(6), maxAttempts: 5, lockAudit: () => [] }),
        addViewer(store, link.id, { minute: 6 }),
      ]);
      expect(wrong).toEqual({ failedPinAttempts: 5, locked: true });
      expect(['added', 'unusable']).toContain(right.kind);
      const after = await store.shareLinks.findByTokenDigest(link.tokenDigest);
      expect(after).toMatchObject({ failedPinAttempts: 5 });
      expect(after!.lockedAt).not.toBeNull();
      expect(after!.viewers).toBe(right.kind === 'added' ? 1 : 0);
    });

    it('parallel unlocks at 2 viewers never make a 4th', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      await addViewer(store, link.id);
      await addViewer(store, link.id);
      const results = await Promise.all(Array.from({ length: 5 }, () => addViewer(store, link.id)));
      expect(results.filter((r) => r.kind === 'added')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'limit')).toHaveLength(4);
      expect((await store.shareLinks.findByTokenDigest(link.tokenDigest))?.viewers).toBe(3);
    });

    it('a revoked, locked or expired link takes no viewer', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const revoked = await created(store, o);
      await store.shareLinks.revoke({ organizationId: o.profileId, linkId: revoked.id, at: at(2), auditFor: audit('share_link.revoked') });
      expect(await addViewer(store, revoked.id, { minute: 3 })).toEqual({ kind: 'unusable' });
      const locked = await created(store, o);
      await store.shareLinks.recordFailedPin({ linkId: locked.id, at: at(2), maxAttempts: 1, lockAudit: () => [] });
      expect(await addViewer(store, locked.id, { minute: 3 })).toEqual({ kind: 'unusable' });
      const expiring = await created(store, o);
      expect(await addViewer(store, expiring.id, { minute: 8 * 24 * 60 })).toEqual({ kind: 'unusable' });
    });

    it('stamps a link’s lastOpenedAt and a viewer’s lastViewedAt', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const digest = `viewer-${unique()}${unique()}`;
      const added = await addViewer(store, link.id, { digest });
      if (added.kind !== 'added') throw new Error(added.kind);
      await store.shareLinks.touchOpened({ linkId: link.id, at: at(40) });
      await store.shareLinks.touchViewer({ viewerId: added.viewer.id, at: at(41) });
      expect(await store.shareLinks.findViewerByDigest(digest)).toMatchObject({ link: { lastOpenedAt: at(40) }, viewer: { lastViewedAt: at(41) } });
    });

    it('the owner’s purge takes their profile’s links and viewers, and is never blocked by them', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const link = await created(store, o);
      const digest = `viewer-${unique()}${unique()}`;
      await addViewer(store, link.id, { digest });
      await purge(store, o.userId, 10);
      expect(await store.shareLinks.findByTokenDigest(link.tokenDigest)).toBeNull();
      expect(await store.shareLinks.findViewerByDigest(digest)).toBeNull();
    });

    it('a co-owner who created a link and is purged leaves it on the profile with no creator', async () => {
      const store = await makeStore();
      const o = await owner(store);
      const made = await store.organizations.createOwned(o.userId, { name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: at(0) }, 6, { actorId: o.userId, requestId: null });
      if (made.kind !== 'created') throw new Error(made.kind);
      const business = made.organization;
      const co = await owner(store);
      const granted = await store.memberships.grantOwner(co.userId, business.id, at(0), 3, { organizationId: business.id, actorType: 'ADMIN', actorId: null, action: 'membership.granted', entityType: 'user', entityId: co.userId, metadata: { role: 'OWNER' }, requestId: null });
      expect(granted.kind).toBe('granted');
      const link = await created(store, { userId: co.userId, profileId: business.id });
      await purge(store, co.userId, 10);
      expect(await store.shareLinks.findByTokenDigest(link.tokenDigest)).toMatchObject({ id: link.id, createdByUserId: null });
    });
  });
}
