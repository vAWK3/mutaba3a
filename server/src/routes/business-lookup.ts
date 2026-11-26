import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { defaultPack, type RegistryLookup } from '../jurisdictions/index.js';
import type { RateLimiter } from '../rate-limit.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';
import { PERSON_OR_MALAFAT } from './security.js';

const RegistryEntrySchema = z
  .object({
    taxId: z.string(),
    kind: z.enum(['company', 'nonprofit']),
    name: z.string(),
    nameEn: z.string().nullable(),
    status: z.string().openapi({ description: 'As the registry says it (Hebrew), e.g. פעילה, מחוקה, רשומה' }),
    active: z.boolean().openapi({ description: 'False for a dissolved, struck-off or deleted body: warn before invoicing it' }),
    address: z.string().nullable(),
  })
  .openapi('BusinessLookup');

/**
 * MUT-642: type a 9-digit number, get the business. Hosted only (it calls data.gov.il), so outside PORTAL_ROUTES; the
 * signed-out portal has no lookup. A sole dealer's number is in no public registry: 404 NOT_IN_REGISTRY, and the person
 * types the name.
 */
export function businessLookupRoutes(options: { registry: RegistryLookup | null; limiter: RateLimiter }): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/business-lookup',
      tags: ['Customers'],
      summary: 'Look a company or nonprofit up by its number',
      description: 'Validates the check digit (422 TAX_ID_INVALID), then asks the Registrar of Companies or the nonprofits registry (open data). 404 NOT_IN_REGISTRY for a number neither holds (a sole dealer, a person); 502 REGISTRY_UNAVAILABLE when the registry doesn\'t answer in time.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('customers:read')] as const,
      request: { query: z.object({ number: z.string().max(20) }) },
      responses: { 200: { description: 'Found', content: { 'application/json': { schema: RegistryEntrySchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { user } = sessionAuth(c);
      const taxId = defaultPack().taxId.normalize(c.req.valid('query').number);
      if (!taxId) throw new ApiError('VALIDATION_FAILED', 'Not a valid VAT, company or ID number (9 digits with the check digit)', { field: 'number', reason: 'TAX_ID_INVALID' });
      const budget = await options.limiter.check(`business-lookup:${user.id}`, c.get('now')());
      if (!budget.allowed) {
        c.header('Retry-After', String(budget.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many lookups; try again shortly');
      }
      const result = options.registry ? await options.registry.lookup(taxId) : { kind: 'unavailable' as const };
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No company or nonprofit with this number', { reason: 'NOT_IN_REGISTRY' });
      if (result.kind === 'unavailable') throw new ApiError('REGISTRY_UNAVAILABLE', 'The registry didn\'t answer; type the details');
      return c.json({ taxId, ...result.entry }, 200);
    },
  );
  return app;
}
