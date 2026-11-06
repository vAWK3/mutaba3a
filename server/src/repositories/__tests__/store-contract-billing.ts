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
    it('offerRenewalCandidates: offer subscriptions, active and not cancelling, renewing in the window, with a linked active payer (MUT-525)', async () => {
      const store = await makeStore();
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user } = await store.users.create(userInput(firm.id));
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, user.id));
      const save = (over: Record<string, unknown>) => store.billing.saveSubscription({ ...subscription(customer), offerId: 'launch-2026', ...over });
      const due = (await save({ currentPeriodEnd: at(20) })).subscription;
      await save({ currentPeriodEnd: at(40) });
      await save({ currentPeriodEnd: at(20), offerId: null });
      await save({ currentPeriodEnd: at(20), status: 'canceled' });
      await save({ currentPeriodEnd: at(20), cancelAtPeriodEnd: true });
      const unlinked = `cus_${unique()}`;
      await store.billing.saveAccount(account(unlinked, null));
      await store.billing.saveSubscription({ ...subscription(unlinked), offerId: 'launch-2026', currentPeriodEnd: at(20) });
      const found = await store.billing.offerRenewalCandidates({ endsAfter: at(10), endsUpTo: at(30) });
      expect(found).toEqual([{ stripeSubscriptionId: due.stripeSubscriptionId, offerId: 'launch-2026', currentPeriodEnd: at(20), userId: user.id, email: user.email, locale: user.locale }]);
    });

    it('pastDueCandidates: past_due subscriptions with a linked active payer, oldest first (MUT-533)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, user.id));
      const save = (over: Record<string, unknown>) => store.billing.saveSubscription({ ...subscription(customer), ...over });
      const later = (await save({ status: 'past_due', currentPeriodEnd: at(30) })).subscription;
      const sooner = (await save({ status: 'past_due', currentPeriodEnd: at(20) })).subscription;
      await save({ status: 'active' });
      await save({ status: 'unpaid' });
      const unlinked = `cus_${unique()}`;
      await store.billing.saveAccount(account(unlinked, null));
      const orphan = (await store.billing.saveSubscription({ ...subscription(unlinked), status: 'past_due' })).subscription;
      const found = await store.billing.pastDueCandidates();
      expect(found.filter((c) => c.userId === user.id)).toEqual([
        { stripeSubscriptionId: sooner.stripeSubscriptionId, tier: sooner.tier, userId: user.id, email: user.email, locale: user.locale },
        { stripeSubscriptionId: later.stripeSubscriptionId, tier: later.tier, userId: user.id, email: user.email, locale: user.locale },
      ]);
      expect(found.some((c) => c.stripeSubscriptionId === orphan.stripeSubscriptionId)).toBe(false);
    });

    it('keeps the offer a subscription’s Checkout carried; absent is none (MUT-525 DD10b)', async () => {
      const store = await makeStore();
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, null));
      const offered = { ...subscription(customer), offerId: 'launch-2026' };
      expect((await store.billing.saveSubscription(offered)).subscription.offerId).toBe('launch-2026');
      expect((await store.billing.getSubscription(offered.stripeSubscriptionId))?.offerId).toBe('launch-2026');
      const plain = subscription(customer);
      expect((await store.billing.saveSubscription(plain)).subscription.offerId).toBeNull();
      expect((await store.billing.getSubscription(plain.stripeSubscriptionId))?.offerId).toBeNull();
    });

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

    it('MUT-565: an ACCOUNTANT grant names a person, never a profile (the CHECK, in both stores)', async () => {
      const store = await makeStore();
      const { user, personalOrganization } = await store.users.create(userInput());
      const base = { tier: 'ACCOUNTANT' as const, reason: 'x', expiresAt: null, grantedBy: 'admin', at: at(1), audit: [] };
      await expect(store.billing.createGrant({ id: randomUUID(), userId: null, organizationId: personalOrganization.id, ...base })).rejects.toThrow(/ACCOUNTANT_PERSON_ONLY/);
      expect(await store.billing.createGrant({ id: randomUUID(), userId: user.id, organizationId: null, ...base })).toMatchObject({ tier: 'ACCOUNTANT', userId: user.id });
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

      expect(await store.billing.getSubscription(base.stripeSubscriptionId)).toBeNull();
      const created = await store.billing.saveSubscription(base);
      expect(await store.billing.getSubscription(base.stripeSubscriptionId)).toMatchObject({ id: created.subscription.id, status: 'active' });
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

    it('saveAccount state cells: unlinked or linked, against a missing, other or unknown person (MUT-360 review)', async () => {
      const store = await makeStore();
      const { user: u, personalOrganization } = await store.users.create(userInput());
      const { user: v } = await store.users.create(userInput());
      const linkAudit = [audit(personalOrganization.id, 'billing.account_linked')];
      const unlinked = `cus_${unique()}`;
      await store.billing.saveAccount(account(unlinked, null, { country: 'IL', currency: 'ILS' }));
      // unlinked × no candidate: stays unlinked, country kept.
      expect(await store.billing.saveAccount(account(unlinked, null, { currency: 'ILS', minute: 2 }))).toMatchObject({ linked: false, conflict: null, account: { userId: null, country: 'IL' } });
      // unlinked × unknown person: stays unlinked.
      expect(await store.billing.saveAccount(account(unlinked, randomUUID(), { currency: 'ILS', linkAudit }))).toMatchObject({ conflict: 'UNKNOWN_USER', account: { userId: null } });
      // A linked customer for u, then: unlinked × u (who already has a customer) → stays unlinked.
      const a = `cus_${unique()}`;
      await store.billing.saveAccount(account(a, u.id, { linkAudit }));
      expect(await store.billing.saveAccount(account(unlinked, u.id, { currency: 'ILS', linkAudit }))).toMatchObject({ conflict: 'USER_HAS_ANOTHER_ACCOUNT', account: { userId: null } });
      // linked × someone with their own customer, and linked × garbage: the link wins and says so.
      await store.billing.saveAccount(account(`cus_${unique()}`, v.id));
      expect(await store.billing.saveAccount(account(a, v.id, { linkAudit }))).toMatchObject({ conflict: 'CUSTOMER_LINKED_ELSEWHERE', account: { userId: u.id } });
      expect(await store.billing.saveAccount(account(a, 'not-a-uuid', { linkAudit }))).toMatchObject({ conflict: 'CUSTOMER_LINKED_ELSEWHERE', account: { userId: u.id } });
      expect(await billingAudit(store, personalOrganization.id)).toEqual(['billing.account_linked']);
      // A null currency keeps the stored one (customer.updated); a brand-new customer needs one.
      expect(await store.billing.saveAccount({ ...account(unlinked, null, { minute: 5 }), currency: null })).toMatchObject({ account: { currency: 'ILS' } });
      await expect(store.billing.saveAccount({ ...account(`cus_${unique()}`, null), currency: null })).rejects.toMatchObject({ reason: 'CURRENCY_REQUIRED' });
    });

    it('concurrent saves never undo or duplicate a link, and two first sightings both succeed (MUT-360 review)', async () => {
      const store = await makeStore();
      for (let i = 0; i < 15; i++) {
        const { user, personalOrganization } = await store.users.create(userInput());
        const linkAudit = [audit(personalOrganization.id, 'billing.account_linked')];
        // Two first sightings of a new customer (checkout + subscription.created arrive together).
        const fresh = `cus_${unique()}`;
        const [x, y] = await Promise.all([store.billing.saveAccount(account(fresh, null)), store.billing.saveAccount(account(fresh, null))]);
        expect(x.account.id).toBe(y.account.id);
        // An operator link racing a sync that names nobody: the link stays.
        const c = `cus_${unique()}`;
        await store.billing.saveAccount(account(c, null));
        await Promise.all([
          store.billing.linkAccount({ stripeCustomerId: c, userId: user.id, currency: null, at: at(1), audit: [] }),
          store.billing.saveAccount(account(c, null, { minute: 2 })),
        ]);
        expect((await store.billing.getAccount(c))?.userId).toBe(user.id);
        // Two saves linking the same person: no false conflict, one audit row.
        const d = `cus_${unique()}`;
        const { user: w, personalOrganization: wp } = await store.users.create(userInput());
        await store.billing.saveAccount(account(d, null));
        const both = await Promise.all([
          store.billing.saveAccount(account(d, w.id, { linkAudit: [audit(wp.id, 'billing.account_linked')] })),
          store.billing.saveAccount(account(d, w.id, { linkAudit: [audit(wp.id, 'billing.account_linked')], minute: 2 })),
        ]);
        expect(both.map((r) => r.conflict)).toEqual([null, null]);
        // An operator link creating a new customer while a sync creates it too: both succeed, the link stays.
        const e = `cus_${unique()}`;
        const { user: z } = await store.users.create(userInput());
        await Promise.all([store.billing.linkAccount({ stripeCustomerId: e, userId: z.id, currency: 'ILS', at: at(1), audit: [] }), store.billing.saveAccount(account(e, null, { currency: 'ILS' }))]);
        expect((await store.billing.getAccount(e))?.userId).toBe(z.id);
        expect((await store.billing.getAccount(d))?.userId).toBe(w.id);
        expect(await billingAudit(store, wp.id)).toEqual(['billing.account_linked']);
        void linkAudit;
      }
    });

    it('two first reads of a new subscription leave one row and one created audit (MUT-360 review)', async () => {
      const store = await makeStore();
      const { personalOrganization } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, null));
      const base = subscription(customer, null, [personalOrganization.id]);
      const outcomes = (await Promise.all([store.billing.saveSubscription(base), store.billing.saveSubscription({ ...base, stripeUpdatedAt: at(2), at: at(2) })])).map((r) => r.outcome);
      expect(outcomes).toContain('created');
      const rows = (await store.audit.list(personalOrganization.id, {}, { limit: 50, cursor: null })).items.filter((e) => e.action === 'billing.subscription_changed');
      expect(rows).toHaveLength(1);
    });

    it('summaryOf returns the person’s trial start, linked account and its subscriptions, latest period first (MUT-362)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      expect(await store.billing.summaryOf(user.id)).toEqual({ account: null, subscriptions: [], trialStartedAt: null });
      await store.billing.setTrialStart(user.id, at(5));

      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, user.id, { country: 'IL', currency: 'ILS' }));
      const older = { ...subscription(customer), status: 'canceled', currentPeriodEnd: at(10) };
      const newer = { ...subscription(customer), currentPeriodEnd: at(40) };
      await store.billing.saveSubscription(older);
      await store.billing.saveSubscription(newer);

      const summary = await store.billing.summaryOf(user.id);
      expect(summary.trialStartedAt).toEqual(at(5));
      expect(summary.account).toMatchObject({ userId: user.id, stripeCustomerId: customer, country: 'IL', currency: 'ILS' });
      expect(summary.subscriptions.map((s) => [s.stripeSubscriptionId, s.status])).toEqual([
        [newer.stripeSubscriptionId, 'active'],
        [older.stripeSubscriptionId, 'canceled'],
      ]);
    });

    it('summaryOf never returns an unlinked customer or another person’s account (MUT-362)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const { user: other } = await store.users.create(userInput());
      const unlinked = `cus_${unique()}`;
      await store.billing.saveAccount(account(unlinked, null));
      await store.billing.saveSubscription(subscription(unlinked));
      const others = `cus_${unique()}`;
      await store.billing.saveAccount(account(others, other.id));
      await store.billing.saveSubscription(subscription(others));

      expect(await store.billing.summaryOf(user.id)).toEqual({ account: null, subscriptions: [], trialStartedAt: null });
      expect((await store.billing.summaryOf(other.id)).account?.stripeCustomerId).toBe(others);
      expect(await store.billing.summaryOf(randomUUID())).toEqual({ account: null, subscriptions: [], trialStartedAt: null });
    });

    it('trialMailCandidates lists ACTIVE people whose trial started inside the window, oldest first (MUT-419)', async () => {
      const store = await makeStore();
      const start = (day: number) => new Date(Date.UTC(2026, 10, day, 8, 0, 0));
      const make = async (day: number | null, status: 'ACTIVE' | 'DISABLED' | 'PENDING_REVIEW' = 'ACTIVE', locale: 'ar' | 'en' = 'en') => {
        const { user } = await store.users.create({ ...userInput(), locale });
        if (day !== null) await store.billing.setTrialStart(user.id, start(day));
        if (status !== 'ACTIVE') await store.users.setStatus(user.id, status, at(2));
        return user;
      };
      const tooEarly = await make(2);
      const firstIn = await make(3, 'ACTIVE', 'ar');
      const lastIn = await make(9);
      const tooLate = await make(10);
      const disabled = await make(5, 'DISABLED');
      const pending = await make(5, 'PENDING_REVIEW');
      const never = await make(null);
      // MUT-333 (R16): someone closing their account gets no reminders.
      const closing = await make(5);
      const session = await store.sessions.create({ userId: closing.id, tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '0'), kind: 'cookie', at: at(2), idleExpiresAt: at(3), absoluteExpiresAt: at(3), userAgent: null });
      await store.users.requestClosure({ userId: closing.id, at: at(2), deleteAfter: new Date(at(2).getTime() + 30 * 86_400_000), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] });

      // (after, upTo]: the window's lower bound is open, its upper bound closed.
      const rows = await store.billing.trialMailCandidates({ startedAfter: start(2), startedUpTo: start(9) });
      const ours = new Set([tooEarly, firstIn, lastIn, tooLate, disabled, pending, never, closing].map((u) => u.id));
      const mine = rows.filter((r) => ours.has(r.userId));
      expect(mine).toEqual([
        { userId: firstIn.id, email: firstIn.email, locale: 'ar', trialStartedAt: start(3) },
        { userId: lastIn.id, email: lastIn.email, locale: 'en', trialStartedAt: start(9) },
      ]);
    });

    it('mirrors a pause and clears it again (MUT-532)', async () => {
      const store = await makeStore();
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, null));
      const base = subscription(customer);
      const { subscription: saved } = await store.billing.saveSubscription(base);
      expect(saved).toMatchObject({ pausedFrom: null, pauseResumesAt: null });
      const paused = await store.billing.saveSubscription({ ...base, pausedFrom: at(30), pauseResumesAt: at(50), stripeUpdatedAt: at(2), at: at(2) });
      expect(paused).toMatchObject({ outcome: 'changed', subscription: { pausedFrom: at(30), pauseResumesAt: at(50) } });
      const resumed = await store.billing.saveSubscription({ ...base, stripeUpdatedAt: at(3), at: at(3) });
      expect(resumed).toMatchObject({ outcome: 'changed', subscription: { pausedFrom: null, pauseResumesAt: null } });
    });

    it('claims a retention event, lists it, ends it early and releases it (MUT-532)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const claim = { userId: user.id, stripeSubscriptionId: 'sub_pause', kind: 'PAUSE' as const, reason: 'unused', months: 2, startsAt: at(30), endsAt: at(50), at: at(5) };
      const event = await store.billing.claimRetentionEvent(claim);
      expect(event).toMatchObject({ userId: user.id, kind: 'PAUSE', reason: 'unused', months: 2, startsAt: at(30), endsAt: at(50), endedEarlyAt: null, createdAt: at(5) });
      expect(await store.billing.endRetentionEventEarly(event.id, at(10))).toMatchObject({ id: event.id, endedEarlyAt: at(10) });
      expect(await store.billing.retentionEventsOf(user.id)).toEqual([{ ...event, endedEarlyAt: at(10) }]);
      expect(await store.billing.releaseRetentionEvent(event.id)).toBe(true);
      expect(await store.billing.releaseRetentionEvent(event.id)).toBe(false);
      expect(await store.billing.endRetentionEventEarly(event.id, at(11))).toBeNull();
      expect(await store.billing.retentionEventsOf(user.id)).toEqual([]);
    });

    it('MUT-534 (D12): a come-back offer is offered once per person per stage, ever, even claimed at the same moment', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const offered = (reason: string) => ({ userId: user.id, stripeSubscriptionId: 'sub_lapsed', kind: 'COMEBACK_OFFERED' as const, reason, months: null, startsAt: null, endsAt: null, at: at(5) });
      const results = await Promise.allSettled([store.billing.claimRetentionEvent(offered('day-30')), store.billing.claimRetentionEvent(offered('day-30'))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { name: 'StateConflict', reason: 'TAKEN' } });
      await expect(store.billing.claimRetentionEvent(offered('day-90'))).resolves.toMatchObject({ kind: 'COMEBACK_OFFERED', reason: 'day-90' });
    });

    it('comebackCandidates: subscriptions Stripe ended in the window, with a linked active payer, oldest end first (MUT-534)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, user.id, { country: 'IL', currency: 'ILS' }));
      const save = (over: Record<string, unknown>) => store.billing.saveSubscription({ ...subscription(customer), status: 'canceled', ...over });
      const later = (await save({ endedAt: at(30) })).subscription;
      const sooner = (await save({ endedAt: at(20) })).subscription;
      await save({ endedAt: at(5) });
      await save({ endedAt: at(50) });
      await save({ status: 'active', endedAt: null });
      const unlinked = `cus_${unique()}`;
      await store.billing.saveAccount(account(unlinked, null));
      const orphan = (await store.billing.saveSubscription({ ...subscription(unlinked), status: 'canceled', endedAt: at(25) })).subscription;
      const found = await store.billing.comebackCandidates({ endedAfter: at(10), endedUpTo: at(40) });
      const row = (s: { stripeSubscriptionId: string; tier: string }, endedAt: Date) => ({ stripeSubscriptionId: s.stripeSubscriptionId, endedAt, tier: s.tier, currency: 'ILS', userId: user.id, email: user.email, locale: user.locale });
      expect(found.filter((c) => c.userId === user.id)).toEqual([row(sooner, at(20)), row(later, at(30))]);
      expect(found.some((c) => c.stripeSubscriptionId === orphan.stripeSubscriptionId)).toBe(false);
    });

    it('MUT-534 (D10): keeps when Stripe ended a subscription; absent is null', async () => {
      const store = await makeStore();
      const customer = `cus_${unique()}`;
      await store.billing.saveAccount(account(customer, null));
      const ended = { ...subscription(customer), status: 'canceled', endedAt: at(40) };
      expect((await store.billing.saveSubscription(ended)).subscription.endedAt).toEqual(at(40));
      expect((await store.billing.getSubscription(ended.stripeSubscriptionId))?.endedAt).toEqual(at(40));
      expect((await store.billing.saveSubscription(subscription(customer))).subscription.endedAt).toBeNull();
    });

    it('a second stay offer for a person is TAKEN, even claimed at the same moment (MUT-532 rule 2)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const { user: other } = await store.users.create(userInput());
      const stay = (userId: string) => ({ userId, stripeSubscriptionId: 'sub_stay', kind: 'STAY_OFFER' as const, reason: 'too_expensive', months: 2, startsAt: at(5), endsAt: null, at: at(5) });
      const results = await Promise.allSettled([store.billing.claimRetentionEvent(stay(user.id)), store.billing.claimRetentionEvent(stay(user.id))]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { name: 'StateConflict', reason: 'TAKEN' } });
      await expect(store.billing.claimRetentionEvent(stay(other.id))).resolves.toMatchObject({ userId: other.id });
      await expect(store.billing.claimRetentionEvent({ ...stay(user.id), kind: 'CANCEL' })).resolves.toMatchObject({ kind: 'CANCEL' });
    });

    it('a pause claimed while another counts in the window is TAKEN; one undone before it started does not count (MUT-532 R6)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      const pause = { userId: user.id, stripeSubscriptionId: 'sub_pause', kind: 'PAUSE' as const, reason: 'unused', months: 1, startsAt: at(30), endsAt: at(40), at: at(5), noPauseSince: at(0) };
      const results = await Promise.allSettled([store.billing.claimRetentionEvent(pause), store.billing.claimRetentionEvent(pause)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const won = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>;
      await store.billing.endRetentionEventEarly(won.value.id, at(6));
      await expect(store.billing.claimRetentionEvent(pause)).resolves.toMatchObject({ kind: 'PAUSE' });
      await expect(store.billing.claimRetentionEvent(pause)).rejects.toMatchObject({ name: 'StateConflict', reason: 'TAKEN' });
    });

    it('a retention event belongs to a real person (ForeignKeyViolation otherwise)', async () => {
      const store = await makeStore();
      const { user } = await store.users.create(userInput());
      await store.billing.claimRetentionEvent({ userId: user.id, stripeSubscriptionId: 'sub_x', kind: 'CANCEL', reason: 'other', months: null, startsAt: null, endsAt: null, at: at(5) });
      await expect(store.billing.claimRetentionEvent({ userId: randomUUID(), stripeSubscriptionId: 'sub_x', kind: 'CANCEL', reason: null, months: null, startsAt: null, endsAt: null, at: at(5) })).rejects.toMatchObject({ name: 'ForeignKeyViolation' });
    });
  });
}
