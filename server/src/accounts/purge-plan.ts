import { canCoOwn } from '../personal-profile.js';
import type { AuditEventInput, MembershipRole, Organization, UserStatus } from '../repositories/ports.js';

/**
 * MUT-333 (ADR-188): what the hard delete does with each profile a closing person belongs to, decided the same way
 * by both stores (the co-owners.ts pattern), from facts read under the purge's own lock.
 *
 *   profile they created ── has another OWNER member (canCoOwn) ──► transfer (D6, R10): never deleted
 *                        └─ otherwise ─────────────────────────────► delete, with every record and file in it
 *   any other profile (a firm, Malafat-fed, someone else's) ────────► leave: only their membership goes,
 *                                                                     their records stay anonymized (D7)
 */

export type PurgeProfile = Pick<Organization, 'id' | 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>;

/** Another member of a profile the person created, as the transfer target rule (R10) needs them. */
export interface PurgeCandidate {
  userId: string;
  role: MembershipRole;
  status: UserStatus;
  /** Their own closure's deadline, or null when they aren't closing. */
  deleteAfter: Date | null;
  membershipCreatedAt: Date;
}

export interface PurgeDecision {
  deleteProfileIds: string[];
  transfers: Array<{ organizationId: string; toUserId: string }>;
  /** Profiles the person belongs to but doesn't own: only the membership goes. */
  leaveProfileIds: string[];
}

/** R10: an ACTIVE co-owner who isn't closing, then any who isn't closing, then the one closing last; oldest first. */
export function transferTargetOf(candidates: readonly PurgeCandidate[]): string | null {
  const owners = candidates.filter((c) => c.role === 'OWNER');
  const rank = (c: PurgeCandidate) => (c.deleteAfter !== null ? 2 : c.status === 'ACTIVE' ? 0 : 1);
  const ordered = [...owners].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.deleteAfter?.getTime() ?? 0) - (a.deleteAfter?.getTime() ?? 0) ||
      a.membershipCreatedAt.getTime() - b.membershipCreatedAt.getTime() ||
      a.userId.localeCompare(b.userId),
  );
  return ordered[0]?.userId ?? null;
}

const createdBy = (profile: PurgeProfile, userId: string) => profile.ownerUserId === userId || profile.personalOwnerUserId === userId;

/**
 * `profiles`: every profile the person created or belongs to. `othersOf(id)`: the other members of a profile they
 * created (never consulted for the rest).
 */
export function decidePurge(userId: string, profiles: readonly PurgeProfile[], othersOf: (organizationId: string) => readonly PurgeCandidate[]): PurgeDecision {
  const decision: PurgeDecision = { deleteProfileIds: [], transfers: [], leaveProfileIds: [] };
  for (const profile of [...profiles].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!createdBy(profile, userId)) {
      decision.leaveProfileIds.push(profile.id);
      continue;
    }
    const target = canCoOwn(profile) ? transferTargetOf(othersOf(profile.id)) : null;
    if (target) decision.transfers.push({ organizationId: profile.id, toUserId: target });
    else decision.deleteProfileIds.push(profile.id);
  }
  return decision;
}

/** The audit rows the purge writes on profiles that survive: the tombstone (D8) and each transfer (D6). */
export function purgeAuditRows(userId: string, decision: PurgeDecision): AuditEventInput[] {
  const transfers = decision.transfers.map(({ organizationId, toUserId }) => ({
    organizationId,
    actorType: 'SYSTEM' as const,
    actorId: null,
    action: 'organization.owner_transferred',
    entityType: 'organization',
    entityId: organizationId,
    metadata: { toUserId, reason: 'account_deleted' },
    requestId: null,
  }));
  const tombstones = [...decision.leaveProfileIds, ...decision.transfers.map((t) => t.organizationId)].map((organizationId) => ({
    organizationId,
    actorType: 'SYSTEM' as const,
    actorId: null,
    action: 'user.deleted',
    entityType: 'user',
    entityId: userId,
    requestId: null,
  }));
  return [...transfers, ...tombstones];
}
