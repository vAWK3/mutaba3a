import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { TOKEN_ACTOR } from '../operator/actor.js';
import { signupReviewActions, type SignupReviewActionOptions } from '../operator/actions/signupReviews.js';
import { ErrorEnvelopeSchema, SignupReviewDecisionSchema, SignupReviewListQuerySchema, SignupReviewListSchema } from '../schemas.js';

/**
 * MUT-367 (ADR-159 §7a, ADR-178): the operator's signup review queue, behind MUTABA3A_ADMIN_TOKEN like the rest of
 * /admin (ADR-037 §1). `npm --prefix server run signups:review` drives it. MUT-459: the actions live in
 * operator/actions/signupReviews.ts, shared with the portal's operator console (/v1/operator/signup-reviews).
 *
 *   GET  /admin/v1/signup-reviews?state=pending|decided   oldest first
 *   POST /admin/v1/signup-reviews/{userId}/approve        ACTIVE, the trial starts now, "your account is ready" mail
 *   POST /admin/v1/signup-reviews/{userId}/decline        the empty account is deleted, "we couldn't open it" mail
 */
export type AdminSignupReviewOptions = SignupReviewActionOptions;

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;
const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });

export function adminSignupReviewRoutes(options: AdminSignupReviewOptions): OpenAPIHono<AppEnv> {
  const actions = signupReviewActions(options);
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/signup-reviews',
      tags: ['Admin'],
      summary: 'Self-service signups waiting for (or decided by) the operator, oldest first (MUT-367)',
      security: [{ adminToken: [] }],
      request: { query: SignupReviewListQuerySchema },
      responses: {
        200: { description: 'Reviews', content: { 'application/json': { schema: SignupReviewListSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => c.json(await actions.list(c.req.valid('query')), 200),
  );

  const decisionResponses = {
    200: { description: 'Decided; `mail` says what became of the person’s mail', content: { 'application/json': { schema: SignupReviewDecisionSchema } } },
    404: { description: 'No review for this user (unknown, never self-signed-up, or already declined)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    409: { description: 'CONFLICT: details.reason ALREADY_DECIDED, or (decline) NOT_EMPTY when the account holds anything besides its empty personal profile', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
    ...adminErrors,
  } as const;

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/signup-reviews/{userId}/approve',
      tags: ['Admin'],
      summary: 'Approve a signup: the account opens, its 14-day trial starts now, and the person is mailed (MUT-367)',
      security: [{ adminToken: [] }],
      request: { params: UserIdParam },
      responses: decisionResponses,
    }),
    async (c) => c.json(await actions.approve(c.req.valid('param').userId, contextOf(c)), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/signup-reviews/{userId}/decline',
      tags: ['Admin'],
      summary: 'Decline a signup: the empty account and its personal profile are deleted, and the person is mailed (MUT-367)',
      description: 'The review stays, with its domain and reasons but no person. The address may sign up again.',
      security: [{ adminToken: [] }],
      request: { params: UserIdParam },
      responses: decisionResponses,
    }),
    async (c) => c.json(await actions.decline(c.req.valid('param').userId, contextOf(c)), 200),
  );

  return app;
}

/** The admin token acts as itself (actorId null, decidedBy `admin-token`), exactly as before MUT-459. */
function contextOf(c: Context<AppEnv>) {
  return { actor: TOKEN_ACTOR, at: c.get('now')(), requestId: c.get('requestId'), requestUrl: c.req.url };
}
