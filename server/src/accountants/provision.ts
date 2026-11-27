import { ApiError } from '../errors.js';
import type { LedgerStore } from '../repositories/ports.js';

/**
 * MUT-764 (accountant channel, epic MUT-762): small pieces the customer route and the operator console share.
 */

/** The person's own (built-in) profile: where an audit row about the person themselves belongs. */
export async function personalOrganizationIdOf(store: Pick<LedgerStore, 'memberships' | 'organizations'>, userId: string): Promise<string> {
  for (const membership of await store.memberships.listByUser(userId)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (organization?.personalOwnerUserId === userId) return organization.id;
  }
  throw new ApiError('INTERNAL', 'The account has no personal profile');
}
