import { closingSince, profileOwner } from '../access/owner-closing.js';
import { addMonths, monthOf, todayIn } from '../dates.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { AccountantGrantRecord, AuditEventInput, ClientActivity, ClientActivityWindow, LedgerStore, Organization } from '../repositories/ports.js';

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

// ---- MUT-575 (ADR-249): the accountant's client books ---------------------------------------------------------
//
//   listForAccountant (ACTIVE + undismissed REVOKED) ──► per profile: org + owner (one read each) ──► clientRows
//                                                                                                     │
//   /v1/me .clients ◄── rows                    /v1/clients ◄── rows + entries.clientActivity (2 queries)

/** What the client list needs to know about one profile: the profile, its owner's name, and whether they are closing. */
export interface ClientProfileFacts {
  organization: Pick<Organization, 'id' | 'name' | 'profileType' | 'timezone'>;
  ownerName: string | null;
  /** When the owner asked to close their account (MUT-333); null when they aren't closing. */
  closingSince: Date | null;
}

/** One client as the accountant sees it. An ended row carries nothing more: every profile-scoped call answers 404. */
export interface AccountantClientRow {
  profileId: string;
  name: string;
  ownerName: string | null;
  profileType: 'personal' | 'business' | null;
  sharedSince: string;
  status: 'active' | 'ended';
  endedReason: 'revoked' | 'closed' | null;
  endedAt: string | null;
}

const PROFILE_TYPE_VIEW = { PERSONAL: 'personal', BUSINESS: 'business' } as const;

/**
 * MUT-575 (ADR-249): the accountant's client rows, pure. Per profile: an ACTIVE grant is `active`, or `ended/closed`
 * while the owner is closing; else the latest REVOKED grant (by `revokedAt`) is `ended/revoked`. `grants` are what
 * `listForAccountant` answers (LEFT and dismissed are never there, and are skipped if they are). A profile missing
 * from `profiles` is gone (purged): no row. Active first, oldest accept first; then ended, newest end first.
 */
export function clientRows(grants: readonly AccountantGrantRecord[], profiles: ReadonlyMap<string, ClientProfileFacts>): AccountantClientRow[] {
  const chosen = new Map<string, AccountantGrantRecord>();
  for (const grant of grants) {
    if (grant.status !== 'ACTIVE' && (grant.status !== 'REVOKED' || grant.dismissedAt !== null)) continue;
    const held = chosen.get(grant.organizationId);
    if (!held || outranks(grant, held)) chosen.set(grant.organizationId, grant);
  }
  const rows: Array<{ row: AccountantClientRow; order: number }> = [];
  for (const grant of chosen.values()) {
    const facts = profiles.get(grant.organizationId);
    if (facts) rows.push(clientRowOf(grant, facts));
  }
  const byId = (a: { row: AccountantClientRow }, b: { row: AccountantClientRow }) => a.row.profileId.localeCompare(b.row.profileId);
  const active = rows.filter((r) => r.row.status === 'active').sort((a, b) => a.order - b.order || byId(a, b));
  const ended = rows.filter((r) => r.row.status === 'ended').sort((a, b) => b.order - a.order || byId(a, b));
  return [...active, ...ended].map((r) => r.row);
}

/** An ACTIVE grant beats a REVOKED one; between two REVOKED, the later revoke. */
function outranks(grant: AccountantGrantRecord, held: AccountantGrantRecord): boolean {
  if (grant.status !== held.status) return grant.status === 'ACTIVE';
  return (grant.revokedAt?.getTime() ?? 0) > (held.revokedAt?.getTime() ?? 0);
}

/** `order` sorts: the accept instant for an active row, the end instant for an ended one. */
function clientRowOf(grant: AccountantGrantRecord, facts: ClientProfileFacts): { row: AccountantClientRow; order: number } {
  const { organization, ownerName, closingSince } = facts;
  const endedAt = grant.status === 'REVOKED' ? grant.revokedAt : closingSince;
  const endedReason = grant.status === 'REVOKED' ? 'revoked' : closingSince ? 'closed' : null;
  const shared = grant.acceptedAt ?? grant.createdAt;
  const row: AccountantClientRow = {
    profileId: organization.id,
    name: organization.name,
    ownerName,
    profileType: organization.profileType ? PROFILE_TYPE_VIEW[organization.profileType] : null,
    sharedSince: shared.toISOString(),
    status: endedReason ? 'ended' : 'active',
    endedReason,
    endedAt: endedReason && endedAt ? endedAt.toISOString() : null,
  };
  return { row, order: (endedReason ? (endedAt ?? shared) : shared).getTime() };
}

/** The facts behind each profile in `grants`: one organization read and one owner read per profile (bounded by grants). */
async function profileFactsOf(store: LedgerStore, grants: readonly AccountantGrantRecord[]): Promise<Map<string, ClientProfileFacts>> {
  const byProfile = new Map(grants.map((g) => [g.organizationId, g]));
  const facts = await Promise.all(
    [...byProfile.values()].map(async (grant): Promise<[string, ClientProfileFacts] | null> => {
      const organization = await store.organizations.getById(grant.organizationId);
      if (!organization) return null;
      const owner = await profileOwner(store, organization);
      const ownerName = owner?.displayName ?? (await displayNameOf(store, grant.invitedByUserId));
      return [organization.id, { organization, ownerName, closingSince: closingSince(owner) }];
    }),
  );
  return new Map(facts.filter((f) => f !== null));
}

/** One profile's current month in its own calendar, as a money-date window [first of month, first of next). */
function monthWindowOf(organization: Pick<Organization, 'id' | 'timezone'>, now: Date): ClientActivityWindow {
  let today: string;
  try {
    today = todayIn(organization.timezone, now);
  } catch {
    today = todayIn('UTC', now);
  }
  const month = monthOf(today);
  return { organizationId: organization.id, from: `${month}-01`, before: `${addMonths(month, 1)}-01` };
}

/**
 * MUT-575: the person's client books. Without `activityAt`, the rows (/v1/me `clients`, no stat queries); with it, each
 * active row adds `entriesThisMonth` (in the profile's own calendar month at that instant) and `lastActivityAt`, in
 * two queries in all (/v1/clients). Ended rows carry null stats.
 */
export async function clientBooksOf(store: LedgerStore, userId: string): Promise<AccountantClientRow[]>;
export async function clientBooksOf(store: LedgerStore, userId: string, activityAt: Date): Promise<Array<AccountantClientRow & { entriesThisMonth: number | null; lastActivityAt: string | null }>>;
export async function clientBooksOf(store: LedgerStore, userId: string, activityAt?: Date) {
  const grants = await store.accountantGrants.listForAccountant(userId);
  const profiles = await profileFactsOf(store, grants);
  const rows = clientRows(grants, profiles);
  if (!activityAt) return rows;
  const windows = rows.filter((r) => r.status === 'active').map((r) => monthWindowOf(profiles.get(r.profileId)!.organization, activityAt));
  const activity = windows.length > 0 ? await store.entries.clientActivity(windows) : new Map<string, ClientActivity>();
  return rows.map((row) => {
    const stats = row.status === 'active' ? activity.get(row.profileId) : undefined;
    return { ...row, entriesThisMonth: stats ? stats.entriesThisMonth : null, lastActivityAt: stats?.lastActivityAt?.toISOString() ?? null };
  });
}

/** One ACTIVE grant as the accountant sees it (what accepting answers). Null if the profile is gone. */
export async function clientOf(store: LedgerStore, grant: AccountantGrantRecord): Promise<AccountantClientRow | null> {
  return clientRows([grant], await profileFactsOf(store, [grant]))[0] ?? null;
}

export async function displayNameOf(store: LedgerStore, userId: string | null): Promise<string | null> {
  return userId ? ((await store.users.getById(userId))?.displayName ?? null) : null;
}

/** The profile's owner, else whoever invited (an operator firm has no owner). */
export async function ownerNameOf(store: LedgerStore, organization: Organization, grant: Pick<AccountantGrantRecord, 'invitedByUserId'>): Promise<string | null> {
  return (await displayNameOf(store, profileOwnerOf(organization))) ?? (await displayNameOf(store, grant.invitedByUserId));
}
