import { ApiError } from '../../errors.js';
import { isFeature, type Feature } from '../../features.js';
import type { Logger } from '../../logger.js';
import { NOOP_REPORTER, type ErrorReporter } from '../../observability/reporter.js';
import { ForeignKeyViolation } from '../../repositories/memory.js';
import type { LedgerStore } from '../../repositories/ports.js';
import { byLabelOf, type ActionContext } from '../actor.js';
import { accountActions, accountAudit, type AccountActionOptions } from './accounts.js';

/**
 * MUT-433 (ADR-196) and MUT-462 (ADR-212 D1, D9): a person's feature flags, turned on and off by the operator. Shared
 * by /admin/v1/users/{userId}/features (the admin token, `users.ts feature:grant`) and
 * /v1/operator/accounts/{userId}/features (a signed-in operator); only the audit row's actorId and `grantedBy` differ.
 * Both are idempotent and audited, in the write's own transaction, on every profile the person belongs to.
 */
export type FeatureActionOptions = Pick<AccountActionOptions, 'store' | 'logger' | 'sessions' | 'reporter'>;

/** The token's `grantedBy`, as MUT-433 always wrote it. */
const TOKEN_GRANTED_BY = 'admin';

/** An unknown name answers 422 with `{ field: 'feature' }` (MUT-433 eng review C7). */
export function featureOf(name: string): Feature {
  if (!isFeature(name)) throw new ApiError('VALIDATION_FAILED', `Unknown feature: ${name}`, { field: 'feature' });
  return name;
}

/** Review D1: the person (or a profile being audited) was deleted between the lookup and the write. */
export async function goneIsNotFound<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'User not found');
    throw err;
  }
}

export function featureActions(options: FeatureActionOptions) {
  const store: LedgerStore = options.store;
  const logger: Logger = options.logger;
  const reporter: ErrorReporter = options.reporter ?? NOOP_REPORTER;
  const accounts = accountActions(options);

  async function profilesToAudit(userId: string, action: string, ctx: ActionContext): Promise<string[]> {
    const organizationIds = await accounts.memberOrganizations(userId);
    if (organizationIds.length === 0) logger.info({ requestId: ctx.requestId, userId, action }, 'account change on a user with no memberships; no organization to audit');
    return organizationIds;
  }

  /** On, idempotently: a second grant changes nothing and keeps the first grantedAt. */
  async function grant(userId: string, name: string, ctx: ActionContext) {
    const feature = featureOf(name);
    const user = await accounts.mustGet(userId);
    // Eng review D5: a pending signup has no approved profile to audit on; approve it first.
    if (user.status === 'PENDING_REVIEW') {
      throw new ApiError('CONFLICT', 'This signup is waiting for review; approve it before granting a feature', { reason: 'USER_PENDING_REVIEW' });
    }
    const organizationIds = await profilesToAudit(user.id, 'user.feature_granted', ctx);
    const { grant: record, granted } = await goneIsNotFound(() =>
      store.features.grant({
        userId: user.id,
        feature,
        grantedBy: byLabelOf(ctx.actor, TOKEN_GRANTED_BY),
        at: ctx.at,
        audit: accountAudit(ctx, organizationIds, user.id, 'user.feature_granted', { feature }),
      }),
    );
    return { feature, grantedAt: record.grantedAt.toISOString(), granted };
  }

  /** Off, idempotently; seen on the person's very next request. Taking agent access away disconnects every agent. */
  async function revoke(userId: string, name: string, ctx: ActionContext) {
    const feature = featureOf(name);
    const user = await accounts.mustGet(userId);
    const organizationIds = await profilesToAudit(user.id, 'user.feature_revoked', ctx);
    const { revoked, agentGrantsRevoked } = await goneIsNotFound(() =>
      store.features.revoke({
        userId: user.id,
        feature,
        at: ctx.at,
        audit: accountAudit(ctx, organizationIds, user.id, 'user.feature_revoked', { feature }),
        // MUT-434 AC7: taking agent access away disconnects every agent, in the same transaction (OV10).
        ...(feature === 'agent_access' ? { agentGrants: { audit: accountAudit(ctx, organizationIds, user.id, 'user.agent_disconnected', { reason: 'feature_revoked' }) } } : {}),
      }),
    );
    if (agentGrantsRevoked > 0) reporter.captureMessage('info', 'OAuth grants revoked', { reason: 'feature_revoked', count: String(agentGrantsRevoked) });
    return { feature, revoked };
  }

  return { grant, revoke };
}
