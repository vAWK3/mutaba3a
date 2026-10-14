import { describe, expect, it } from 'vitest';
import type { CreateUserInput, ExpenseCategoryInput, LedgerStore } from '../ports.js';

/**
 * MUT-182 storage contract: profiles a user owns. The MUT-120 personal
 * profile is owned and PERSONAL from the moment the user exists; any other
 * owned profile comes from `createOwned`, which counts the user's owned
 * profiles and refuses past the cap inside the same transaction.
 * `updateOwned` is the one versioned write behind PATCH /v1/profiles/{id}
 * (eng review D4): name, currency and type in one transaction, the type
 * change replacing the profile's expense categories.
 */
export function describeLedgerStoreProfilesContract(name: string, makeStore: () => Promise<LedgerStore>, options: { concurrent: boolean } = { concurrent: false }): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 9, minute, 0));
  const CAP = 6;
  const owned = (label = 'Studio') => ({ name: label, slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', at: at(1) });
  const userInput = (organizationId?: string): CreateUserInput => ({
    email: `owner-${unique()}@studio.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    ...(organizationId ? { organizationId } : {}),
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const preset = (labels: string[]): ExpenseCategoryInput[] => labels.map((n) => ({ name: n, color: '#123456' }));
  const GENERAL = preset(['Office Rent', 'Software', 'Other']);

  async function owner(store: LedgerStore) {
    return store.users.create(userInput());
  }

  async function createOwned(store: LedgerStore, userId: string, profileType: 'PERSONAL' | 'BUSINESS' = 'BUSINESS') {
    const result = await store.organizations.createOwned(userId, { ...owned(), profileType }, CAP);
    if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
    return result.organization;
  }

  describe(`${name} LedgerStore profiles contract (MUT-182)`, () => {
    it('marks the MUT-120 personal profile as owned and PERSONAL, at version 1 (C2)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await owner(store);
      expect(personalOrganization).toMatchObject({ ownerUserId: user.id, profileType: 'PERSONAL', personalOwnerUserId: user.id, version: 1 });
      expect(await store.organizations.getById(personalOrganization.id)).toMatchObject({ ownerUserId: user.id, profileType: 'PERSONAL' });
    });

    it('leaves operator firms unowned and untyped', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(firm).toMatchObject({ ownerUserId: null, profileType: null, version: 1 });
    });

    it('creates an owned profile and its membership in one call (C1)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const input = { ...owned('Design Studio'), profileType: 'BUSINESS' as const };
      const result = await store.organizations.createOwned(user.id, input, CAP);
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      expect(result.organization).toMatchObject({ name: 'Design Studio', slug: input.slug, ownerUserId: user.id, profileType: 'BUSINESS', personalOwnerUserId: null, version: 1 });
      expect(result.membership).toMatchObject({ userId: user.id, organizationId: result.organization.id });
      expect(await store.memberships.find(user.id, result.organization.id)).not.toBeNull();
      expect(await store.organizations.countOwnedBy(user.id)).toBe(2);
    });

    it('counts the personal profile toward the cap and refuses past it, writing nothing (C3)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      for (let i = 1; i < CAP; i++) await createOwned(store, user.id);
      expect(await store.organizations.countOwnedBy(user.id)).toBe(CAP);
      const refused = await store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP);
      expect(refused).toEqual({ kind: 'limit', count: CAP });
      expect(await store.organizations.countOwnedBy(user.id)).toBe(CAP);
      expect(await store.memberships.listByUser(user.id)).toHaveLength(CAP);
    });

    it('does not count a firm the user was granted', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user } = await store.users.create(userInput(firm.id));
      expect(await store.organizations.countOwnedBy(user.id)).toBe(1);
    });

    if (options.concurrent) {
      it('lets exactly one of two concurrent creates through at cap − 1 (C4)', async () => {
        const store = await makeStore();
        const { user } = await owner(store);
        for (let i = 2; i < CAP; i++) await createOwned(store, user.id);
        const results = await Promise.all([
          store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP),
          store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP),
        ]);
        expect(results.map((r) => r.kind).sort()).toEqual(['created', 'limit']);
        expect(await store.organizations.countOwnedBy(user.id)).toBe(CAP);
      });

      it('never leaves two presets when a type change races the first category seed (C10, D3)', async () => {
        const store = await makeStore();
        const { user } = await owner(store);
        const profile = await createOwned(store, user.id, 'PERSONAL');
        const personalPreset = preset(['Groceries', 'Rent', 'Other']);
        await Promise.all([
          store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2)),
          store.expenseCategories.seed(profile.id, personalPreset, at(2)),
        ]);
        // Seed first: the type change then replaces it. Type change first: the seed finds categories and does nothing.
        // Either way the profile ends with the new preset alone, never a mix.
        const names = (await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name).sort();
        expect(names).toEqual(['Office Rent', 'Other', 'Software']);
      });
    }

    it('updates name and currency under If-Match, once per call (C5)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id);
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Renamed', defaultCurrency: 'USD' }, null, at(2));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Renamed', defaultCurrency: 'USD', version: 2 }, typeChange: null });
      expect(await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Again' }, null, at(3))).toMatchObject({ kind: 'stale', record: { name: 'Renamed', version: 2 } });
    });

    it('answers not_found for someone else’s profile and for an operator firm (C5, C9)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const { user: other } = await owner(store);
      const profile = await createOwned(store, user.id);
      expect(await store.organizations.updateOwned(profile.id, other.id, 1, { name: 'Mine now' }, null, at(2))).toEqual({ kind: 'not_found' });
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(await store.organizations.updateOwned(firm.id, user.id, 1, { name: 'Mine now' }, null, at(2))).toEqual({ kind: 'not_found' });
      expect((await store.organizations.getById(profile.id))?.name).toBe('Studio');
    });

    it('replaces the categories on a type change and uncategorizes every expense, live and deleted (C6, C7)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      await store.expenseCategories.seed(profile.id, preset(['Groceries', 'Rent']), at(1));
      const [groceries] = await store.expenseCategories.list(profile.id, { includeArchived: false });
      const custom = await store.expenseCategories.create(profile.id, { name: 'Kids', color: null }, at(1));
      const archived = await store.expenseCategories.create(profile.id, { name: 'Old', color: null }, at(1));
      await store.expenseCategories.update(profile.id, archived.id, 1, { archived: true }, at(1));
      const expense = (categoryId: string | null) =>
        store.expenses.create({ organizationId: profile.id, occurredOn: '2026-10-10', amountMinor: 1000n, currency: 'ILS', title: null, vendor: null, categoryId, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1));
      const a = await expense(groceries!.id);
      const b = await expense(custom.id);
      const deleted = await expense(custom.id);
      await store.expenses.softDelete(profile.id, deleted.id, at(1));
      const untouched = await expense(null);

      expect(await store.organizations.typeChangeImpact(profile.id)).toEqual({ uncategorizedExpenses: 2, deletedCategories: 4 });
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(5));
      expect(result).toMatchObject({ kind: 'updated', record: { profileType: 'BUSINESS', version: 2 }, typeChange: { uncategorizedExpenses: 2, deletedCategories: 4 } });

      expect((await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name)).toEqual(['Office Rent', 'Software', 'Other']);
      for (const id of [a.id, b.id]) expect(await store.expenses.getById(profile.id, id)).toMatchObject({ categoryId: null, version: 2 });
      expect(await store.expenses.getById(profile.id, untouched.id)).toMatchObject({ categoryId: null, version: 1 });
      expect(await store.organizations.typeChangeImpact(profile.id)).toEqual({ uncategorizedExpenses: 0, deletedCategories: 3 });
    });

    it('keeps the categories when the type does not change, and still bumps the version once (C6)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'BUSINESS');
      await store.expenseCategories.seed(profile.id, GENERAL, at(1));
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Same type', profileType: 'BUSINESS' }, GENERAL, at(2));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Same type', version: 2 }, typeChange: null });
      expect(await store.expenseCategories.list(profile.id, { includeArchived: true })).toHaveLength(GENERAL.length);
    });

    it('applies name and type together, with a single version bump (R16, D4)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Now a business', profileType: 'BUSINESS' }, GENERAL, at(2));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Now a business', profileType: 'BUSINESS', version: 2 } });
    });

    it('changes nothing when the version is stale, the type change included (C8)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      await store.expenseCategories.seed(profile.id, preset(['Groceries']), at(1));
      expect(await store.organizations.updateOwned(profile.id, user.id, 7, { profileType: 'BUSINESS' }, GENERAL, at(2))).toMatchObject({ kind: 'stale' });
      expect((await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name)).toEqual(['Groceries']);
      expect(await store.organizations.getById(profile.id)).toMatchObject({ profileType: 'PERSONAL', version: 1 });
    });

    it('refuses to make the built-in personal profile BUSINESS (D2)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await owner(store);
      await expect(store.organizations.updateOwned(personalOrganization.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2))).rejects.toThrow();
      expect(await store.organizations.getById(personalOrganization.id)).toMatchObject({ profileType: 'PERSONAL', version: 1 });
    });

    it('rejects an expense whose category does not exist (R17: the store’s foreign key)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await owner(store);
      await expect(
        store.expenses.create({ organizationId: personalOrganization.id, occurredOn: '2026-10-10', amountMinor: 1000n, currency: 'ILS', title: null, vendor: null, categoryId: '00000000-0000-4000-8000-000000000000', customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1)),
      ).rejects.toMatchObject({ constraint: expect.stringContaining('category') });
    });
  });
}
