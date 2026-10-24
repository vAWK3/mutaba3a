import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation, UniqueViolation } from '../memory.js';
import type { CreateUserInput, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-37 storage contract: operator-provisioned users and their memberships
 * (hosted-portal.md §3.1). A user is not organization-scoped; a membership is
 * the access join, access/no-access only. Creating a user always creates its
 * first membership in the same transaction, so a user with no way in is never
 * the result of a half-finished provisioning call.
 *
 * MUT-120: that same transaction also creates the user's one personal
 * organization (`personalOwnerUserId` = the user, unique) and its membership,
 * with or without a firm membership beside it.
 */
export function describeLedgerStoreUsersContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 9, minute, 0));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const personal = (): CreateUserInput['personal'] => ({ name: 'شخصي', slug: `personal-${unique()}`, defaultCurrency: 'USD', timezone: 'Asia/Hebron' });
  const input = (organizationId: string | undefined, overrides: Partial<CreateUserInput> = {}): CreateUserInput => ({
    email: `partner-${unique()}@firm.ps`,
    displayName: 'Nour Haddad',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'ar',
    ...(organizationId ? { organizationId } : {}),
    personal: personal(),
    at: at(0),
    ...overrides,
  });

  describe(`${name} LedgerStore users contract (MUT-37)`, () => {
    it('creates a user with its personal organization and its firm membership, in one call', async () => {
      const store = await makeStore();
      const o = await org(store);
      const created = input(o.id);
      const { user, memberships, personalOrganization } = await store.users.create(created);
      expect(user).toMatchObject({ status: 'ACTIVE', locale: 'ar', displayName: 'Nour Haddad', failedSignIns: 0, lockedUntil: null, lastSignInAt: null });
      expect(user.id).toMatch(/[0-9a-f-]{36}/);
      expect(user.passwordChangedAt.toISOString()).toBe(at(0).toISOString());
      expect(user.createdAt.toISOString()).toBe(at(0).toISOString());
      expect(personalOrganization).toMatchObject({ ...created.personal, personalOwnerUserId: user.id });
      expect(memberships.map((m) => m.organizationId)).toEqual([personalOrganization.id, o.id]);
      for (const m of memberships) {
        expect(m.userId).toBe(user.id);
        expect(m.createdAt.toISOString()).toBe(at(0).toISOString());
      }
      expect(await store.memberships.listByUser(user.id)).toHaveLength(2);
      expect(await store.organizations.getById(personalOrganization.id)).toMatchObject({ personalOwnerUserId: user.id });
    });

    it('creates a personal-only user when no firm is given (MUT-120)', async () => {
      const store = await makeStore();
      const { user, memberships, personalOrganization } = await store.users.create(input(undefined));
      expect(memberships).toEqual([expect.objectContaining({ userId: user.id, organizationId: personalOrganization.id })]);
      expect(await store.memberships.listByUser(user.id)).toHaveLength(1);
    });

    it('keeps one personal organization per user: a second one is a UniqueViolation (MUT-120)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(input(undefined));
      await expect(
        store.organizations.create({ name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', personalOwnerUserId: user.id }),
      ).rejects.toBeInstanceOf(UniqueViolation);
    });

    it('refuses a personal organization for an unknown user (MUT-120)', async () => {
      const store = await makeStore();
      await expect(
        store.organizations.create({ name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', personalOwnerUserId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toBeInstanceOf(ForeignKeyViolation);
    });

    it('rolls the user back when the personal slug is already taken (MUT-120)', async () => {
      const store = await makeStore();
      const o = await org(store);
      const clash = input(undefined, { personal: { ...personal(), slug: o.slug } });
      await expect(store.users.create(clash)).rejects.toBeInstanceOf(UniqueViolation);
      expect(await store.users.findByEmail(clash.email)).toBeNull();
    });

    it('marks firm organizations with no personal owner (MUT-120)', async () => {
      const store = await makeStore();
      const o = await org(store);
      expect(o.personalOwnerUserId).toBeNull();
      expect((await store.organizations.getById(o.id))?.personalOwnerUserId).toBeNull();
    });

    it('refuses a second user with the same email and leaves no second personal organization behind', async () => {
      const store = await makeStore();
      const o = await org(store);
      const first = input(o.id);
      await store.users.create(first);
      const retry = input(o.id, { email: first.email });
      // The admin route reports "email already exists" only when the constraint names email (MUT-120 review).
      await expect(store.users.create(retry)).rejects.toSatisfy((err: unknown) => err instanceof UniqueViolation && err.constraint.includes('email'));
      expect(await store.organizations.getBySlug(retry.personal.slug)).toBeNull();
    });

    it('refuses an unknown organization and leaves no user and no personal organization behind', async () => {
      const store = await makeStore();
      const orphan = input('00000000-0000-4000-8000-000000000000');
      await expect(store.users.create(orphan)).rejects.toBeInstanceOf(ForeignKeyViolation);
      expect(await store.users.findByEmail(orphan.email)).toBeNull();
      expect(await store.organizations.getBySlug(orphan.personal.slug)).toBeNull();
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

    it('stores Malafat suggestions: none at first, dismissals added to what is stored, the switch last-write-wins (MUT-191)', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      expect((await store.users.getById(user.id))?.malafatSuggestions).toBeNull();
      expect(await store.users.updateMalafatSuggestions(user.id, { dismiss: ['client-threshold'] }, at(1))).toMatchObject({
        malafatSuggestions: { off: false, dismissed: ['client-threshold'] },
      });
      expect(await store.users.updateMalafatSuggestions(user.id, { off: true, dismiss: ['second-business', 'client-threshold'] }, at(2))).toMatchObject({
        malafatSuggestions: { off: true, dismissed: ['client-threshold', 'second-business'] },
      });
      expect(await store.users.updateMalafatSuggestions(user.id, { off: false }, at(3))).toMatchObject({
        malafatSuggestions: { off: false, dismissed: ['client-threshold', 'second-business'] },
      });
      expect(await store.users.updateMalafatSuggestions('00000000-0000-4000-8000-000000000000', { off: true }, at(3))).toBeNull();
    });

    it('never loses a dismissal to a concurrent change (MUT-191)', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      await Promise.all([
        store.users.updateMalafatSuggestions(user.id, { dismiss: ['client-threshold'] }, at(1)),
        store.users.updateMalafatSuggestions(user.id, { dismiss: ['second-business'] }, at(1)),
        store.users.updateMalafatSuggestions(user.id, { off: true }, at(1)),
      ]);
      expect((await store.users.getById(user.id))?.malafatSuggestions).toEqual({ off: true, dismissed: ['client-threshold', 'second-business'] });
    });

    it('stores the trial prompt: none at first, the first welcome answer kept, a snooze moved on (MUT-418)', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      expect((await store.users.getById(user.id))?.trialPrompt).toBeNull();
      expect((await store.users.updateTrialPrompt(user.id, 'welcome-skipped', at(1)))?.trialPrompt).toEqual({
        welcomedAt: at(1).toISOString(),
        welcomeAnswer: 'skipped',
        bannerSnoozedUntil: null,
      });
      await store.users.updateTrialPrompt(user.id, 'welcome-accepted', at(2));
      await store.users.updateTrialPrompt(user.id, 'banner-snoozed', at(3));
      expect((await store.users.getById(user.id))?.trialPrompt).toEqual({
        welcomedAt: at(1).toISOString(),
        welcomeAnswer: 'skipped',
        bannerSnoozedUntil: new Date(at(3).getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(await store.users.updateTrialPrompt('00000000-0000-4000-8000-000000000000', 'banner-snoozed', at(3))).toBeNull();
    });

    it('two devices answering the welcome at once keep exactly one answer (MUT-418)', async () => {
      const store = await makeStore();
      const o = await org(store);
      const { user } = await store.users.create(input(o.id));
      await Promise.all([store.users.updateTrialPrompt(user.id, 'welcome-accepted', at(1)), store.users.updateTrialPrompt(user.id, 'banner-snoozed', at(1)), store.users.updateTrialPrompt(user.id, 'welcome-skipped', at(1))]);
      const stored = (await store.users.getById(user.id))?.trialPrompt;
      expect(stored?.welcomedAt).toBe(at(1).toISOString());
      expect(['accepted', 'skipped']).toContain(stored?.welcomeAnswer);
      expect(stored?.bannerSnoozedUntil).not.toBeNull();
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
      const { user, personalOrganization } = await store.users.create(input(a.id));
      const first = await store.memberships.grant(user.id, b.id, at(3));
      expect(first.created).toBe(true);
      expect(first.membership.createdAt.toISOString()).toBe(at(3).toISOString());
      const again = await store.memberships.grant(user.id, b.id, at(4));
      expect(again.created).toBe(false);
      expect(again.membership.createdAt.toISOString()).toBe(at(3).toISOString());
      expect((await store.memberships.listByUser(user.id)).map((m) => m.organizationId).sort()).toEqual([personalOrganization.id, a.id, b.id].sort());
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
      const { user, personalOrganization } = await store.users.create(input(a.id));
      const { user: other } = await store.users.create(input(b.id));
      await store.memberships.grant(user.id, b.id, at(1));

      expect(await store.memberships.find(user.id, b.id)).toMatchObject({ userId: user.id, organizationId: b.id });
      expect((await store.memberships.listByOrganization(a.id)).map((m) => m.userId)).toEqual([user.id]);
      expect((await store.memberships.listByOrganization(b.id)).map((m) => m.userId).sort()).toEqual([user.id, other.id].sort());

      expect(await store.memberships.revoke(user.id, b.id)).toBe(true);
      expect(await store.memberships.revoke(user.id, b.id)).toBe(false);
      expect(await store.memberships.find(user.id, b.id)).toBeNull();
      expect((await store.memberships.listByOrganization(b.id)).map((m) => m.userId)).toEqual([other.id]);
      expect((await store.memberships.listByUser(user.id)).map((m) => m.organizationId).sort()).toEqual([personalOrganization.id, a.id].sort());
    });
  });
}
