import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import type { Mailer, SendResult } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { decodeCursor, encodeCursor, parseLimit } from '../pagination.js';
import type { LedgerStore, SignupReviewRecord, SignupReviewRow } from '../repositories/ports.js';
import { ErrorEnvelopeSchema, SignupReviewDecisionSchema, SignupReviewListQuerySchema, SignupReviewListSchema } from '../schemas.js';
import { signInLinkOf } from './account-setup.js';

/**
 * MUT-367 (ADR-159 §7a, ADR-178): the operator's signup review queue, behind MUTABA3A_ADMIN_TOKEN like the rest of
 * /admin (ADR-037 §1). `npm --prefix server run signups:review` drives it.
 *
 *   GET  /admin/v1/signup-reviews?state=pending|decided   oldest first
 *   POST /admin/v1/signup-reviews/{userId}/approve        ACTIVE, the trial starts now, "your account is ready" mail
 *   POST /admin/v1/signup-reviews/{userId}/decline        the empty account is deleted, "we couldn't open it" mail
 *
 * A decision commits first; the mail follows and never undoes it (its outcome is in the answer). After a decline the
 * review keeps no person, so the userId answers 404 from then on (D28).
 */
export interface AdminSignupReviewOptions {
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  settings: Pick<SessionSettings, 'portalOrigin'>;
  /** Where a declined person may write (MAIL_REPLY_TO). */
  supportAddress: string;
}

/** D15: the admin token carries no identity. */
export const REVIEW_DECIDED_BY = 'admin-token';

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;
const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });

export function adminSignupReviewRoutes(options: AdminSignupReviewOptions): OpenAPIHono<AppEnv> {
  const { store, mailer, logger, settings, supportAddress } = options;
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
    async (c) => {
      const query = c.req.valid('query');
      const page = await store.signupReviews.list({ state: query.state, limit: parseLimit(query.limit), cursor: query.cursor ? decodeCursor(query.cursor) : null });
      return c.json({ data: page.items.map(serializeReview), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null }, 200);
    },
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
    async (c) => {
      const { userId } = c.req.valid('param');
      const requestId = c.get('requestId');
      const result = await store.signupReviews.approve({
        userId,
        at: c.get('now')(),
        decidedBy: REVIEW_DECIDED_BY,
        auditFor: (personalOrganizationId) => [
          { organizationId: personalOrganizationId, actorType: 'ADMIN', actorId: null, action: 'user.signup_approved', entityType: 'user', entityId: userId, requestId },
        ],
      });
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No signup review for this user');
      if (result.kind === 'already_decided') throw alreadyDecided(result.review);
      const mail = await send(() =>
        mailer.send({ to: result.user.email, template: 'account-ready', locale: result.user.locale, vars: { signInLink: signInLinkOf(settings, c.req.url) }, idempotencyKey: `account-ready:${result.review.id}` }),
      );
      logger.info({ reviewId: result.review.id, domain: result.review.domain, mail }, 'user.signup_approved');
      return c.json({ review: serializeReview({ ...result.review, person: { email: result.user.email, displayName: result.user.displayName, locale: result.user.locale } }), mail }, 200);
    },
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
    async (c) => {
      const { userId } = c.req.valid('param');
      const result = await store.signupReviews.decline({ userId, at: c.get('now')(), decidedBy: REVIEW_DECIDED_BY });
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No signup review for this user');
      if (result.kind === 'already_decided') throw alreadyDecided(result.review);
      if (result.kind === 'not_empty') throw new ApiError('CONFLICT', 'This account holds more than an empty profile; it can’t be declined', { reason: 'NOT_EMPTY' });
      const mail = await send(() =>
        mailer.send({ to: result.person.email, template: 'account-declined', locale: result.person.locale, vars: { supportAddress }, idempotencyKey: `account-declined:${result.review.id}` }),
      );
      // The operator log line (the profile, and with it the audit trail, is gone): the review id and domain, never the address.
      logger.info({ reviewId: result.review.id, domain: result.review.domain, reasons: result.review.reasons, mail }, 'user.signup_declined');
      return c.json({ review: serializeReview({ ...result.review, person: null }), mail }, 200);
    },
  );

  /** A mail outcome never undoes a decision; a throw (a bug) is logged and reported as failed. */
  async function send(run: () => Promise<SendResult>): Promise<SendResult['status']> {
    try {
      return (await run()).status;
    } catch (err) {
      logger.error({ err }, 'signup review mail failed');
      return 'failed';
    }
  }

  return app;
}

function alreadyDecided(review: SignupReviewRecord): ApiError {
  return new ApiError('CONFLICT', 'This signup was already decided', { reason: 'ALREADY_DECIDED', decision: review.decision });
}

function serializeReview(row: SignupReviewRow) {
  return {
    id: row.id,
    userId: row.userId,
    email: row.person?.email ?? null,
    displayName: row.person?.displayName ?? null,
    locale: row.person?.locale ?? null,
    domain: row.domain,
    classification: row.classification,
    reasons: row.reasons,
    createdAt: row.createdAt.toISOString(),
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decision: row.decision,
  };
}
