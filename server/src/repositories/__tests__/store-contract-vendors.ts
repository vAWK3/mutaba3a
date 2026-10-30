import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { LedgerStore, Organization } from '../ports.js';

/** MUT-254 storage contract (ADR-183): vendors saved from typed names, matched exactly on save (V1), fuzzy only in search. */
export function describeLedgerStoreVendorsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 24, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `v-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    return { a, b, user };
  }

  describe(`${name} LedgerStore vendors contract (MUT-254)`, () => {
    it('creates a vendor from a typed name, and the same name however it is written finds it again, in one profile only', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.vendors.resolve({ organizationId: w.a.id, name: '  Super Deal Ltd ' }, at(1));
      expect(created).toMatchObject({ organizationId: w.a.id, canonicalName: 'Super Deal Ltd', registrationNo: null, phone: null, email: null, lastCategoryId: null, lastUsedAt: at(1), version: 1, createdAt: at(1), updatedAt: at(1) });
      expect(created).not.toHaveProperty('registrationKey');

      for (const typed of ['super deal', 'SUPER-DEAL', 'Super Deal, Inc.']) {
        expect((await store.vendors.resolve({ organizationId: w.a.id, name: typed }, at(2)))?.id).toBe(created!.id);
      }
      const other = await store.vendors.resolve({ organizationId: w.b.id, name: 'Super Deal' }, at(3));
      expect(other!.id).not.toBe(created!.id);
      expect(await store.vendors.getById(w.a.id, created!.id)).toEqual(created);
      expect(await store.vendors.getById(w.b.id, created!.id)).toBeNull();
    });

    it('folds Arabic letter forms, so a typed variant is the same vendor', async () => {
      const store = await makeStore();
      const w = await world(store);
      const bakery = await store.vendors.resolve({ organizationId: w.a.id, name: 'مخبز الأقصى' }, at(1));
      expect((await store.vendors.resolve({ organizationId: w.a.id, name: 'مخبز الاقصى' }, at(2)))?.id).toBe(bakery!.id);
    });

    it('resolves nothing for a name that normalises to nothing', async () => {
      const store = await makeStore();
      const w = await world(store);
      expect(await store.vendors.resolve({ organizationId: w.a.id, name: '  ...  ' }, at(1))).toBeNull();
      expect(await store.vendors.search(w.a.id, '', 10)).toEqual([]);
    });

    it('matches the registration number first: another name with the same number is an alias of that vendor', async () => {
      const store = await makeStore();
      const w = await world(store);
      const cab = await store.vendors.resolve({ organizationId: w.a.id, name: 'Yellow Cab', registrationNo: '516667276' }, at(1));
      const viaNumber = await store.vendors.resolve({ organizationId: w.a.id, name: 'Yellow Taxi', registrationNo: '51-666-7276' }, at(2));
      expect(viaNumber!.id).toBe(cab!.id);
      expect(viaNumber!.canonicalName).toBe('Yellow Cab');
      // The alias now finds it on its own, with no number.
      expect((await store.vendors.resolve({ organizationId: w.a.id, name: 'yellow taxi' }, at(3)))?.id).toBe(cab!.id);
      const hits = await store.vendors.search(w.a.id, 'taxi', 10);
      expect(hits.map((h) => [h.vendor.id, h.matchedName])).toEqual([[cab!.id, 'Yellow Taxi']]);
    });

    it('never merges: a number already held by one vendor never moves a name another vendor owns', async () => {
      const store = await makeStore();
      const w = await world(store);
      const cab = await store.vendors.resolve({ organizationId: w.a.id, name: 'Yellow Cab', registrationNo: '516667276' }, at(1));
      const shop = await store.vendors.resolve({ organizationId: w.a.id, name: 'Corner Shop' }, at(2));
      // The number wins; "Corner Shop" stays Corner Shop's name, not an alias of the cab.
      expect((await store.vendors.resolve({ organizationId: w.a.id, name: 'Corner Shop', registrationNo: '516667276' }, at(3)))?.id).toBe(cab!.id);
      expect((await store.vendors.resolve({ organizationId: w.a.id, name: 'Corner Shop' }, at(4)))?.id).toBe(shop!.id);
    });

    it('fills a missing number, phone or email on a name match, and never overwrites one', async () => {
      const store = await makeStore();
      const w = await world(store);
      const v = await store.vendors.resolve({ organizationId: w.a.id, name: 'Corner Shop', phone: '+970 2 555 0100' }, at(1));
      const filled = await store.vendors.resolve({ organizationId: w.a.id, name: 'corner shop', registrationNo: '٥١٦٦٦٧٢٧٦', phone: '+970 9 999 9999', email: 'shop@corner.test' }, at(2));
      expect(filled).toMatchObject({ id: v!.id, registrationNo: '٥١٦٦٦٧٢٧٦', phone: '+970 2 555 0100', email: 'shop@corner.test', version: 1, updatedAt: at(2) });
      const kept = await store.vendors.resolve({ organizationId: w.a.id, name: 'Corner Shop', registrationNo: '99999999', email: 'other@corner.test' }, at(3));
      expect(kept).toMatchObject({ id: v!.id, registrationNo: '٥١٦٦٦٧٢٧٦', email: 'shop@corner.test' });
      // A short "number" is no number.
      const tiny = await store.vendors.resolve({ organizationId: w.a.id, name: 'Kiosk', registrationNo: '1234' }, at(4));
      expect(tiny!.registrationNo).toBeNull();
    });

    it('two first sightings of one name at once make one vendor', async () => {
      const store = await makeStore();
      const w = await world(store);
      const [x, y] = await Promise.all([
        store.vendors.resolve({ organizationId: w.a.id, name: 'Race Cafe' }, at(1)),
        store.vendors.resolve({ organizationId: w.a.id, name: 'race cafe' }, at(1)),
      ]);
      expect(x!.id).toBe(y!.id);
      expect((await store.vendors.search(w.a.id, 'race', 10)).length).toBe(1);
    });

    it('touch stamps lastUsedAt and remembers a category, but never the automatic Other and never another profile’s', async () => {
      const store = await makeStore();
      const w = await world(store);
      const travel = await store.expenseCategories.create(w.a.id, { name: 'Travel', color: null }, at(0));
      const other = await store.expenseCategories.create(w.a.id, { name: 'Other', color: null }, at(0));
      const foreign = await store.expenseCategories.create(w.b.id, { name: 'Food', color: null }, at(0));
      const v = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Yellow Cab' }, at(1)))!;

      await store.vendors.touch(w.a.id, v.id, { categoryId: travel.id }, at(2));
      expect(await store.vendors.getById(w.a.id, v.id)).toMatchObject({ lastCategoryId: travel.id, lastUsedAt: at(2), version: 1 });
      await store.vendors.touch(w.a.id, v.id, { categoryId: other.id }, at(3));
      await store.vendors.touch(w.a.id, v.id, { categoryId: foreign.id }, at(4));
      await store.vendors.touch(w.a.id, v.id, { categoryId: null }, at(5));
      expect(await store.vendors.getById(w.a.id, v.id)).toMatchObject({ lastCategoryId: travel.id, lastUsedAt: at(5), version: 1 });
      // Another profile can't touch it.
      await store.vendors.touch(w.b.id, v.id, { categoryId: null }, at(9));
      expect((await store.vendors.getById(w.a.id, v.id))!.lastUsedAt).toEqual(at(5));
    });

    it('a profile type change drops every vendor’s remembered category with the old categories', async () => {
      const store = await makeStore();
      const { user, personalOrganization: personal } = await store.users.create({ email: `t-${unique()}@firm.ps`, displayName: 'Rana', passwordHash: 'x', locale: 'en', personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
      const created = await store.organizations.createOwned(user.id, { name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'PERSONAL', at: at(0) }, 10, { actorId: user.id, requestId: 'req-mut254' });
      if (created.kind !== 'created') throw new Error(created.kind);
      const profile = created.organization;
      const food = await store.expenseCategories.create(profile.id, { name: 'Food', color: null }, at(0));
      const v = (await store.vendors.resolve({ organizationId: profile.id, name: 'Cafe' }, at(1)))!;
      await store.vendors.touch(profile.id, v.id, { categoryId: food.id }, at(2));

      const result = await store.organizations.updateOwned(profile.id, user.id, profile.version, { profileType: 'BUSINESS' }, [{ name: 'Software', color: null }], at(3), { actorId: user.id, requestId: 'req-mut254', fields: ['type'], preset: { name: 'general', locale: 'en' } });
      expect(result.kind).toBe('updated');
      expect((await store.vendors.getById(profile.id, v.id))!.lastCategoryId).toBeNull();
      expect(personal.id).not.toBe(profile.id);
    });

    it('search ranks a prefix above a contains above a near-miss, one row per vendor, never another profile’s', async () => {
      const store = await makeStore();
      const w = await world(store);
      const deal = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Super Deal' }, at(1)))!;
      const mega = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Mega Super Store' }, at(2)))!;
      const dell = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Supr Dell' }, at(3)))!;
      await store.vendors.resolve({ organizationId: w.b.id, name: 'Super Market' }, at(4));

      const hits = await store.vendors.search(w.a.id, 'super', 10);
      expect(hits.map((h) => h.vendor.id)).toEqual([deal.id, mega.id]);
      expect(hits.map((h) => h.score)).toEqual([1, 0.8]);
      expect(hits.map((h) => h.exact)).toEqual([false, false]);
      // An exact key ranks first and says so, ahead of another vendor it is merely a prefix of.
      const superV = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Super' }, at(5)))!;
      expect((await store.vendors.search(w.a.id, 'SUPER', 10)).map((h) => [h.vendor.id, h.exact])).toEqual([[superV.id, true], [deal.id, false], [mega.id, false]]);
      const fuzzy = await store.vendors.search(w.a.id, 'super dell', 10);
      expect(fuzzy[0]!.vendor.id).toBe(dell.id);
      expect(fuzzy[0]!.score).toBeLessThan(0.8);
      expect(await store.vendors.search(w.a.id, 'zzz', 10)).toEqual([]);
      expect((await store.vendors.search(w.a.id, 'super', 1)).length).toBe(1);
    });

    it('a near-miss is scored only among the 50 most recently used; a contains match always counts', async () => {
      const store = await makeStore();
      const w = await world(store);
      const old = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Carrefour' }, at(1)))!;
      for (let i = 0; i < 50; i += 1) await store.vendors.resolve({ organizationId: w.a.id, name: `Shop ${i}` }, at(10 + i));
      expect((await store.vendors.search(w.a.id, 'carefour', 10)).map((h) => h.vendor.id)).not.toContain(old.id);
      expect((await store.vendors.search(w.a.id, 'arref', 10)).map((h) => h.vendor.id)).toEqual([old.id]);
      await store.vendors.touch(w.a.id, old.id, { categoryId: null }, at(100));
      expect((await store.vendors.search(w.a.id, 'carefour', 10)).map((h) => h.vendor.id)).toContain(old.id);
    });

    it('an empty query lists the most recently used vendors first', async () => {
      const store = await makeStore();
      const w = await world(store);
      const old = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Old Shop' }, at(1)))!;
      const fresh = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Fresh Shop' }, at(2)))!;
      await store.vendors.touch(w.a.id, old.id, { categoryId: null }, at(5));
      expect((await store.vendors.search(w.a.id, '  ', 10)).map((h) => h.vendor.id)).toEqual([old.id, fresh.id]);
    });

    it('an expense keeps its vendor link through an update, and refuses a vendor that does not exist', async () => {
      const store = await makeStore();
      const w = await world(store);
      const here = (await store.vendors.resolve({ organizationId: w.a.id, name: 'Here' }, at(1)))!;
      const there = (await store.vendors.resolve({ organizationId: w.a.id, name: 'There' }, at(1)))!;
      const base = { organizationId: w.a.id, occurredOn: '2026-10-24', amountMinor: 1_000n, currency: 'ILS', title: null, vendor: 'Here', categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: w.user.id };
      const expense = await store.expenses.create({ ...base, vendorId: here.id }, at(2));
      expect(expense.vendorId).toBe(here.id);
      expect((await store.expenses.create(base, at(2))).vendorId).toBeNull();
      const moved = await store.expenses.update(w.a.id, expense.id, expense.version, { vendor: 'There', vendorId: there.id }, at(3));
      expect(moved).toMatchObject({ kind: 'updated', record: { vendor: 'There', vendorId: there.id } });
      const cleared = await store.expenses.update(w.a.id, expense.id, expense.version + 1, { vendor: null, vendorId: null }, at(4));
      expect(cleared).toMatchObject({ kind: 'updated', record: { vendor: null, vendorId: null } });
      await expect(store.expenses.create({ ...base, vendorId: randomUUID() }, at(5))).rejects.toThrow();
    });
  });
}
