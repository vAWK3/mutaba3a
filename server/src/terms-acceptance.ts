import type { SessionKind } from './auth/sessions.js';
import { ApiError } from './errors.js';
import { TERMS_SURFACE_OF, type CurrentTerms } from './legal.js';
import { ownedProfilesOf } from './personal-profile.js';
import type { AuditEventInput, LedgerStore, TermsAcceptanceInput, UserLocale, UserRecord } from './repositories/ports.js';

/**
 * MUT-324 (ADR-102): what one acceptance of the current terms records, shared
 * by the setup-link redeem and POST /v1/me/terms-acceptance. MUT-354: plus the
 * client release the request named, kept as sent (null when it named none).
 */
export function termsAcceptanceOf(terms: CurrentTerms, locale: UserLocale, kind: SessionKind, clientRelease: string | undefined): TermsAcceptanceInput {
  return { version: terms.version, locale, textSha256: terms.sha256[locale], surface: TERMS_SURFACE_OF[kind], clientRelease: clientRelease ?? null };
}

/** The shared refusal for a missing or outdated terms version: the setup-link redeem and POST /v1/me/terms-acceptance. */
export function staleTerms(terms: CurrentTerms): ApiError {
  return new ApiError('TERMS_VERSION_STALE', 'The terms changed; read the current version and accept it', { current: terms.version });
}

/**
 * `user.terms_accepted`, as the person, on each profile they own (D2): a person
 * accepts for themselves and, as owner, for their own profiles. A firm they are
 * only a member of never sees it (ownedProfilesOf).
 */
export async function termsAcceptedAudit(store: LedgerStore, person: UserRecord, acceptance: TermsAcceptanceInput, requestId: string): Promise<AuditEventInput[]> {
  return (await ownedProfilesOf(store, person.id)).map((organization) => ({
      organizationId: organization.id,
      actorType: 'USER' as const,
      actorId: person.id,
      action: 'user.terms_accepted',
      entityType: 'user',
      entityId: person.id,
      metadata: {
        version: acceptance.version,
        locale: acceptance.locale,
        surface: acceptance.surface,
        textSha256: acceptance.textSha256,
        clientRelease: acceptance.clientRelease,
      },
      requestId,
    }));
}
