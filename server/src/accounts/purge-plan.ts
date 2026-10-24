import { canCoOwn } from '../personal-profile.js';
import type { AuditEventInput, MembershipRole, Organization, UserStatus } from '../repositories/ports.js';

/**
 * MUT-333 (ADR-188): what the hard delete does with each profile a closing person belongs to, decided the same way
 * by both stores (the co-owners.ts pattern), from facts read under the purge's own lock.
 *
 *   profile they created ── has another OWNER member (canCoOwn) ──► transfer (D6, R10): never deleted
 *                        ├─ has other members, none an owner ──────► blocked (R18): never deleted with their work;
 *                        │                                            close refuses, the purge waits for the operator
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
  /**
   * R18: profiles they created that others belong to (a firm's bookkeepers, MUT-300/305) with no co-owner to pass them
   * to. Never deleted with those people's work: close refuses (409 ACCOUNT_CLOSE_BLOCKED) and the purge skips the
   * account until the creator adds a co-owner or the members leave.
   */
  blockedProfileIds: string[];
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
  const decision: PurgeDecision = { deleteProfileIds: [], transfers: [], leaveProfileIds: [], blockedProfileIds: [] };
  for (const profile of [...profiles].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!createdBy(profile, userId)) {
      decision.leaveProfileIds.push(profile.id);
      continue;
    }
    const others = profile.personalOwnerUserId === userId ? [] : othersOf(profile.id);
    const target = canCoOwn(profile) ? transferTargetOf(others) : null;
    if (target) decision.transfers.push({ organizationId: profile.id, toUserId: target });
    else if (others.length > 0) decision.blockedProfileIds.push(profile.id);
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
