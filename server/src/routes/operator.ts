import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { beginOperatorStepUp, finishOperatorStepUp, operatorStepUpUntil } from '../auth/step-up.js';
import type { WebauthnConfig } from '../auth/webauthn.js';
import { ApiError } from '../errors.js';
import { signupReviewActions, type SignupReviewActionOptions } from '../operator/actions/signupReviews.js';
import {
  ErrorEnvelopeSchema,
  OperatorSignupReviewListSchema,
  OperatorStepUpSchema,
  PasskeySignInChallengeSchema,
  PasskeySignInRequestSchema,
  SignupReviewDecisionSchema,
  SignupReviewListQuerySchema,
} from '../schemas.js';
import type { PasskeyRequestOptionsSchema } from '../schemas.js';

/**
 * MUT-459 (ADR-208): the portal's operator console, signed in as an operator. Mounted behind the /v1 authenticate()
 * and operatorGate (auth/operator-gate.ts): a non-operator gets 404, every write needs a fresh passkey step-up.
 *
 * The actions run on the unguarded store (`store` here is the base store, as the admin routes' raw access): the store
 * guard refuses `operator` methods to every principal (ADR-037 decision 7), and these routes are the one session
 * surface allowed them, reached only through the operator gate. They answer exactly what /admin answers, from the same
 * action module, with the operator as the actor (audit actorId, `decidedBy` operator:<id>).
 *
 *   GET  /v1/operator/signup-reviews                       the queue + when the step-up lapses
 *   POST /v1/operator/signup-reviews/{userId}/approve|decline|resend
 *   POST /v1/operator/step-up/options  →  POST /v1/operator/step-up
 */
export interface OperatorRouteOptions extends SignupReviewActionOptions {
  webauthn: WebauthnConfig | null;
}

/** Every operator route is the person's own, on no profile (no X-Mutaba3a-Profile); the lapse gate leaves them open. */
export const OPERATOR_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/operator/signup-reviews',
  'POST /v1/operator/signup-reviews/:userId/approve',
  'POST /v1/operator/signup-reviews/:userId/decline',
  'POST /v1/operator/signup-reviews/:userId/resend',
  'POST /v1/operator/step-up/options',
  'POST /v1/operator/step-up',
]);

const SESSION = [{ session: [] }];
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const operatorErrors = {
  401: errorResponse('Not signed in'),
  403: errorResponse('CROSS_SITE_REQUEST; or, on a write, RECENT_SIGN_IN_REQUIRED `{ method: "passkey", windowMinutes }`: step up with the passkey first'),
  404: errorResponse('Not an operator (or, on a decision, no review for this user)'),
} as const;
const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });

export function operatorRoutes(options: OperatorRouteOptions): OpenAPIHono<AppEnv> {
  const actions = signupReviewActions(options);
  const { store, webauthn, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/signup-reviews',
      tags: ['Operator'],
      summary: 'The signup review queue, oldest first, as the admin list, plus when this session’s passkey step-up lapses (MUT-459)',
      security: SESSION,
      request: { query: SignupReviewListQuerySchema },
      responses: {
        200: { description: 'Reviews', content: { 'application/json': { schema: OperatorSignupReviewListSchema } } },
        422: errorResponse('Validation failed'),
        ...operatorErrors,
      },
    }),
    async (c) => {
      const page = await actions.list(c.req.valid('query'));
      const until = operatorStepUpUntil(c.get('identity').session, c.get('now')());
      return c.json({ ...page, stepUpUntil: until?.toISOString() ?? null }, 200);
    },
  );

  const decisionResponses = {
    200: { description: 'Decided (or mailed again); `mail` says what became of the person’s mail', content: { 'application/json': { schema: SignupReviewDecisionSchema } } },
    409: errorResponse('CONFLICT: details.reason ALREADY_DECIDED, NOT_EMPTY (decline), or NOT_APPROVED (resend)'),
    ...operatorErrors,
  } as const;

  for (const [verb, summary] of [
    ['approve', 'Approve a signup: the account opens, its 14-day trial starts now, and the person is mailed'],
    ['decline', 'Decline a signup: the empty account and its personal profile are deleted, and the person is mailed'],
    ['resend', 'Mail an approved signup its “your account is ready” message again, after a send that didn’t go'],
  ] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/v1/operator/signup-reviews/{userId}/${verb}`,
        tags: ['Operator'],
        summary: `${summary} (MUT-459)`,
        security: SESSION,
        request: { params: UserIdParam },
        responses: decisionResponses,
      }),
      async (c) => {
        const userId = c.req.valid('param').userId;
        const ctx = contextOf(c);
        const result = verb === 'approve' ? await actions.approve(userId, ctx) : verb === 'decline' ? await actions.decline(userId, ctx) : await actions.resendApproval(userId, ctx);
        return c.json(result, 200);
      },
    );
  }

  const configured = (): WebauthnConfig => {
    if (!webauthn) throw new ApiError('NOT_FOUND', 'Passkeys are not available on this server');
    return webauthn;
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/operator/step-up/options',
      tags: ['Operator'],
      summary: 'Start an operator passkey step-up: the options for navigator.credentials.get(), offering only your passkeys (MUT-459)',
      description: 'Single-use, 5 minutes, bound to you. Then POST /v1/operator/step-up.',
      security: SESSION,
      responses: {
        200: { description: 'A step-up challenge', content: { 'application/json': { schema: PasskeySignInChallengeSchema } } },
        409: errorResponse('CONFLICT: details.reason OPERATOR_NEEDS_PASSKEY (no passkey left on the account)'),
        ...operatorErrors,
      },
    }),
    async (c) => {
      const { challengeId, publicKey } = await beginOperatorStepUp(store, configured(), c.get('identity').user, c.get('now')());
      return c.json({ challengeId, publicKey: publicKey as unknown as z.infer<typeof PasskeyRequestOptionsSchema> }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/operator/step-up',
      tags: ['Operator'],
      summary: 'Finish an operator passkey step-up: operator writes are open for 10 minutes (MUT-459)',
      security: SESSION,
      request: { body: { content: { 'application/json': { schema: PasskeySignInRequestSchema } }, required: true } },
      responses: {
        200: { description: 'Stepped up', content: { 'application/json': { schema: OperatorStepUpSchema } } },
        403: errorResponse('PASSKEY_NOT_ACCEPTED (another person’s passkey, a sign-in or used or expired challenge, a bad signature), or CROSS_SITE_REQUEST'),
        401: operatorErrors[401],
        404: operatorErrors[404],
        422: errorResponse('Validation failed'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const until = await finishOperatorStepUp(
        { store, webauthn: configured(), logger },
        c.get('identity'),
        { challengeId: body.challengeId, response: body.response as unknown as AuthenticationResponseJSON },
        { now: c.get('now')(), requestId: c.get('requestId') },
      );
      return c.json({ stepUpUntil: until.toISOString() }, 200);
    },
  );

  return app;
}

function contextOf(c: Context<AppEnv>) {
  return { actor: { kind: 'operator' as const, userId: c.get('identity').user.id }, at: c.get('now')(), requestId: c.get('requestId'), requestUrl: c.req.url };
}
