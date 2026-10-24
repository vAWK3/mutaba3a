import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ListVendorsQuerySchema, VendorSuggestionListSchema } from '../schemas.js';
import { serializeVendorSuggestion } from '../serializers.js';
import { errorResponses, validationResponse } from './shared.js';

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];

/**
 * /v1/vendors (MUT-254, ADR-183): the profile's vendors, saved automatically from every typed vendor. Read-only here:
 * a vendor is created or linked by the expense writes themselves. Session-only, in the expenses domain: Malafat's key
 * reaches none of it.
 */
export function vendorRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/vendors',
      tags: ['Expenses'],
      summary: 'Vendor suggestions for what was typed (the typeahead)',
      description:
        'Names (a vendor’s own or an alias) that start with the query rank first, then names that contain it, then near-misses (similar spelling, at least 60%); one row per vendor, best name first. Matching ignores case, spacing, punctuation, Arabic letter forms and diacritics, and a trailing legal suffix (Ltd, Inc, בע״מ, ش.م.م …). Empty q: the most recently used. Suggestions only: saving an expense matches its vendor exactly.',
      security: SESSION_ONLY,
      middleware: [requireScope('expenses:read')] as const,
      request: { query: ListVendorsQuerySchema },
      responses: { 200: { description: 'Suggestions', content: { 'application/json': { schema: VendorSuggestionListSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const { q, limit } = c.req.valid('query');
      const hits = await store.vendors.search(organization.id, q ?? '', limit);
      return c.json({ items: hits.map(serializeVendorSuggestion) }, 200);
    },
  );

  return app;
}
