import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp } from '../auth/sessions.js';
import type { TwoFactorFlow } from '../auth/two-factor-flow.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, TwoFactorEmailCodeRequestSchema, TwoFactorEmailCodeResponseSchema } from '../schemas.js';

/**
 * MUT-710 (ADR-275): two-step sign-in routes that aren't a sign-in themselves. POST /v1/two-factor/email-code is public
 * (a challenge token is the only credential) and serves the portal and the phone alike.
 */
export interface TwoFactorRouteOptions {
  store: LedgerStore;
  settings: SessionSettings;
  ipLimiter: RateLimiter;
  twoFactor: TwoFactorFlow;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function twoFactorRoutes(options: TwoFactorRouteOptions): OpenAPIHono<AppEnv> {
  const { store, settings, ipLimiter, twoFactor } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/two-factor/email-code',
      tags: ['Sessions'],
      summary: 'Email a fresh second-step code (MUT-710)',
      description:
        'For a challenge whose method is email (sign-in or a setup link). At most once every 30 seconds and 5 times per challenge, and 10 codes an hour per person; the newest code replaces the last. A browser call must come from the portal itself.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: TwoFactorEmailCodeRequestSchema } } } },
      responses: {
        202: { description: 'A new code is on its way', content: { 'application/json': { schema: TwoFactorEmailCodeResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST, or TWO_FACTOR_CHALLENGE_EXPIRED (unknown, used, expired, or not an email challenge)'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED — too soon after the last code, too many codes, or too many attempts from this address'),
      },
    }),
    async (c) => {
      // A phone sends no Origin; a browser that does must be the portal.
      if (c.req.header('origin') && !isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Ask for a code from the MTB3A portal itself');
      const ip = await ipLimiter.check(`sign-in:${requestClientIp((name) => c.req.header(name), settings)}`, c.get('now')());
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      return c.json(await twoFactor.resend(c, store, c.req.valid('json').challengeToken), 202);
    },
  );

  return app;
}
