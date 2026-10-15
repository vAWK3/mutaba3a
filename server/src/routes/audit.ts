import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import type { LedgerStore } from '../repositories/ports.js';
import { EXPENSE_ENTITY_TYPES } from '../expenses/compose.js';
import { AuditPageSchema, ListAuditQuerySchema } from '../schemas.js';
import { serializeAuditEvent } from '../serializers.js';
import { encodeNextCursor, errorResponses, toPageRequest, validationResponse } from './shared.js';

/**
 * Audit entity types of a hosted profile's own session-only activity: expenses (MUT-42) and
 * conversions (MUT-161; closed by MUT-194 — `conversion.created` used to leak here).
 */
export const SESSION_ONLY_ENTITY_TYPES = [...EXPENSE_ENTITY_TYPES, 'conversion'] as const;

/**
 * MUT-223: a person's own edits on rows whose entity types Malafat does read (receivable, payment). Excluded by action,
 * since excluding the entity type would hide every receivable and payment event from Malafat.
 */
export const OWED_REDATED = 'income.owed.redated';
export const PAYMENT_REDATED = 'payment.redated';
export const SESSION_ONLY_ACTIONS = [OWED_REDATED, PAYMENT_REDATED] as const;

/** /v1/audit — the organization's financial history for API keys (M6 brief §2). */
export function auditRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/audit',
      tags: ['Audit'],
      summary: 'List audit events, oldest first, filtered by entity or action',
      description: 'entityType is the API’s entity name (payment, receivable, agreement, installment, retainer_charge, customer, project, attachment, …); entityId its id. Keyset pagination like every list.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('audit:read')] as const,
      request: { query: ListAuditQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: AuditPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      // MUT-42, MUT-194: expense and conversion activity is a hosted profile's own; Malafat's key never lists it,
      // not even when it asks for that entity type by name. MUT-223: nor a person's own re-dates, excluded by action.
      const page = await store.audit.list(organization.id, { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.action ? { action: q.action } : {}), excludeEntityTypes: SESSION_ONLY_ENTITY_TYPES, excludeActions: SESSION_ONLY_ACTIONS }, toPageRequest(q));
      return c.json({ items: page.items.map(serializeAuditEvent), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  return app;
}
