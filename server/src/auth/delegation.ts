import type { IntegrationRecord, LedgerStore } from '../repositories/ports.js';

/**
 * MUT-593 (ADR-254): Malafat acting as one person, on one firm. A delegated token resolves to the person (the session
 * path below it is unchanged) plus this `via`, which binds it to the one profile its Malafat tenant names (D9): the
 * integration is unique per tenant, so a delegated token reaches exactly one profile.
 */
export interface DelegatedVia {
  clientId: string;
  grantId: string;
  tenantId: string;
  /** The profile the tenant's CONNECTED integration names. */
  organizationId: string;
}

/** What an audit row written on a delegated call carries in `metadata.via` (AC9: "Rana (via Malafat)"). */
export const DELEGATED_AUDIT_VIA = 'malafat';

/** MUT-596: a record Malafat writes as the person shows "(via Malafat)": its stored capture source, set by the server. */
export const DELEGATED_CAPTURE_SOURCE = 'malafat';

/**
 * The organization-independent routes a delegated token may call, by endpoint key. Everything else that names no
 * profile (the cross-profile feed and verdict, inbox, billing, sessions…) would reach past the tenant, so it is
 * refused even if a route declares `delegated`. `/v1/me` filters itself to the tenant's profile.
 */
export const DELEGATED_PERSON_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me']);

/**
 * The owner routes that name their profile in the path rather than X-Mutaba3a-Profile (accountant access, share
 * links). A delegated token reaches one only when that path's profile is the tenant's.
 */
export const DELEGATED_PROFILE_PATH_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/profiles/:profileId/accountants',
  'GET /v1/profiles/:profileId/accountants',
  'DELETE /v1/profiles/:profileId/accountants/:grantId',
  'POST /v1/profiles/:profileId/share-links',
  'GET /v1/profiles/:profileId/share-links',
  'DELETE /v1/profiles/:profileId/share-links/:linkId',
]);

/** The firm a tenant's delegated tokens act on: a CONNECTED Malafat integration with the operator's switch on. */
export async function delegatedFirm(store: LedgerStore, tenantId: string): Promise<IntegrationRecord | null> {
  const integration = await store.integrations.findByProviderAndTenant('MALAFAT', tenantId);
  return integration && integration.status === 'CONNECTED' && integration.delegationEnabledAt !== null ? integration : null;
}

/** Consent (ADR-254 §7, R6): a person may let Malafat act for them only on a delegated firm they are a member of. */
export async function mayDelegate(store: LedgerStore, userId: string, tenantId: string): Promise<boolean> {
  const firm = await delegatedFirm(store, tenantId);
  return firm !== null && (await store.memberships.find(userId, firm.organizationId)) !== null;
}

const PROFILE_PATH = /^\/v1\/profiles\/([^/]+)(?:\/|$)/;

/** The `{profileId}` of a `/v1/profiles/{profileId}/…` path, for the tenant check on routes that name it in the path. */
export function profileIdInPath(path: string): string | null {
  return PROFILE_PATH.exec(path)?.[1] ?? null;
}
