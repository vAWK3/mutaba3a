import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { beginOperatorStepUp, finishOperatorStepUp, operatorStepUpUntil } from '../auth/step-up.js';
import type { WebauthnConfig } from '../auth/webauthn.js';
import { ApiError } from '../errors.js';
import type { ErrorReporter } from '../observability/reporter.js';
import { accountActions, type AccountStatusVerb } from '../operator/actions/accounts.js';
import { signupReviewActions, type SignupReviewActionOptions } from '../operator/actions/signupReviews.js';
import {
  ErrorEnvelopeSchema,
  IssueSetupLinkRequestSchema,
  IssueSetupLinkResponseSchema,
  OperatorAccountSearchSchema,
  OperatorAccountStatusResponseSchema,
  OperatorAccountViewSchema,
  OperatorSignupReviewListSchema,
  OperatorStepUpSchema,
  PasskeySignInChallengeSchema,
  PasskeySignInRequestSchema,
  RevokeSessionsResponseSchema,
  SignupReviewDecisionSchema,
  SignupReviewListQuerySchema,
} from '../schemas.js';
import type { PasskeyRequestOptionsSchema } from '../schemas.js';
import { serializeUser } from '../serializers.js';

/**
 * MUT-459 (ADR-212): the portal's operator console, signed in as an operator. Mounted behind the /v1 authenticate()
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
 *
 * MUT-461: accounts, from operator/actions/accounts.ts (shared with /admin/v1/users). An operator never acts on their
 * own account here (E10: 409 OWN_ACCOUNT); their own is You › Account.
 *
 *   GET  /v1/operator/accounts?email=                      exact email (D5): one match or null
 *   GET  /v1/operator/accounts/{userId}                    the account view
 *   POST /v1/operator/accounts/{userId}/disable|enable|sessions/revoke|setup-link
 */
export interface OperatorRouteOptions extends SignupReviewActionOptions {
  webauthn: WebauthnConfig | null;
  /** The account actions digest setup-link tokens with the session pepper. */
  settings: Pick<SessionSettings, 'portalOrigin' | 'pepper'>;
  /** MUT-434 (D14): forced agent disconnects are noted here. Absent = nowhere. */
  reporter?: ErrorReporter;
}

/** Every operator route is the person's own, on no profile (no X-Mutaba3a-Profile); the lapse gate leaves them open. */
export const OPERATOR_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/operator/signup-reviews',
  'POST /v1/operator/signup-reviews/:userId/approve',
  'POST /v1/operator/signup-reviews/:userId/decline',
  'POST /v1/operator/signup-reviews/:userId/resend',
  'POST /v1/operator/step-up/options',
  'POST /v1/operator/step-up',
  'GET /v1/operator/accounts',
  'GET /v1/operator/accounts/:userId',
  'POST /v1/operator/accounts/:userId/disable',
  'POST /v1/operator/accounts/:userId/enable',
  'POST /v1/operator/accounts/:userId/sessions/revoke',
  'POST /v1/operator/accounts/:userId/setup-link',
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
  const { store, webauthn, logger, settings } = options;
  const accounts = accountActions({ store, logger, sessions: settings, ...(options.reporter ? { reporter: options.reporter } : {}) });
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

  // ---- MUT-461: accounts ------------------------------------------------------------------------------------------

  const accountErrors = {
    ...operatorErrors,
    404: errorResponse('Not an operator, or NOT_FOUND with details.reason ACCOUNT_NOT_FOUND: no such account'),
  } as const;
  const stepUpUntilOf = (c: Context<AppEnv>) => operatorStepUpUntil(c.get('identity').session, c.get('now')())?.toISOString() ?? null;

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/accounts',
      tags: ['Operator'],
      summary: 'Find an account by its exact email, normalised (MUT-461). No match is 200 with account null',
      security: SESSION,
      request: { query: z.object({ email: z.string().min(1).max(320) }) },
      responses: {
        200: { description: 'Zero or one account, and when the step-up lapses', content: { 'application/json': { schema: OperatorAccountSearchSchema } } },
        422: errorResponse('Validation failed'),
        ...operatorErrors,
      },
    }),
    async (c) => {
      const user = await accounts.findByEmail(c.req.valid('query').email);
      const account = user ? { id: user.id, email: user.email, displayName: user.displayName, status: user.status } : null;
      return c.json({ account, stepUpUntil: stepUpUntilOf(c) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/operator/accounts/{userId}',
      tags: ['Operator'],
      summary: 'One account as the operator sees it: status, last sign-in, passkeys, flags, devices, agents, profiles and billing (MUT-461)',
      security: SESSION,
      request: { params: UserIdParam },
      responses: {
        200: { description: 'The account, and when the step-up lapses', content: { 'application/json': { schema: OperatorAccountViewSchema } } },
        ...accountErrors,
      },
    }),
    async (c) => c.json({ account: await accounts.view(c.req.valid('param').userId, c.get('now')()), stepUpUntil: stepUpUntilOf(c) }, 200),
  );

  /** E10: the operator's own account is never acted on from the console (a disable or sign-out would lock them out). */
  const notOwn = (c: Context<AppEnv>, userId: string) => {
    if (userId === c.get('identity').user.id) throw new ApiError('CONFLICT', 'Change your own account from You › Account, not the operator console', { reason: 'OWN_ACCOUNT' });
  };
  const ownAccount = errorResponse('CONFLICT: details.reason OWN_ACCOUNT (your own account), USER_PENDING_REVIEW (a waiting signup: approve or decline it), or USER_DISABLED (a setup link for a disabled account)');

  for (const verb of ['disable', 'enable'] as const satisfies readonly AccountStatusVerb[]) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/v1/operator/accounts/{userId}/${verb}`,
        tags: ['Operator'],
        summary:
          verb === 'disable'
            ? 'Disable an account (idempotent): every session and connected agent ends, and sign-in is refused (MUT-461)'
            : 'Enable a disabled account again (idempotent) (MUT-461)',
        security: SESSION,
        request: { params: UserIdParam },
        responses: {
          200: { description: 'The account, and what the disable ended', content: { 'application/json': { schema: OperatorAccountStatusResponseSchema } } },
          409: ownAccount,
          ...accountErrors,
        },
      }),
      async (c) => {
        const userId = c.req.valid('param').userId;
        notOwn(c, userId);
        const result = await accounts.setStatus(userId, verb, contextOf(c));
        return c.json({ ...result, user: serializeUser(result.user) }, 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/operator/accounts/{userId}/sessions/revoke',
      tags: ['Operator'],
      summary: 'Sign an account out everywhere: every session and connected agent ends; the password still works (MUT-461)',
      security: SESSION,
      request: { params: UserIdParam },
      responses: {
        200: { description: 'How many sessions and agents ended', content: { 'application/json': { schema: RevokeSessionsResponseSchema } } },
        409: ownAccount,
        ...accountErrors,
      },
    }),
    async (c) => {
      const userId = c.req.valid('param').userId;
      notOwn(c, userId);
      return c.json(await accounts.revokeSessions(userId, contextOf(c)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/operator/accounts/{userId}/setup-link',
      tags: ['Operator'],
      summary: 'Issue a one-time setup link, returned once; any earlier open link is cancelled. With `lock` the password stops and every session ends now (MUT-461)',
      security: SESSION,
      request: { params: UserIdParam, body: { required: false, content: { 'application/json': { schema: IssueSetupLinkRequestSchema } } } },
      responses: {
        200: { description: 'The link, shown once', content: { 'application/json': { schema: IssueSetupLinkResponseSchema } } },
        409: ownAccount,
        422: errorResponse('Validation failed'),
        ...accountErrors,
      },
    }),
    async (c) => {
      const userId = c.req.valid('param').userId;
      notOwn(c, userId);
      // The body is optional: with none, the validator is skipped and nothing is defaulted (the action falls back).
      const body: { validHours?: number | undefined; lock?: boolean | undefined } = c.req.valid('json') ?? {};
      const result = await accounts.issueSetupLink(userId, body, contextOf(c));
      return c.json({ ...result, user: serializeUser(result.user) }, 200);
    },
  );

  return app;
}

function contextOf(c: Context<AppEnv>) {
  return { actor: { kind: 'operator' as const, userId: c.get('identity').user.id }, at: c.get('now')(), requestId: c.get('requestId'), requestUrl: c.req.url };
}
