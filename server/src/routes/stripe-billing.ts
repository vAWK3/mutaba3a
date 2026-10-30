import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../auth/middleware.js';
import { requestClientIp } from '../auth/sessions.js';
import { InvalidStripeSignature, type StripeGateway } from '../billing/stripe/gateway.js';
import { ReconcileRunning, type StripeSync } from '../billing/stripe/sync.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import { ErrorEnvelopeSchema, StripeReconcileSummarySchema, StripeWebhookResponseSchema } from '../schemas.js';

/**
 * MUT-360 (§2.5, ADR-165, D1): every HTTP door to the Stripe sync in one place.
 *
 *   POST /v1/billing/stripe/webhook          public; Stripe-Signature is the credential; failed signatures rate-limited
 *   POST /jobs/v1/billing/stripe-reconcile   the nightly Cloud Scheduler job, X-Job-Token (jobAuth on /jobs/*)
 *   POST /admin/v1/billing/stripe/reconcile  the operator (`npm run billing:reconcile`), X-Admin-Token
 *
 * Never in PORTAL_ROUTES: the local app has no Stripe. The webhook reads the raw body (no zod body, which would parse
 * it first): the signature covers the exact bytes Stripe sent.
 */
export const STRIPE_WEBHOOK_PATH = '/v1/billing/stripe/webhook';
export const STRIPE_WEBHOOK_POLICY = { ipPerMinute: 300 } as const;
export const STRIPE_WEBHOOK_MAX_BYTES = 256 * 1024;

export interface StripeBillingRouteOptions {
  /** Null: Stripe isn't configured, and all three answer 503 BILLING_NOT_CONFIGURED. */
  stripe: { sync: StripeSync; webhookGateway: StripeGateway } | null;
  ipLimiter: RateLimiter;
  trustedProxyHops: number;
  frontDoorToken?: string;
  /** MUT-487: the legacy forwarder's secret, trusted for the client IP only. */
  forwarderToken?: string;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function stripeBillingRoutes(options: StripeBillingRouteOptions): OpenAPIHono<AppEnv> {
  const { stripe, ipLimiter } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.use(
    STRIPE_WEBHOOK_PATH,
    bodyLimit({
      maxSize: STRIPE_WEBHOOK_MAX_BYTES,
      onError: (c) => {
        const err = new ApiError('PAYLOAD_TOO_LARGE', `A Stripe event is at most ${STRIPE_WEBHOOK_MAX_BYTES / 1024} KB`);
        return c.json(err.toEnvelope(c.get('requestId')), err.status);
      },
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: STRIPE_WEBHOOK_PATH,
      tags: ['Billing'],
      summary: 'Stripe webhook: mirrors subscriptions after re-reading them from Stripe',
      description:
        'Called by Stripe only. The raw body is verified against `Stripe-Signature` (the endpoint secret, 300 s tolerance); a bad, missing ' +
        'or old signature is 400 and nothing is stored. An event already handled answers 200 `duplicate`. The subscription is re-fetched ' +
        'from Stripe rather than trusted from the payload, so events arriving out of order end in Stripe’s current state. A Stripe or ' +
        `database failure is 500 so Stripe redelivers. Failed signatures are rate-limited to ${STRIPE_WEBHOOK_POLICY.ipPerMinute} per minute per address; verified events never are.`,
      security: [],
      responses: {
        200: { description: 'Handled, ignored, a duplicate, or recorded for the operator', content: { 'application/json': { schema: StripeWebhookResponseSchema } } },
        400: errorResponse('INVALID_SIGNATURE'),
        413: errorResponse('PAYLOAD_TOO_LARGE'),
        429: errorResponse('Too many failed signatures from this address; `Retry-After` says when to try again'),
        500: errorResponse('The event could not be handled now; Stripe redelivers it'),
        503: errorResponse('BILLING_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      if (!stripe) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
      const raw = await c.req.text();
      let event;
      try {
        event = stripe.webhookGateway.verifyEvent(raw, c.req.header('stripe-signature') ?? '');
      } catch (err) {
        if (!(err instanceof InvalidStripeSignature)) throw err;
        // Only failed signatures spend the address's budget: Stripe sends every account's webhooks from a few shared
        // IPs, so counting verified events would let anyone's junk deliveries 429 ours (MUT-360 review).
        const ip = await ipLimiter.check(`stripe-webhook:${requestClientIp((name) => c.req.header(name), options)}`, c.get('now')());
        if (!ip.allowed) {
          c.header('Retry-After', String(ip.retryAfterSeconds));
          throw new ApiError('RATE_LIMITED', 'Too many requests; try again in a minute', { retryAfterSeconds: ip.retryAfterSeconds });
        }
        throw new ApiError('INVALID_SIGNATURE', 'Stripe-Signature does not verify for this endpoint');
      }
      const handled = await stripe.sync.handleEvent(event, c.get('requestId'));
      if (handled.status === 500) throw new ApiError('INTERNAL', 'The event could not be handled now; Stripe will redeliver it');
      return c.json({ received: true as const, result: handled.result }, 200);
    },
  );

  const reconcileResponses = (unauthorized: string, unavailable: string) => ({
    200: { description: 'The run’s summary; `errors` lists what needs the operator', content: { 'application/json': { schema: StripeReconcileSummarySchema } } },
    401: errorResponse(unauthorized),
    409: errorResponse('RECONCILE_RUNNING'),
    502: errorResponse('RECONCILE_FAILED: Stripe could not be listed; `details` is the run summary'),
    503: errorResponse(unavailable),
  });
  const reconcile = async (requestId: string) => {
    if (!stripe) throw new ApiError('BILLING_NOT_CONFIGURED', 'Stripe is not configured on this server');
    let summary;
    try {
      summary = await stripe.sync.reconcile(requestId);
    } catch (err) {
      if (err instanceof ReconcileRunning) throw new ApiError('RECONCILE_RUNNING', 'A Stripe reconcile is already running');
      throw err;
    }
    // Nothing was reconciled: answer non-2xx so the Scheduler retries and logs a failure (an alert watches it).
    if (summary.errors.some((e) => e.code === 'LIST_FAILED')) throw new ApiError('RECONCILE_FAILED', 'Stripe could not be listed; nothing was reconciled', summary);
    return summary;
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/jobs/v1/billing/stripe-reconcile',
      tags: ['Billing'],
      summary: 'Nightly Stripe reconcile (Cloud Scheduler)',
      description: 'Lists every Stripe subscription and repairs the mirror, so a missed webhook heals within a day. Always 200 once it ran; the job token opens nothing else.',
      security: [{ jobToken: [] }],
      responses: reconcileResponses('JOB_UNAUTHORIZED', 'BILLING_NOT_CONFIGURED or JOBS_NOT_CONFIGURED'),
    }),
    async (c) => c.json(await reconcile(c.get('requestId')), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/billing/stripe/reconcile',
      tags: ['Admin'],
      summary: 'Run the Stripe reconcile now',
      description: 'The same run as the nightly job, for the operator (pilot cutover, after fixing metadata).',
      security: [{ adminToken: [] }],
      responses: reconcileResponses('Missing or invalid admin token', 'BILLING_NOT_CONFIGURED'),
    }),
    async (c) => c.json(await reconcile(c.get('requestId')), 200),
  );

  return app;
}
