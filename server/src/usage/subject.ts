import { profileOwnerOf } from '../personal-profile.js';
import type { Organization } from '../repositories/ports.js';

/**
 * MUT-735 (ADR-281): who pays for an action on a profile, the key its usage is counted under. A profile a person
 * created (or their personal one) is that person's, whoever acts on it (a co-owner's issue counts to the creator's
 * meter; the event keeps the actor). An operator-provisioned firm with no owner counts to itself.
 */
export function subjectKeyOf(organization: Pick<Organization, 'id' | 'ownerUserId' | 'personalOwnerUserId'>): string {
  const owner = profileOwnerOf(organization);
  return owner ? userSubjectKey(owner) : `org:${organization.id}`;
}

export function userSubjectKey(userId: string): string {
  return `user:${userId}`;
}

/** The person behind a subject key, or null for a profile's own (`org:`). */
export function userIdOfSubject(subjectKey: string): string | null {
  return subjectKey.startsWith('user:') ? subjectKey.slice('user:'.length) : null;
}
