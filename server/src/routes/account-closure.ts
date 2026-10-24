import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { closingRefusal, closureDeadline, deletionDayOf, subscriptionActionsAtClose } from '../accounts/closure.js';
import { verifyCurrentPassword } from '../auth/current-password.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import type { SignInThrottle } from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import type { AccountStripeGateway } from '../billing/stripe/account-gateway.js';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { StateConflict } from '../repositories/memory.js';
import type { AuditEventInput, LedgerStore, UserRecord } from '../repositories/ports.js';
import { CloseAccountRequestSchema, CloseAccountResponseSchema, ErrorEnvelopeSchema, KeepAccountResponseSchema } from '../schemas.js';
import { signInLinkOf } from './account-setup.js';

/**
 * MUT-333 (ADR-188): Close my account, and Keep my account during the 30 days' grace. Person-level (no
 * X-Mutaba3a-Profile), `open` in the lapse gate (a locked person can close), for a cookie and a device session alike.
 *
 *   POST /v1/me/closure {password}
 *     password ─► Stripe: expire open checkouts, end paying subscriptions at the period end, cancel failing ones now
 *              ─► closure + other sessions revoked (one transaction) ─► mail "deleted on <date>"
 *     A Stripe failure reverts what this close changed in Stripe: 502, nothing changed (R6).
 *   DELETE /v1/me/closure
 *     closure cleared (only before the deadline and the purge's claim) ─► the subscriptions it ended turned back on
 */
export const CLOSURE_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['POST /v1/me/closure', 'DELETE /v1/me/closure']);

export interface AccountClosureRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  throttle: SignInThrottle;
  settings: SessionSettings;
  mailer: Mailer;
  logger: Logger;
  /** Null when Stripe isn't configured: a person with a Stripe customer can't close (503), anyone else can. */
  stripe: AccountStripeGateway | null;
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function accountClosureRoutes(options: AccountClosureRouteOptions): OpenAPIHono<AppEnv> {
  const { store, mailer, logger, stripe } = options;
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/me/closure',
      tags: ['Sessions'],
      summary: 'Close your account (MUT-333)',
      description:
        'Starts 30 days of grace, then the account and every profile it created are deleted (a business profile shared with a co-owner passes to them; ' +
        'firms and Malafat profiles keep the records, anonymized). Paying Stripe subscriptions end at their period end; past-due ones are cancelled now. ' +
        'Every other session, web and phone, is signed out; this one stays, but until the account is kept it reaches only GET /v1/me, ' +
        'DELETE /v1/me/closure and sign-out (403 ACCOUNT_CLOSING). A wrong password counts toward the sign-in lockout.',
      security: [{ session: [] }, { deviceSession: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: CloseAccountRequestSchema } } } },
      responses: {
        200: { description: 'Closing', content: { 'application/json': { schema: CloseAccountResponseSchema } } },
        403: errorResponse('CURRENT_PASSWORD_WRONG (wrong password, or the account is locked), ACCOUNT_CLOSING, CROSS_SITE_REQUEST or PRINCIPAL_NOT_ACCEPTED'),
        422: errorResponse('VALIDATION_FAILED'),
        502: errorResponse('STRIPE_UNAVAILABLE: Stripe could not be reached; nothing changed'),
        503: errorResponse('BILLING_NOT_CONFIGURED: the account has a Stripe customer and this server has no Stripe'),
      },
    }),
    async (c) => {
      const { user, session } = c.get('identity');
      const { password } = c.req.valid('json');
      const now = c.get('now')();
      await verifyCurrentPassword(options, user, password, now, c.get('requestId'));

      const customers = await customersOf(store, stripe, user);
      if (customers.length > 0 && !stripe) throw new ApiError('BILLING_NOT_CONFIGURED', 'This account has a Stripe subscription and Stripe is not configured on this server');
      const ended: string[] = [];
      let cancelled = 0;
      try {
        for (const customer of customers) {
          await stripe!.expireOpenCheckouts(customer);
          const actions = subscriptionActionsAtClose(await stripe!.liveSubscriptionsOf(customer));
          for (const id of actions.endAtPeriodEnd) {
            await stripe!.setCancelAtPeriodEnd(id, true);
            ended.push(id);
          }
          for (const id of actions.cancelNow) {
            await stripe!.cancelNow(id);
            cancelled++;
          }
        }
      } catch (err) {
        await restartSubscriptions(stripe, ended, logger, user.id);
        logger.warn({ err, userId: user.id }, 'account closure: Stripe failed; nothing changed');
        throw new ApiError('STRIPE_UNAVAILABLE', 'Stripe could not be reached, so your account was not closed. Try again in a minute');
      }

      let closed: UserRecord | null;
      try {
        closed = await store.users.requestClosure({
          userId: user.id,
          at: now,
          deleteAfter: closureDeadline(now),
          endedSubscriptionIds: ended,
          exceptSessionId: session.id,
          audit: await personAudit(store, user.id, 'user.close_requested', c.get('requestId')),
        });
      } catch (err) {
        await restartSubscriptions(stripe, ended, logger, user.id);
        if (err instanceof StateConflict && err.reason === 'ALREADY_CLOSING') throw closingRefusal((await store.users.getById(user.id))?.closure ?? { deleteAfter: closureDeadline(now) });
        if (err instanceof StateConflict) throw new ApiError('SESSION_EXPIRED', 'This session ended; sign in again');
        throw err;
      }
      const closure = closed?.closure;
      if (!closed || !closure) throw new ApiError('SESSION_EXPIRED', 'This session ended; sign in again');

      // After the commit, and never able to change this answer (the password notice's rule).
      try {
        const result = await mailer.send({
          to: closed.email,
          template: 'account-closing',
          locale: closed.locale,
          vars: { deleteOn: deletionDayOf(closure.deleteAfter, await personalTimeZone(store, closed.id)), signInLink: signInLinkOf(options.settings, c.req.url) },
          idempotencyKey: `account-closing:${closed.id}:${closure.requestedAt.toISOString()}`,
        });
        if (result.status !== 'sent') logger.debug({ userId: closed.id, outcome: result.status }, 'account-closing mail not sent');
      } catch (err) {
        logger.error({ err, userId: closed.id }, 'account-closing mail failed');
      }
      return c.json(
        { closure: { requestedAt: closure.requestedAt.toISOString(), deleteAfter: closure.deleteAfter.toISOString() }, subscriptionsEnded: ended.length, subscriptionsCancelled: cancelled },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/me/closure',
      tags: ['Sessions'],
      summary: 'Keep your account (MUT-333)',
      description:
        'Ends a closing within its 30 days: nothing was deleted, and the Stripe subscriptions the closing set to end are turned back on. ' +
        '`billingNeedsAttention` is true when one could not be (open Billing). Idempotent: an account that is not closing answers the same.',
      security: [{ session: [] }, { deviceSession: [] }],
      responses: {
        200: { description: 'Kept', content: { 'application/json': { schema: KeepAccountResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST or PRINCIPAL_NOT_ACCEPTED'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const kept = await store.users.cancelClosure({ userId: user.id, at: c.get('now')(), audit: await personAudit(store, user.id, 'user.close_cancelled', c.get('requestId')) });
      if (!kept) return c.json({ billingNeedsAttention: false }, 200);
      const failed = await restartSubscriptions(stripe, kept.ended.endedSubscriptionIds, logger, user.id);
      return c.json({ billingNeedsAttention: failed > 0 }, 200);
    },
  );

  return app;
}

/** R5: the mirrored customer, and every other customer Stripe holds that names this person. */
async function customersOf(store: LedgerStore, stripe: AccountStripeGateway | null, user: UserRecord): Promise<string[]> {
  const mirrored = (await store.billing.summaryOf(user.id)).account?.stripeCustomerId ?? null;
  const found = stripe ? await stripe.customersOf({ userId: user.id, email: user.email }).catch((err: unknown) => {
    throw Object.assign(new ApiError('STRIPE_UNAVAILABLE', 'Stripe could not be reached, so your account was not closed. Try again in a minute'), { cause: err });
  }) : [];
  return [...new Set([...(mirrored ? [mirrored] : []), ...found])];
}

/** Turns back on what a close ended (R6 compensation, and Keep my account). Returns how many could not be. */
async function restartSubscriptions(stripe: AccountStripeGateway | null, ids: readonly string[], logger: Logger, userId: string): Promise<number> {
  let failed = 0;
  for (const id of ids) {
    try {
      if (!stripe) throw new Error('Stripe is not configured');
      await stripe.setCancelAtPeriodEnd(id, false);
    } catch (err) {
      failed++;
      logger.error({ err, userId, subscriptionId: id }, 'account closure needs the operator: a subscription could not be turned back on');
    }
  }
  return failed;
}

async function personAudit(store: LedgerStore, userId: string, action: string, requestId: string | null): Promise<AuditEventInput[]> {
  return (await store.memberships.listByUser(userId)).map((m) => ({ organizationId: m.organizationId, actorType: 'USER', actorId: userId, action, entityType: 'user', entityId: userId, requestId }));
}

/** R16: the person's own zone is their personal profile's; UTC if they have none. */
async function personalTimeZone(store: LedgerStore, userId: string): Promise<string> {
  for (const m of await store.memberships.listByUser(userId)) {
    const organization = await store.organizations.getById(m.organizationId);
    if (organization?.personalOwnerUserId === userId) return organization.timezone;
  }
  return 'UTC';
}
