import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { requireTwoFactor } from '../auth/two-factor-flow.js';
import { ApiError } from '../errors.js';
import { TaxAuthorityError, type DecisionChoice } from '../israel/tax-authority/client.js';
import { accessTokenFor, allocationInvoiceId, connectionFrom, newState, readState, statusOf, type TaxAuthorityDeps } from '../israel/tax-authority/service.js';
import type { JsonObject, Organization } from '../repositories/ports.js';
import { AllocationDecisionRequestSchema, TaxAuthorityConnectSchema, TaxAuthorityStatusSchema } from '../schemas.js';
import { PERSON_OR_MALAFAT } from './security.js';
import { conflictResponse, errorResponses, notFoundResponse, validationResponse } from './shared.js';

/**
 * MUT-571 (ADR-264): connecting a profile to the Tax Authority. The owner asks for the authorize URL (a signed,
 * ten-minute `state` names the profile and the person), signs in at the Tax Authority, and its browser comes back to
 * the unauthenticated callback, which checks the state, swaps the code for tokens and stores them sealed. Then it sends
 * the browser to the portal's invoicing setup (or answers a short page when no portal origin is configured).
 * MUT-572: the owner reports a held allocation's choice (cancel, or a hearing; "continue" is the issue itself).
 */
const json = <T>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });

export interface TaxAuthorityRouteDeps {
  store: TaxAuthorityDeps['store'];
  taxAuthority: TaxAuthorityDeps | null;
  issuingProfile: (c: Context<AppEnv>, write: boolean) => Promise<Organization>;
  audit: (c: Context<AppEnv>, action: string, entityType: string, entityId: string, metadata?: JsonObject) => Promise<unknown>;
  portalOrigin: string | null;
  vatNumberOf: (organizationId: string) => Promise<number | null>;
}

const serialize = (status: ReturnType<typeof statusOf>) =>
  status.state === 'none' ? { state: status.state, connectedAt: null, until: null, environment: null } : { state: status.state, connectedAt: status.connectedAt.toISOString(), until: status.until?.toISOString() ?? null, environment: status.environment };

export function registerTaxAuthorityRoutes(app: OpenAPIHono<AppEnv>, deps: TaxAuthorityRouteDeps): void {
  const off = () => new ApiError('NOT_FOUND', 'Not found', { reason: 'TAX_AUTHORITY_OFF' });
  const configured = (): TaxAuthorityDeps => {
    if (!deps.taxAuthority) throw off();
    return deps.taxAuthority;
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/tax-authority',
      tags: ['Issuing'],
      summary: 'Whether this profile is connected to the Tax Authority',
      description: 'MUT-571: `connected` until the consent ends (90 days), then `expired` (connect again); `none` before the first connect. 404 when this server has no Tax Authority connection configured.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The connection', TaxAuthorityStatusSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, false);
      return c.json(serialize(statusOf(await deps.store.issuing.getTaxConnection(organization.id), ta.client.environment, c.get('now')())), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/tax-authority/connect',
      tags: ['Issuing'],
      summary: 'Start connecting this profile to the Tax Authority',
      description: 'MUT-571: answers the Tax Authority sign-in address to open in the browser. Its `state` is good for 10 minutes and names this profile and person. Owner only.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), requireTwoFactor(deps.store)] as const,
      responses: { 200: json('Where to sign in', TaxAuthorityConnectSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, true);
      const { user } = sessionAuth(c);
      return c.json({ authorizeUrl: ta.client.authorizeUrl(newState(ta.stateSecret, organization.id, user.id, c.get('now')())) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/tax-authority/callback',
      tags: ['Issuing'],
      summary: 'Where the Tax Authority sends the browser back after sign-in',
      description: 'MUT-571: unauthenticated; trusts only its signed `state`. Swaps the code for tokens, stores them sealed, and redirects to the portal\'s invoicing setup with `taxAuthority=connected` or `failed`.',
      security: [],
      request: { query: z.object({ code: z.string().max(4096).optional(), state: z.string().max(2048).optional(), error: z.string().max(200).optional() }) },
      responses: { 302: { description: 'Back to the portal' }, 200: { description: 'Done (no portal configured)', content: { 'text/html': { schema: z.string() } } } },
    }),
    async (c) => {
      const ta = configured();
      const now = c.get('now')();
      const { code, state, error } = c.req.valid('query');
      const claim = state ? readState(ta.stateSecret, state, now) : null;
      let outcome: 'connected' | 'failed' = 'failed';
      if (claim && code && !error) {
        try {
          const tokens = await ta.client.exchangeCode(code);
          await ta.store.issuing.putTaxConnection(connectionFrom(ta, tokens, { organizationId: claim.profileId, connectedByUserId: claim.userId, connectedAt: now, refreshExpiresAt: null }, now));
          await ta.store.audit.append({ organizationId: claim.profileId, actorType: 'USER', actorId: claim.userId, action: 'tax_authority.connected', entityType: 'issuer_details', entityId: claim.profileId, requestId: c.get('requestId') });
          outcome = 'connected';
        } catch (err) {
          // The reason is kept (never the code or a token); the browser just hears it failed.
          if (claim) {
            await ta.store.audit.append({ organizationId: claim.profileId, actorType: 'USER', actorId: claim.userId, action: 'tax_authority.connect_failed', entityType: 'issuer_details', entityId: claim.profileId, metadata: { status: err instanceof TaxAuthorityError ? err.status : null }, requestId: c.get('requestId') });
          }
        }
      }
      if (deps.portalOrigin && claim) return c.redirect(`${deps.portalOrigin}/p/${claim.profileId}/you/invoicing?taxAuthority=${outcome}`, 302);
      return c.html(`<!doctype html><meta charset="utf-8"><title>MTB3A</title><p>${outcome === 'connected' ? 'Connected to the Tax Authority. You can close this window.' : 'The connection to the Tax Authority did not complete. Close this window and try again.'}</p>`, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/issuing/tax-authority',
      tags: ['Issuing'],
      summary: 'Disconnect this profile from the Tax Authority',
      description: 'MUT-571: the stored tokens are deleted. Issuing above the allocation threshold then waits for a new connection. Owner only.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write')] as const,
      responses: { 204: { description: 'Disconnected' }, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      configured();
      const organization = await deps.issuingProfile(c, true);
      if (await deps.store.issuing.deleteTaxConnection(organization.id)) await deps.audit(c, 'tax_authority.disconnected', 'issuer_details', organization.id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/allocation-decisions',
      tags: ['Issuing'],
      summary: 'Report the choice for a held allocation number',
      description:
        'MUT-572: after a 409 ALLOCATION_HELD, the owner reports CANCEL (abandon the invoice) or FURTHER_OBJECTION (ask for a hearing) to the Tax Authority, naming the held request by its Idempotency-Key. To issue without a number, send the issue again with a new key and `withoutAllocation.heldKey`; that reports CONTINUE. Reverse charge is not offered yet (ADR-264).',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), requireTwoFactor(deps.store)] as const,
      request: { body: { required: true, content: { 'application/json': { schema: AllocationDecisionRequestSchema } } } },
      responses: { 204: { description: 'Reported' }, ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, true);
      const { heldKey, choice } = c.req.valid('json');
      await reportDecision(ta, deps, organization.id, heldKey, choice, c.get('now')());
      await deps.audit(c, 'issued_document.allocation_decision', 'issuer_details', organization.id, { choice });
      return c.body(null, 204);
    },
  );
}

/** Reports a held invoice's choice to the Tax Authority (InvoiceDecision); throws when it isn't heard. */
export async function reportDecision(ta: TaxAuthorityDeps, deps: Pick<TaxAuthorityRouteDeps, 'vatNumberOf'>, organizationId: string, heldKey: string, choice: DecisionChoice, now: Date): Promise<void> {
  const token = await accessTokenFor(ta, organizationId, now);
  if (!token) throw new ApiError('CONFLICT', 'Connect this profile to the Tax Authority first', { reason: 'TAX_AUTHORITY_NOT_CONNECTED' });
  const vatNumber = await deps.vatNumberOf(organizationId);
  if (vatNumber === null) throw new ApiError('VALIDATION_FAILED', 'Add the business details printed on documents first', { reason: 'ISSUER_DETAILS_REQUIRED' });
  let answer: { ok: boolean; message: string | null };
  try {
    answer = await ta.client.decide(token, choice, { invoiceId: allocationInvoiceId(organizationId, heldKey), vatNumber, accountingSoftwareNumber: ta.accountingSoftwareNumber });
  } catch {
    throw new ApiError('TAX_AUTHORITY_UNAVAILABLE', 'The Tax Authority did not answer; try again shortly');
  }
  if (!answer.ok) throw new ApiError('VALIDATION_FAILED', 'The Tax Authority did not accept the choice', { reason: 'ALLOCATION_DECISION_REFUSED', message: answer.message });
}
