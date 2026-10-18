import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
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
export function meRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
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
    async (c) => c.json(await buildMe(store, c.get('identity').user), 200),
  );

  return app;
}

/** Exported for routes/device-sessions.ts (MUT-64): both sign-in surfaces return the same Me shape. */
export async function buildMe(store: LedgerStore, user: UserRecord) {
  const profiles = [];
  for (const membership of await store.memberships.listByUser(user.id)) {
    const organization = await store.organizations.getById(membership.organizationId);
    if (!organization) continue;
    const malafat = await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT');
    profiles.push(hostedProfileFor(organization, malafat?.status === 'CONNECTED' ? 'MALAFAT' : null, user.id));
  }
  // MUT-120: the personal membership is created in the same instant as the firm's, so membership order alone ties on a
  // random id. A stable sort on rank keeps membership order (oldest first) inside each group: firms, then the profiles
  // the caller created (MUT-182), then the caller's personal profile last. The portal opens profiles[0].
  const rank = (p: { isPersonalDefault: boolean; owned: boolean }) => (p.isPersonalDefault ? 2 : p.owned ? 1 : 0);
  profiles.sort((a, b) => rank(a) - rank(b));
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName, locale: user.locale, malafatSuggestions: resolveMalafatSuggestions(user.malafatSuggestions) },
    profiles,
    limits: { ownedProfiles: await store.organizations.countOwnedBy(user.id), maxOwnedProfiles: MAX_OWNED_PROFILES },
    currencies: [...SUPPORTED_CURRENCIES],
  };
}
