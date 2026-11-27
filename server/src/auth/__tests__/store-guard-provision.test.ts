import { describe, expect, it } from 'vitest';
import { STORE_ACCESS, accountantStoreGuard, agentStoreGuard, principalStoreGuard, shareLinkStoreGuard, storeRefusal, type MethodAccess } from '../store-guard.js';

/**
 * MUT-763 (accountant channel, eng review finding 3): creating another person's account has a guard class of its own.
 * `sessionOnly` would let any signed-in person reach it and `operator` would refuse the accountant's own request, so
 * `provision` is allowed to a signed-in session only, refused to every other principal and to every read-only guard,
 * and the store method re-checks the operator's approval inside its transaction (the store contract tests that).
 */
describe('the provision guard class (MUT-763)', () => {
  const provisionMethods = Object.entries(STORE_ACCESS as Record<string, Record<string, MethodAccess>>).flatMap(([repo, methods]) =>
    Object.entries(methods)
      .filter(([, access]) => access === 'provision')
      .map(([method]) => `${repo}.${method}`),
  );

  it('belongs to the accountant’s own calls: creating a customer, reading one’s own approval and the two daily counts', () => {
    expect(provisionMethods.sort()).toEqual([
      'provision.approvalOf',
      'provision.countCreatedSince',
      'provision.countLookupsSince',
      'provision.countReissuesSince',
      'provision.create',
      'provision.customersOf',
      'provision.reissue',
      'provision.setMailStatus',
      'provision.unclaimedCustomerOf',
    ]);
  });

  it('keeps the operator’s approval, the origin, the setup link and the unclaimed list below every guard', () => {
    expect(STORE_ACCESS.provision.setApproval).toBe('operator');
    expect(STORE_ACCESS.provision.originOf).toBe('operator');
    expect(STORE_ACCESS.provision.setupLinkOf).toBe('operator');
    expect(STORE_ACCESS.provision.listUnclaimed).toBe('operator');
    // MUT-765: only the public claim step counts a wrong code, on the unguarded store.
    expect(STORE_ACCESS.provision.failClaimCode).toBe('operator');
  });

  it('lets a signed-in session create, and refuses an API key', () => {
    expect(storeRefusal('session', null, 'provision')).toBeNull();
    expect(storeRefusal('apiKey', null, 'provision')?.code).toBe('PRINCIPAL_NOT_ACCEPTED');
    expect(() => principalStoreGuard('session', null).assertCanCall('provision', 'create')).not.toThrow();
    expect(() => principalStoreGuard('apiKey', null).assertCanCall('provision', 'create')).toThrow();
  });

  it('refuses it to an accountant on a shared profile, to a share link viewer and to an MCP agent', () => {
    for (const guard of [accountantStoreGuard(), shareLinkStoreGuard(), agentStoreGuard()]) {
      expect(() => guard.assertCanCall('provision', 'create')).toThrow();
      expect(() => guard.assertCanCall('provision', 'approvalOf')).toThrow();
      expect(() => guard.assertCanCall('provision', 'countCreatedSince')).toThrow();
      expect(() => guard.assertCanCall('provision', 'countLookupsSince')).toThrow();
    }
  });
});
