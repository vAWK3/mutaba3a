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
import type { AuditEventInput, LedgerStore, Organization, UserRecord } from '../repositories/ports.js';
import { decidePurge, type PurgeCandidate } from '../accounts/purge-plan.js';
import { CloseAccountRequestSchema, CloseAccountResponseSchema, ErrorEnvelopeSchema, KeepAccountResponseSchema } from '../schemas.js';
import { signInLinkOf } from './account-setup.js';

/**
 * MUT-333 (ADR-188): Close my account, and Keep my account during the 30 days' grace. Person-level (no
 * X-Mutaba3a-Profile), `open` in the lapse gate (a locked person can close), for a cookie and a device session alike.
 *
 *   POST /v1/me/closure {password}
 *     password ─► no created profile others belong to without a co-owner (else 409 ACCOUNT_CLOSE_BLOCKED, R18)
 *              ─► Stripe: end paying subscriptions at the period end (undoable; a failure reverts it: 502, R6/R20)
 *              ─► closure + other sessions revoked (one transaction)
 *              ─► Stripe: cancel failing subscriptions now, expire open checkouts (after the commit, R20) ─► mail
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
        409: errorResponse('ACCOUNT_CLOSE_BLOCKED: a profile the person created has other members and no co-owner; details.profiles names them. CONFLICT reason OPERATOR_ACCOUNT: an operator (MUT-459)'),
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
      // MUT-459 (re-review cycle 3): an operator's account closes only after the CLI takes the mark off (ADR-208).
      // Otherwise a password alone could sign the operator out everywhere and lock the console for 30 days.
      if (user.operatorAt) throw new ApiError('CONFLICT', 'An operator account can’t be closed here: the operator mark is removed with the CLI first', { reason: 'OPERATOR_ACCOUNT' });

      // R18: a profile they created that others belong to, with no co-owner, would take those people's work with it.
      const blocked = await blockingProfilesOf(store, user.id);
      if (blocked.length > 0) {
        throw new ApiError('ACCOUNT_CLOSE_BLOCKED', 'A profile you created has other members and no co-owner: add a co-owner or remove them first', { profiles: blocked });
      }

      const customers = await customersOf(store, stripe, user);
      if (customers.length > 0 && !stripe) throw new ApiError('BILLING_NOT_CONFIGURED', 'This account has a Stripe subscription and Stripe is not configured on this server');
      // R20: first only what can be undone (end at the period end); a failure reverts it and nothing changed.
      const ended: string[] = [];
      const cancelLater: string[] = [];
      try {
        for (const customer of customers) {
          const actions = subscriptionActionsAtClose(await stripe!.liveSubscriptionsOf(customer));
          for (const id of actions.endAtPeriodEnd) {
            await stripe!.setCancelAtPeriodEnd(id, true);
            ended.push(id);
          }
          cancelLater.push(...actions.cancelNow);
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
        if (err instanceof StateConflict && err.reason === 'ALREADY_CLOSING') {
          // R21: a second close lost the race; the first one's closure owns the subscriptions it recorded.
          const existing = (await store.users.getById(user.id))?.closure;
          await restartSubscriptions(stripe, ended.filter((id) => !existing?.endedSubscriptionIds.includes(id)), logger, user.id);
          throw closingRefusal(existing ?? { deleteAfter: closureDeadline(now) });
        }
        await restartSubscriptions(stripe, ended, logger, user.id);
        if (err instanceof StateConflict) throw new ApiError('SESSION_EXPIRED', 'This session ended; sign in again');
        throw err;
      }
      const closure = closed?.closure;
      if (!closed || !closure) throw new ApiError('SESSION_EXPIRED', 'This session ended; sign in again');

      // R20: what can't be undone runs only once the closing is committed: failing subscriptions cancelled now (R7),
      // open checkouts expired (R5). A failure here is the operator's, never the person's answer.
      const cancelled = await afterCommit(stripe, customers, cancelLater, logger, user.id);

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

/** R20: after the commit; returns how many failing subscriptions were cancelled. */
async function afterCommit(stripe: AccountStripeGateway | null, customers: readonly string[], cancelNow: readonly string[], logger: Logger, userId: string): Promise<number> {
  if (!stripe) return 0;
  let cancelled = 0;
  for (const id of cancelNow) {
    try {
      await stripe.cancelNow(id);
      cancelled++;
    } catch (err) {
      logger.error({ err, userId, subscriptionId: id }, 'account closure needs the operator: a past-due subscription could not be cancelled');
    }
  }
  for (const customer of customers) {
    try {
      await stripe.expireOpenCheckouts(customer);
    } catch (err) {
      logger.error({ err, userId, customer }, 'account closure needs the operator: open checkouts could not be expired');
    }
  }
  return cancelled;
}

/** R18: the person's created profiles that others belong to with no co-owner to pass them to (purge-plan.ts). */
async function blockingProfilesOf(store: LedgerStore, userId: string): Promise<Array<{ id: string; name: string }>> {
  const memberships = await store.memberships.listByUser(userId);
  const profiles = (await Promise.all(memberships.map((m) => store.organizations.getById(m.organizationId)))).filter((o): o is Organization => o !== null);
  const others = new Map<string, PurgeCandidate[]>();
  for (const profile of profiles) {
    if (profile.ownerUserId !== userId && profile.personalOwnerUserId !== userId) continue;
    const members = (await store.memberships.listByOrganization(profile.id)).filter((m) => m.userId !== userId);
    const candidates: PurgeCandidate[] = [];
    for (const m of members) {
      const person = await store.users.getById(m.userId);
      if (person) candidates.push({ userId: m.userId, role: m.role, status: person.status, deleteAfter: person.closure?.deleteAfter ?? null, membershipCreatedAt: m.createdAt });
    }
    others.set(profile.id, candidates);
  }
  const { blockedProfileIds } = decidePurge(userId, profiles, (id) => others.get(id) ?? []);
  return profiles.filter((p) => blockedProfileIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name }));
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
