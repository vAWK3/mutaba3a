import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../../repositories/prisma.js';
import { backfillVendors } from '../backfill-vendors.js';

/**
 * MUT-254 (A9/A10): the post-roll vendor backfill. Other test files share the database and run alongside, so every
 * assertion reads this test's own rows rather than the run's global counts.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('backfill-vendors (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  const t = (minute: number) => new Date(Date.UTC(2026, 9, 1, 8, minute));

  async function world() {
    const tag = randomUUID().slice(0, 8);
    const org = await store.organizations.create({ name: 'Firm', slug: `vendors-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const other = await store.organizations.create({ name: 'Other firm', slug: `vendors-o-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await store.users.create({ email: `vendors-${tag}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: org.id, personal: { name: 'Personal', slug: `personal-${tag}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: t(0) });
    const food = await store.expenseCategories.create(org.id, { name: 'Food', color: null }, t(0));
    const otherCategory = await store.expenseCategories.create(org.id, { name: 'Other', color: null }, t(0));
    // What the old revision wrote: vendor text, no link.
    const expense = (organizationId: string, vendor: string | null, categoryId: string | null, minute: number) =>
      store.expenses.create({ organizationId, occurredOn: '2026-10-01', amountMinor: 1_000n, currency: 'ILS', title: null, vendor, categoryId, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: user.id }, t(minute));
    const first = await expense(org.id, 'Cafe Nour', food.id, 1);
    const second = await expense(org.id, 'cafe  nour', otherCategory.id, 2);
    const blank = await expense(org.id, '...', null, 3);
    const elsewhere = await expense(other.id, 'Cafe Nour', null, 4);
    return { org, other, first, second, blank, elsewhere, food };
  }

  const reread = (id: string) => db.expense.findUniqueOrThrow({ where: { id } });

  describe('backfillVendors', () => {
    it('--dry reports and writes nothing', async () => {
      const w = await world();
      const r = await backfillVendors(db, { dry: true });
      expect(r.linked).toBeGreaterThanOrEqual(3);
      expect((await reread(w.first.id)).vendorId).toBeNull();
      expect(await db.vendor.count({ where: { organizationId: w.org.id } })).toBe(0);
    });

    it('links oldest first, one vendor per name per profile, catches up last-used and sets a default that is never Other; a second run changes nothing', async () => {
      const w = await world();
      await backfillVendors(db);

      const [first, second, blank, elsewhere] = await Promise.all([reread(w.first.id), reread(w.second.id), reread(w.blank.id), reread(w.elsewhere.id)]);
      expect(first.vendorId).toEqual(expect.any(String));
      expect(second.vendorId).toBe(first.vendorId);
      expect(blank.vendorId).toBeNull();
      expect(elsewhere.vendorId).not.toBe(first.vendorId);
      // A link is housekeeping: no version bump, so no client's If-Match goes stale.
      expect(first).toMatchObject({ version: 1, updatedAt: t(1) });
      const vendor = await db.vendor.findUniqueOrThrow({ where: { id: first.vendorId! } });
      expect(vendor).toMatchObject({ canonicalName: 'Cafe Nour', lastUsedAt: t(2), lastCategoryId: w.food.id, createdAt: t(1) });

      const before = await db.vendor.findMany({ where: { organizationId: { in: [w.org.id, w.other.id] } }, orderBy: { id: 'asc' } });
      await backfillVendors(db);
      expect(await db.vendor.findMany({ where: { organizationId: { in: [w.org.id, w.other.id] } }, orderBy: { id: 'asc' } })).toEqual(before);
      expect((await reread(w.second.id)).vendorId).toBe(first.vendorId);
    });

    it('re-links a row whose text the old revision changed, and unlinks one it blanked', async () => {
      const w = await world();
      await backfillVendors(db);
      const linked = (await reread(w.first.id)).vendorId;
      await db.expense.update({ where: { id: w.first.id }, data: { vendor: 'Bakery Salam' } });
      await db.expense.update({ where: { id: w.second.id }, data: { vendor: '  ' } });

      await backfillVendors(db);

      const moved = await reread(w.first.id);
      expect(moved.vendorId).not.toBe(linked);
      expect((await db.vendor.findUniqueOrThrow({ where: { id: moved.vendorId! } })).canonicalName).toBe('Bakery Salam');
      expect((await reread(w.second.id)).vendorId).toBeNull();
    });

    it('unlinks a row whose vendor the old revision cleared', async () => {
      const w = await world();
      await backfillVendors(db);
      await db.expense.update({ where: { id: w.first.id }, data: { vendor: null } });

      await backfillVendors(db);

      expect((await reread(w.first.id)).vendorId).toBeNull();
    });

    it('keeps a link made by registration number where another vendor holds the typed name (A5)', async () => {
      const w = await world();
      await backfillVendors(db);
      const nour = (await reread(w.first.id)).vendorId!;
      const registered = (await store.vendors.resolve({ organizationId: w.org.id, name: 'Nour Trading', registrationNo: '516667276' }, t(5)))!;
      // A receipt filed as "Cafe Nour" with Nour Trading's number: linked to Nour Trading, the name stays Cafe Nour's.
      const viaNumber = await store.vendors.resolve({ organizationId: w.org.id, name: 'Cafe Nour', registrationNo: '516667276' }, t(6));
      expect(viaNumber!.id).toBe(registered.id);
      await db.expense.update({ where: { id: w.second.id }, data: { vendorId: registered.id } });

      await backfillVendors(db);

      expect((await reread(w.second.id)).vendorId).toBe(registered.id);
      expect((await reread(w.first.id)).vendorId).toBe(nour);
    });

    it('relinkSince leaves linked rows not updated since then alone, and still links unlinked ones', async () => {
      const w = await world();
      await backfillVendors(db);
      const linked = (await reread(w.first.id)).vendorId;
      await db.expense.update({ where: { id: w.first.id }, data: { vendor: 'Bakery Salam', updatedAt: t(1) } });
      const fresh = await store.expenses.create({ organizationId: w.org.id, occurredOn: '2026-10-01', amountMinor: 500n, currency: 'ILS', title: null, vendor: 'Kiosk Amal', categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: w.first.createdByUserId! }, t(9));

      await backfillVendors(db, { relinkSince: t(5) });

      expect((await reread(w.first.id)).vendorId).toBe(linked);
      expect((await reread(fresh.id)).vendorId).toEqual(expect.any(String));
    });
  });
}
