import { randomUUID } from 'node:crypto';
import type { AuditEventInput, CreateUserInput, LedgerStore, Organization, OwnedProfileAudit, ProfileType, ProfileTypeChange, UpdateOwnedProfileAudit, UserLocale } from './repositories/ports.js';

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
 * The profiles a person owns (profileOwnerOf), out of the ones they are a member of: where a person's own act is
 * audited (MUT-324 terms, MUT-358 billing). A firm they only belong to is left out. The profiles are read in one tick:
 * Prisma batches same-tick `findUnique` calls into a single query, so this is one round trip, not a fan-out on the pool.
 */
export async function ownedProfilesOf(store: Pick<LedgerStore, 'memberships' | 'organizations'>, userId: string): Promise<Organization[]> {
  const memberships = await store.memberships.listByUser(userId);
  const organizations = await Promise.all(memberships.map((membership) => store.organizations.getById(membership.organizationId)));
  return organizations.filter((organization): organization is Organization => organization !== null && profileOwnerOf(organization) === userId);
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

