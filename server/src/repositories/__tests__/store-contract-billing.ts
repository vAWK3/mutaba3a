import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditEventInput, CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-358 storage contract (ADR-160): the billing facts /v1/me reads, operator grants (revoked, never deleted) and
 * Stripe-customer links. Each write that changes something audits in its own transaction; one that changes nothing
 * writes no audit row. Run against the memory store and Postgres.
 */
export function describeLedgerStoreBillingContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute, 0));
  const userInput = (organizationId?: string): CreateUserInput => ({
    email: `billing-${unique()}@studio.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    ...(organizationId ? { organizationId } : {}),
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const audit = (organizationId: string, action: string): AuditEventInput => ({
    organizationId,
    actorType: 'ADMIN',
    actorId: null,
    action,
    entityType: 'user',
    entityId: null,
    requestId: 'req-mut358',
  });
  const billingAudit = async (store: LedgerStore, organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('billing.')).map((e) => e.action);
  const subscription = (stripeCustomerId: string, organizationId: string | null = null) => ({
    stripeCustomerId,
    stripeSubscriptionId: `sub_${unique()}`,
    tier: 'FREELANCER' as const,
    organizationId,
    status: 'active',
    currentPeriodEnd: at(30),
    cancelAtPeriodEnd: false,
    priceLookupKey: 'freelancer_founder_monthly_ils',
    founderUntil: null,
    stripeUpdatedAt: at(1),
  });

  describe(`${name} LedgerStore billing (MUT-358)`, () => {
    it('factsFor returns the owner’s subscriptions with their payer, grants on the owner or the profile, and trial starts', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user, personalOrganization } = await store.users.create(userInput(firm.id));
      const { user: stranger } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount({ stripeCustomerId: customer, userId: user.id, country: 'IL', currency: 'ILS' });
      await store.billing.saveSubscription(subscription(customer));
      const strangerCustomer = `cus_${unique()}`;
      await store.billing.saveAccount({ stripeCustomerId: strangerCustomer, userId: stranger.id, country: null, currency: 'USD' });
      const firmSub = await store.billing.saveSubscription({ ...subscription(strangerCustomer, firm.id), tier: 'FIRM' });
      await store.billing.createGrant({ id: randomUUID(), userId: null, organizationId: firm.id, tier: 'FIRM', reason: 'pilot', expiresAt: null, grantedBy: 'admin', at: at(2), audit: [] });
      await store.billing.setTrialStart(user.id, at(3));

      const facts = await store.billing.factsFor({ ownerUserIds: [user.id], organizationIds: [firm.id, personalOrganization.id] });
      expect(facts.subscriptions.map((s) => [s.userId, s.organizationId]).sort()).toEqual(
        [
          [user.id, null],
          [stranger.id, firm.id],
        ].sort(),
      );
      expect(facts.subscriptions.find((s) => s.id === firmSub.id)).toMatchObject({ tier: 'FIRM', status: 'active', currentPeriodEnd: at(30) });
      expect(facts.grants.map((g) => g.organizationId)).toEqual([firm.id]);
      expect(facts.trialStarts.get(user.id)).toEqual(at(3));
      expect(await store.billing.setTrialStart(randomUUID(), at(4))).toBeNull();
    });

    it('a grant is written with its audit rows, revoked once (audited once), and filtered by activeAt', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput());
      const id = randomUUID();
      const grant = await store.billing.createGrant({
        id,
        userId: user.id,
        organizationId: null,
        tier: 'FREELANCER',
        reason: 'pilot P01',
        expiresAt: at(50),
        grantedBy: 'admin',
        at: at(1),
        audit: [audit(personalOrganization.id, 'billing.grant_created')],
      });
      expect(grant).toMatchObject({ id, userId: user.id, organizationId: null, tier: 'FREELANCER', expiresAt: at(50), revokedAt: null, createdAt: at(1) });
      expect(await store.billing.listGrants({ userId: user.id, activeAt: at(10) })).toHaveLength(1);
      expect(await store.billing.listGrants({ userId: user.id, activeAt: at(51) })).toEqual([]);

      const first = await store.billing.revokeGrant(id, at(5), [audit(personalOrganization.id, 'billing.grant_revoked')]);
      expect(first).toMatchObject({ revoked: true, grant: { revokedAt: at(5) } });
      const again = await store.billing.revokeGrant(id, at(6), [audit(personalOrganization.id, 'billing.grant_revoked')]);
      expect(again).toMatchObject({ revoked: false, grant: { revokedAt: at(5) } });
      expect(await store.billing.revokeGrant(randomUUID(), at(6), [])).toBeNull();
      expect(await store.billing.listGrants({ userId: user.id })).toHaveLength(1);
      expect((await billingAudit(store, personalOrganization.id)).sort()).toEqual(['billing.grant_created', 'billing.grant_revoked']);
    });

    it('a grant names exactly one target that exists', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput());
      const base = { tier: 'FREELANCER' as const, reason: 'x', expiresAt: null, grantedBy: 'admin', at: at(1), audit: [] };
      await expect(store.billing.createGrant({ id: randomUUID(), userId: user.id, organizationId: personalOrganization.id, ...base })).rejects.toThrow();
      await expect(store.billing.createGrant({ id: randomUUID(), userId: randomUUID(), organizationId: null, ...base })).rejects.toThrow(/userId/);
      await expect(store.billing.createGrant({ id: randomUUID(), userId: null, organizationId: randomUUID(), ...base })).rejects.toThrow(/organizationId/);
    });

    it('links a customer to one person, idempotently, and refuses every other pairing', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput());
      const { user: other } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      const link = (stripeCustomerId: string, userId: string, currency: string | null = 'ILS') =>
        store.billing.linkAccount({ stripeCustomerId, userId, currency, at: at(1), audit: [audit(personalOrganization.id, 'billing.account_linked')] });

      await expect(link(customer, user.id, null)).rejects.toMatchObject({ reason: 'CURRENCY_REQUIRED' });
      expect(await link(customer, user.id)).toMatchObject({ linked: true, account: { stripeCustomerId: customer, userId: user.id, currency: 'ILS' } });
      expect(await link(customer, user.id)).toMatchObject({ linked: false });
      await expect(link(customer, other.id)).rejects.toMatchObject({ reason: 'CUSTOMER_LINKED_ELSEWHERE' });
      await expect(link(`cus_${unique()}`, user.id)).rejects.toMatchObject({ reason: 'USER_HAS_ANOTHER_ACCOUNT' });
      await expect(link(`cus_${unique()}`, randomUUID())).rejects.toThrow();
      expect(await billingAudit(store, personalOrganization.id)).toEqual(['billing.account_linked']);
    });

    it('lists unlinked customers and links one the webhook stored', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount({ stripeCustomerId: customer, userId: null, country: 'JO', currency: 'USD' });
      expect((await store.billing.listAccounts({ linked: false })).map((a) => a.stripeCustomerId)).toContain(customer);
      await store.billing.linkAccount({ stripeCustomerId: customer, userId: user.id, currency: null, at: at(2), audit: [] });
      expect((await store.billing.listAccounts({ linked: false })).map((a) => a.stripeCustomerId)).not.toContain(customer);
      expect((await store.billing.listAccounts({ linked: true })).find((a) => a.stripeCustomerId === customer)).toMatchObject({ userId: user.id, country: 'JO', currency: 'USD' });
    });

    it('saveSubscription upserts by Stripe id and needs a known customer', async () => {
      const store = await makeStore();
      const customer = `cus_${unique()}`;
      await expect(store.billing.saveSubscription(subscription(customer))).rejects.toThrow(/billingAccountId/);
      await store.billing.saveAccount({ stripeCustomerId: customer, userId: null, country: null, currency: 'USD' });
      const first = await store.billing.saveSubscription(subscription(customer));
      const updated = await store.billing.saveSubscription({ ...subscription(customer), stripeSubscriptionId: first.stripeSubscriptionId, status: 'canceled' });
      expect(updated).toMatchObject({ id: first.id, status: 'canceled' });
    });
  });
}
