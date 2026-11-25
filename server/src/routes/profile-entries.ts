import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { feedPage } from '../entries/feed-page.js';
import { decodeFeedCursor, rowKindOf } from '../entries/merge.js';
import type { LedgerStore } from '../repositories/ports.js';
import { EntryPageSchema, ProfileEntriesQuerySchema } from '../schemas.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';
import { PERSON_OR_MALAFAT } from './security.js';

// MUT-64: a device session is the same 'session' principal, so it reaches every route a cookie session does.

/**
 * MUT-575 (ADR-249, E6): one profile's entries feed, named by X-Mutaba3a-Profile and served through selectProfile like
 * every profile-scoped route. That is the whole access story: a member reads the profile they belong to; an accountant
 * reads a client shared with them, under MUT-559's method gate, the GET allowlist derived from this route's scope tags
 * (no list names it) and the read-only store guard; any other profile is 404 PROFILE_NOT_FOUND. `/v1/entries` stays
 * the person's memberships only, so an accountant's own feed never mixes a client in.
 *
 * Always by money date, newest first: the shape of `/v1/entries?order=occurredOn`, built by the same `feedPage`.
 * Never lazy-posts.
 */
export function profileEntriesRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/profile-entries',
      tags: ['Entries'],
      summary: 'One profile’s entries, newest money date first',
      description:
        'MUT-575. The expenses, received payments, Owed entries and conversions of the profile named in X-Mutaba3a-Profile, newest money date first, then newest logged: the same items and cursor as GET /v1/entries?profileId=…&order=occurredOn. ' +
        'An accountant reads a client shared with them this way (read-only). kinds narrows (all four when absent); occurredFrom and occurredBefore bound the money date. ' +
        'A profile you can’t open answers 404 PROFILE_NOT_FOUND, including one whose sharing ended between two pages.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('expenses:read'), requireScope('payments:read'), requireScope('conversions:read')] as const,
      request: { query: ProfileEntriesQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: EntryPageSchema } } }, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const page = await feedPage(store, [organization.id], {
        limit: q.limit,
        order: 'occurredOn',
        cursor: q.cursor ? decodeFeedCursor(q.cursor, 'occurredOn') : null,
        ...(q.kinds !== undefined && { kinds: [...new Set(q.kinds)].map(rowKindOf) }),
        ...(q.occurredFrom !== undefined && { occurredFrom: q.occurredFrom }),
        ...(q.occurredBefore !== undefined && { occurredBefore: q.occurredBefore }),
      });
      return c.json(page, 200);
    },
  );

  return app;
}
