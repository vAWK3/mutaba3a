import { canCoOwn, profileOwnerOf, profileTypeOf } from './personal-profile.js';
import type { AuditEventInput, FirmAudit, MembershipRole, Organization, SetFirmInput, SetFirmResult } from './repositories/ports.js';

/**
 * MUT-300 (ADR-099, amended by the eng review D3/D4/D6): the firm switch rules
 * both stores share, so the memory store and Postgres refuse, assign roles and
 * audit identically.
 */

/** A new member of an organization with firm features on is a BOOKKEEPER (D3); elsewhere OWNER, which nothing reads. */
export function roleForNewMembership(organization: Pick<Organization, 'firmEnabledAt'>): MembershipRole {
  return organization.firmEnabledAt ? 'BOOKKEEPER' : 'OWNER';
}

type FirmOrganization = Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType' | 'firmEnabledAt'>;

/**
 * Why an enable is refused, checked before any write, or null. An owned
 * profile's own owner is its OWNER, so `ownerUserIds` is ignored there; an
 * operator firm needs at least one, each already a member.
 */
export function firmEnableRefusal(organization: FirmOrganization, ownerUserIds: string[], memberIds: ReadonlySet<string>): Exclude<SetFirmResult, { kind: 'updated' } | { kind: 'not_found' }> | null {
  if (organization.personalOwnerUserId) return { kind: 'personal_profile' };
  if (profileOwnerOf(organization)) return profileTypeOf(organization) === 'BUSINESS' ? null : { kind: 'not_business' };
  if (ownerUserIds.length === 0) return { kind: 'owners_required' };
  const outsiders = [...new Set(ownerUserIds)].filter((id) => !memberIds.has(id));
  return outsiders.length > 0 ? { kind: 'not_a_member', userIds: outsiders } : null;
}

/**
 * The users who become OWNER on enable: an owned profile's owner and its co-owners (MUT-373: `coOwnerIds`, its
 * current OWNER members, so enabling never demotes one), or an operator firm's named owners — deduplicated, in order.
 */
export function firmOwnersOf(organization: FirmOrganization, ownerUserIds: string[], coOwnerIds: readonly string[] = []): string[] {
  const owner = profileOwnerOf(organization);
  if (!owner) return [...new Set(ownerUserIds)];
  return [...new Set([owner, ...(canCoOwn(organization) ? coOwnerIds : [])])];
}

/** True when the organization is already in the state the input asks for (a no-op: nothing written, no audit). */
export function firmUnchanged(organization: Pick<Organization, 'firmEnabledAt'>, input: SetFirmInput): boolean {
  return (organization.firmEnabledAt !== null) === input.enabled;
}

export type FirmAuditAction = 'firm.requested' | 'firm.enabled' | 'firm.disabled' | 'firm.request_declined';

/** The one audit row each firm-switch write commits with: the owner's request is USER, every operator change ADMIN. */
export function firmAuditRow(organizationId: string, action: FirmAuditAction, audit: FirmAudit, metadata?: AuditEventInput['metadata']): AuditEventInput {
  return {
    organizationId,
    actorType: action === 'firm.requested' ? 'USER' : 'ADMIN',
    actorId: audit.actorId,
    action,
    entityType: 'organization',
    entityId: organizationId,
    ...(metadata ? { metadata } : {}),
    requestId: audit.requestId,
  };
}
