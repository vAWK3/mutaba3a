import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { generateSetupToken, SETUP_LINK_POLICY, setupLinkOrigin, setupUrl } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { sessionDigest } from '../auth/sessions.js';
import { normalizeEmail } from '../auth/users.js';
import { ApiError, ownedProfileConflict } from '../errors.js';
import { isFeature } from '../features.js';
import { termsAccepted, type CurrentTerms } from '../legal.js';
import { MAX_PROFILE_OWNERS } from '../co-owners.js';
import { personalProfileFor, profileOwnerOf } from '../personal-profile.js';
import type { Logger } from '../logger.js';
import { ForeignKeyViolation, StateConflict, UniqueViolation } from '../repositories/memory.js';
import { SETUP_LINK_STATUSES, type AuditEventInput, type JsonObject, type LedgerStore, type Organization, type PersonSetupLinkPurpose, type UserRecord } from '../repositories/ports.js';
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  ErrorEnvelopeSchema,
  FeatureGrantResponseSchema,
  FeatureHoldersSchema,
  FeatureRevokeResponseSchema,
  GrantMembershipRequestSchema,
  GrantMembershipResponseSchema,
  IssueSetupLinkRequestSchema,
  IssueSetupLinkResponseSchema,
  RemoveMembershipResponseSchema,
  RevokeSessionsResponseSchema,
  UserDetailSchema,
  UserListSchema,
  UserStatusResponseSchema,
  TermsReportSchema,
} from '../schemas.js';
import { serializeMembership, serializeUser } from '../serializers.js';

/**
 * Operator-only user accounts (MUT-37, ADR-037 decision 1). Every route sits
 * under /admin/ behind MUTABA3A_ADMIN_TOKEN; nothing here is reachable by an
 * API key or, later, a session. There is deliberately no signup, invite or
 * self-service reset anywhere in the service (no-self-registration.test.ts).
 *
 * Each mutation is audited with actor ADMIN on every organization the user
 * belongs to after it (a removed membership is audited on the organization it
 * removed). MUT-235 (ADR-088): no route here knows anyone's password. Creating
 * a user and resetting one issue a one-time setup link instead, returned once;
 * the person sets their own password through it. A disable revokes every live
 * session of the user (MUT-38); so does a reset with `lock`.
 */
export interface AdminUserOptions {
  store: LedgerStore;
  logger: Logger;
  /** The session pepper digests link tokens; the portal origin is where links point. */
  sessions: Pick<SessionSettings, 'pepper' | 'portalOrigin'>;
  /** MUT-324: the current terms, for the operator's acceptance report. */
  terms: CurrentTerms;
}

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;
const notFound = { description: 'Unknown user or organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } as const;

const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });
/** MUT-433: a plain string, checked by `featureOf` so an unknown name answers 422 with `{ field: 'feature' }` (eng review C7). */
const FeatureParam = z.object({ feature: z.string().max(64).openapi({ param: { name: 'feature', in: 'path' }, example: 'agent_access' }) });
const UserFeatureParams = UserIdParam.extend(FeatureParam.shape);

function featureOf(name: string) {
  if (!isFeature(name)) throw new ApiError('VALIDATION_FAILED', `Unknown feature: ${name}`, { field: 'feature' });
  return name;
}

const MembershipParams = UserIdParam.extend({
  organizationId: z.string().uuid().openapi({ param: { name: 'organizationId', in: 'path' } }),
});

type AuditAction =
  | 'user.created'
  | 'user.setup_link_issued'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.feature_granted'
  | 'user.feature_revoked'
  | 'membership.granted'
  | 'membership.revoked';

/**
 * MUT-120: the personal profile's currency and timezone. The request wins; else the firm's;
 * with neither there is nothing to default to, so the request is invalid.
 */
function resolvePersonalSettings(
  request: { defaultCurrency?: string | undefined; timezone?: string | undefined },
  firm: Pick<Organization, 'defaultCurrency' | 'timezone'> | null,
): { defaultCurrency: string; timezone: string } | null {
  const defaultCurrency = request.defaultCurrency ?? firm?.defaultCurrency;
  const timezone = request.timezone ?? firm?.timezone;
  return defaultCurrency && timezone ? { defaultCurrency, timezone } : null;
}

export function adminUserRoutes(options: AdminUserOptions): OpenAPIHono<AppEnv> {
  const { store, logger, sessions, terms } = options;
  const app = new OpenAPIHono<AppEnv>();

  function auditEvents(c: Context<AppEnv>, organizationIds: string[], userId: string, action: AuditAction, metadata?: JsonObject): AuditEventInput[] {
    return organizationIds.map((organizationId) => ({
      organizationId,
      actorType: 'ADMIN',
      actorId: null,
      action,
      entityType: 'user',
      entityId: userId,
      ...(metadata ? { metadata } : {}),
      requestId: c.get('requestId'),
    }));
  }

  /** MUT-373 (ADR-163): the pilot's one way to add a co-owner (design review DR11: at most MAX_PROFILE_OWNERS). */
  async function grantCoOwner(c: Context<AppEnv>, user: UserRecord, organizationId: string) {
    // Basel (qa-reconcile D2): a disabled account can't sign in, so it never takes one of the profile's owner places.
    if (user.status !== 'ACTIVE') throw new ApiError('CONFLICT', 'Only an active account can be made a co-owner (enable it, or approve its signup, first)', { reason: 'USER_DISABLED' });
    // The audit commits with the membership (adversarial review 1): pre-roll recognizes a co-owner by this row.
    const [grantAudit] = auditEvents(c, [organizationId], user.id, 'membership.granted', { role: 'OWNER' }) as [AuditEventInput];
    const result = await store.memberships.grantOwner(user.id, organizationId, c.get('now')(), MAX_PROFILE_OWNERS, grantAudit);
    switch (result.kind) {
      case 'granted':
        return c.json({ membership: serializeMembership(result.membership), created: result.created }, result.created ? 201 : 200);
      case 'not_found':
        throw new ApiError('NOT_FOUND', 'Organization not found');
      case 'personal_profile':
        throw new ApiError('CONFLICT', 'A built-in personal profile is never shared', { reason: 'PERSONAL_PROFILE' });
      case 'not_business':
        throw new ApiError('CONFLICT', 'Only a Business profile can have co-owners', { reason: 'NOT_BUSINESS' });
      case 'not_co_ownable':
        throw new ApiError('CONFLICT', 'Co-owners are for profiles a person created; roles on firms arrive with MUT-305', { reason: 'NOT_CO_OWNABLE' });
      case 'limit':
        throw new ApiError('CONFLICT', `This profile already has ${result.count} owners, the most it can have`, { reason: 'OWNER_LIMIT', limit: MAX_PROFILE_OWNERS });
      case 'role_conflict':
        throw new ApiError('CONFLICT', `Already a member as ${result.role}; changing a role isn't supported yet`, { reason: 'ROLE_CHANGE_NOT_SUPPORTED', role: result.role });
    }
  }

  /**
   * MUT-235: a fresh link. The token appears only in `view.url`, returned once; the store gets its digest.
   */
  function newSetupLink(c: Context<AppEnv>, purpose: PersonSetupLinkPurpose, validHours: number | undefined) {
    const at = c.get('now')();
    const token = generateSetupToken();
    const expiresAt = new Date(at.getTime() + (validHours ?? SETUP_LINK_POLICY.defaultHours) * 3_600_000);
    const view = { url: setupUrl(setupLinkOrigin(sessions.portalOrigin, c.req.url), token), expiresAt: expiresAt.toISOString(), purpose };
    return { at, tokenDigest: sessionDigest(sessions.pepper, token), purpose, expiresAt, view };
  }

  const setupLinkMetadata = (link: ReturnType<typeof newSetupLink>, lock: boolean): JsonObject => ({
    purpose: link.purpose,
    expiresAt: link.view.expiresAt,
    ...(lock ? { lock: true } : {}),
  });

  /**
   * MUT-235: one transaction cancels the person's open link, issues this one and audits it (and, with `lock`,
   * clears the password and revokes every session).
   */
  async function issueSetupLink(c: Context<AppEnv>, user: UserRecord, options: { purpose: PersonSetupLinkPurpose; validHours?: number | undefined; lock: boolean }) {
    const link = newSetupLink(c, options.purpose, options.validHours);
    const organizationIds = await memberOrganizations(user.id);
    if (organizationIds.length === 0) logger.info({ requestId: c.get('requestId'), userId: user.id, action: 'user.setup_link_issued' }, 'account change on a user with no memberships; no organization to audit');
    await store.accountSetup.issue({
      userId: user.id,
      tokenDigest: link.tokenDigest,
      purpose: link.purpose,
      at: link.at,
      expiresAt: link.expiresAt,
      lock: options.lock,
      audit: auditEvents(c, organizationIds, user.id, 'user.setup_link_issued', setupLinkMetadata(link, options.lock)),
    });
    return link.view;
  }

  async function audit(c: Context<AppEnv>, organizationIds: string[], userId: string, action: AuditAction, metadata?: JsonObject) {
    if (organizationIds.length === 0) {
      logger.info({ requestId: c.get('requestId'), userId, action }, 'account change on a user with no memberships; no organization to audit');
      return;
    }
    for (const event of auditEvents(c, organizationIds, userId, action, metadata)) await store.audit.append(event);
  }

  async function memberOrganizations(userId: string): Promise<string[]> {
    return (await store.memberships.listByUser(userId)).map((m) => m.organizationId);
  }

  async function mustGetUser(userId: string): Promise<UserRecord> {
    const user = await store.users.getById(userId);
    if (!user) throw new ApiError('NOT_FOUND', 'User not found');
    return user;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/users',
      tags: ['Admin'],
      summary: 'Create a user with their personal profile and, optionally, a firm membership (one-time setup link returned once)',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: CreateUserRequestSchema } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: CreateUserResponseSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        409: { description: 'Email already in use, or organizationId is a profile a person owns (CONFLICT, details.reason PERSONAL_PROFILE or OWNED_PROFILE)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const email = normalizeEmail(body.email);
      const firm = body.organizationId ? await store.organizations.getById(body.organizationId) : null;
      if (body.organizationId && !firm) throw new ApiError('NOT_FOUND', 'Organization not found');
      if (firm && profileOwnerOf(firm)) throw ownedProfileConflict(firm, 'A profile a person owns belongs to them and cannot be anyone else’s organization');
      const settings = resolvePersonalSettings(body, firm);
      if (!settings) throw new ApiError('VALIDATION_FAILED', 'defaultCurrency and timezone are required when no organizationId is given');
      // MUT-235: no password until the person sets one through their link, and that first link commits with the user
      // (review fix), so a create never leaves an account with neither.
      const link = newSetupLink(c, 'SETUP', body.setupLinkValidHours);
      let created: Awaited<ReturnType<typeof store.users.create>>;
      try {
        created = await store.users.create({
          email,
          displayName: body.displayName,
          passwordHash: null,
          locale: body.locale,
          ...(firm ? { organizationId: firm.id } : {}),
          personal: personalProfileFor(body.locale, settings),
          setupLink: { tokenDigest: link.tokenDigest, purpose: link.purpose, expiresAt: link.expiresAt },
          at: link.at,
        });
      } catch (err) {
        // MUT-120: the transaction also writes the personal organization (and now the link), so only an email clash is reported as one.
        if (err instanceof UniqueViolation) {
          throw new ApiError('CONFLICT', err.constraint.includes('email') ? 'A user with this email already exists' : 'A conflicting record already exists; retry the request');
        }
        if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'Organization not found');
        throw err;
      }
      const { user, memberships, personalOrganization } = created;
      await store.audit.append({
        organizationId: personalOrganization.id,
        actorType: 'ADMIN',
        actorId: null,
        action: 'organization.created',
        entityType: 'organization',
        entityId: personalOrganization.id,
        metadata: { personal: true, ownerUserId: user.id },
        requestId: c.get('requestId'),
      });
      const organizationIds = memberships.map((m) => m.organizationId);
      await audit(c, organizationIds, user.id, 'user.created', { email: user.email, displayName: user.displayName });
      await audit(c, organizationIds, user.id, 'user.setup_link_issued', setupLinkMetadata(link, false));
      return c.json(
        {
          user: serializeUser(user),
          memberships: memberships.map(serializeMembership),
          personalProfile: { id: personalOrganization.id, name: personalOrganization.name },
          setupLink: link.view,
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/users',
      tags: ['Admin'],
      summary: 'Find a user by email (normalised before lookup)',
      security: [{ adminToken: [] }],
      request: { query: z.object({ email: z.string().min(1).max(320) }) },
      responses: {
        200: { description: 'Zero or one user', content: { 'application/json': { schema: UserListSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await store.users.findByEmail(normalizeEmail(c.req.valid('query').email));
      return c.json({ users: user ? [serializeUser(user)] : [] }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/terms-acceptance',
      tags: ['Admin'],
      summary: 'Every user, the terms version they last accepted and the client release that showed it (MUT-324, MUT-354)',
      description: 'For the operator to see who has not yet accepted the current terms, for example someone who only uses the phone app.',
      security: [{ adminToken: [] }],
      responses: {
        200: { description: 'The terms report', content: { 'application/json': { schema: TermsReportSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const rows = await store.users.listLatestTermsVersions();
      const users = rows.map((r) => ({
        id: r.userId,
        email: r.email,
        status: r.status,
        latestVersion: r.latestVersion,
        clientRelease: r.latestClientRelease,
        accepted: termsAccepted(r.latestVersion, terms.version),
      }));
      return c.json({ current: terms.version, users }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/users/{userId}',
      tags: ['Admin'],
      summary: 'Inspect a user, their memberships and their unsorted-inbox size',
      security: [{ adminToken: [] }],
      request: { params: UserIdParam },
      responses: {
        200: { description: 'User detail', content: { 'application/json': { schema: UserDetailSchema } } },
        404: notFound,
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      const memberships = await store.memberships.listByUser(user.id);
      // One indexed count, never a list: support needs to know an inbox is backing up, not what is in it (MUT-66).
      const inboxEntryCount = await store.inboxEntries.countByUser(user.id);
      return c.json({ user: serializeUser(user), memberships: memberships.map(serializeMembership), inboxEntryCount }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/users/{userId}/memberships',
      tags: ['Admin'],
      summary: 'Grant a user access to an organization (idempotent)',
      security: [{ adminToken: [] }],
      request: {
        params: UserIdParam,
        body: { required: true, content: { 'application/json': { schema: GrantMembershipRequestSchema } } },
      },
      responses: {
        201: { description: 'Granted', content: { 'application/json': { schema: GrantMembershipResponseSchema } } },
        200: { description: 'Already granted', content: { 'application/json': { schema: GrantMembershipResponseSchema } } },
        404: notFound,
        409: {
          description:
            'Without `role`: the organization is a profile another user owns (CONFLICT, details.reason PERSONAL_PROFILE or OWNED_PROFILE). With `role: OWNER` (MUT-373): PERSONAL_PROFILE, NOT_BUSINESS (an owned Personal profile), NOT_CO_OWNABLE (not an owned profile), OWNER_LIMIT, ROLE_CHANGE_NOT_SUPPORTED (already a member with another role), or USER_DISABLED (the account is disabled). Either way, USER_PENDING_REVIEW for a signup waiting for review (MUT-367).',
          content: { 'application/json': { schema: ErrorEnvelopeSchema } },
        },
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      const { organizationId, role } = c.req.valid('json');
      // MUT-367 (code review): a waiting signup gains nothing until it is approved; a membership would also block its decline.
      if (user.status === 'PENDING_REVIEW') {
        throw new ApiError('CONFLICT', 'This signup is waiting for review; approve it before granting access', { reason: 'USER_PENDING_REVIEW' });
      }
      if (role === 'OWNER') return grantCoOwner(c, user, organizationId);
      const org = await store.organizations.getById(organizationId);
      if (!org) throw new ApiError('NOT_FOUND', 'Organization not found');
      const owner = profileOwnerOf(org);
      if (owner && owner !== user.id) {
        throw ownedProfileConflict(org, 'A profile a person owns belongs to them and cannot be granted to another');
      }
      const { membership, created } = await store.memberships.grant(user.id, organizationId, c.get('now')());
      if (created) await audit(c, [organizationId], user.id, 'membership.granted');
      return c.json({ membership: serializeMembership(membership), created }, created ? 201 : 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/admin/v1/users/{userId}/memberships/{organizationId}',
      tags: ['Admin'],
      summary: 'Remove a user’s access to an organization (idempotent)',
      security: [{ adminToken: [] }],
      request: { params: MembershipParams },
      responses: {
        200: { description: 'Removed, or there was nothing to remove', content: { 'application/json': { schema: RemoveMembershipResponseSchema } } },
        404: notFound,
        409: { description: 'The organization is a profile this user owns (CONFLICT, details.reason PERSONAL_PROFILE or OWNED_PROFILE)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const { userId, organizationId } = c.req.valid('param');
      const user = await mustGetUser(userId);
      // MUT-120/182: a user always keeps a profile they created; it cannot be revoked away from them. A co-owner
      // (MUT-373) can be: the audit records the role they held, so the trail shows an owner was removed.
      const owned = await store.organizations.getById(organizationId);
      if (owned && profileOwnerOf(owned) === user.id) {
        throw ownedProfileConflict(owned, 'A user keeps the profiles they own; they cannot be revoked');
      }
      const membership = await store.memberships.find(user.id, organizationId);
      const removed = await store.memberships.revoke(user.id, organizationId);
      if (removed) await audit(c, [organizationId], user.id, 'membership.revoked', membership ? { role: membership.role, reason: 'operator' } : undefined);
      return c.json({ removed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/users/{userId}/setup-link',
      tags: ['Admin'],
      summary: 'Operator reset: issue a one-time setup link (returned once). The current password works until the link is used, unless `lock`',
      security: [{ adminToken: [] }],
      request: {
        params: UserIdParam,
        body: { required: false, content: { 'application/json': { schema: IssueSetupLinkRequestSchema } } },
      },
      responses: {
        200: { description: 'Setup link issued; any earlier open link is cancelled', content: { 'application/json': { schema: IssueSetupLinkResponseSchema } } },
        404: notFound,
        409: { description: 'The user is disabled (CONFLICT, details.reason USER_DISABLED); enable them first. A user waiting for signup review may get one (MUT-367 D29)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      if (!SETUP_LINK_STATUSES.has(user.status)) throw new ApiError('CONFLICT', 'A disabled user cannot use a setup link; enable them first', { reason: 'USER_DISABLED' });
      // The body is optional: with none, the validator is skipped and nothing is defaulted, hence the explicit fallbacks.
      const body: { validHours?: number | undefined; lock?: boolean | undefined } = c.req.valid('json') ?? {};
      const purpose: PersonSetupLinkPurpose = user.passwordHash === null ? 'SETUP' : 'RESET';
      const lock = body.lock === true;
      let setupLink: Awaited<ReturnType<typeof issueSetupLink>>;
      try {
        setupLink = await issueSetupLink(c, user, { purpose, validHours: body.validHours, lock });
      } catch (err) {
        // A disable that committed after the check above: the store refuses under its row lock (MUT-235 review).
        if (err instanceof StateConflict) throw new ApiError('CONFLICT', 'A disabled user cannot use a setup link; enable them first', { reason: 'USER_DISABLED' });
        throw err;
      }
      return c.json({ user: serializeUser((await store.users.getById(user.id)) ?? user), setupLink, lock }, 200);
    },
  );

  for (const [verb, status, action] of [
    ['disable', 'DISABLED', 'user.disabled'],
    ['enable', 'ACTIVE', 'user.enabled'],
  ] as const) {
    app.openapi(
      createRoute({
        method: 'post',
        path: `/admin/v1/users/{userId}/${verb}`,
        tags: ['Admin'],
        summary: verb === 'disable' ? 'Disable a user (idempotent); they can no longer sign in' : 'Re-enable a disabled user (idempotent)',
        security: [{ adminToken: [] }],
        request: { params: UserIdParam },
        responses: {
          200: { description: `User ${status}`, content: { 'application/json': { schema: UserStatusResponseSchema } } },
          404: notFound,
          409: { description: 'The user is waiting for signup review (CONFLICT, details.reason USER_PENDING_REVIEW): approve or decline it instead (MUT-367)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
          ...adminErrors,
        },
      }),
      async (c) => {
        const existing = await mustGetUser(c.req.valid('param').userId);
        // MUT-367 (D11): approve and decline are a pending signup's only ways out (the trial and the mail go with them).
        if (existing.status === 'PENDING_REVIEW') {
          throw new ApiError('CONFLICT', 'This signup is waiting for review; approve or decline it (signups:review)', { reason: 'USER_PENDING_REVIEW' });
        }
        const now = c.get('now')();
        const user = await store.users.setStatus(existing.id, status, now);
        if (!user) throw new ApiError('NOT_FOUND', 'User not found');
        if (status === 'DISABLED') await store.sessions.revokeAllForUser(user.id, 'disabled', now);
        if (existing.status !== status) await audit(c, await memberOrganizations(user.id), user.id, action);
        return c.json({ user: serializeUser(user) }, 200);
      },
    );
  }

  // ---- MUT-433 (ADR-196): per-user feature flags --------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'put',
      path: '/admin/v1/users/{userId}/features/{feature}',
      tags: ['Admin'],
      summary: 'Turn a feature on for a person (idempotent); audited on every profile they belong to',
      description:
        'Every feature is off until the operator grants it (features.ts). A second grant changes nothing and keeps the first grantedAt. ' +
        'A signup waiting for review is refused; a disabled account may hold a flag, which waits until it can sign in.',
      security: [{ adminToken: [] }],
      request: { params: UserFeatureParams },
      responses: {
        200: { description: 'The flag is on', content: { 'application/json': { schema: FeatureGrantResponseSchema } } },
        404: notFound,
        409: { description: 'The user is waiting for signup review (CONFLICT, details.reason USER_PENDING_REVIEW)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Unknown feature (VALIDATION_FAILED, details.field feature)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const params = c.req.valid('param');
      const feature = featureOf(params.feature);
      const user = await mustGetUser(params.userId);
      // Eng review D5: a pending signup has no approved profile to audit on; approve it first.
      if (user.status === 'PENDING_REVIEW') {
        throw new ApiError('CONFLICT', 'This signup is waiting for review; approve it before granting a feature', { reason: 'USER_PENDING_REVIEW' });
      }
      const organizationIds = await memberOrganizations(user.id);
      if (organizationIds.length === 0) logger.info({ requestId: c.get('requestId'), userId: user.id, action: 'user.feature_granted' }, 'account change on a user with no memberships; no organization to audit');
      const { grant, granted } = await store.features.grant({
        userId: user.id,
        feature,
        grantedBy: 'admin',
        at: c.get('now')(),
        audit: auditEvents(c, organizationIds, user.id, 'user.feature_granted', { feature }),
      });
      return c.json({ feature, grantedAt: grant.grantedAt.toISOString(), granted }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/admin/v1/users/{userId}/features/{feature}',
      tags: ['Admin'],
      summary: 'Turn a feature off for a person (idempotent); seen on their very next request',
      security: [{ adminToken: [] }],
      request: { params: UserFeatureParams },
      responses: {
        200: { description: 'The flag is off', content: { 'application/json': { schema: FeatureRevokeResponseSchema } } },
        404: notFound,
        422: { description: 'Unknown feature (VALIDATION_FAILED, details.field feature)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const params = c.req.valid('param');
      const feature = featureOf(params.feature);
      const user = await mustGetUser(params.userId);
      const { revoked } = await store.features.revoke({
        userId: user.id,
        feature,
        at: c.get('now')(),
        audit: auditEvents(c, await memberOrganizations(user.id), user.id, 'user.feature_revoked', { feature }),
      });
      return c.json({ feature, revoked }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/admin/v1/features/{feature}',
      tags: ['Admin'],
      summary: 'Everyone holding a feature now, oldest grant first',
      security: [{ adminToken: [] }],
      request: { params: FeatureParam },
      responses: {
        200: { description: 'The holders', content: { 'application/json': { schema: FeatureHoldersSchema } } },
        422: { description: 'Unknown feature (VALIDATION_FAILED, details.field feature)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const feature = featureOf(c.req.valid('param').feature);
      const holders = await store.features.holders(feature);
      return c.json({ feature, holders: holders.map((h) => ({ userId: h.userId, email: h.email, grantedAt: h.grantedAt.toISOString() })) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/users/{userId}/sessions/revoke',
      tags: ['Admin'],
      summary: 'Sign a user out everywhere (revokes every live session)',
      security: [{ adminToken: [] }],
      request: { params: UserIdParam },
      responses: {
        200: { description: 'How many sessions were revoked', content: { 'application/json': { schema: RevokeSessionsResponseSchema } } },
        404: notFound,
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      const revoked = await store.sessions.revokeAllForUser(user.id, 'operator', c.get('now')());
      return c.json({ revoked }, 200);
    },
  );

  return app;
}
