import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv } from '../auth/middleware.js';
import { requestClientIp } from '../auth/sessions.js';
import { suppressionsFrom } from '../email/resend-webhook.js';
import { verifySvixSignature } from '../email/svix.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore } from '../repositories/ports.js';
import { EmailWebhookResponseSchema, ErrorEnvelopeSchema } from '../schemas.js';

/**
 * MUT-359 (ADR-159 §5, D12, D19, D20): Resend's bounce and complaint webhook. A `security: []` route under /v1 like
 * the Stripe webhook, so the public-surface pins (no-self-registration, route-security) list it. The raw body is
 * verified against the Svix signature before anything is parsed; a failure is 401, writes nothing and spends the
 * caller's failed-signature budget. Verified events are never rate-limited. It is on whenever a signing secret is
 * set, whatever MAILER says: Resend sends the shared account's events as soon as the endpoint exists.
 */
export const EMAIL_WEBHOOK_PATH = '/v1/email/resend/webhook';
export const EMAIL_WEBHOOK_POLICY = { ipPerMinute: 60 } as const;
export const EMAIL_WEBHOOK_MAX_BYTES = 64 * 1024;

export interface EmailWebhookRouteOptions {
  /** Null: no signing secret, and the route answers 503 MAILER_NOT_CONFIGURED. */
  webhook: { secret: string; fromDomain: string } | null;
  /** The unguarded store: a webhook is not a principal's request. */
  store: LedgerStore;
  ipLimiter: RateLimiter;
  trustedProxyHops: number;
  frontDoorToken?: string;
  /** MUT-487: the legacy forwarder's secret, trusted for the client IP only. */
  forwarderToken?: string;
  logger: Logger;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function emailWebhookRoutes(options: EmailWebhookRouteOptions): OpenAPIHono<AppEnv> {
  const { webhook, store, ipLimiter, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.use(
    EMAIL_WEBHOOK_PATH,
    bodyLimit({
      maxSize: EMAIL_WEBHOOK_MAX_BYTES,
      onError: (c) => {
        const err = new ApiError('PAYLOAD_TOO_LARGE', `A Resend event is at most ${EMAIL_WEBHOOK_MAX_BYTES / 1024} KB`);
        return c.json(err.toEnvelope(c.get('requestId')), err.status);
      },
    }),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: EMAIL_WEBHOOK_PATH,
      tags: ['Email'],
      summary: 'Resend webhook: suppresses addresses that hard-bounce or complain',
      description:
        'Called by Resend (Svix-signed) only. The raw body is verified against `svix-id`, `svix-timestamp` and `svix-signature` with the ' +
        'endpoint secret, within 5 minutes; anything else is 401 and nothing is stored. Only events sent from this server\'s own mail ' +
        'domain count: `email.bounced` with a Permanent bounce and `email.complained` suppress every recipient, so no more mail goes ' +
        `to them; every other event is acknowledged and ignored. Failed signatures are rate-limited to ${EMAIL_WEBHOOK_POLICY.ipPerMinute} per minute per address. ` +
        'A database failure is 500, so Resend redelivers.',
      security: [],
      responses: {
        200: { description: 'Suppressed, or acknowledged and ignored', content: { 'application/json': { schema: EmailWebhookResponseSchema } } },
        401: errorResponse('INVALID_WEBHOOK_SIGNATURE'),
        413: errorResponse('PAYLOAD_TOO_LARGE'),
        429: errorResponse('Too many failed signatures from this address; `Retry-After` says when to try again'),
        500: errorResponse('The event could not be stored now; Resend redelivers it'),
        503: errorResponse('MAILER_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      if (!webhook) throw new ApiError('MAILER_NOT_CONFIGURED', 'The Resend webhook is not configured on this server');
      const raw = await c.req.text();
      const now = c.get('now')();
      if (!verifySvixSignature({ secret: webhook.secret, header: (name) => c.req.header(name), body: raw, now })) {
        const ip = await ipLimiter.check(`email-webhook:${requestClientIp((name) => c.req.header(name), options)}`, now);
        if (!ip.allowed) {
          c.header('Retry-After', String(ip.retryAfterSeconds));
          throw new ApiError('RATE_LIMITED', 'Too many requests; try again in a minute', { retryAfterSeconds: ip.retryAfterSeconds });
        }
        throw new ApiError('INVALID_WEBHOOK_SIGNATURE', 'The Svix signature does not verify for this endpoint');
      }
      let event: unknown = null;
      try {
        event = JSON.parse(raw);
      } catch {
        logger.warn({ requestId: c.get('requestId') }, 'resend webhook: a signed body that is not JSON; ignored');
      }
      const intents = suppressionsFrom(event, webhook.fromDomain);
      const eventId = c.req.header('svix-id') ?? 'unknown';
      for (const intent of intents) await store.email.suppress({ ...intent, eventId, at: now });
      const type = typeof event === 'object' && event !== null ? String((event as { type?: unknown }).type ?? '') : '';
      if (intents.length > 0) logger.info({ requestId: c.get('requestId'), eventType: type, count: intents.length, reason: intents[0]!.reason }, 'resend webhook: addresses suppressed');
      return c.json({ received: true as const, result: intents.length > 0 ? ('suppressed' as const) : ('ignored' as const) }, 200);
    },
  );

  return app;
}
