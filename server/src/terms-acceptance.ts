import type { SessionKind } from './auth/sessions.js';
import { TERMS_SURFACE_OF, type CurrentTerms } from './legal.js';
import { profileOwnerOf } from './personal-profile.js';
import type { AuditEventInput, LedgerStore, TermsAcceptanceInput, UserLocale, UserRecord } from './repositories/ports.js';

/**
 * MUT-324 (ADR-102): what one acceptance of the current terms records, shared
 * by the setup-link redeem and POST /v1/me/terms-acceptance.
 */
export function termsAcceptanceOf(terms: CurrentTerms, locale: UserLocale, kind: SessionKind): TermsAcceptanceInput {
  return { version: terms.version, locale, textSha256: terms.sha256[locale], surface: TERMS_SURFACE_OF[kind] };
}

/**
 * `user.terms_accepted`, as the person, on each profile they own (D2): a person
 * accepts for themselves and, as owner, for their own profiles. A firm they are
 * only a member of never sees it.
 */
export async function termsAcceptedAudit(store: LedgerStore, person: UserRecord, acceptance: TermsAcceptanceInput, requestId: string): Promise<AuditEventInput[]> {
  const audit: AuditEventInput[] = [];
  for (const membership of await store.memberships.listByUser(person.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (!organization || profileOwnerOf(organization) !== person.id) continue;
    audit.push({
      organizationId: organization.id,
      actorType: 'USER',
      actorId: person.id,
      action: 'user.terms_accepted',
      entityType: 'user',
      entityId: person.id,
      metadata: { version: acceptance.version, locale: acceptance.locale, surface: acceptance.surface, textSha256: acceptance.textSha256 },
      requestId,
    });
  }
  return audit;
}
