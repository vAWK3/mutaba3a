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
  const subscription = (stripeCustomerId: string, organizationId: string | null = null, profileIds: string[] = []) => ({
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
    at: at(1),
    audit: { profileIds, source: 'webhook' as const, eventId: 'evt_mut360', requestId: 'req-mut360' },
  });
  const account = (stripeCustomerId: string, userId: string | null, rest: { country?: string | null; currency?: string; linkAudit?: AuditEventInput[]; minute?: number } = {}) => ({
    stripeCustomerId,
    userId,
    country: rest.country ?? null,
    currency: rest.currency ?? 'USD',
    at: at(rest.minute ?? 1),
    linkAudit: rest.linkAudit ?? [],
  });

  describe(`${name} LedgerStore billing (MUT-358)`, () => {
    it('factsFor returns the owner’s subscriptions with their payer, grants on the owner or the profile, and trial starts', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user, personalOrganization } = await store.users.create(userInput(firm.id));
      const { user: stranger } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, user.id, { country: 'IL', currency: 'ILS' }));
      await store.billing.saveSubscription(subscription(customer));
      const strangerCustomer = `cus_${unique()}`;
      await store.billing.saveAccount(account(strangerCustomer, stranger.id));
      const { subscription: firmSub } = await store.billing.saveSubscription({ ...subscription(strangerCustomer, firm.id), tier: 'FIRM' });
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
      await store.billing.saveAccount(account(customer, null, { country: 'JO' }));
      expect((await store.billing.listAccounts({ linked: false })).map((a) => a.stripeCustomerId)).toContain(customer);
      await store.billing.linkAccount({ stripeCustomerId: customer, userId: user.id, currency: null, at: at(2), audit: [] });
      expect((await store.billing.listAccounts({ linked: false })).map((a) => a.stripeCustomerId)).not.toContain(customer);
      expect((await store.billing.listAccounts({ linked: true })).find((a) => a.stripeCustomerId === customer)).toMatchObject({ userId: user.id, country: 'JO', currency: 'USD' });
    });

    it('saveAccount fills an empty link once and never unlinks or relinks (MUT-360 D5)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput());
      const { user: other } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      const linkAudit = [audit(personalOrganization.id, 'billing.account_linked')];

      expect(await store.billing.getAccount(customer)).toBeNull();
      expect(await store.billing.saveAccount(account(customer, null, { country: 'IL', currency: 'ILS' }))).toMatchObject({
        linked: false,
        conflict: null,
        account: { stripeCustomerId: customer, userId: null, country: 'IL', currency: 'ILS' },
      });
      expect(await store.billing.saveAccount(account(customer, user.id, { currency: 'ILS', linkAudit, minute: 2 }))).toMatchObject({
        linked: true,
        conflict: null,
        account: { userId: user.id, country: 'IL' },
      });
      // A read without a link (null) keeps the person, and a null country keeps the stored one.
      expect(await store.billing.saveAccount(account(customer, null, { currency: 'ILS', linkAudit, minute: 3 }))).toMatchObject({
        linked: false,
        conflict: null,
        account: { userId: user.id, country: 'IL' },
      });
      expect(await store.billing.saveAccount(account(customer, user.id, { currency: 'ILS', linkAudit, minute: 4 }))).toMatchObject({ linked: false, conflict: null });
      expect(await store.billing.saveAccount(account(customer, other.id, { currency: 'ILS', linkAudit, minute: 5 }))).toMatchObject({
        linked: false,
        conflict: 'CUSTOMER_LINKED_ELSEWHERE',
        account: { userId: user.id },
      });

      const second = `cus_${unique()}`;
      expect(await store.billing.saveAccount(account(second, user.id, { linkAudit }))).toMatchObject({
        linked: false,
        conflict: 'USER_HAS_ANOTHER_ACCOUNT',
        account: { stripeCustomerId: second, userId: null },
      });
      expect(await store.billing.saveAccount(account(`cus_${unique()}`, randomUUID(), { linkAudit }))).toMatchObject({ conflict: 'UNKNOWN_USER', account: { userId: null } });
      expect(await store.billing.saveAccount(account(`cus_${unique()}`, 'not-a-uuid', { linkAudit }))).toMatchObject({ conflict: 'UNKNOWN_USER', account: { userId: null } });
      expect(await store.billing.getAccount(customer)).toMatchObject({ stripeCustomerId: customer, userId: user.id, country: 'IL', currency: 'ILS' });
      expect(await billingAudit(store, personalOrganization.id)).toEqual(['billing.account_linked']);
    });

    it('saveSubscription needs a known customer, keeps the newer read, and audits only real changes', async () => {
      const store = await makeStore();
      const { personalOrganization } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      const base = subscription(customer, null, [personalOrganization.id, personalOrganization.id]);
      await expect(store.billing.saveSubscription(base)).rejects.toThrow(/billingAccountId/);
      await store.billing.saveAccount(account(customer, null));

      const created = await store.billing.saveSubscription(base);
      expect(created).toMatchObject({ outcome: 'created', subscription: { stripeSubscriptionId: base.stripeSubscriptionId, status: 'active' } });
      expect(await store.billing.saveSubscription({ ...base, stripeUpdatedAt: at(2), at: at(2) })).toMatchObject({ outcome: 'unchanged' });
      const canceled = await store.billing.saveSubscription({ ...base, status: 'canceled', stripeUpdatedAt: at(4), at: at(4) });
      expect(canceled).toMatchObject({ outcome: 'changed', subscription: { id: created.subscription.id, status: 'canceled', stripeUpdatedAt: at(4) } });
      // An older read arriving late changes nothing.
      expect(await store.billing.saveSubscription({ ...base, status: 'active', stripeUpdatedAt: at(3), at: at(5) })).toMatchObject({
        outcome: 'stale',
        subscription: { status: 'canceled', stripeUpdatedAt: at(4) },
      });
      // A change that reaches no profile yet is saved without audit.
      expect(await store.billing.saveSubscription({ ...base, status: 'past_due', stripeUpdatedAt: at(6), at: at(6), audit: { ...base.audit, profileIds: [] } })).toMatchObject({
        outcome: 'changed',
      });

      const rows = (await store.audit.list(personalOrganization.id, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'billing.subscription_changed');
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [(r.metadata?.from as { status: string } | null)?.status ?? null, (r.metadata?.to as { status: string }).status]).sort()).toEqual(
        [
          [null, 'active'],
          ['active', 'canceled'],
        ].sort(),
      );
      expect(rows[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null, entityType: 'billing_subscription', entityId: created.subscription.id, requestId: 'req-mut360' });
      expect(rows[0]!.metadata).toMatchObject({ stripeSubscriptionId: base.stripeSubscriptionId, source: 'webhook', eventId: 'evt_mut360' });
    });

    it('Stripe events: processed once, an error is handled again on redelivery, and old ones are pruned', async () => {
      const store = await makeStore();
      const id = `evt_${unique()}`;
      expect(await store.billing.beginStripeEvent({ id, type: 'customer.subscription.updated', at: at(1) })).toEqual({ alreadyProcessed: false });
      await store.billing.finishStripeEvent(id, { error: 'TRANSIENT' });
      expect(await store.billing.beginStripeEvent({ id, type: 'customer.subscription.updated', at: at(2) })).toEqual({ alreadyProcessed: false });
      await store.billing.finishStripeEvent(id, { processedAt: at(3) });
      expect(await store.billing.beginStripeEvent({ id, type: 'customer.subscription.updated', at: at(4) })).toEqual({ alreadyProcessed: true });
      expect(await store.billing.pruneStripeEvents(at(30))).toBeGreaterThanOrEqual(1);
      expect(await store.billing.beginStripeEvent({ id, type: 'customer.subscription.updated', at: at(31) })).toEqual({ alreadyProcessed: false });
    });
  });
}
