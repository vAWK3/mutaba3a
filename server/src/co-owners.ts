import { canCoOwn, ownsProfile, profileOwnerOf, profileTypeOf } from './personal-profile.js';
import type { AuditEventInput, GrantOwnerResult, MembershipRole, Organization, ProfileOwnerEntry, RemoveOwnerInput, RemoveOwnerResult } from './repositories/ports.js';

/**
 * MUT-373 (ADR-163): the co-owner rules both stores share, so the memory store and Postgres refuse, decide and
 * audit identically (the firm.ts pattern). A co-owner is an OWNER member of an owned BUSINESS profile; its creator
 * stays `ownerUserId`.
 */

/** How many people may own one profile, its creator included (design review DR11). A product limit, not configuration. */
export const MAX_PROFILE_OWNERS = 3;

type CoOwnable = Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>;

/** The ids that own the profile: its creator, then — where it can be co-owned — its other OWNER members. */
export function ownerIdsOf(organization: CoOwnable, members: readonly { userId: string; role: MembershipRole }[]): string[] {
  const creator = profileOwnerOf(organization);
  if (!creator) return [];
  const coOwners = canCoOwn(organization) ? members.filter((m) => m.role === 'OWNER').map((m) => m.userId) : [];
  return [...new Set([creator, ...coOwners])];
}

/** Why a co-owner grant is refused, checked under the row lock before any write, or null. */
export function grantOwnerRefusal(
  organization: CoOwnable,
  existingRole: MembershipRole | null,
  ownerCount: number,
  maxOwners: number,
): Exclude<GrantOwnerResult, { kind: 'granted' } | { kind: 'not_found' }> | null {
  if (organization.personalOwnerUserId) return { kind: 'personal_profile' };
  if (!profileOwnerOf(organization)) return { kind: 'not_co_ownable' };
  if (profileTypeOf(organization) !== 'BUSINESS') return { kind: 'not_business' };
  if (existingRole === 'OWNER') return null;
  if (existingRole) return { kind: 'role_conflict', role: existingRole };
  return ownerCount >= maxOwners ? { kind: 'limit', count: ownerCount } : null;
}

/** What a leave or a removal does, decided from the rows read under the row lock. */
export function removeOwnerDecision(
  organization: CoOwnable,
  input: Pick<RemoveOwnerInput, 'userId' | 'actorId'>,
  actorRole: MembershipRole | null,
  targetRole: MembershipRole | null,
): RemoveOwnerResult {
  if (!actorRole) return { kind: 'not_found' };
  if (!ownsProfile(organization, input.actorId, actorRole)) return { kind: 'not_owner' };
  const creator = profileOwnerOf(organization);
  const leaving = input.userId === input.actorId;
  if (input.userId === creator) return leaving ? { kind: 'creator_cannot_leave' } : { kind: 'not_creator' };
  if (!targetRole || !ownsProfile(organization, input.userId, targetRole)) return { kind: 'not_found' };
  if (!leaving && input.actorId !== creator) return { kind: 'not_creator' };
  return { kind: 'removed', reason: leaving ? 'left' : 'removed' };
}

/** The one audit row a leave or removal commits with (eng review A6: the existing `membership.revoked`, actor USER). */
export function ownerRemovedAudit(input: RemoveOwnerInput, reason: 'left' | 'removed'): AuditEventInput {
  return {
    organizationId: input.organizationId,
    actorType: 'USER',
    actorId: input.actorId,
    action: 'membership.revoked',
    entityType: 'user',
    entityId: input.userId,
    metadata: { reason, role: 'OWNER' },
    requestId: input.requestId,
  };
}

/** One profile's owners as the profile responses publish them: the creator first, then co-owners in the order they joined. */
export function profileOwnersOf(organization: CoOwnable, entries: readonly ProfileOwnerEntry[]) {
  const creator = profileOwnerOf(organization);
  const owners = entries.filter((e) => e.userId === creator || canCoOwn(organization));
  const ordered = [...owners].sort((a, b) => Number(b.userId === creator) - Number(a.userId === creator) || a.createdAt.getTime() - b.createdAt.getTime());
  // Design review DR10: a person with no display name is shown by their email, so the name is null rather than blank.
  return ordered.map((e) => ({ userId: e.userId, name: e.displayName.trim() || null, email: e.email, creator: e.userId === creator }));
}
