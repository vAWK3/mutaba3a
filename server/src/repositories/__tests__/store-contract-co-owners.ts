import { describe, expect, it } from 'vitest';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-373 storage contract: co-owners (ADR-163). `memberships.grantOwner` adds an OWNER member to an owned BUSINESS
 * profile under the organization's row lock; `removeOwner` ends one, audited in the same transaction;
 * `listOwnersOf` reads every owner of many profiles at once; `organizations.updateOwned` lets a co-owner write but
 * never an OWNER-role member of a firm (outside voice OV2), and refuses to retype a shared profile PERSONAL (OV3).
 */
export function describeLedgerStoreCoOwnersContract(name: string, makeStore: () => Promise<LedgerStore>, options: { concurrent: boolean } = { concurrent: false }): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 21, 9, minute, 0));
  const MAX = 3;
  const userInput = (displayName: string, organizationId?: string): CreateUserInput => ({
    email: `owner-${unique()}@studio.ps`,
    displayName,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    ...(organizationId ? { organizationId } : {}),
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const granted = (userId: string, organizationId: string): AuditEventInput => ({ organizationId, actorType: 'ADMIN', actorId: null, action: 'membership.granted', entityType: 'user', entityId: userId, metadata: { role: 'OWNER' }, requestId: 'req-grant' });
  const grantedRows = async (store: LedgerStore, organizationId: string, userId: string) =>
    (await store.audit.listByOrganization(organizationId, 100)).filter((e) => e.action === 'membership.granted' && e.entityId === userId);
  const upd = (actorId: string) => ({ actorId, requestId: 'req-mut373', fields: ['name'], preset: null });

  async function sharedProfile(store: LedgerStore) {
    const creator = (await store.users.create(userInput('Basel Sader'))).user;
    const partner = (await store.users.create(userInput('Lina Haddad'))).user;
    const created = await store.organizations.createOwned(creator.id, { name: 'S&H', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: at(1) }, 6, {
      actorId: creator.id,
      requestId: null,
    });
    if (created.kind !== 'created') throw new Error('cap');
    return { store, creator, partner, profile: created.organization };
  }

  describe(`${name} LedgerStore co-owners contract (MUT-373)`, () => {
    it('grants an OWNER membership on an owned Business profile, idempotently', async () => {
      const { store, partner, profile } = await sharedProfile(await makeStore());
      const first = await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      expect(first).toMatchObject({ kind: 'granted', created: true, membership: { userId: partner.id, organizationId: profile.id, role: 'OWNER' } });
      expect(await store.memberships.grantOwner(partner.id, profile.id, at(3), MAX, granted(partner.id, profile.id))).toMatchObject({ kind: 'granted', created: false });
    });

    it('refuses the built-in personal profile, an owned Personal one and an operator firm', async () => {
      const store = await makeStore();
      const { user: creator, personalOrganization } = await store.users.create(userInput('Basel Sader'));
      const partner = (await store.users.create(userInput('Lina Haddad'))).user;
      const ownedPersonal = await store.organizations.createOwned(creator.id, { name: 'Home', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'PERSONAL', at: at(1) }, 6, {
        actorId: creator.id,
        requestId: null,
      });
      if (ownedPersonal.kind !== 'created') throw new Error('cap');
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      expect(await store.memberships.grantOwner(partner.id, personalOrganization.id, at(2), MAX, granted(partner.id, personalOrganization.id))).toEqual({ kind: 'personal_profile' });
      expect(await store.memberships.grantOwner(partner.id, ownedPersonal.organization.id, at(2), MAX, granted(partner.id, ownedPersonal.organization.id))).toEqual({ kind: 'not_business' });
      expect(await store.memberships.grantOwner(partner.id, firm.id, at(2), MAX, granted(partner.id, firm.id))).toEqual({ kind: 'not_co_ownable' });
      expect(await store.memberships.find(partner.id, firm.id)).toBeNull();
    });

    it('stops at the owner limit, the creator counted', async () => {
      const { store, partner, profile } = await sharedProfile(await makeStore());
      const third = (await store.users.create(userInput('Omar'))).user;
      const fourth = (await store.users.create(userInput('Sami'))).user;
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      await store.memberships.grantOwner(third.id, profile.id, at(3), MAX, granted(third.id, profile.id));
      expect(await store.memberships.grantOwner(fourth.id, profile.id, at(4), MAX, granted(fourth.id, profile.id))).toEqual({ kind: 'limit', count: 3 });
    });

    if (options.concurrent) {
      it('never passes the owner limit under concurrent grants (row lock)', async () => {
        const { store, profile } = await sharedProfile(await makeStore());
        const people = await Promise.all(['A', 'B', 'C', 'D'].map(async (n) => (await store.users.create(userInput(n))).user));
        const results = await Promise.all(people.map((p, i) => store.memberships.grantOwner(p.id, profile.id, at(5 + i), MAX, granted(p.id, profile.id))));
        expect(results.filter((r) => r.kind === 'granted')).toHaveLength(MAX - 1);
        expect((await store.memberships.listOwnersOf([profile.id])).length).toBe(MAX);
      });
    }

    it('lists every owner of many profiles in one read, oldest membership first', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      const other = await sharedProfile(store);
      const owners = await store.memberships.listOwnersOf([profile.id, other.profile.id]);
      expect(owners.filter((o) => o.organizationId === profile.id).map((o) => [o.userId, o.displayName])).toEqual([
        [creator.id, 'Basel Sader'],
        [partner.id, 'Lina Haddad'],
      ]);
      expect(owners.filter((o) => o.organizationId === other.profile.id).map((o) => o.userId)).toEqual([other.creator.id]);
      expect(await store.memberships.listOwnersOf([])).toEqual([]);
    });

    it('lets a co-owner update the profile, and refuses an OWNER-role member of a firm outright (OV2)', async () => {
      const { store, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      expect(await store.organizations.updateOwned(profile.id, partner.id, 1, { name: 'Renamed' }, null, at(3), upd(partner.id))).toMatchObject({ kind: 'updated', record: { name: 'Renamed', ownerUserId: profile.ownerUserId } });
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const staff = (await store.users.create(userInput('Staff', firm.id))).user;
      expect(await store.memberships.find(staff.id, firm.id)).toMatchObject({ role: 'OWNER' });
      expect(await store.organizations.updateOwned(firm.id, staff.id, 1, { name: 'Mine' }, null, at(4), upd(staff.id))).toEqual({ kind: 'not_found' });
      expect(await store.organizations.getById(firm.id)).toMatchObject({ ownerUserId: null, name: 'Firm' });
    });

    it('refuses to retype a shared profile PERSONAL, and allows it once the co-owner is gone (OV3)', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      const retype = (version: number) => store.organizations.updateOwned(profile.id, creator.id, version, { profileType: 'PERSONAL' }, [], at(3), { ...upd(creator.id), fields: ['type'], preset: { name: 'personal', locale: 'en' } });
      expect(await retype(1)).toEqual({ kind: 'co_owned' });
      await store.memberships.removeOwner({ organizationId: profile.id, userId: partner.id, actorId: creator.id, at: at(4), requestId: null });
      expect(await retype(1)).toMatchObject({ kind: 'updated', record: { profileType: 'PERSONAL' } });
    });

    it('removes a co-owner, keeps the creator, and audits who did it', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      const input = (actor: string, target: string) => ({ organizationId: profile.id, userId: target, actorId: actor, at: at(3), requestId: 'req-remove' });
      expect(await store.memberships.removeOwner(input(creator.id, creator.id))).toEqual({ kind: 'creator_cannot_leave' });
      expect(await store.memberships.removeOwner(input(partner.id, creator.id))).toEqual({ kind: 'not_creator' });
      expect(await store.memberships.removeOwner(input(creator.id, partner.id))).toEqual({ kind: 'removed', reason: 'removed' });
      expect(await store.memberships.find(partner.id, profile.id)).toBeNull();
      expect(await store.memberships.find(creator.id, profile.id)).not.toBeNull();
      const rows = (await store.audit.listByOrganization(profile.id, 50)).filter((e) => e.action === 'membership.revoked');
      expect(rows).toEqual([expect.objectContaining({ actorType: 'USER', actorId: creator.id, entityId: partner.id, metadata: { reason: 'removed', role: 'OWNER' } })]);
      expect(await store.memberships.removeOwner(input(creator.id, partner.id))).toEqual({ kind: 'not_found' });
    });

    it('keeps every owner OWNER when firm features are enabled', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      expect(await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: [] }, at(3), { actorId: null, requestId: null })).toMatchObject({ kind: 'updated', changed: true });
      expect((await store.memberships.find(creator.id, profile.id))!.role).toBe('OWNER');
      expect((await store.memberships.find(partner.id, profile.id))!.role).toBe('OWNER');
    });

    it('commits the grant audit with the membership, and on a confirm only when none exists (adversarial review 1)', async () => {
      const { store, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      await store.memberships.grantOwner(partner.id, profile.id, at(3), MAX, granted(partner.id, profile.id));
      expect(await grantedRows(store, profile.id, partner.id)).toEqual([expect.objectContaining({ actorType: 'ADMIN', metadata: { role: 'OWNER' } })]);
      // A membership that predates the co-owner path (no audit row): confirming it records the grant once.
      const planted = (await store.users.create(userInput('Planted'))).user;
      await store.memberships.grant(planted.id, profile.id, at(4));
      expect(await store.memberships.grantOwner(planted.id, profile.id, at(5), MAX, granted(planted.id, profile.id))).toMatchObject({ kind: 'granted', created: false });
      await store.memberships.grantOwner(planted.id, profile.id, at(6), MAX, granted(planted.id, profile.id));
      expect(await grantedRows(store, profile.id, planted.id)).toHaveLength(1);
    });

    it('writes nothing for a refused grant', async () => {
      const store = await makeStore();
      const { personalOrganization } = await store.users.create(userInput('Basel Sader'));
      const partner = (await store.users.create(userInput('Lina Haddad'))).user;
      expect(await store.memberships.grantOwner(partner.id, personalOrganization.id, at(2), MAX, granted(partner.id, personalOrganization.id))).toEqual({ kind: 'personal_profile' });
      expect(await grantedRows(store, personalOrganization.id, partner.id)).toEqual([]);
    });

    it('never removes firm staff, and staff can neither leave as an owner nor be removed as one', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: [] }, at(3), { actorId: null, requestId: null });
      const bookkeeper = (await store.users.create(userInput('Rami'))).user;
      expect((await store.memberships.grant(bookkeeper.id, profile.id, at(4))).membership.role).toBe('BOOKKEEPER');
      const remove = (actorId: string) => store.memberships.removeOwner({ organizationId: profile.id, userId: bookkeeper.id, actorId, at: at(5), requestId: null });
      expect(await remove(bookkeeper.id)).toEqual({ kind: 'not_owner' });
      expect(await remove(creator.id)).toEqual({ kind: 'not_found' });
      expect(await remove(partner.id)).toEqual({ kind: 'not_found' });
      expect(await store.memberships.find(bookkeeper.id, profile.id)).toMatchObject({ role: 'BOOKKEEPER' });
      expect((await store.audit.listByOrganization(profile.id, 100)).filter((e) => e.action === 'membership.revoked')).toEqual([]);
    });

    it('keeps staff BOOKKEEPER and owners OWNER when firm features are turned off again', async () => {
      const { store, creator, partner, profile } = await sharedProfile(await makeStore());
      await store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id));
      await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: [] }, at(3), { actorId: null, requestId: null });
      const bookkeeper = (await store.users.create(userInput('Rami'))).user;
      await store.memberships.grant(bookkeeper.id, profile.id, at(4));
      await store.organizations.setFirm(profile.id, { enabled: false }, at(5), { actorId: null, requestId: null });
      expect((await store.memberships.find(creator.id, profile.id))!.role).toBe('OWNER');
      expect((await store.memberships.find(partner.id, profile.id))!.role).toBe('OWNER');
      // With firm features off a new membership would default to OWNER, which ownsProfile reads: staff must not become owners.
      expect((await store.memberships.find(bookkeeper.id, profile.id))!.role).toBe('BOOKKEEPER');
      const version = (await store.organizations.getById(profile.id))!.version;
      expect(await store.organizations.updateOwned(profile.id, bookkeeper.id, version, { name: 'Mine' }, null, at(6), upd(bookkeeper.id))).toEqual({ kind: 'not_found' });
      expect(await store.organizations.updateOwned(profile.id, partner.id, version, { name: 'Still ours' }, null, at(6), upd(partner.id))).toMatchObject({ kind: 'updated' });
    });

    if (options.concurrent) {
      it('serializes a retype to Personal against a grant: never Personal with two owners (OV3)', async () => {
        const { store, creator, partner, profile } = await sharedProfile(await makeStore());
        const [grant, retype] = await Promise.all([
          store.memberships.grantOwner(partner.id, profile.id, at(2), MAX, granted(partner.id, profile.id)),
          store.organizations.updateOwned(profile.id, creator.id, 1, { profileType: 'PERSONAL' }, [], at(2), { ...upd(creator.id), fields: ['type'], preset: { name: 'personal', locale: 'en' } }),
        ]);
        expect(grant.kind === 'granted' && retype.kind === 'updated').toBe(false);
        const after = (await store.organizations.getById(profile.id))!;
        const owners = await store.memberships.listOwnersOf([profile.id]);
        expect(after.profileType === 'PERSONAL' && owners.length > 1).toBe(false);
      });
    }

    it('refuses an OWNER grant to a member who holds another role (eng review D7)', async () => {
      const { store, partner, profile } = await sharedProfile(await makeStore());
      await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: [] }, at(2), { actorId: null, requestId: null });
      // MUT-300: a plain grant into a firm lands as BOOKKEEPER (the only way to plant one before MUT-306).
      const { membership } = await store.memberships.grant(partner.id, profile.id, at(3));
      expect(membership.role).toBe('BOOKKEEPER');
      expect(await store.memberships.grantOwner(partner.id, profile.id, at(4), MAX, granted(partner.id, profile.id))).toEqual({ kind: 'role_conflict', role: 'BOOKKEEPER' });
      expect(await grantedRows(store, profile.id, partner.id)).toEqual([]);
    });
  });
}
