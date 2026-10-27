import type { SessionSettings } from '../../auth/middleware.js';
import type { Mailer, SendResult } from '../../email/ports.js';
import { ApiError } from '../../errors.js';
import type { Logger } from '../../logger.js';
import { decodeCursor, encodeCursor, parseLimit } from '../../pagination.js';
import type { LedgerStore, SignupReviewRecord, SignupReviewRow, SignupReviewState, UserLocale } from '../../repositories/ports.js';
import { signInLinkOf } from '../../routes/account-setup.js';
import { auditActorIdOf, byLabelOf, type OperatorActor } from '../actor.js';

/**
 * MUT-367 (ADR-178) and MUT-459 (ADR-212): the signup review queue's actions, shared by /admin/v1/signup-reviews (the
 * admin token, `npm --prefix server run signups:review`) and /v1/operator/signup-reviews (a signed-in operator), so
 * both answer the same thing for the same decision. A decision commits first; the mail follows and never undoes it
 * (its outcome is in the answer). After a decline the review keeps no person, so the userId answers 404 from then on
 * (D28).
 */
export interface SignupReviewActionOptions {
  store: LedgerStore;
  mailer: Mailer;
  logger: Logger;
  settings: Pick<SessionSettings, 'portalOrigin'>;
  /** Where a declined person may write (MAIL_REPLY_TO). */
  supportAddress: string;
}

/** D15: what the admin token stores as `decidedBy`; an operator stores `operator:<id>`. */
export const REVIEW_DECIDED_BY = 'admin-token';

/** The request facts every action needs. */
export interface ActionContext {
  actor: OperatorActor;
  at: Date;
  requestId: string | null;
  requestUrl: string;
}

export type MailOutcome = SendResult['status'];

/** "Send again" sends at most once per this window (its idempotency key); a double tap is one mail. */
const RESEND_BUCKET_MS = 60_000;

export function signupReviewActions(options: SignupReviewActionOptions) {
  const { store, mailer, logger, settings, supportAddress } = options;

  async function list(query: { state: SignupReviewState; limit?: number | undefined; cursor?: string | undefined }) {
    const page = await store.signupReviews.list({ state: query.state, limit: parseLimit(query.limit), cursor: query.cursor ? decodeCursor(query.cursor) : null });
    return { data: page.items.map(serializeReview), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
  }

  async function approve(userId: string, ctx: ActionContext) {
    const result = await store.signupReviews.approve({
      userId,
      at: ctx.at,
      decidedBy: byLabelOf(ctx.actor, REVIEW_DECIDED_BY),
      auditFor: (personalOrganizationId) => [
        { organizationId: personalOrganizationId, actorType: 'ADMIN', actorId: auditActorIdOf(ctx.actor), action: 'user.signup_approved', entityType: 'user', entityId: userId, requestId: ctx.requestId },
      ],
    });
    if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No signup review for this user');
    if (result.kind === 'already_decided') throw alreadyDecided(result.review);
    const mail = await sendAccountReady(result.user, `account-ready:${result.review.id}`, ctx.requestUrl);
    logger.info({ reviewId: result.review.id, domain: result.review.domain, mail }, 'user.signup_approved');
    return { review: serializeReview({ ...result.review, person: { email: result.user.email, displayName: result.user.displayName, locale: result.user.locale } }), mail };
  }

  async function decline(userId: string, ctx: ActionContext) {
    const result = await store.signupReviews.decline({ userId, at: ctx.at, decidedBy: byLabelOf(ctx.actor, REVIEW_DECIDED_BY) });
    if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No signup review for this user');
    if (result.kind === 'already_decided') throw alreadyDecided(result.review);
    if (result.kind === 'not_empty') throw new ApiError('CONFLICT', 'This account holds more than an empty profile; it can’t be declined', { reason: 'NOT_EMPTY' });
    const mail = await send(() =>
      mailer.send({ to: result.person.email, template: 'account-declined', locale: result.person.locale, vars: { supportAddress }, idempotencyKey: `account-declined:${result.review.id}` }),
    );
    // The operator log line (the profile, and with it the audit trail, is gone): the review id, domain and who, never the address.
    logger.info({ reviewId: result.review.id, domain: result.review.domain, reasons: result.review.reasons, mail, operatorUserId: auditActorIdOf(ctx.actor) }, 'user.signup_declined');
    return { review: serializeReview({ ...result.review, person: null }), mail };
  }

  /**
   * MUT-459 (design 9A): "Send again" after an approval whose mail didn't go. Only an approved review whose person
   * still exists and is still an open account (review finding 4: not disabled, not closing). One send per minute: the
   * idempotency key is the minute, so a double tap mails once while a later retry is a real new send. Audited.
   */
  async function resendApproval(userId: string, ctx: ActionContext) {
    const review = await store.signupReviews.findByUser(userId);
    const user = review ? await store.users.getById(userId) : null;
    if (!review || !user) throw new ApiError('NOT_FOUND', 'No signup review for this user');
    if (review.decision !== 'APPROVED') throw new ApiError('CONFLICT', 'Only an approved signup can be mailed again', { reason: 'NOT_APPROVED', decision: review.decision });
    if (user.status !== 'ACTIVE' || user.closure) throw new ApiError('CONFLICT', 'This account is no longer open; it can’t be mailed again', { reason: 'NOT_ACTIVE' });
    const minute = Math.floor(ctx.at.getTime() / RESEND_BUCKET_MS);
    const mail = await sendAccountReady(user, `account-ready:${review.id}:again:${minute}`, ctx.requestUrl);
    for (const m of await store.memberships.listByUser(userId)) {
      await store.audit.append({ organizationId: m.organizationId, actorType: 'ADMIN', actorId: auditActorIdOf(ctx.actor), action: 'user.signup_approval_mailed_again', entityType: 'user', entityId: userId, metadata: { mail }, requestId: ctx.requestId });
    }
    logger.info({ reviewId: review.id, domain: review.domain, mail, operatorUserId: auditActorIdOf(ctx.actor) }, 'user.signup_approval_mailed_again');
    return { review: serializeReview({ ...review, person: { email: user.email, displayName: user.displayName, locale: user.locale } }), mail };
  }

  function sendAccountReady(user: { email: string; locale: UserLocale }, idempotencyKey: string, requestUrl: string) {
    return send(() => mailer.send({ to: user.email, template: 'account-ready', locale: user.locale, vars: { signInLink: signInLinkOf(settings, requestUrl) }, idempotencyKey }));
  }

  /** A mail outcome never undoes a decision; a throw (a bug) is logged and reported as failed. */
  async function send(run: () => Promise<SendResult>): Promise<MailOutcome> {
    try {
      return (await run()).status;
    } catch (err) {
      logger.error({ err }, 'signup review mail failed');
      return 'failed';
    }
  }

  return { list, approve, decline, resendApproval };
}

function alreadyDecided(review: SignupReviewRecord): ApiError {
  return new ApiError('CONFLICT', 'This signup was already decided', { reason: 'ALREADY_DECIDED', decision: review.decision });
}

export function serializeReview(row: SignupReviewRow) {
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
