import { generateSetupToken, SETUP_LINK_POLICY, setupLinkOrigin, setupUrl } from '../../auth/account-setup.js';
import type { SessionSettings } from '../../auth/middleware.js';
import { sessionDigest } from '../../auth/sessions.js';
import { normalizeEmail } from '../../auth/users.js';
import { serializeEntitlement, standingOfPerson } from '../../billing/coverage.js';
import { ApiError } from '../../errors.js';
import type { Logger } from '../../logger.js';
import { NOOP_REPORTER, type ErrorReporter } from '../../observability/reporter.js';
import { profileOwnerOf } from '../../personal-profile.js';
import { StateConflict } from '../../repositories/memory.js';
import { SETUP_LINK_STATUSES, type AuditEventInput, type JsonObject, type LedgerStore, type PersonSetupLinkPurpose, type UserRecord } from '../../repositories/ports.js';
import { serializeUser } from '../../serializers.js';
import { auditActorIdOf, type ActionContext } from '../actor.js';

/**
 * MUT-37/38/235/434 and MUT-461 (ADR-212 D1, D9): a person's account, as the operator acts on it — find by email, the
 * account view, disable/enable, sign out everywhere, and the one-time setup link. Shared by /admin/v1/users (the admin
 * token, `users.ts`) and /v1/operator/accounts (a signed-in operator), so both do the same thing for the same action;
 * only the audit row's actorId differs (actor.ts).
 *
 * Each change is audited with actor ADMIN on every profile the person belongs to. A disable revokes every live session
 * and every connected agent (MUT-38, MUT-434 D12); so does sign out everywhere. A setup link is returned once: the store
 * keeps only its digest (MUT-235), and with `lock` the password stops working and every session ends now.
 */
export interface AccountActionOptions {
  store: LedgerStore;
  logger: Logger;
  /** The session pepper digests link tokens; the portal origin is where links point. */
  sessions: Pick<SessionSettings, 'pepper' | 'portalOrigin'>;
  /** MUT-434 (D14): forced agent disconnects are noted here. Absent = nowhere. */
  reporter?: ErrorReporter;
}

export type AccountAuditAction =
  | 'user.created'
  | 'user.setup_link_issued'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.feature_granted'
  | 'user.feature_revoked'
  | 'user.operator_granted'
  | 'user.operator_revoked'
  | 'user.agent_disconnected'
  | 'user.sessions_revoked'
  | 'membership.granted'
  | 'membership.revoked';

export type AccountStatusVerb = 'disable' | 'enable';

/** One audit row per profile, actor ADMIN: the token records no id, an operator their own. */
export function accountAudit(ctx: Pick<ActionContext, 'actor' | 'requestId'>, organizationIds: string[], userId: string, action: AccountAuditAction, metadata?: JsonObject): AuditEventInput[] {
  return organizationIds.map((organizationId) => ({
    organizationId,
    actorType: 'ADMIN',
    actorId: auditActorIdOf(ctx.actor),
    action,
    entityType: 'user',
    entityId: userId,
    ...(metadata ? { metadata } : {}),
    requestId: ctx.requestId,
  }));
}

/** A missing person: NOT_FOUND, with a reason the portal tells apart from a lost profile (design 3A). */
export function accountNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'User not found', { reason: 'ACCOUNT_NOT_FOUND' });
}

/**
 * MUT-235: a fresh one-time link. The token appears only in `view.url`, returned once; the store gets its digest.
 * Shared with creating a user (/admin/v1/users), whose first link commits with the account.
 */
export function mintSetupLink(sessions: AccountActionOptions['sessions'], input: { purpose: PersonSetupLinkPurpose; validHours: number | undefined; at: Date; requestUrl: string }) {
  const token = generateSetupToken();
  const expiresAt = new Date(input.at.getTime() + (input.validHours ?? SETUP_LINK_POLICY.defaultHours) * 3_600_000);
  const view = { url: setupUrl(setupLinkOrigin(sessions.portalOrigin, input.requestUrl), token), expiresAt: expiresAt.toISOString(), purpose: input.purpose };
  return { at: input.at, tokenDigest: sessionDigest(sessions.pepper, token), purpose: input.purpose, expiresAt, view };
}

/** What `user.setup_link_issued` records: never the token. */
export function setupLinkAuditMetadata(link: ReturnType<typeof mintSetupLink>, lock: boolean): JsonObject {
  return { purpose: link.purpose, expiresAt: link.view.expiresAt, ...(lock ? { lock: true } : {}) };
}

function disabledCannotReset(): ApiError {
  return new ApiError('CONFLICT', 'A disabled user cannot use a setup link; enable them first', { reason: 'USER_DISABLED' });
}

export function accountActions(options: AccountActionOptions) {
  const { store, logger, sessions } = options;
  const reporter = options.reporter ?? NOOP_REPORTER;

  async function memberOrganizations(userId: string): Promise<string[]> {
    return (await store.memberships.listByUser(userId)).map((m) => m.organizationId);
  }

  async function mustGet(userId: string): Promise<UserRecord> {
    const user = await store.users.getById(userId);
    if (!user) throw accountNotFound();
    return user;
  }

  /** Audits outside a store transaction; a person with no profile has nowhere to audit, which is logged. */
  async function audit(ctx: ActionContext, organizationIds: string[], userId: string, action: AccountAuditAction, metadata?: JsonObject) {
    if (organizationIds.length === 0) {
      logger.info({ requestId: ctx.requestId, userId, action }, 'account change on a user with no memberships; no organization to audit');
      return;
    }
    for (const event of accountAudit(ctx, organizationIds, userId, action, metadata)) await store.audit.append(event);
  }

  /** MUT-434 (D12, D14): an operator-forced disconnect of every agent, audited on each profile and noted in Sentry. */
  async function revokeAgentGrants(ctx: ActionContext, userId: string, reason: 'disabled' | 'operator'): Promise<number> {
    const organizationIds = await memberOrganizations(userId);
    const count = await store.oauth.revokeAllForUser({ userId, reason, at: ctx.at, audit: accountAudit(ctx, organizationIds, userId, 'user.agent_disconnected', { reason }) });
    if (count > 0) reporter.captureMessage('info', 'OAuth grants revoked', { reason, count: String(count) });
    return count;
  }

  /** The address is normalised before the lookup (exact match, ADR-212 D5). */
  function findByEmail(email: string): Promise<UserRecord | null> {
    return store.users.findByEmail(normalizeEmail(email));
  }

  /** Idempotent. MUT-367 (D11): approve and decline are a pending signup's only ways out (the trial and the mail go with them). */
  async function setStatus(userId: string, verb: AccountStatusVerb, ctx: ActionContext) {
    const existing = await mustGet(userId);
    if (existing.status === 'PENDING_REVIEW') {
      throw new ApiError('CONFLICT', 'This signup is waiting for review; approve or decline it (signups:review)', { reason: 'USER_PENDING_REVIEW' });
    }
    const status = verb === 'disable' ? 'DISABLED' : 'ACTIVE';
    const user = await store.users.setStatus(existing.id, status, ctx.at);
    if (!user) throw accountNotFound();
    let sessionsRevoked = 0;
    let agentGrantsRevoked = 0;
    if (status === 'DISABLED') {
      sessionsRevoked = await store.sessions.revokeAllForUser(user.id, 'disabled', ctx.at);
      agentGrantsRevoked = await revokeAgentGrants(ctx, user.id, 'disabled');
    }
    if (existing.status !== status) await audit(ctx, await memberOrganizations(user.id), user.id, verb === 'disable' ? 'user.disabled' : 'user.enabled');
    return { user, sessionsRevoked, agentGrantsRevoked };
  }

  /** Sign out everywhere. MUT-434 (D12): "everywhere" includes connected agents; the flag stays, so the owner can reconnect. */
  async function revokeSessions(userId: string, ctx: ActionContext) {
    const user = await mustGet(userId);
    const revoked = await store.sessions.revokeAllForUser(user.id, 'operator', ctx.at);
    const agentGrantsRevoked = await revokeAgentGrants(ctx, user.id, 'operator');
    // MUT-461: audited (the AC's "every action"), with what it ended; before, only the agents' disconnect was.
    await audit(ctx, await memberOrganizations(user.id), user.id, 'user.sessions_revoked', { revoked, agentGrantsRevoked });
    return { revoked, agentGrantsRevoked };
  }

  /**
   * MUT-235: one transaction cancels the person's open link, issues this one and audits it (and, with `lock`, clears
   * the password and revokes every session).
   * A person waiting for signup review may get one (MUT-367 D29); a disabled one may not.
   */
  async function issueSetupLink(userId: string, request: { validHours?: number | undefined; lock?: boolean | undefined }, ctx: ActionContext) {
    const user = await mustGet(userId);
    if (!SETUP_LINK_STATUSES.has(user.status)) throw disabledCannotReset();
    const purpose: PersonSetupLinkPurpose = user.passwordHash === null ? 'SETUP' : 'RESET';
    const lock = request.lock === true;
    const link = mintSetupLink(sessions, { purpose, validHours: request.validHours, at: ctx.at, requestUrl: ctx.requestUrl });
    const organizationIds = await memberOrganizations(user.id);
    if (organizationIds.length === 0) logger.info({ requestId: ctx.requestId, userId: user.id, action: 'user.setup_link_issued' }, 'account change on a user with no memberships; no organization to audit');
    try {
      await store.accountSetup.issue({
        userId: user.id,
        tokenDigest: link.tokenDigest,
        purpose,
        at: ctx.at,
        expiresAt: link.expiresAt,
        lock,
        audit: accountAudit(ctx, organizationIds, user.id, 'user.setup_link_issued', setupLinkAuditMetadata(link, lock)),
      });
    } catch (err) {
      // A disable that committed after the check above: the store refuses under its row lock (MUT-235 review).
      if (err instanceof StateConflict) throw disabledCannotReset();
      throw err;
    }
    return { user: (await store.users.getById(user.id)) ?? user, setupLink: link.view, lock };
  }

  /**
   * MUT-461 (design 4A, 5A): what the operator sees before acting — status, last sign-in, passkeys, flags, how many
   * devices and agents an action would sign out, and each profile with its billing as /v1/me reports it. About six
   * indexed reads, once per page view.
   */
  async function view(userId: string, at: Date) {
    const user = await mustGet(userId);
    const [passkeys, features, activeSessionCount, agentGrants, { entitlements }, memberships] = await Promise.all([
      store.passkeys.listByUser(user.id),
      store.features.activeFor(user.id),
      store.sessions.countLiveForUser(user.id, at),
      store.oauth.listLiveGrants(user.id, at),
      standingOfPerson(store, user.id, at),
      store.memberships.listByUser(user.id),
    ]);
    const organizations = await Promise.all(memberships.map((m) => store.organizations.getById(m.organizationId)));
    const profiles = memberships.flatMap((membership, i) => {
      const organization = organizations[i];
      if (!organization) return [];
      const entitlement = entitlements.get(organization.id);
      return [
        {
          id: organization.id,
          name: organization.name,
          role: membership.role,
          personal: organization.personalOwnerUserId === user.id,
          owned: profileOwnerOf(organization) === user.id,
          firmEnabledAt: organization.firmEnabledAt?.toISOString() ?? null,
          firmRequestedAt: organization.firmRequestedAt?.toISOString() ?? null,
          billing: entitlement ? serializeEntitlement(entitlement) : null,
        },
      ];
    });
    return {
      ...serializeUser(user),
      closing: user.closure !== null,
      operator: user.operatorAt !== null,
      passkeyCount: passkeys.length,
      features,
      activeSessionCount,
      agentGrantCount: agentGrants.length,
      profiles,
    };
  }

  return { findByEmail, mustGet, memberOrganizations, audit, setStatus, revokeSessions, issueSetupLink, view };
}
