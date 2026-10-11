import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation, UniqueViolation } from '../memory.js';
import type { CreateUserInput, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-37 storage contract: operator-provisioned users and their memberships
 * (hosted-portal.md §3.1). A user is not organization-scoped; a membership is
 * the access join, access/no-access only. Creating a user always creates its
 * first membership in the same transaction, so a user with no way in is never
 * the result of a half-finished provisioning call.
 */
export function describeLedgerStoreUsersContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 9, minute, 0));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const input = (organizationId: string, overrides: Partial<CreateUserInput> = {}): CreateUserInput => ({
    email: `partner-${unique()}@firm.ps`,
    displayName: 'Nour Haddad',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'ar',
    organizationId,
    at: at(0),
    ...overrides,
  });

  describe(`${name} LedgerStore users contract (MUT-37)`, () => {
    it('creates a user together with its first membership', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user, membership } = await store.users.create(input(o.id));
      expect(user).toMatchObject({ status: 'ACTIVE', locale: 'ar', displayName: 'Nour Haddad', failedSignIns: 0, lockedUntil: null, lastSignInAt: null });
      expect(user.id).toMatch(/[0-9a-f-]{36}/);
      expect(user.passwordChangedAt.toISOString()).toBe(at(0).toISOString());
      expect(user.createdAt.toISOString()).toBe(at(0).toISOString());
      expect(membership).toMatchObject({ userId: user.id, organizationId: o.id });
      expect(membership.createdAt.toISOString()).toBe(at(0).toISOString());
      expect(await store.memberships.listByUser(user.id)).toHaveLength(1);
    });

    it('refuses a second user with the same email', async () => {
      const store = await makeStore();
      const o = await org(store);
      const first = input(o.id);
      await store.users.create(first);
      await expect(store.users.create(input(o.id, { email: first.email }))).rejects.toBeInstanceOf(UniqueViolation);
    });

    it('refuses an unknown organization and leaves no user behind', async () => {
      const store = await makeStore();
      const orphan = input('00000000-0000-4000-8000-000000000000');
      await expect(store.users.create(orphan)).rejects.toBeInstanceOf(ForeignKeyViolation);
      expect(await store.users.findByEmail(orphan.email)).toBeNull();
    });

    it('reads by id and by email; unknown ones are null', async () => {
      const store = await makeStore();
      const o = await org(store);
      const created = input(o.id);
      const { user } = await store.users.create(created);
      expect(await store.users.getById(user.id)).toMatchObject({ id: user.id, email: created.email });
      expect(await store.users.findByEmail(created.email)).toMatchObject({ id: user.id });
      expect(await store.users.getById('00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(await store.users.findByEmail(`nobody-${unique()}@firm.ps`)).toBeNull();
    });

    it('setPassword replaces the hash, stamps passwordChangedAt and clears the lockout counters', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      const updated = await store.users.setPassword(user.id, '$argon2id$v=19$m=19456,t=2,p=1$bmV3$bmV3', at(5));
      expect(updated).toMatchObject({ passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$bmV3$bmV3', failedSignIns: 0, lockedUntil: null });
      expect(updated?.passwordChangedAt.toISOString()).toBe(at(5).toISOString());
      expect(await store.users.setPassword('00000000-0000-4000-8000-000000000000', 'x', at(5))).toBeNull();
    });

    it('setStatus toggles ACTIVE and DISABLED', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      expect((await store.users.setStatus(user.id, 'DISABLED', at(1)))?.status).toBe('DISABLED');
      expect((await store.users.getById(user.id))?.status).toBe('DISABLED');
      expect((await store.users.setStatus(user.id, 'ACTIVE', at(2)))?.status).toBe('ACTIVE');
      expect(await store.users.setStatus('00000000-0000-4000-8000-000000000000', 'DISABLED', at(1))).toBeNull();
    });

    it('grants idempotently, keeping the original createdAt', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const { user } = await store.users.create(input(a.id));
      const first = await store.memberships.grant(user.id, b.id, at(3));
      expect(first.created).toBe(true);
      expect(first.membership.createdAt.toISOString()).toBe(at(3).toISOString());
      const again = await store.memberships.grant(user.id, b.id, at(4));
      expect(again.created).toBe(false);
      expect(again.membership.createdAt.toISOString()).toBe(at(3).toISOString());
      expect((await store.memberships.listByUser(user.id)).map((m) => m.organizationId).sort()).toEqual([a.id, b.id].sort());
    });

    it('refuses a grant for an unknown user or organization', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      const nobody = '00000000-0000-4000-8000-000000000000';
      await expect(store.memberships.grant(nobody, o.id, at(1))).rejects.toBeInstanceOf(ForeignKeyViolation);
      await expect(store.memberships.grant(user.id, nobody, at(1))).rejects.toBeInstanceOf(ForeignKeyViolation);
    });

    it('revokes once, finds, and keeps organizations isolated', async () => {
      const store = await makeStore();
      const a = await org(store, 'A');
      const b = await org(store, 'B');
      const { user } = await store.users.create(input(a.id));
      const { user: other } = await store.users.create(input(b.id));
      await store.memberships.grant(user.id, b.id, at(1));

      expect(await store.memberships.find(user.id, b.id)).toMatchObject({ userId: user.id, organizationId: b.id });
      expect((await store.memberships.listByOrganization(a.id)).map((m) => m.userId)).toEqual([user.id]);
      expect((await store.memberships.listByOrganization(b.id)).map((m) => m.userId).sort()).toEqual([user.id, other.id].sort());

      expect(await store.memberships.revoke(user.id, b.id)).toBe(true);
      expect(await store.memberships.revoke(user.id, b.id)).toBe(false);
      expect(await store.memberships.find(user.id, b.id)).toBeNull();
      expect((await store.memberships.listByOrganization(b.id)).map((m) => m.userId)).toEqual([other.id]);
      expect((await store.memberships.listByUser(user.id)).map((m) => m.organizationId)).toEqual([a.id]);
    });
  });
}
