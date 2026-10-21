import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import type { AuditEventInput } from '../../repositories/ports.js';
import { PrismaLedgerStore } from '../../repositories/prisma.js';
import { findStrayOwnedMemberships } from '../pre-roll.js';

/**
 * deploy.sh step 3 (MUT-373, eng review OV1b): before the roll, find memberships on owned profiles held by someone
 * the operator never made a co-owner — they would silently become owners under ownsProfile. A co-owner added through
 * the admin grant (audited membership.granted, role OWNER) is not stray.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('pre-roll checks (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  const granted = (organizationId: string, userId: string): AuditEventInput => ({ organizationId, actorType: 'ADMIN', actorId: null, action: 'membership.granted', entityType: 'user', entityId: userId, metadata: { role: 'OWNER' }, requestId: null });

  describe('findStrayOwnedMemberships', () => {
    it('reports a membership planted on an owned profile, and not one the operator made a co-owner', async () => {
      const at = new Date('2026-10-21T08:00:00Z');
      const tag = randomUUID().slice(0, 8);
      const person = async (n: string) =>
        (await store.users.create({ email: `pre-roll-${n}-${tag}@studio.ps`, displayName: n, passwordHash: 'x', locale: 'en', personal: { name: 'Personal', slug: `personal-${n}-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at })).user;
      const creator = await person('creator');
      const planted = await person('planted');
      const partner = await person('partner');
      const created = await store.organizations.createOwned(creator.id, { name: 'Studio', slug: `pre-roll-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at }, 6, { actorId: creator.id, requestId: null });
      if (created.kind !== 'created') throw new Error('cap');
      const id = created.organization.id;
      // What a pre-MUT-182 path could have left: a plain row with the default role.
      await db.membership.create({ data: { userId: planted.id, organizationId: id, createdAt: at } });
      // What MUT-373's operator path writes: the membership and, in the same transaction, its audit row.
      await store.memberships.grantOwner(partner.id, id, at, 3, granted(id, partner.id));
      // A firm's other roles own nothing, so they are never stray (review: role filter).
      const bookkeeper = await person('bookkeeper');
      await db.membership.create({ data: { userId: bookkeeper.id, organizationId: id, role: 'BOOKKEEPER', createdAt: at } });

      const stray = (await findStrayOwnedMemberships(db)).filter((s) => s.organizationId === id);
      expect(stray).toEqual([{ organizationId: id, userId: planted.id }]);
      // The creator is never stray, and the built-in personal profile (personalOwnerUserId, the COALESCE) is checked too.
      expect(stray.map((s) => s.userId)).not.toContain(creator.id);
    });

    it('flags a stray on a built-in personal profile, and clears a flagged row once the operator confirms it', async () => {
      const at = new Date('2026-10-21T08:00:00Z');
      const tag = randomUUID().slice(0, 8);
      const person = async (n: string) =>
        await store.users.create({ email: `pre-roll2-${n}-${tag}@studio.ps`, displayName: n, passwordHash: 'x', locale: 'en', personal: { name: 'Personal', slug: `personal2-${n}-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at });
      const { user: owner, personalOrganization } = await person('owner');
      const { user: stranger } = await person('stranger');
      await db.membership.create({ data: { userId: stranger.id, organizationId: personalOrganization.id, createdAt: at } });
      expect((await findStrayOwnedMemberships(db)).filter((s) => s.organizationId === personalOrganization.id)).toEqual([{ organizationId: personalOrganization.id, userId: stranger.id }]);

      // The remedy pre-roll prints: confirm it with grant:user --role owner. On a planted OWNER row this answers
      // created:false — and must still leave the audit row pre-roll looks for (adversarial review 1).
      const created = await store.organizations.createOwned(owner.id, { name: 'Studio', slug: `pre-roll2-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at }, 6, { actorId: owner.id, requestId: null });
      if (created.kind !== 'created') throw new Error('cap');
      const id = created.organization.id;
      await db.membership.create({ data: { userId: stranger.id, organizationId: id, createdAt: at } });
      expect((await findStrayOwnedMemberships(db)).filter((s) => s.organizationId === id)).toHaveLength(1);
      expect(await store.memberships.grantOwner(stranger.id, id, at, 3, granted(id, stranger.id))).toMatchObject({ kind: 'granted', created: false });
      expect((await findStrayOwnedMemberships(db)).filter((s) => s.organizationId === id)).toEqual([]);
    });
  });
}
