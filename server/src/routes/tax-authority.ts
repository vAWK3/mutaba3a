import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { requireTwoFactor } from '../auth/two-factor-flow.js';
import { ApiError } from '../errors.js';
import { TaxAuthorityError, type DecisionChoice } from '../israel/tax-authority/client.js';
import { accessTokenFor, allocationInvoiceId, connectionFrom, logTaxAuthority, newState, readState, statusOf, type TaxAuthorityDeps } from '../israel/tax-authority/service.js';
import { planLimitError, type TaxAuthorityPlan } from '../issuing/tax-authority-plan.js';
import type { JsonObject, Organization } from '../repositories/ports.js';
import type { UsagePlan } from '../usage/kinds.js';
import { AllocationDecisionRequestSchema, TaxAuthorityConnectSchema, TaxAuthorityStatusSchema } from '../schemas.js';
import { PERSON_OR_MALAFAT } from './security.js';
import { conflictResponse, errorResponses, notFoundResponse, validationResponse } from './shared.js';

/**
 * MUT-571 (ADR-264): connecting a profile to the Tax Authority. The owner asks for the authorize URL (a signed,
 * ten-minute `state` names the profile and the person), signs in at the Tax Authority, and its browser comes back to
 * the unauthenticated callback, which checks the state, swaps the code for tokens and stores them sealed. Then it sends
 * the browser back to the portal's invoicing setup: the portal the person pressed Connect on (signed into the state),
 * else this server's own portal when it serves one; with neither (an API-only server, a forged or late state) it
 * answers a short page of its own, never an address with no page behind it.
 * MUT-572: the owner reports a held allocation's choice (cancel, or a hearing; "continue" is the issue itself).
 * MUT-736 (ADR-282): the connection is a paid-plan feature. On Starter, connect and decisions refuse with 409
 * PLAN_LIMIT, a callback stores nothing (`taxAuthority=plan`), and a kept connection reads `suspended`: never deleted,
 * so it is connected again on a paid plan with no new setup. Disconnect always works.
 */
const json = <T>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });

export interface TaxAuthorityRouteDeps {
  store: TaxAuthorityDeps['store'];
  taxAuthority: TaxAuthorityDeps | null;
  issuingProfile: (c: Context<AppEnv>, write: boolean) => Promise<Organization>;
  audit: (c: Context<AppEnv>, action: string, entityType: string, entityId: string, metadata?: JsonObject) => Promise<unknown>;
  portalOrigin: string | null;
  /** This server serves the portal itself (PORTAL_DIST_DIR): its pages exist at PORTAL_ORIGIN, or its own origin. */
  servesPortal: boolean;
  vatNumberOf: (organizationId: string) => Promise<number | null>;
  /** MUT-736: whether the payer's plan includes the connection (`taxAuthorityPlanOf`). */
  planOf: (organization: Organization, now: Date) => Promise<TaxAuthorityPlan & { plan: UsagePlan }>;
  /** MUT-736: a paid plan can be bought on this server now (Checkout configured): the refusal's `canUpgrade`. */
  canUpgrade: boolean;
}

/** MUT-736: a kept connection on a plan without it reads `suspended` (nothing is deleted). */
const serialize = (status: ReturnType<typeof statusOf>, plan: TaxAuthorityPlan) => {
  const planView = { allowed: plan.allowed, nextPlan: plan.nextPlan };
  if (status.state === 'none') return { state: status.state, connectedAt: null, until: null, environment: null, plan: planView };
  return { state: plan.allowed ? status.state : ('suspended' as const), connectedAt: status.connectedAt.toISOString(), until: status.until?.toISOString() ?? null, environment: status.environment, plan: planView };
};

export function registerTaxAuthorityRoutes(app: OpenAPIHono<AppEnv>, deps: TaxAuthorityRouteDeps): void {
  const off = () => new ApiError('NOT_FOUND', 'Not found', { reason: 'TAX_AUTHORITY_OFF' });
  const configured = (): TaxAuthorityDeps => {
    if (!deps.taxAuthority) throw off();
    return deps.taxAuthority;
  };
  /** MUT-736: refuses unless the payer's plan includes the connection. */
  const requirePlan = async (organization: Organization, now: Date) => {
    const plan = await deps.planOf(organization, now);
    if (!plan.allowed) throw planLimitError({ limit: 'taxAuthority', plan: plan.plan, nextPlan: plan.nextPlan, canUpgrade: deps.canUpgrade });
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/tax-authority',
      tags: ['Issuing'],
      summary: 'Whether this profile is connected to the Tax Authority',
      description:
        'MUT-571: `connected` until the consent ends (90 days), then `expired` (connect again); `none` before the first connect. MUT-736: `suspended` while the payer’s plan has no connection (Starter), and `plan` says whether it does. 404 when this server has no Tax Authority connection configured.',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:read')] as const,
      responses: { 200: json('The connection', TaxAuthorityStatusSchema), ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, false);
      const now = c.get('now')();
      const [connection, plan] = await Promise.all([deps.store.issuing.getTaxConnection(organization.id), deps.planOf(organization, now)]);
      return c.json(serialize(statusOf(connection, ta.client.environment, now), plan), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/issuing/tax-authority/connect',
      tags: ['Issuing'],
      summary: 'Start connecting this profile to the Tax Authority',
      description:
        'MUT-571: answers the Tax Authority sign-in address to open in the browser. Its `state` is good for 10 minutes and names this profile and person. Owner only. MUT-736: 409 PLAN_LIMIT (`details`: limit taxAuthority, plan, nextPlan, canUpgrade) when the payer’s plan has no connection (Starter).',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), requireTwoFactor(deps.store)] as const,
      responses: { 200: json('Where to sign in', TaxAuthorityConnectSchema), ...conflictResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, true);
      await requirePlan(organization, c.get('now')());
      const { user } = sessionAuth(c);
      return c.json({ authorizeUrl: ta.client.authorizeUrl(newState(ta.stateSecret, organization.id, user.id, c.get('now')(), returnOriginOf(c, deps.portalOrigin))) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/issuing/tax-authority/callback',
      tags: ['Issuing'],
      summary: 'Where the Tax Authority sends the browser back after sign-in',
      description:
        'MUT-571: unauthenticated; trusts only its signed `state`. Swaps the code for tokens, stores them sealed, and redirects to the invoicing setup of the portal Connect was pressed on (else this server\'s own portal) with `taxAuthority=connected`, `refused` (the owner did not consent), `failed`, or `plan` (MUT-736: the payer’s plan no longer includes the connection; nothing exchanged or stored). With no portal to return to, or a forged or late state, it answers a short page saying what happened.',
      security: [],
      request: { query: z.object({ code: z.string().max(4096).optional(), state: z.string().max(2048).optional(), error: z.string().max(200).optional() }) },
      responses: { 302: { description: 'Back to the portal' }, 200: { description: 'Done (no portal configured)', content: { 'text/html': { schema: z.string() } } } },
    }),
    async (c) => {
      const ta = configured();
      const now = c.get('now')();
      const { code, state, error } = c.req.valid('query');
      const claim = state ? readState(ta.stateSecret, state, now) : null;
      // The Tax Authority sends `error` (access_denied) when the owner declines; nothing is exchanged then.
      let outcome: 'connected' | 'refused' | 'failed' | 'plan' = claim && error ? 'refused' : 'failed';
      // MUT-736: the plan may have changed since Connect; on one without the connection nothing is exchanged or stored.
      const profile = claim && code && !error ? await ta.store.organizations.getById(claim.profileId) : null;
      if (profile && !(await deps.planOf(profile, now)).allowed) outcome = 'plan';
      else if (claim && code && !error) {
        try {
          const tokens = await ta.client.exchangeCode(code);
          await ta.store.issuing.putTaxConnection(connectionFrom(ta, tokens, { organizationId: claim.profileId, connectedByUserId: claim.userId, connectedAt: now, refreshExpiresAt: null }, now));
          await ta.store.audit.append({ organizationId: claim.profileId, actorType: 'USER', actorId: claim.userId, action: 'tax_authority.connected', entityType: 'issuer_details', entityId: claim.profileId, requestId: c.get('requestId') });
          logTaxAuthority(ta, 'tax_authority.connected', { userId: claim.userId, organizationId: claim.profileId, requestId: c.get('requestId') });
          outcome = 'connected';
        } catch (err) {
          // The reason is kept (never the code or a token); the browser just hears it failed.
          if (claim) {
            logTaxAuthority(ta, 'tax_authority.connect_failed', { userId: claim.userId, organizationId: claim.profileId, outcome: String(err instanceof TaxAuthorityError ? err.status : 'error'), requestId: c.get('requestId') });
            await ta.store.audit.append({ organizationId: claim.profileId, actorType: 'USER', actorId: claim.userId, action: 'tax_authority.connect_failed', entityType: 'issuer_details', entityId: claim.profileId, metadata: { status: err instanceof TaxAuthorityError ? err.status : null }, requestId: c.get('requestId') });
          }
        }
      }
      const portal = claim?.returnOrigin ?? (deps.servesPortal ? setupLinkOrigin(deps.portalOrigin ?? undefined, c.req.url) : null);
      if (portal && claim) return c.redirect(`${portal.replace(/\/+$/, '')}/p/${claim.profileId}/you/invoicing?taxAuthority=${outcome}`, 302);
      return c.html(callbackPage(outcome), 200);
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
      const ta = configured();
      const organization = await deps.issuingProfile(c, true);
      if (await deps.store.issuing.deleteTaxConnection(organization.id)) {
        await deps.audit(c, 'tax_authority.disconnected', 'issuer_details', organization.id);
        logTaxAuthority(ta, 'tax_authority.disconnected', { userId: c.get('identity')?.user.id ?? null, organizationId: organization.id, requestId: c.get('requestId') });
      }
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
        'MUT-736: 409 PLAN_LIMIT on a plan without the connection (Starter). MUT-572: after a 409 ALLOCATION_HELD, the owner reports CANCEL (abandon the invoice) or FURTHER_OBJECTION (ask for a hearing) to the Tax Authority, naming the held request by its Idempotency-Key. To issue without a number, send the issue again with a new key and `withoutAllocation.heldKey`; that reports CONTINUE. Reverse charge is not offered yet (ADR-264).',
      security: PERSON_OR_MALAFAT,
      middleware: [requireScope('issuing:write'), requireTwoFactor(deps.store)] as const,
      request: { body: { required: true, content: { 'application/json': { schema: AllocationDecisionRequestSchema } } } },
      responses: { 204: { description: 'Reported' }, ...conflictResponse, ...validationResponse, ...notFoundResponse, ...errorResponses },
    }),
    async (c) => {
      const ta = configured();
      const organization = await deps.issuingProfile(c, true);
      await requirePlan(organization, c.get('now')());
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

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The portal the person pressed Connect on, to return to after the Tax Authority: the request's Origin, but only one
 * that is this server's portal (PORTAL_ORIGIN, or the API's own origin when it has none) or, on a local server, a
 * loopback dev portal (the Vite one on another port). Anything else (a phone's request with no Origin, a foreign site)
 * signs no origin into the state, so the callback falls back to this server's own portal or its own page.
 */
function returnOriginOf(c: Context<AppEnv>, portalOrigin: string | null): string | null {
  const origin = c.req.header('origin');
  if (!origin || origin === 'null') return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  if (portalOrigin && origin === new URL(portalOrigin).origin) return origin;
  if (origin === setupLinkOrigin(portalOrigin ?? undefined, c.req.url)) return origin;
  const localServer = portalOrigin ? LOOPBACK_ORIGIN.test(new URL(portalOrigin).origin) : LOOPBACK_ORIGIN.test(new URL(c.req.url).origin);
  return localServer && LOOPBACK_ORIGIN.test(origin) ? origin : null;
}

const PAGE_WORDS = {
  connected: { en: 'Connected to the Tax Authority. You can close this window and go back to MTB3A.', ar: 'تم الربط بسلطة الضرائب. يمكنك إغلاق هذه النافذة والعودة إلى متابعة.' },
  refused: { en: 'The connection was not approved on the Tax Authority’s site. Close this window and choose Connect to the Tax Authority again when you are ready.', ar: 'لم تتم الموافقة على الربط في موقع سلطة الضرائب. أغلق هذه النافذة واختر «الربط بسلطة الضرائب» مجددًا حين تكون مستعدًا.' },
  failed: { en: 'The connection to the Tax Authority did not complete. Close this window and try again.', ar: 'لم يكتمل الربط بسلطة الضرائب. أغلق هذه النافذة وحاول مجددًا.' },
  plan: { en: 'Nothing was connected. Close this window and go back to MTB3A.', ar: 'لم يُربط شيء. أغلق هذه النافذة وعُد إلى متابعة.' },
} as const;

/** The callback's own page, when there is no portal to return to: what happened, in Arabic first, then English. */
function callbackPage(outcome: keyof typeof PAGE_WORDS): string {
  const words = PAGE_WORDS[outcome];
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MTB3A</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.6"><p>${words.ar}</p><p lang="en" dir="ltr">${words.en}</p></body></html>`;
}
