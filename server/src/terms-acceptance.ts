import type { SessionKind } from './auth/sessions.js';
import { ApiError } from './errors.js';
import { TERMS_SURFACE_OF, type CurrentTerms } from './legal.js';
import { profileOwnerOf } from './personal-profile.js';
import type { AuditEventInput, LedgerStore, Organization, TermsAcceptanceInput, UserLocale, UserRecord } from './repositories/ports.js';

/**
 * MUT-324 (ADR-102): what one acceptance of the current terms records, shared
 * by the setup-link redeem and POST /v1/me/terms-acceptance.
 */
export function termsAcceptanceOf(terms: CurrentTerms, locale: UserLocale, kind: SessionKind): TermsAcceptanceInput {
  return { version: terms.version, locale, textSha256: terms.sha256[locale], surface: TERMS_SURFACE_OF[kind] };
}

/** The shared refusal for a missing or outdated terms version: the setup-link redeem and POST /v1/me/terms-acceptance. */
export function staleTerms(terms: CurrentTerms): ApiError {
  return new ApiError('TERMS_VERSION_STALE', 'The terms changed; read the current version and accept it', { current: terms.version });
}

/**
 * `user.terms_accepted`, as the person, on each profile they own (D2): a person
 * accepts for themselves and, as owner, for their own profiles. A firm they are
 * only a member of never sees it. The profiles are read in one tick: Prisma batches same-tick
 * `findUnique` calls into a single query, so this is one round trip, not a fan-out on the pool.
 */
export async function termsAcceptedAudit(store: LedgerStore, person: UserRecord, acceptance: TermsAcceptanceInput, requestId: string): Promise<AuditEventInput[]> {
  const memberships = await store.memberships.listByUser(person.id);
  const organizations = await Promise.all(memberships.map((membership) => store.organizations.getById(membership.organizationId)));
  return organizations
    .filter((organization): organization is Organization => organization !== null && profileOwnerOf(organization) === person.id)
    .map((organization) => ({
      organizationId: organization.id,
      actorType: 'USER' as const,
      actorId: person.id,
      action: 'user.terms_accepted',
      entityType: 'user',
      entityId: person.id,
      metadata: { version: acceptance.version, locale: acceptance.locale, surface: acceptance.surface, textSha256: acceptance.textSha256 },
      requestId,
    }));
}
