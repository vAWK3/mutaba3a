import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, Organization, UserRecord } from '../repositories/ports.js';

/**
 * MUT-575 (ADR-249): one rule for every read-only viewer of a profile (a share link, MUT-560; an accountant's grant,
 * MUT-559): while the profile owner's account is closing (MUT-333), nobody else reads it. "Keep my account" brings
 * access back; the purge deletes the profile and everything shared from it. Kept free of Node-only imports: the
 * middleware and the memory store's callers import it.
 */

type UsersStore = Pick<LedgerStore, 'users'>;

/** The profile's owner (creator, or the personal profile's person); null for an operator firm or a deleted account. */
export async function profileOwner(store: UsersStore, organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId'>): Promise<UserRecord | null> {
  const ownerId = profileOwnerOf(organization);
  return ownerId ? await store.users.getById(ownerId) : null;
}

/** When the owner asked to close their account, else null. Read from a loaded owner, so callers read the user once. */
export function closingSince(owner: Pick<UserRecord, 'closure'> | null): Date | null {
  return owner?.closure?.requestedAt ?? null;
}

/** Whether the profile's owner is closing their account. One user read. */
export async function ownerIsClosing(store: UsersStore, organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId'>): Promise<boolean> {
  return closingSince(await profileOwner(store, organization)) !== null;
}
