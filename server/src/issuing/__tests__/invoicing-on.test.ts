import { describe, expect, it } from 'vitest';
import type { LedgerStore, Organization } from '../../repositories/ports.js';
import { invoicingOn } from '../invoicing-on.js';

/**
 * MUT-736 (ADR-282): the one rule for whether a profile issues documents. A business profile with an owner that isn't
 * a Malafat firm; then INVOICING_FOR_ALL, or (the kill switch: the flag off) the owner's operator `invoicing` grant.
 */
const OWNER = 'owner-1';
const storeWith = (features: string[]) => ({ features: { activeFor: async () => features } }) as unknown as LedgerStore;
const profile = (over: Partial<Organization> = {}) =>
  ({ id: 'p1', ownerUserId: OWNER, personalOwnerUserId: null, profileType: 'BUSINESS', memberSyncAt: null, ...over }) as Organization;

describe('invoicingOn', () => {
  describe('INVOICING_FOR_ALL on', () => {
    it('is on for a business profile with no grant', async () => {
      expect(await invoicingOn(storeWith([]), profile(), true)).toBe(true);
    });
    it('stays off for the personal profile, a Malafat firm and a profile with no owner', async () => {
      expect(await invoicingOn(storeWith(['invoicing']), profile({ profileType: 'PERSONAL' }), true)).toBe(false);
      expect(await invoicingOn(storeWith(['invoicing']), profile({ ownerUserId: null, personalOwnerUserId: OWNER, profileType: null }), true)).toBe(false);
      expect(await invoicingOn(storeWith(['invoicing']), profile({ memberSyncAt: new Date() }), true)).toBe(false);
      expect(await invoicingOn(storeWith(['invoicing']), profile({ ownerUserId: null }), true)).toBe(false);
    });
  });

  describe('INVOICING_FOR_ALL off (the kill switch): the operator grant decides again', () => {
    it('is on with the owner’s grant', async () => {
      expect(await invoicingOn(storeWith(['invoicing']), profile(), false)).toBe(true);
    });
    it('is off without it', async () => {
      expect(await invoicingOn(storeWith(['agent_access']), profile(), false)).toBe(false);
    });
  });
});
