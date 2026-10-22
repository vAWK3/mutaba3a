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
  const AUDIT = { actorId: '', requestId: 'req-mut182' };
  const by = (userId: string) => ({ ...AUDIT, actorId: userId });
  const upd = (userId: string, fields: string[] = ['name'], presetName: string | null = null) => ({ ...by(userId), fields, preset: presetName ? { name: presetName, locale: 'en' } : null });

  async function owner(store: LedgerStore) {
    return store.users.create(userInput());
  }

  async function createOwned(store: LedgerStore, userId: string, profileType: 'PERSONAL' | 'BUSINESS' = 'BUSINESS') {
    const result = await store.organizations.createOwned(userId, { ...owned(), profileType }, CAP, by(userId));
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
      const result = await store.organizations.createOwned(user.id, input, CAP, by(user.id));
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
      const refused = await store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP, by(user.id));
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
          store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP, by(user.id)),
          store.organizations.createOwned(user.id, { ...owned(), profileType: 'BUSINESS' }, CAP, by(user.id)),
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
          store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['type'], 'general')),
          store.expenseCategories.seed(profile.id, personalPreset, at(2)),
        ]);
        // Seed first: the type change then replaces it. Type change first: the seed finds categories and does nothing.
        // Either way the profile ends with the new preset alone, never a mix.
        const names = (await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name).sort();
        expect(names).toEqual(['Office Rent', 'Other', 'Software']);
      });

      it('never deadlocks a type change against an expense moving between two categories (C12, re-review)', async () => {
        for (let round = 0; round < 5; round++) {
          const store = await makeStore();
          const { user } = await owner(store);
          const profile = await createOwned(store, user.id, 'PERSONAL');
          await store.expenseCategories.seed(profile.id, preset(['Alpha', 'Beta']), at(1));
          const [alpha, beta] = await store.expenseCategories.list(profile.id, { includeArchived: true });
          const e = await store.expenses.create({ organizationId: profile.id, occurredOn: '2026-10-10', amountMinor: 100n, currency: 'ILS', title: null, vendor: null, categoryId: alpha!.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1));
          const [retyped, moved] = await Promise.all([
            store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['type'], 'general')),
            store.expenses.update(profile.id, e.id, 1, { categoryId: beta!.id }, at(2)).catch((err: unknown) => err),
          ]);
          expect(retyped.kind).toBe('updated');
          // The move either landed first (and the type change then cleared it) or found Beta gone (422 at the route) — never a deadlock.
          if (moved instanceof Error) expect(moved.name).toBe('ForeignKeyViolation');
          expect(await store.expenses.getById(profile.id, e.id)).toMatchObject({ categoryId: null });
        }
      });

      it('serializes a custom category create with a type change, so the reseed never clashes on a name (C11, qa-reconcile D5)', async () => {
        const store = await makeStore();
        const { user } = await owner(store);
        const profile = await createOwned(store, user.id, 'PERSONAL');
        await store.expenseCategories.seed(profile.id, preset(['Groceries']), at(1));
        // 'Other' is also in the preset the type change seeds: interleaved between its delete and its insert, it would clash.
        const [retyped] = await Promise.all([
          store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['type'], 'general')),
          store.expenseCategories.create(profile.id, { name: 'Other', color: null }, at(2)).catch((err: unknown) => err),
        ]);
        expect(retyped.kind).toBe('updated');
        expect((await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name).sort()).toEqual(['Office Rent', 'Other', 'Software']);
      });
    }

    it('updates name and currency under If-Match, once per call (C5)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id);
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Renamed', defaultCurrency: 'USD' }, null, at(2), upd(user.id, ['name', 'defaultCurrency'], null));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Renamed', defaultCurrency: 'USD', version: 2 }, typeChange: null });
      expect(await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Again' }, null, at(3), upd(user.id, ['name'], null))).toMatchObject({ kind: 'stale', record: { name: 'Renamed', version: 2 } });
    });

    it('answers not_found for someone else’s profile and for an operator firm (C5, C9)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const { user: other } = await owner(store);
      const profile = await createOwned(store, user.id);
      expect(await store.organizations.updateOwned(profile.id, other.id, 1, { name: 'Mine now' }, null, at(2), upd(other.id, ['name'], null))).toEqual({ kind: 'not_found' });
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(await store.organizations.updateOwned(firm.id, user.id, 1, { name: 'Mine now' }, null, at(2), upd(user.id, ['name'], null))).toEqual({ kind: 'not_found' });
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
      await store.expenses.softDelete(profile.id, deleted.id, at(1), 'unlink');
      const untouched = await expense(null);

      expect(await store.organizations.typeChangeImpact(profile.id)).toEqual({ uncategorizedExpenses: 2, deletedCategories: 4 });
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(5), upd(user.id, ['type'], 'general'));
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
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Same type', profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['name', 'type'], 'general'));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Same type', version: 2 }, typeChange: null });
      expect(await store.expenseCategories.list(profile.id, { includeArchived: true })).toHaveLength(GENERAL.length);
    });

    it('applies name and type together, with a single version bump (R16, D4)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      const result = await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Now a business', profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['name', 'type'], 'general'));
      expect(result).toMatchObject({ kind: 'updated', record: { name: 'Now a business', profileType: 'BUSINESS', version: 2 } });
    });

    it('changes nothing when the version is stale, the type change included (C8)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      await store.expenseCategories.seed(profile.id, preset(['Groceries']), at(1));
      expect(await store.organizations.updateOwned(profile.id, user.id, 7, { profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['type'], 'general'))).toMatchObject({ kind: 'stale' });
      expect((await store.expenseCategories.list(profile.id, { includeArchived: true })).map((c) => c.name)).toEqual(['Groceries']);
      expect(await store.organizations.getById(profile.id)).toMatchObject({ profileType: 'PERSONAL', version: 1 });
    });

    it('refuses to make the built-in personal profile BUSINESS, leaving its categories, expenses and audit untouched (D2)', async () => {
      const store = await makeStore();
      const { user, personalOrganization: p } = await owner(store);
      await store.expenseCategories.seed(p.id, preset(['Groceries']), at(1));
      const [category] = await store.expenseCategories.list(p.id, { includeArchived: true });
      const e = await store.expenses.create({ organizationId: p.id, occurredOn: '2026-10-10', amountMinor: 1000n, currency: 'ILS', title: null, vendor: null, categoryId: category!.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1));
      const auditBefore = (await store.audit.listByOrganization(p.id, 100)).length;
      await expect(store.organizations.updateOwned(p.id, user.id, 1, { profileType: 'BUSINESS' }, GENERAL, at(2), upd(user.id, ['type'], 'general'))).rejects.toThrow();
      expect(await store.organizations.getById(p.id)).toMatchObject({ profileType: 'PERSONAL', version: 1 });
      expect((await store.expenseCategories.list(p.id, { includeArchived: true })).map((c) => c.name)).toEqual(['Groceries']);
      expect(await store.expenses.getById(p.id, e.id)).toMatchObject({ categoryId: category!.id, version: 1 });
      expect(await store.audit.listByOrganization(p.id, 100)).toHaveLength(auditBefore);
    });

    it('writes the create’s audit rows with the profile, as the person (qa-reconcile D3)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id);
      const rows = (await store.audit.listByOrganization(profile.id, 10)).map((e) => [e.action, e.actorType, e.actorId, e.requestId, e.metadata ?? null]).sort();
      expect(rows).toEqual([
        ['membership.granted', 'USER', user.id, 'req-mut182', null],
        ['organization.created', 'USER', user.id, 'req-mut182', { owned: true, profileType: 'BUSINESS' }],
      ]);
    });

    it('records a type change with every removed category and each expense’s lost category (qa-reconcile D3/D4)', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id, 'PERSONAL');
      await store.expenseCategories.seed(profile.id, preset(['Groceries', 'Rent']), at(1));
      const [groceries, rent] = await store.expenseCategories.list(profile.id, { includeArchived: false });
      await store.expenseCategories.update(profile.id, rent!.id, 1, { archived: true }, at(1));
      const e = await store.expenses.create({ organizationId: profile.id, occurredOn: '2026-10-10', amountMinor: 500n, currency: 'ILS', title: null, vendor: null, categoryId: groceries!.id, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1));
      await store.organizations.updateOwned(profile.id, user.id, 1, { name: 'Shop', profileType: 'BUSINESS' }, GENERAL, at(3), upd(user.id, ['name', 'type'], 'general'));
      const events = await store.audit.listByOrganization(profile.id, 20);
      expect(events.find((ev) => ev.action === 'organization.updated')?.metadata).toEqual({ fields: ['name', 'type'] });
      expect(events.find((ev) => ev.action === 'organization.type_changed')).toMatchObject({
        actorType: 'USER',
        actorId: user.id,
        metadata: {
          from: 'PERSONAL',
          to: 'BUSINESS',
          uncategorizedExpenses: 1,
          deletedCategories: 2,
          preset: 'general',
          removedCategories: [
            { id: groceries!.id, name: 'Groceries', color: '#123456', archived: false },
            { id: rent!.id, name: 'Rent', color: '#123456', archived: true },
          ],
          uncategorized: [{ expenseId: e.id, categoryId: groceries!.id }],
        },
      });
      expect(events.find((ev) => ev.action === 'expense_category.seeded')).toMatchObject({ actorType: 'SYSTEM', metadata: { preset: 'general', count: GENERAL.length, locale: 'en' } });
    });

    it('writes no audit row when the update is stale', async () => {
      const store = await makeStore();
      const { user } = await owner(store);
      const profile = await createOwned(store, user.id);
      const before = (await store.audit.listByOrganization(profile.id, 20)).length;
      await store.organizations.updateOwned(profile.id, user.id, 9, { name: 'x' }, null, at(2), upd(user.id));
      expect(await store.audit.listByOrganization(profile.id, 20)).toHaveLength(before);
    });

    it('rejects an expense whose category does not exist (R17: the store’s foreign key)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await owner(store);
      await expect(
        store.expenses.create({ organizationId: personalOrganization.id, occurredOn: '2026-10-10', amountMinor: 1000n, currency: 'ILS', title: null, vendor: null, categoryId: '00000000-0000-4000-8000-000000000000', customerId: null, projectId: null, notes: null, createdByUserId: user.id }, at(1)),
      ).rejects.toMatchObject({ constraint: expect.stringContaining('categoryId') }); // the exact predicate withCategoryForeignKey matches
    });
  });
}
