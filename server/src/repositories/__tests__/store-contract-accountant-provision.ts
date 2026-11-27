import { describe, expect, it } from 'vitest';
import type { AuditEventInput, CreateUserInput, LedgerStore, ProvisionCustomerInput, ProvisionCustomerResult } from '../ports.js';

/**
 * MUT-763 storage contract (accountant channel, eng review T1/T2): `provision.create` makes a customer's account for an
 * approved accountant in ONE transaction: a passwordless user, their personal profile, an owned BUSINESS profile, an
 * ACTIVE read grant for the accountant, a SETUP setup link carrying the claim code's digest, and the audit rows. All rows
 * or none; the approval is re-checked inside the method. Run against the memory store and Postgres.
 */
export function describeLedgerStoreAccountantProvisionContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  describe(`${name} LedgerStore accountant provision contract`, () => {
    const unique = () => Math.random().toString(36).slice(2, 10);
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 27, 9, minute, 0));
    const userInput = (prefix: string): CreateUserInput => ({
      email: `${prefix}-${unique()}@firm-${unique()}.ps`,
      displayName: 'Hadi Khatib',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      locale: 'en',
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
    /** An accountant, approved to provision (or not). */
    async function accountant(store: LedgerStore, approved = true) {
      const { user, personalOrganization } = await store.users.create(userInput('acct'));
      if (approved) await store.provision.setApproval({ userId: user.id, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: at(1) });
      return { userId: user.id, personalId: personalOrganization.id };
    }
    const audit = (created: { userId: string; personalOrganizationId: string; organizationId: string }): AuditEventInput[] => [
      { organizationId: created.organizationId, actorType: 'USER', actorId: null, action: 'accountant.customer_created', entityType: 'user', entityId: created.userId, metadata: {}, requestId: null },
    ];
    const provisionInput = (accountantUserId: string, over: Partial<ProvisionCustomerInput> = {}): ProvisionCustomerInput => ({
      accountantUserId,
      email: `cust-${unique()}@cafe-${unique()}.ps`,
      displayName: 'Samer Haddad',
      locale: 'ar',
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      profile: { name: 'Café Nour', slug: `cafe-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      setupLink: { tokenDigest: `d-${unique()}${unique()}`, expiresAt: at(60 * 24 * 14) },
      claimCodeDigest: `c-${unique()}${unique()}`,
      at: at(2),
      auditFor: audit,
      ...over,
    });
    const created = (r: ProvisionCustomerResult) => {
      if (r.kind !== 'created') throw new Error(`expected created, got ${r.kind}`);
      return r;
    };

    it('creates the passwordless user, both profiles, the ACTIVE read grant, the setup link and the audit in one go', async () => {
      const store = await makeStore();
      const acct = await accountant(store);
      const input = provisionInput(acct.userId);
      const r = created(await store.provision.create(input));

      expect(r.user.email).toBe(input.email);
      expect(r.user.passwordHash).toBeNull();
      expect(r.organization.profileType).toBe('BUSINESS');
      expect(r.organization.ownerUserId).toBe(r.user.id);
      expect(r.personalOrganization.id).not.toBe(r.organization.id);

      // The accountant reads it through an ACTIVE grant (ADR-245), nothing more.
      expect(r.grant).toMatchObject({ organizationId: r.organization.id, accountantUserId: acct.userId, status: 'ACTIVE' });
      expect((await store.accountantGrants.findActive(acct.userId, r.organization.id))?.id).toBe(r.grant.id);
      expect((await store.accountantGrants.listForAccountant(acct.userId)).map((g) => g.organizationId)).toContain(r.organization.id);

      // The customer is the owner of the business profile, and provenance is recorded.
      expect((await store.memberships.find(r.user.id, r.organization.id))?.role).toBe('OWNER');
      expect(await store.provision.originOf(r.user.id)).toEqual({ accountantUserId: acct.userId, provisionedAt: input.at });

      // The setup link and its claim code digest committed with the user; the link is a SETUP one, not signup.
      const link = await store.provision.setupLinkOf(r.user.id);
      expect(link).toMatchObject({ tokenDigest: input.setupLink.tokenDigest, purpose: 'SETUP', claimCodeDigest: input.claimCodeDigest, claimCodeAttempts: 0 });
      expect(link?.expiresAt).toEqual(input.setupLink.expiresAt);

      // The audit rows landed on the new profile.
      const rows = await store.audit.listByOrganization(r.organization.id, 50);
      expect(rows.some((row) => row.action === 'accountant.customer_created' && row.entityId === r.user.id)).toBe(true);
    });

    it('refuses an accountant who is not approved, and writes nothing', async () => {
      const store = await makeStore();
      const acct = await accountant(store, false);
      const input = provisionInput(acct.userId);
      expect((await store.provision.create(input)).kind).toBe('not_approved');
      expect(await store.users.findByEmail(input.email)).toBeNull();
    });

    it('re-checks the approval inside the method: an approval withdrawn stops the next create', async () => {
      const store = await makeStore();
      const acct = await accountant(store);
      created(await store.provision.create(provisionInput(acct.userId)));
      await store.provision.setApproval({ userId: acct.userId, enabled: false, createLimitPerDay: null, lookupLimitPerDay: null, at: at(5) });
      expect((await store.provision.create(provisionInput(acct.userId))).kind).toBe('not_approved');
    });

    it('creates no second user for an address that already has an account', async () => {
      const store = await makeStore();
      const acct = await accountant(store);
      const existing = await store.users.create(userInput('existing'));
      const r = await store.provision.create(provisionInput(acct.userId, { email: existing.user.email }));
      expect(r.kind).toBe('account_exists');
      expect((await store.accountantGrants.listForAccountant(acct.userId)).length).toBe(0);
    });

    it('is all rows or none: a duplicate setup-link digest rolls back the user, profiles and grant', async () => {
      const store = await makeStore();
      const acct = await accountant(store);
      const first = created(await store.provision.create(provisionInput(acct.userId)));
      const firstLink = await store.provision.setupLinkOf(first.user.id);
      const second = provisionInput(acct.userId, { setupLink: { tokenDigest: firstLink!.tokenDigest, expiresAt: at(60 * 24 * 14) } });
      await expect(store.provision.create(second)).rejects.toThrow();
      expect(await store.users.findByEmail(second.email)).toBeNull();
      expect((await store.accountantGrants.listForAccountant(acct.userId)).length).toBe(1);
    });

    it('of two concurrent creates for one address, exactly one wins', async () => {
      const store = await makeStore();
      const acct = await accountant(store);
      const email = `race-${unique()}@cafe-${unique()}.ps`;
      const results = await Promise.all([
        store.provision.create(provisionInput(acct.userId, { email })).catch(() => null),
        store.provision.create(provisionInput(acct.userId, { email })).catch(() => null),
      ]);
      expect(results.filter((r) => r?.kind === 'created').length).toBe(1);
      expect((await store.accountantGrants.listForAccountant(acct.userId)).length).toBe(1);
    });

    it('stores and reads the per-accountant approval and limits', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput('limits'));
      expect(await store.provision.approvalOf(user.id)).toEqual({ enabled: false, createLimitPerDay: null, lookupLimitPerDay: null });
      await store.provision.setApproval({ userId: user.id, enabled: true, createLimitPerDay: 80, lookupLimitPerDay: 120, at: at(3) });
      expect(await store.provision.approvalOf(user.id)).toEqual({ enabled: true, createLimitPerDay: 80, lookupLimitPerDay: 120 });
      expect(await store.provision.approvalOf('00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('writes the approval’s audit rows with the change, and none for an unknown person', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput('audited'));
      const row = (action: string): AuditEventInput => ({ organizationId: personalOrganization.id, actorType: 'USER', actorId: null, action, entityType: 'user', entityId: user.id, metadata: { createLimitPerDay: 5 }, requestId: null });
      await store.provision.setApproval({ userId: user.id, enabled: true, createLimitPerDay: 5, lookupLimitPerDay: null, at: at(3), audit: [row('accountant.provisioning_approved')] });
      expect((await store.audit.listByOrganization(personalOrganization.id, 20)).map((e) => e.action)).toContain('accountant.provisioning_approved');

      const unknown = '00000000-0000-4000-8000-000000000000';
      expect(await store.provision.setApproval({ userId: unknown, enabled: true, createLimitPerDay: null, lookupLimitPerDay: null, at: at(4), audit: [row('accountant.provisioning_approved')] })).toBeNull();
      expect((await store.audit.listByOrganization(personalOrganization.id, 20)).filter((e) => e.action === 'accountant.provisioning_approved')).toHaveLength(1);
    });

    // MUT-764: the per-day counts behind the accountant's two limits, and the operator's list of unclaimed accounts.
    describe('counts and the unclaimed list (MUT-764)', () => {
      const lookupAudit = (organizationId: string, actorId: string): AuditEventInput => ({
        organizationId, actorType: 'USER', actorId, action: 'accountant.customer_lookup_existing', entityType: 'user', entityId: actorId, metadata: {}, requestId: null,
      });

      it('counts the accounts an accountant created since a moment, and no one else’s', async () => {
        const store = await makeStore();
        const a = await accountant(store);
        const b = await accountant(store);
        created(await store.provision.create(provisionInput(a.userId, { at: at(10) })));
        created(await store.provision.create(provisionInput(a.userId, { at: at(20) })));
        created(await store.provision.create(provisionInput(b.userId, { at: at(30) })));

        expect(await store.provision.countCreatedSince(a.userId, at(0))).toBe(2);
        expect(await store.provision.countCreatedSince(a.userId, at(15))).toBe(1);
        expect(await store.provision.countCreatedSince(a.userId, at(25))).toBe(0);
        expect(await store.provision.countCreatedSince(b.userId, at(0))).toBe(1);
      });

      it('counts the existing-address attempts an accountant made since a moment, from their audit rows', async () => {
        const store = await makeStore();
        const a = await accountant(store);
        const b = await accountant(store);
        await store.audit.append(lookupAudit(a.personalId, a.userId));
        await store.audit.append(lookupAudit(a.personalId, a.userId));
        await store.audit.append(lookupAudit(b.personalId, b.userId));
        // Another action by the same actor is not a lookup.
        await store.audit.append({ ...lookupAudit(a.personalId, a.userId), action: 'accountant.customer_created' });

        const since = new Date(Date.now() - 60_000);
        expect(await store.provision.countLookupsSince(a.userId, since)).toBe(2);
        expect(await store.provision.countLookupsSince(b.userId, since)).toBe(1);
        expect(await store.provision.countLookupsSince(a.userId, new Date(Date.now() + 60_000))).toBe(0);
      });

      it('lists unclaimed provisioned accounts, newest first, and drops one once it has a password', async () => {
        const store = await makeStore();
        const a = await accountant(store);
        const first = created(await store.provision.create(provisionInput(a.userId, { at: at(10) })));
        const second = created(await store.provision.create(provisionInput(a.userId, { at: at(20) })));

        const rows = await store.provision.listUnclaimed({ limit: 10 });
        const ids = rows.map((r) => r.userId);
        expect(ids.indexOf(second.user.id)).toBeLessThan(ids.indexOf(first.user.id));
        expect(rows.find((r) => r.userId === first.user.id)).toMatchObject({ email: first.user.email, accountantUserId: a.userId, provisionedAt: at(10) });

        await store.users.setPassword(first.user.id, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', at(40));
        expect((await store.provision.listUnclaimed({ limit: 10 })).map((r) => r.userId)).not.toContain(first.user.id);
        expect(await store.provision.listUnclaimed({ limit: 1 })).toHaveLength(1);
      });
    });
  });
}
