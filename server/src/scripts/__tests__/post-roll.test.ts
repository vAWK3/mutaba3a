import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../../repositories/prisma.js';
import { backfillPersonalProfiles, repairCaptureOrigins } from '../post-roll.js';

/**
 * deploy.sh step 6 (MUT-61): the migration backfills `origin` before the new
 * revision serves, so a payment a person captured through the old revision in
 * between — or after a rollback — keeps the default INTEGRATION. The repair
 * must mark exactly those CAPTURE, touch nothing else, and be repeatable.
 *
 * MUT-120 shipped with no backfill (ADR-037 amendment), so a user provisioned
 * before it — or by the old revision during a roll — has no personal profile.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('post-roll repairs (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  describe('repairCaptureOrigins', () => {
    it('re-marks a person’s payment left INTEGRATION, leaves the integration’s own and existing captures alone, and reports 0 the second time', async () => {
      const at = new Date('2026-10-12T08:00:00Z');
      const tag = randomUUID().slice(0, 8);
      const org = await store.organizations.create({ name: 'Firm', slug: `post-roll-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user } = await store.users.create({ email: `post-roll-${tag}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: org.id, personal: { name: 'Personal', slug: `personal-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at });
      const base = { organizationId: org.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 1000n, receivedOn: '2026-10-10', method: 'CASH' as const, reference: null, notes: null, replacesPaymentId: null, requestId: null, captureSource: null, allocations: [] };
      // What the old revision wrote during the window: a person's payment with the column default.
      const stranded = (await store.payments.create({ ...base, createdByUserId: user.id, origin: 'INTEGRATION' }, at)).payment;
      const integration = (await store.payments.create({ ...base, createdByUserId: null, origin: 'INTEGRATION' }, at)).payment;
      const capture = await store.payments.capture({ ...base, createdByUserId: user.id, captureSource: 'app' }, at);

      expect(await repairCaptureOrigins(db)).toBeGreaterThanOrEqual(1);
      expect(await store.payments.getById(org.id, stranded.id)).toMatchObject({ origin: 'CAPTURE' });
      expect(await store.payments.getById(org.id, integration.id)).toMatchObject({ origin: 'INTEGRATION' });
      expect(await store.payments.getById(org.id, capture.id)).toMatchObject({ origin: 'CAPTURE', captureSource: 'app' });
      expect(await repairCaptureOrigins(db)).toBe(0);
    });
  });

  describe('backfillPersonalProfiles', () => {
    const at = new Date('2026-10-13T08:00:00Z');

    /** What a pre-MUT-120 revision wrote: a user and a firm membership, no personal profile. */
    async function legacyUser(tag: string, locale: 'en' | 'ar', firmId: string | null) {
      const user = await db.user.create({
        data: { email: `legacy-${tag}@firm.ps`, displayName: 'Legacy', passwordHash: 'x', locale, passwordChangedAt: at, createdAt: at, updatedAt: at },
      });
      if (firmId) await db.membership.create({ data: { userId: user.id, organizationId: firmId, createdAt: at } });
      return user;
    }

    it('gives a legacy user a personal profile in their language with the firm’s currency and timezone, audited, and does nothing the second time', async () => {
      const tag = randomUUID().slice(0, 8);
      const firm = await store.organizations.create({ name: 'Firm', slug: `backfill-${tag}`, defaultCurrency: 'USD', timezone: 'Asia/Gaza' });
      const user = await legacyUser(tag, 'ar', firm.id);

      const first = await backfillPersonalProfiles(db, at);
      const created = first.created.find((c) => c.userId === user.id);
      expect(created).toBeDefined();
      const personal = await db.organization.findUniqueOrThrow({ where: { personalOwnerUserId: user.id } });
      // MUT-182: owned by the user and PERSONAL, as every MUT-120 profile must be.
      expect(personal).toMatchObject({ id: created?.organizationId, name: 'شخصي', defaultCurrency: 'USD', timezone: 'Asia/Gaza', ownerUserId: user.id, profileType: 'PERSONAL' });
      expect(personal.slug).toMatch(/^personal-/);
      expect(await db.membership.findMany({ where: { userId: user.id }, orderBy: { organizationId: 'asc' } })).toHaveLength(2);
      expect(await db.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: personal.id } } })).not.toBeNull();
      const audit = await db.auditEvent.findMany({ where: { organizationId: personal.id }, orderBy: { action: 'asc' } });
      expect(audit.map((e) => [e.action, e.actorType])).toEqual([
        ['membership.granted', 'SYSTEM'],
        ['organization.created', 'SYSTEM'],
      ]);
      expect(audit.find((e) => e.action === 'organization.created')?.metadata).toEqual({ personal: true, ownerUserId: user.id, backfill: 'post-roll' });

      const second = await backfillPersonalProfiles(db, at);
      expect(second.created.map((c) => c.userId)).not.toContain(user.id);
      expect(await db.organization.count({ where: { personalOwnerUserId: user.id } })).toBe(1);
    });

    it('leaves a user created with a personal profile alone', async () => {
      const tag = randomUUID().slice(0, 8);
      const { user, personalOrganization } = await store.users.create({ email: `current-${tag}@me.ps`, displayName: 'Solo', passwordHash: 'x', locale: 'en', personal: { name: 'Personal', slug: `personal-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at });

      const result = await backfillPersonalProfiles(db, at);
      expect([...result.created.map((c) => c.userId), ...result.skipped.map((s) => s.userId)]).not.toContain(user.id);
      expect(await db.organization.findUniqueOrThrow({ where: { personalOwnerUserId: user.id } })).toMatchObject({ id: personalOrganization.id });
    });

    it('takes settings only from an operator firm, never from a profile the user owns (MUT-182)', async () => {
      const tag = randomUUID().slice(0, 8);
      const user = await legacyUser(tag, 'en', null);
      // A legacy user can't really own one without a personal profile, but the selector must not care how it got there.
      const ownedProfile = await db.organization.create({ data: { name: 'Studio', slug: `owned-${tag}`, defaultCurrency: 'EUR', timezone: 'Europe/Berlin', ownerUserId: user.id, profileType: 'BUSINESS' } });
      await db.membership.create({ data: { userId: user.id, organizationId: ownedProfile.id, createdAt: new Date(at.getTime() - 60_000) } });
      const firm = await store.organizations.create({ name: 'Firm', slug: `backfill-firm-${tag}`, defaultCurrency: 'USD', timezone: 'Asia/Gaza' });
      await db.membership.create({ data: { userId: user.id, organizationId: firm.id, createdAt: at } });

      await backfillPersonalProfiles(db, at);
      expect(await db.organization.findUniqueOrThrow({ where: { personalOwnerUserId: user.id } })).toMatchObject({ defaultCurrency: 'USD', timezone: 'Asia/Gaza' });
    });

    it('skips and reports a legacy user with no firm to take a currency and timezone from', async () => {
      const tag = randomUUID().slice(0, 8);
      const user = await legacyUser(tag, 'en', null);

      const result = await backfillPersonalProfiles(db, at);
      expect(result.skipped).toContainEqual({ userId: user.id, reason: 'NO_FIRM' });
      expect(await db.organization.count({ where: { personalOwnerUserId: user.id } })).toBe(0);
    });
  });
}
