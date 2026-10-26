import { randomUUID } from 'node:crypto';
import type { VerdictProfileKind } from './summaries/verdict.js';
import type { AuditEventInput, CreateUserInput, LedgerStore, MembershipRole, Organization, OwnedProfileAudit, ProfileType, ProfileTypeChange, UpdateOwnedProfileAudit, UserLocale } from './repositories/ports.js';

/** MUT-120: the personal profile is named in the user's language; a server-generated name, so no i18n layer (precedent: expenses/presets.ts). */
export const PERSONAL_PROFILE_NAME: Record<UserLocale, string> = { en: 'Personal', ar: 'شخصي' };

/**
 * The organization fields of a user's personal profile. Shared by account
 * creation (`POST /admin/v1/users`) and the post-roll backfill, so a
 * backfilled profile is indistinguishable from one created with the account.
 */
export function personalProfileFor(locale: UserLocale, settings: { defaultCurrency: string; timezone: string }): CreateUserInput['personal'] {
  // slugify() strips Arabic, and the user id does not exist until the store creates it: a random, ASCII, never-shown slug.
  return { name: PERSONAL_PROFILE_NAME[locale], slug: `personal-${randomUUID()}`, ...settings };
}

/**
 * MUT-182: who owns a profile — `ownerUserId`, or, for a MUT-120 profile an
 * older revision wrote during a deploy's roll window or after a rollback,
 * before post-roll stamped it (qa-reconcile D1), its `personalOwnerUserId`.
 * Every "is this a person's own profile" door reads this, never one column.
 */
export function profileOwnerOf(organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId'>): string | null {
  return organization.ownerUserId ?? organization.personalOwnerUserId;
}

/**
 * MUT-373 (ADR-163): a profile more than one person may own — an owned BUSINESS profile, never the built-in personal
 * profile, an owned PERSONAL one or an operator firm. Its creator stays `ownerUserId`; co-owners are OWNER members.
 */
export function canCoOwn(organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>): boolean {
  return organization.ownerUserId !== null && organization.personalOwnerUserId === null && organization.profileType === 'BUSINESS';
}

/**
 * MUT-373 (ADR-163, outside voice OV1): whether `userId` owns the profile — its creator (`profileOwnerOf`), or an
 * OWNER member of a profile that can be co-owned. Every membership defaults to OWNER (MUT-300), so the role counts
 * only where `canCoOwn` holds: a member of a firm, a Malafat-fed profile or someone's personal profile never owns it.
 * Every owner gate reads this; none compares columns or roles itself.
 */
export function ownsProfile(organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>, userId: string, role: MembershipRole | null): boolean {
  return profileOwnerOf(organization) === userId || (role === 'OWNER' && canCoOwn(organization));
}

/**
 * The profiles a person created (profileOwnerOf), out of the ones they are a member of: billing coverage (MUT-358)
 * follows the creator only, so a profile they co-own is left out (TD-193), as is a firm they only belong to. The
 * profiles are read in one tick: Prisma batches same-tick `findUnique` calls into a single query, so this is one
 * round trip, not a fan-out on the pool.
 */
export async function ownedProfilesOf(store: Pick<LedgerStore, 'memberships' | 'organizations'>, userId: string): Promise<Organization[]> {
  return (await memberProfilesOf(store, userId)).filter(({ organization }) => profileOwnerOf(organization) === userId).map(({ organization }) => organization);
}

/** MUT-373: every profile a person owns, the ones they co-own included (ownsProfile) — where their own act is audited (MUT-324 terms). */
export async function ownedOrCoOwnedProfilesOf(store: Pick<LedgerStore, 'memberships' | 'organizations'>, userId: string): Promise<Organization[]> {
  return (await memberProfilesOf(store, userId)).filter(({ organization, role }) => ownsProfile(organization, userId, role)).map(({ organization }) => organization);
}

/**
 * MUT-447 (eng review D2): the profiles a person's Reports verdict counts — the ones they own or co-own
 * (`ownsProfile`), plus operator firms where their membership is OWNER (a lawyer's own practice), never a firm they
 * staff (BOOKKEEPER/SUBMITTER). Wider than MUT-435 P1 on purpose: that rule is what an agent may see. `shared` = more
 * than one OWNER member (R6).
 */
export async function verdictProfilesOf(
  store: Pick<LedgerStore, 'memberships' | 'organizations'>,
  userId: string,
): Promise<{ organization: Organization; kind: VerdictProfileKind; shared: boolean }[]> {
  const held = (await memberProfilesOf(store, userId)).filter(({ organization, role }) => ownsProfile(organization, userId, role) || (profileOwnerOf(organization) === null && role === 'OWNER'));
  // One read for every held profile's OWNER members (review: not one per profile).
  const owners = new Map<string, number>();
  for (const entry of await store.memberships.listOwnersOf(held.map(({ organization }) => organization.id))) owners.set(entry.organizationId, (owners.get(entry.organizationId) ?? 0) + 1);
  return held.map(({ organization }) => {
    if (profileTypeOf(organization) === 'PERSONAL') return { organization, kind: 'PERSONAL', shared: false };
    return { organization, kind: profileOwnerOf(organization) ? 'BUSINESS' : 'FIRM', shared: (owners.get(organization.id) ?? 0) > 1 };
  });
}

async function memberProfilesOf(store: Pick<LedgerStore, 'memberships' | 'organizations'>, userId: string): Promise<{ organization: Organization; role: MembershipRole }[]> {
  const memberships = await store.memberships.listByUser(userId);
  const organizations = await Promise.all(memberships.map((membership) => store.organizations.getById(membership.organizationId)));
  return organizations.flatMap((organization, i) => (organization ? [{ organization, role: memberships[i]!.role }] : []));
}

/** A profile's type, counting an unstamped MUT-120 profile as the PERSONAL it always is. */
export function profileTypeOf(organization: Pick<Organization, 'profileType' | 'personalOwnerUserId'>): ProfileType | null {
  return organization.profileType ?? (organization.personalOwnerUserId ? 'PERSONAL' : null);
}

/** What a type change removed, read inside its transaction before the delete (qa-reconcile D4): enough for support to put it back by hand. */
export interface TypeChangeDetail {
  removedCategories: { id: string; name: string; color: string | null; archived: boolean }[];
  uncategorized: { expenseId: string; categoryId: string }[];
}

/** The rows `organizations.createOwned` writes in its own transaction (qa-reconcile D3). */
export function ownedProfileCreatedAudit(organization: Organization, audit: OwnedProfileAudit): AuditEventInput[] {
  const base = { organizationId: organization.id, actorType: 'USER' as const, actorId: audit.actorId, requestId: audit.requestId };
  return [
    { ...base, action: 'organization.created', entityType: 'organization', entityId: organization.id, metadata: { owned: true, profileType: organization.profileType } },
    { ...base, action: 'membership.granted', entityType: 'user', entityId: audit.actorId },
  ];
}

/** The rows `organizations.updateOwned` writes in its own transaction (qa-reconcile D3/D4). */
export function ownedProfileUpdatedAudit(
  organizationId: string,
  types: { from: ProfileType | null; to: ProfileType | null },
  audit: UpdateOwnedProfileAudit,
  typeChange: { impact: ProfileTypeChange; detail: TypeChangeDetail; seeded: number } | null,
): AuditEventInput[] {
  const user = { organizationId, actorType: 'USER' as const, actorId: audit.actorId, requestId: audit.requestId };
  const rows: AuditEventInput[] = [{ ...user, action: 'organization.updated', entityType: 'organization', entityId: organizationId, metadata: { fields: audit.fields } }];
  if (!typeChange || !audit.preset) return rows;
  rows.push(
    {
      ...user,
      action: 'organization.type_changed',
      entityType: 'organization',
      entityId: organizationId,
      metadata: { from: types.from, to: types.to, ...typeChange.impact, preset: audit.preset.name, removedCategories: typeChange.detail.removedCategories, uncategorized: typeChange.detail.uncategorized },
    },
    {
      organizationId,
      actorType: 'SYSTEM',
      actorId: null,
      action: 'expense_category.seeded',
      entityType: 'expense_category',
      entityId: null,
      metadata: { preset: audit.preset.name, count: typeChange.seeded, locale: audit.preset.locale },
      requestId: audit.requestId,
    },
  );
  return rows;
}

