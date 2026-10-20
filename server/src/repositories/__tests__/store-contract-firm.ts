import { describe, expect, it } from 'vitest';
import type { CreateUserInput, LedgerStore } from '../ports.js';

/**
 * MUT-300 storage contract: the firm switch (ADR-099, amended by the MUT-300
 * eng review D4/D6). An owner requests firm features for an owned Business
 * profile; an operator enables them in place (ownership untouched), disables
 * them, or declines the request. Enabling writes roles: the profile's owner,
 * or the named owners of an operator firm, become OWNER and every other
 * member BOOKKEEPER. Each write audits in its own transaction; a write that
 * changes nothing writes no audit row.
 */
export function describeLedgerStoreFirmContract(name: string, makeStore: () => Promise<LedgerStore>, options: { concurrent: boolean } = { concurrent: false }): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 9, minute, 0));
  const CAP = 6;
  const userInput = (organizationId?: string): CreateUserInput => ({
    email: `firm-${unique()}@studio.ps`,
    displayName: 'Rana Saleh',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    locale: 'en',
    ...(organizationId ? { organizationId } : {}),
    personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: at(0),
  });
  const USER_AUDIT = (userId: string) => ({ actorId: userId, requestId: 'req-mut300' });
  const OPERATOR = { actorId: null, requestId: 'req-mut300-admin' };

  async function ownedBusiness(store: LedgerStore, profileType: 'PERSONAL' | 'BUSINESS' = 'BUSINESS') {
    const { user, personalOrganization } = await store.users.create(userInput());
    const result = await store.organizations.createOwned(
      user.id,
      { name: 'Studio', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType, at: at(1) },
      CAP,
      USER_AUDIT(user.id),
    );
    if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
    return { user, personalOrganization, profile: result.organization };
  }

  async function operatorFirm(store: LedgerStore) {
    const org = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user: rana } = await store.users.create(userInput(org.id));
    const { user: omar } = await store.users.create(userInput(org.id));
    return { org, rana, omar };
  }

  const firmAudit = async (store: LedgerStore, organizationId: string) =>
    (await store.audit.list(organizationId, {}, { limit: 50, cursor: null })).items.filter((e) => e.action.startsWith('firm.'));

  describe(`${name} LedgerStore firm switch contract (MUT-300)`, () => {
    it('starts every organization with firm features off and nothing requested', async () => {
      const store = await makeStore();
      const { profile, personalOrganization } = await ownedBusiness(store);
      const { org } = await operatorFirm(store);
      for (const o of [profile, personalOrganization, org]) {
        expect(await store.organizations.getById(o.id)).toMatchObject({ firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null });
      }
    });

    it('gives a new membership the OWNER role outside a firm (inert until firm features are on)', async () => {
      const store = await makeStore();
      const { user, profile, personalOrganization } = await ownedBusiness(store);
      expect(await store.memberships.find(user.id, profile.id)).toMatchObject({ role: 'OWNER' });
      expect(await store.memberships.find(user.id, personalOrganization.id)).toMatchObject({ role: 'OWNER' });
      const { org, rana } = await operatorFirm(store);
      expect(await store.memberships.find(rana.id, org.id)).toMatchObject({ role: 'OWNER' });
    });

    describe('requestFirm', () => {
      it('records the request with its requester, audited once, without bumping the version (O3)', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        const result = await store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id));
        expect(result).toMatchObject({ kind: 'requested', created: true });
        if (result.kind !== 'requested') return;
        expect(result.organization).toMatchObject({ firmRequestedAt: at(2), firmRequestedByUserId: user.id, firmEnabledAt: null, version: profile.version });
        const events = await firmAudit(store, profile.id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ action: 'firm.requested', actorType: 'USER', actorId: user.id, entityType: 'organization', entityId: profile.id, requestId: 'req-mut300' });
      });

      it('returns the first request unchanged on a repeat, writing no second audit row', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        await store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id));
        const again = await store.organizations.requestFirm(profile.id, user.id, at(5), USER_AUDIT(user.id));
        expect(again).toMatchObject({ kind: 'requested', created: false, organization: { firmRequestedAt: at(2) } });
        expect(await firmAudit(store, profile.id)).toHaveLength(1);
      });

      it('refuses an unknown organization and one whose firm features are already on', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        expect(await store.organizations.requestFirm('00000000-0000-4000-8000-000000000000', user.id, at(2), USER_AUDIT(user.id))).toEqual({ kind: 'not_found' });
        await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: [] }, at(3), OPERATOR);
        expect(await store.organizations.requestFirm(profile.id, user.id, at(4), USER_AUDIT(user.id))).toEqual({ kind: 'already_firm' });
      });
    });

    describe('setFirm', () => {
      it('enables an owned Business profile in place: ownership kept, the owner OWNER, the request cleared (D4)', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        await store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id));
        const result = await store.organizations.setFirm(profile.id, { enabled: true, ownerUserIds: ['ignored-for-owned'] }, at(3), OPERATOR);
        expect(result).toMatchObject({ kind: 'updated', changed: true });
        if (result.kind !== 'updated') return;
        expect(result.organization).toMatchObject({ firmEnabledAt: at(3), firmRequestedAt: null, firmRequestedByUserId: null, ownerUserId: user.id, profileType: 'BUSINESS' });
        expect(result.organization.version).toBe(profile.version + 1);
        expect(await store.organizations.countOwnedBy(user.id)).toBe(2);
        expect(await store.memberships.find(user.id, profile.id)).toMatchObject({ role: 'OWNER' });
        const events = await firmAudit(store, profile.id);
        expect(events.map((e) => e.action)).toEqual(['firm.requested', 'firm.enabled']);
        expect(events[1]).toMatchObject({ actorType: 'ADMIN', actorId: null, metadata: { ownerUserIds: [user.id] } });
      });

      it('enables an operator firm with the named owners OWNER and every other member BOOKKEEPER', async () => {
        const store = await makeStore();
        const { org, rana, omar } = await operatorFirm(store);
        const result = await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [rana.id] }, at(3), OPERATOR);
        expect(result).toMatchObject({ kind: 'updated', changed: true, organization: { firmEnabledAt: at(3) } });
        expect(await store.memberships.find(rana.id, org.id)).toMatchObject({ role: 'OWNER' });
        expect(await store.memberships.find(omar.id, org.id)).toMatchObject({ role: 'BOOKKEEPER' });
        expect((await firmAudit(store, org.id))[0]).toMatchObject({ action: 'firm.enabled', metadata: { ownerUserIds: [rana.id] } });
      });

      it('refuses an operator firm with no owner named, or an owner who is not a member, writing nothing', async () => {
        const store = await makeStore();
        const { org, rana } = await operatorFirm(store);
        const { user: stranger } = await store.users.create(userInput());
        expect(await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [] }, at(3), OPERATOR)).toEqual({ kind: 'owners_required' });
        expect(await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [rana.id, stranger.id] }, at(3), OPERATOR)).toEqual({ kind: 'not_a_member', userIds: [stranger.id] });
        expect(await store.organizations.getById(org.id)).toMatchObject({ firmEnabledAt: null });
        expect(await firmAudit(store, org.id)).toHaveLength(0);
      });

      it('refuses the built-in personal profile and an owned Personal profile', async () => {
        const store = await makeStore();
        const { personalOrganization } = await ownedBusiness(store);
        expect(await store.organizations.setFirm(personalOrganization.id, { enabled: true, ownerUserIds: [] }, at(3), OPERATOR)).toEqual({ kind: 'personal_profile' });
        const { profile: ownedPersonal } = await ownedBusiness(store, 'PERSONAL');
        expect(await store.organizations.setFirm(ownedPersonal.id, { enabled: true, ownerUserIds: [] }, at(3), OPERATOR)).toEqual({ kind: 'not_business' });
        expect(await store.organizations.setFirm('00000000-0000-4000-8000-000000000000', { enabled: false }, at(3), OPERATOR)).toEqual({ kind: 'not_found' });
      });

      it('disables without touching roles, and treats the same state as a no-op with no audit', async () => {
        const store = await makeStore();
        const { org, rana, omar } = await operatorFirm(store);
        await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [rana.id] }, at(3), OPERATOR);
        const again = await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [omar.id] }, at(4), OPERATOR);
        expect(again).toMatchObject({ kind: 'updated', changed: false, organization: { firmEnabledAt: at(3) } });
        const off = await store.organizations.setFirm(org.id, { enabled: false }, at(5), OPERATOR);
        expect(off).toMatchObject({ kind: 'updated', changed: true, organization: { firmEnabledAt: null } });
        expect(await store.organizations.setFirm(org.id, { enabled: false }, at(6), OPERATOR)).toMatchObject({ kind: 'updated', changed: false });
        expect(await store.memberships.find(rana.id, org.id)).toMatchObject({ role: 'OWNER' });
        expect(await store.memberships.find(omar.id, org.id)).toMatchObject({ role: 'BOOKKEEPER' });
        expect((await firmAudit(store, org.id)).map((e) => e.action)).toEqual(['firm.enabled', 'firm.disabled']);
      });

      it('makes a later grant into a firm BOOKKEEPER, and a new user created into a firm too (D3)', async () => {
        const store = await makeStore();
        const { org, rana } = await operatorFirm(store);
        await store.organizations.setFirm(org.id, { enabled: true, ownerUserIds: [rana.id] }, at(3), OPERATOR);
        const { user: nour } = await store.users.create(userInput());
        const granted = await store.memberships.grant(nour.id, org.id, at(4));
        expect(granted.membership).toMatchObject({ role: 'BOOKKEEPER' });
        const { memberships } = await store.users.create(userInput(org.id));
        expect(memberships.map((m) => m.role)).toEqual(['OWNER', 'BOOKKEEPER']);
      });
    });

    describe('declineFirmRequest', () => {
      it('clears a pending request, audited, so the owner can ask again (D6)', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        await store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id));
        const result = await store.organizations.declineFirmRequest(profile.id, at(3), OPERATOR);
        expect(result).toMatchObject({ kind: 'declined', organization: { firmRequestedAt: null, firmRequestedByUserId: null, firmEnabledAt: null } });
        expect((await firmAudit(store, profile.id)).map((e) => e.action)).toEqual(['firm.requested', 'firm.request_declined']);
        expect(await store.organizations.requestFirm(profile.id, user.id, at(4), USER_AUDIT(user.id))).toMatchObject({ kind: 'requested', created: true });
      });

      it('answers not_found when nothing is pending or the organization is unknown', async () => {
        const store = await makeStore();
        const { profile } = await ownedBusiness(store);
        expect(await store.organizations.declineFirmRequest(profile.id, at(3), OPERATOR)).toEqual({ kind: 'not_found' });
        expect(await store.organizations.declineFirmRequest('00000000-0000-4000-8000-000000000000', at(3), OPERATOR)).toEqual({ kind: 'not_found' });
      });
    });

    describe('listFirmRequests', () => {
      it('lists pending requests oldest first, page by page, leaving out enabled and declined ones', async () => {
        const store = await makeStore();
        const made = [];
        for (let i = 0; i < 4; i++) made.push(await ownedBusiness(store));
        for (const [i, { user, profile }] of made.entries()) await store.organizations.requestFirm(profile.id, user.id, at(10 + i), USER_AUDIT(user.id));
        await store.organizations.setFirm(made[1]!.profile.id, { enabled: true, ownerUserIds: [] }, at(20), OPERATOR);
        await store.organizations.declineFirmRequest(made[2]!.profile.id, at(21), OPERATOR);
        const ours = new Set(made.map((m) => m.profile.id));
        const seen: string[] = [];
        let cursor = null;
        do {
          const page = await store.organizations.listFirmRequests({ limit: 1, cursor });
          seen.push(...page.items.filter((o) => ours.has(o.id)).map((o) => o.id));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen).toEqual([made[0]!.profile.id, made[3]!.profile.id]);
      });
    });

    if (options.concurrent) {
      it('lets two concurrent requests write one request and one audit row', async () => {
        const store = await makeStore();
        const { user, profile } = await ownedBusiness(store);
        const results = await Promise.all([
          store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id)),
          store.organizations.requestFirm(profile.id, user.id, at(2), USER_AUDIT(user.id)),
        ]);
        expect(results.map((r) => (r.kind === 'requested' ? r.created : null)).sort()).toEqual([false, true]);
        expect(await firmAudit(store, profile.id)).toHaveLength(1);
      });
    }
  });
}
