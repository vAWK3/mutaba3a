import type { LedgerStore, MembershipRecord, Organization, ProfileExportField, UserRecord } from '../repositories/ports.js';
import { SNAPSHOT_FIELDS, type RecordsFilePage } from './codec.js';
import { LOCAL_PERSON_EMAIL } from './local-person.js';

/**
 * One profile's records file, as the portal's local mode would hold it
 * (MUT-325, brief §4.3): the profile's own rows exactly as stored, plus the
 * person, their membership and their inbox, re-homed so the file boots as
 * the device's one person. Yielded a page at a time, in `SNAPSHOT_FIELDS`
 * order, for `writeRecordsFile`.
 */

/** Rows per query and per written page: bounds what one export holds in memory, whatever the profile's size. */
export const EXPORT_PAGE_SIZE = 500;

export interface ProfileExportSubject {
  person: UserRecord;
  organization: Organization;
  membership: MembershipRecord;
}

/**
 * The device's person: the exporter's own row under the local address, with nothing that only means something to
 * the hosted account (password, lockout, last sign-in). No other person's row or email is ever written.
 */
export function localPersonOf(person: UserRecord): UserRecord {
  // Field by field, never a spread: a column the account gains later (a role, a plan) must not reach a device unasked.
  return {
    id: person.id, email: LOCAL_PERSON_EMAIL, displayName: person.displayName, passwordHash: null, locale: person.locale, status: 'ACTIVE', failedSignIns: 0,
    lockedUntil: null, passwordChangedAt: person.passwordChangedAt, lastSignInAt: null, emailVerifiedAt: null, malafatSuggestions: person.malafatSuggestions,
    // MUT-418: the trial's card prompt is the hosted account's; a device has no trial.
    trialPrompt: null, createdAt: person.createdAt, updatedAt: person.updatedAt,
  };
}

/** The membership as the device holds it, field by field for the same reason. */
export function localMembershipOf(membership: MembershipRecord): MembershipRecord {
  // MUT-300: the device's one person owns every profile (ADR-097 §2.2), whatever their role on the account.
  return { userId: membership.userId, organizationId: membership.organizationId, role: 'OWNER', createdAt: membership.createdAt };
}

/**
 * Locally the one person owns every profile (ADR-097 §2.2): renaming, retyping and re-dating are the owner's
 * (`isOwnProfile`), so a profile the exporter belongs to but doesn't own (a firm, or anyone else's) becomes theirs:
 * a BUSINESS profile, or PERSONAL when it was someone's personal one. Their own profiles keep their ownership.
 * Field by field, so a column a firm gains later (ADR-099's) never reaches a device. The firm switch (MUT-300)
 * arrives off: a device has no operator to turn it on or to read a request.
 */
export function localProfileOf(organization: Organization, personId: string): Organization {
  const own = organization.personalOwnerUserId === personId || (organization.personalOwnerUserId === null && organization.ownerUserId === personId);
  const wasPersonal = organization.personalOwnerUserId !== null;
  return {
    id: organization.id, name: organization.name, slug: organization.slug, defaultCurrency: organization.defaultCurrency, timezone: organization.timezone,
    personalOwnerUserId: own ? organization.personalOwnerUserId : null,
    ownerUserId: own ? organization.ownerUserId : personId,
    profileType: own ? organization.profileType : wasPersonal ? 'PERSONAL' : (organization.profileType ?? 'BUSINESS'),
    firmEnabledAt: null, firmRequestedAt: null, firmRequestedByUserId: null,
    version: organization.version, createdAt: organization.createdAt,
  };
}

export async function* profileExportPages(
  store: Pick<LedgerStore, 'recordsExport'>,
  subject: ProfileExportSubject,
  pageSize: number = EXPORT_PAGE_SIZE,
): AsyncGenerator<RecordsFilePage> {
  const { person, organization, membership } = subject;
  for (const field of SNAPSHOT_FIELDS) {
    switch (field) {
      case 'orgs':
        yield { field, entries: [[organization.id, localProfileOf(organization, person.id)]] };
        break;
      case 'ints': // Integration rows hold Malafat's connection; none leaves. Without one the profile has no other writer locally.
      case 'files': // Malafat's documents stay with Malafat (ADR-097 §7, ADR-156); receipts are the files a records file carries.
        break;
      case 'people':
        yield { field, entries: [[person.id, localPersonOf(person)]] };
        break;
      case 'members':
        yield { field, entries: [[`${person.id}:${organization.id}`, localMembershipOf(membership)]] };
        break;
      case 'inbox':
        yield* pagesOf(field, (after) => store.recordsExport.inboxPage(person.id, after, pageSize));
        break;
      default:
        yield* pagesOf(field, (after) => store.recordsExport.profilePage(organization.id, field as ProfileExportField, after, pageSize));
    }
  }
}

async function* pagesOf(
  field: RecordsFilePage['field'],
  read: (afterKey: string | null) => Promise<{ entries: Array<[string, unknown]>; nextKey: string | null }>,
): AsyncGenerator<RecordsFilePage> {
  let after: string | null = null;
  do {
    const page = await read(after);
    if (page.entries.length > 0) yield { field, entries: page.entries };
    after = page.nextKey;
  } while (after !== null);
}
