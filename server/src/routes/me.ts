import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { entitlementsFor, serializeEntitlement } from '../billing/coverage.js';
import { termsAccepted, type CurrentTerms } from '../legal.js';
import { resolveMalafatSuggestions } from '../malafat-suggestions.js';
import { SUPPORTED_CURRENCIES } from '../money.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, MeSchema } from '../schemas.js';
import { hostedProfileFor } from '../serializers.js';
import { MAX_OWNED_PROFILES } from './profiles.js';

/** GET /v1/me, acting on the person rather than an organization: no X-Mutaba3a-Profile. */
export const ME_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/me']);

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

/**
 * The signed-in person and the hosted profiles they may open (MUT-38,
 * hosted-portal.md §4, §6). Split out of routes/sessions.ts (MUT-286) so the
 * portal's local-mode backend can register it without pulling in sign-in,
 * which needs argon2 and never applies there.
 */
export function meRoutes(store: LedgerStore, terms: CurrentTerms | null, billing: boolean): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Sessions'],
      summary: 'The signed-in person and the hosted profiles they may open',
      security: [{ session: [] }, { deviceSession: [] }],
      responses: {
        200: { description: 'Me', content: { 'application/json': { schema: MeSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => c.json(await buildMe(store, c.get('identity').user, terms, billing ? c.get('now')() : null), 200),
  );

  return app;
}

/**
 * Exported for routes/device-sessions.ts (MUT-64): both sign-in surfaces return the same Me shape.
 * `terms` is null where no terms apply (MUT-324: the portal's signed-out mode). `billingAt` is null there too
 * (MUT-358), and every profile's `billing` is then null; otherwise it is the request's clock.
 */
export async function buildMe(store: LedgerStore, user: UserRecord, terms: CurrentTerms | null, billingAt: Date | null) {
  const loaded = [];
  for (const membership of await store.memberships.listByUser(user.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (!organization) continue;
    const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
    loaded.push({ organization, membership, malafatConnected: malafat?.status === 'CONNECTED' });
  }
  // MUT-358: one billing read for all the profiles (billing/coverage.ts), never one per profile.
  const entitlements = billingAt ? await entitlementsFor(store, loaded, billingAt) : null;
  const profiles = loaded.map(({ organization, membership, malafatConnected }) => {
    const entitlement = entitlements?.get(organization.id);
    return {
      ...hostedProfileFor(organization, malafatConnected ? 'MALAFAT' : null, user.id, membership),
      billing: entitlement ? serializeEntitlement(entitlement) : null,
    };
  });
  // MUT-120: the personal membership is created in the same instant as the firm's, so membership order alone ties on a
  // random id. A stable sort on rank keeps membership order (oldest first) inside each group: firms, then the profiles
  // the caller created (MUT-182), then the caller's personal profile last. The portal opens profiles[0].
  const rank = (p: { isPersonalDefault: boolean; owned: boolean }) => (p.isPersonalDefault ? 2 : p.owned ? 1 : 0);
  profiles.sort((a, b) => rank(a) - rank(b));
  const [ownedProfiles, termsNow] = await Promise.all([store.organizations.countOwnedBy(user.id), terms && termsStatus(store, user.id, terms)]);
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, malafatSuggestions: resolveMalafatSuggestions(user.malafatSuggestions) },
    profiles,
    limits: { ownedProfiles, maxOwnedProfiles: MAX_OWNED_PROFILES },
    currencies: [...SUPPORTED_CURRENCIES],
    terms: termsNow,
  };
}

/** MUT-324: the current version, and whether the person's latest acceptance covers it (D10). */
async function termsStatus(store: LedgerStore, userId: string, terms: CurrentTerms) {
  const latest = await store.users.latestTermsAcceptance(userId);
  return { version: terms.version, accepted: termsAccepted(latest?.version ?? null, terms.version) };
}
