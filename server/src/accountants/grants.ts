import { profileOwnerOf } from '../personal-profile.js';
import type { AccountantGrantRecord, AuditEventInput, LedgerStore, Organization } from '../repositories/ports.js';

/**
 * MUT-559 (ADR-245): an owner shares one profile, read-only, with an accountant. The rules of a grant's life live
 * here: its lifetime and cap, how a grant is shown and the masked address (the "last viewed" throttle is
 * access/view-touch.ts, shared with share links). Access itself
 * is decided in one place, selectProfile (auth/middleware.ts); the routes are routes/accountants.ts.
 *
 * Kept free of Node-only imports: the memory store (which the portal's signed-out mode runs in the browser) and the
 * middleware import it. The accept rule's domain lists (D4) are read in the routes file.
 */

/** An invite can be accepted for 14 days. Expiry is computed from `inviteExpiresAt`; no job sweeps it. */
export const ACCOUNTANT_INVITE_TTL_MS = 14 * 86_400_000;

/** ACCOUNTANTS_PER_PROFILE_MAX's default: live grants (pending or active) one profile may hold. */
export const ACCOUNTANTS_PER_PROFILE_DEFAULT = 5;

/** Invites one owner may send per hour, across their profiles (a refused one counts too). */
export const ACCOUNTANT_INVITE_POLICY = { perUserPerHour: 20 } as const;

/** Counts toward the per-profile cap and blocks a second invite to the address: ACTIVE, or PENDING and unexpired. */
export function isLiveGrant(grant: Pick<AccountantGrantRecord, 'status' | 'inviteExpiresAt'>, at: Date): boolean {
  return grant.status === 'ACTIVE' || (grant.status === 'PENDING' && grant.inviteExpiresAt > at);
}

/** How the owner's list shows a live grant. */
export function grantStatusView(grant: Pick<AccountantGrantRecord, 'status' | 'inviteExpiresAt'>, at: Date): 'pending' | 'expired' | 'active' {
  if (grant.status === 'ACTIVE') return 'active';
  return grant.inviteExpiresAt > at ? 'pending' : 'expired';
}

/** `hadi@books.ps` → `h***@books.ps`: enough for the right person to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** The invite link: the token rides in the fragment, which browsers never send (D3). */
export function accountantInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/accountant-invite#${token}`;
}

export type GrantAuditAction = 'accountant.invited' | 'accountant.accepted' | 'accountant.revoked' | 'accountant.left' | 'accountant.viewed';

/** An audit row about a grant, on the shared profile. Never the address or a name in its metadata. */
export function grantAudit(grant: Pick<AccountantGrantRecord, 'id' | 'organizationId'>, action: GrantAuditAction, actorId: string | null, requestId: string | null): AuditEventInput {
  return { organizationId: grant.organizationId, actorType: 'USER', actorId, action, entityType: 'accountant_grant', entityId: grant.id, metadata: {}, requestId };
}

/** /v1/me `clients`: the profiles shared with the person as an accountant, oldest accept first. */
export async function clientsOf(store: LedgerStore, userId: string) {
  const grants = await store.accountantGrants.listActiveByAccountant(userId);
  return (await Promise.all(grants.map((grant) => clientOf(store, grant)))).filter((client) => client !== null);
}

/** One ACTIVE grant as the accountant sees it (/v1/me `clients`, and what accepting answers). Null if the profile is gone. */
export async function clientOf(store: LedgerStore, grant: AccountantGrantRecord) {
  const organization = await store.organizations.getById(grant.organizationId);
  if (!organization) return null;
  return { profileId: organization.id, name: organization.name, ownerName: await ownerNameOf(store, organization, grant), sharedSince: grant.acceptedAt!.toISOString() };
}

export async function displayNameOf(store: LedgerStore, userId: string | null): Promise<string | null> {
  return userId ? ((await store.users.getById(userId))?.displayName ?? null) : null;
}

/** The profile's owner, else whoever invited (an operator firm has no owner). */
export async function ownerNameOf(store: LedgerStore, organization: Organization, grant: Pick<AccountantGrantRecord, 'invitedByUserId'>): Promise<string | null> {
  return (await displayNameOf(store, profileOwnerOf(organization))) ?? (await displayNameOf(store, grant.invitedByUserId));
}
