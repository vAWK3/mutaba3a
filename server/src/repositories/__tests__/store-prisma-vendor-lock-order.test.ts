import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-254 (A8): `vendors.touch` locks the category (KEY SHARE) before the vendor row, the order a profile type change
 * takes (categories FOR UPDATE, then vendors), so the two can never deadlock.
 *
 * Deterministic: a second connection holds the category FOR UPDATE, as `replaceCategories` does. A touch naming that
 * category must queue on it before it touches the vendor, so `FOR UPDATE NOWAIT` on the vendor row still succeeds.
 * Vendor first would already hold the vendor row, and NOWAIT would fail.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma vendor lock order (MUT-254) (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const holder = new PrismaClient({ datasources: { db: { url } } });
  const prober = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await Promise.all([store.disconnect(), holder.$disconnect(), prober.$disconnect()]);
  });

  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 24, 10, 0, 0, ms));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function vendorRowFree(id: string): Promise<boolean> {
    try {
      await prober.$transaction((tx) => tx.$queryRaw`SELECT id FROM vendors WHERE id = ${id}::uuid FOR UPDATE NOWAIT`);
      return true;
    } catch {
      return false;
    }
  }

  describe('Prisma vendor lock order (MUT-254)', () => {
    it('touch waits on the category before it locks the vendor row', async () => {
      const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const travel = await store.expenseCategories.create(org.id, { name: 'Travel', color: null }, at(0));
      const vendor = (await store.vendors.resolve({ organizationId: org.id, name: 'Yellow Cab' }, at(1)))!;

      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const held = holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM expense_categories WHERE id = ${travel.id}::uuid FOR UPDATE`;
        locked();
        await released;
      }, { timeout: 30_000 });
      await isLocked;

      const touch = store.vendors.touch(org.id, vendor.id, { categoryId: travel.id }, at(2));
      await sleep(300);
      try {
        expect(await vendorRowFree(vendor.id)).toBe(true);
      } finally {
        release();
        await held;
      }
      await touch;
      expect(await store.vendors.getById(org.id, vendor.id)).toMatchObject({ lastCategoryId: travel.id, lastUsedAt: at(2) });
    }, 60_000);
  });
}
