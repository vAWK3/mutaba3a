import { describe, expect, it } from 'vitest';
import { UniqueViolation } from '../memory.js';
import type { AuditEventInput, IssueSignupLinkInput, LedgerStore, RedeemSignupLinkInput } from '../ports.js';

/**
 * MUT-366 storage contract: SIGNUP links (ADR-159, ADR-175). A SIGNUP link is bound to an address, not a person; the
 * account is created by the transaction that claims the link, so a refused or lost redeem writes nothing, and of
 * any number of links for one address at most one account results.
 */
export function describeLedgerStoreSignupContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 23, hour, 0, 0));
  const digest = () => `${unique()}${unique()}`.padEnd(64, '0').slice(0, 64);
  const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
  const TERMS = { version: '2026-10-19', locale: 'ar' as const, textSha256: 'f'.repeat(64), surface: 'portal' as const, clientRelease: 'web-v0.1.20' as string | null };
  const email = () => `s-${unique()}@studio.example`;

  const issueInput = (address: string, overrides: Partial<IssueSignupLinkInput> = {}): IssueSignupLinkInput => ({
    email: address,
    locale: 'ar',
    tokenDigest: digest(),
    at: at(1),
    expiresAt: at(25),
    ...overrides,
  });

  const signedUp = (ids: { userId: string; personalOrganizationId: string }): AuditEventInput[] => [
    { organizationId: ids.personalOrganizationId, actorType: 'USER', actorId: ids.userId, action: 'user.signed_up', entityType: 'user', entityId: ids.userId, requestId: 'req-1' },
  ];

  const redeemInput = (tokenDigest: string, overrides: Partial<RedeemSignupLinkInput> = {}): RedeemSignupLinkInput => ({
    tokenDigest,
    passwordHash: HASH,
    at: at(2),
    displayName: 'Rana',
    personal: { name: 'شخصي', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    status: 'ACTIVE',
    trialStartsAt: at(2),
    terms: TERMS,
    auditFor: signedUp,
    ...overrides,
  });

  async function operatorCreate(store: LedgerStore, address: string) {
    return store.users.create({
      email: address,
      displayName: 'Operator made',
      passwordHash: null,
      locale: 'en',
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
      at: at(0),
    });
  }

  describe(`${name} LedgerStore signup-link contract (MUT-366)`, () => {
    it('issues a SIGNUP link bound to the address, with no user', async () => {
      const store = await makeStore();
      const address = email();
      const link = await store.accountSetup.issueSignup(issueInput(address));
      expect(link).toMatchObject({ purpose: 'SIGNUP', userId: null, email: address, locale: 'ar', mailed: true, usedAt: null, cancelledAt: null });
      expect(await store.accountSetup.findByDigest(link.tokenDigest)).toMatchObject({ id: link.id, purpose: 'SIGNUP', email: address });
      expect(await store.users.findByEmail(address)).toBeNull();
    });

    it("a new SIGNUP link cancels the address's open ones and leaves other addresses' alone", async () => {
      const store = await makeStore();
      const address = email();
      const other = await store.accountSetup.issueSignup(issueInput(email()));
      const first = await store.accountSetup.issueSignup(issueInput(address));
      await store.accountSetup.issueSignup(issueInput(address, { at: at(2) }));
      expect((await store.accountSetup.findByDigest(first.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(2).toISOString());
      expect((await store.accountSetup.findByDigest(other.tokenDigest))?.cancelledAt).toBeNull();
    });

    it('refuses a duplicate digest', async () => {
      const store = await makeStore();
      const link = await store.accountSetup.issueSignup(issueInput(email()));
      await expect(store.accountSetup.issueSignup(issueInput(email(), { tokenDigest: link.tokenDigest }))).rejects.toBeInstanceOf(UniqueViolation);
    });

    it('redeem creates exactly one user with a personal profile, the trial, the verified address, the terms and the audit', async () => {
      const store = await makeStore();
      const address = email();
      const link = await store.accountSetup.issueSignup(issueInput(address));
      const created = await store.accountSetup.redeemSignup(redeemInput(link.tokenDigest));
      expect(created).not.toBeNull();
      const { user, personalOrganization } = created!;
      expect(user).toMatchObject({ email: address, displayName: 'Rana', locale: 'ar', status: 'ACTIVE', passwordHash: HASH, failedSignIns: 0, lastSignInAt: null });
      expect(user.emailVerifiedAt?.toISOString()).toBe(at(2).toISOString());
      expect(personalOrganization).toMatchObject({ name: 'شخصي', ownerUserId: user.id, personalOwnerUserId: user.id, profileType: 'PERSONAL', defaultCurrency: 'ILS' });
      expect((await store.memberships.listByUser(user.id)).map((m) => m.organizationId)).toEqual([personalOrganization.id]);
      expect((await store.billing.summaryOf(user.id)).trialStartedAt?.toISOString()).toBe(at(2).toISOString());
      expect(await store.users.latestTermsAcceptance(user.id)).toMatchObject({ version: TERMS.version, locale: 'ar', surface: 'portal', clientRelease: 'web-v0.1.20' });
      expect((await store.audit.listByOrganization(personalOrganization.id, 10)).map((e) => e.action)).toContain('user.signed_up');
      expect((await store.accountSetup.findByDigest(link.tokenDigest))?.usedAt?.toISOString()).toBe(at(2).toISOString());
    });

    it('redeem with no trial leaves trialStartedAt null (MUT-367: it starts at approval)', async () => {
      const store = await makeStore();
      const link = await store.accountSetup.issueSignup(issueInput(email()));
      const created = await store.accountSetup.redeemSignup(redeemInput(link.tokenDigest, { trialStartsAt: null }));
      expect((await store.billing.summaryOf(created!.user.id)).trialStartedAt).toBeNull();
    });

    describe('a refused redeem returns null and writes nothing', () => {
      /** The redeem is refused, and no account exists for the address beyond the one `prepare` may have made. */
      async function refused(prepare: (store: LedgerStore, address: string) => Promise<RedeemSignupLinkInput>) {
        const store = await makeStore();
        const address = email();
        const input = await prepare(store, address);
        const holderBefore = await store.users.findByEmail(address);
        expect(await store.accountSetup.redeemSignup(input)).toBeNull();
        expect((await store.users.findByEmail(address))?.id ?? null).toBe(holderBefore?.id ?? null);
      }

      it('a second use', () =>
        refused(async (store, address) => {
          const link = await store.accountSetup.issueSignup(issueInput(address));
          expect(await store.accountSetup.redeemSignup(redeemInput(link.tokenDigest))).not.toBeNull();
          return redeemInput(link.tokenDigest, { at: at(3) });
        }));

      it('at the expiry instant', () =>
        refused(async (store, address) => {
          const link = await store.accountSetup.issueSignup(issueInput(address));
          return redeemInput(link.tokenDigest, { at: at(25) });
        }));

      it('a link a newer one cancelled', () =>
        refused(async (store, address) => {
          const first = await store.accountSetup.issueSignup(issueInput(address));
          await store.accountSetup.issueSignup(issueInput(address, { at: at(2) }));
          return redeemInput(first.tokenDigest, { at: at(3) });
        }));

      it('an unknown digest', () => refused(async () => redeemInput(digest())));

      it('a person-bound link', () =>
        refused(async (store) => {
          const { user } = await operatorCreate(store, email());
          const link = await store.accountSetup.issue({ userId: user.id, tokenDigest: digest(), purpose: 'SETUP', at: at(1), expiresAt: at(73), lock: false, audit: [] });
          return redeemInput(link.tokenDigest);
        }));

      it('an address the operator created an account for meanwhile', async () => {
        const store = await makeStore();
        const address = email();
        const link = await store.accountSetup.issueSignup(issueInput(address));
        const { user } = await operatorCreate(store, address);
        expect(await store.accountSetup.redeemSignup(redeemInput(link.tokenDigest))).toBeNull();
        expect((await store.users.findByEmail(address))?.id).toBe(user.id);
        expect((await store.accountSetup.findByDigest(link.tokenDigest))?.usedAt).toBeNull();
      });
    });

    it('of two concurrent redeems of one SIGNUP link, exactly one creates the account', async () => {
      const store = await makeStore();
      const address = email();
      const link = await store.accountSetup.issueSignup(issueInput(address));
      const results = await Promise.all([store.accountSetup.redeemSignup(redeemInput(link.tokenDigest)), store.accountSetup.redeemSignup(redeemInput(link.tokenDigest))]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('two links for one address raced yield exactly one account', async () => {
      const store = await makeStore();
      const address = email();
      const first = await store.accountSetup.issueSignup(issueInput(address));
      const second = await store.accountSetup.issueSignup(issueInput(address));
      const results = await Promise.all([store.accountSetup.redeemSignup(redeemInput(first.tokenDigest)), store.accountSetup.redeemSignup(redeemInput(second.tokenDigest))]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      // And a link issued after the account exists can never make a second one.
      const late = await store.accountSetup.issueSignup(issueInput(address, { at: at(3), expiresAt: at(27) }));
      expect(await store.accountSetup.redeemSignup(redeemInput(late.tokenDigest, { at: at(4) }))).toBeNull();
    });

    it('a mailed person link stamps emailVerifiedAt when redeemed; an operator link does not', async () => {
      const store = await makeStore();
      const { user: mailed } = await operatorCreate(store, email());
      const { user: handed } = await operatorCreate(store, email());
      const base = { tokenDigest: '', purpose: 'RESET' as const, at: at(1), expiresAt: at(2), lock: false, audit: [] };
      const m = await store.accountSetup.issue({ ...base, userId: mailed.id, tokenDigest: digest(), mailed: true });
      const h = await store.accountSetup.issue({ ...base, userId: handed.id, tokenDigest: digest() });
      expect(m.mailed).toBe(true);
      expect(h.mailed).toBe(false);
      const redeem = (tokenDigest: string) => store.accountSetup.redeem({ tokenDigest, passwordHash: HASH, at: at(1), audit: [], terms: TERMS, termsAudit: [] });
      expect((await redeem(m.tokenDigest))?.emailVerifiedAt?.toISOString()).toBe(at(1).toISOString());
      expect((await redeem(h.tokenDigest))?.emailVerifiedAt).toBeNull();
    });

    it('a mailed link cancels only earlier mailed links; the operator’s open link stays, and redeeming either closes the other', async () => {
      const store = await makeStore();
      const { user } = await operatorCreate(store, email());
      const base = { userId: user.id, purpose: 'RESET' as const, at: at(1), expiresAt: at(9), lock: false, audit: [] };
      const operator = await store.accountSetup.issue({ ...base, tokenDigest: digest() });
      const firstMailed = await store.accountSetup.issue({ ...base, tokenDigest: digest(), mailed: true });
      const secondMailed = await store.accountSetup.issue({ ...base, tokenDigest: digest(), mailed: true, at: at(2) });
      expect((await store.accountSetup.findByDigest(operator.tokenDigest))?.cancelledAt).toBeNull();
      expect((await store.accountSetup.findByDigest(firstMailed.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(2).toISOString());
      expect(await store.accountSetup.redeem({ tokenDigest: secondMailed.tokenDigest, passwordHash: HASH, at: at(3), audit: [], terms: TERMS, termsAudit: [] })).not.toBeNull();
      expect((await store.accountSetup.findByDigest(operator.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(3).toISOString());
      // An operator link still replaces every open link, mailed ones included.
      const mailed = await store.accountSetup.issue({ ...base, tokenDigest: digest(), mailed: true, at: at(4) });
      await store.accountSetup.issue({ ...base, tokenDigest: digest(), at: at(5) });
      expect((await store.accountSetup.findByDigest(mailed.tokenDigest))?.cancelledAt?.toISOString()).toBe(at(5).toISOString());
    });

    it('prune deletes only unredeemed SIGNUP links that expired before the cutoff', async () => {
      const store = await makeStore();
      const stale = await store.accountSetup.issueSignup(issueInput(email(), { expiresAt: at(3) }));
      const fresh = await store.accountSetup.issueSignup(issueInput(email(), { expiresAt: at(10) }));
      const usedAddress = email();
      const used = await store.accountSetup.issueSignup(issueInput(usedAddress, { expiresAt: at(3) }));
      await store.accountSetup.redeemSignup(redeemInput(used.tokenDigest, { at: at(2) }));
      const { user } = await operatorCreate(store, email());
      const personLink = await store.accountSetup.issue({ userId: user.id, tokenDigest: digest(), purpose: 'SETUP', at: at(1), expiresAt: at(2), lock: false, audit: [] });

      expect(await store.accountSetup.pruneSignupLinks(at(5))).toBeGreaterThanOrEqual(1);
      expect(await store.accountSetup.findByDigest(stale.tokenDigest)).toBeNull();
      expect(await store.accountSetup.findByDigest(fresh.tokenDigest)).not.toBeNull();
      expect(await store.accountSetup.findByDigest(used.tokenDigest)).not.toBeNull();
      expect(await store.accountSetup.findByDigest(personLink.tokenDigest)).not.toBeNull();
    });
  });
}
