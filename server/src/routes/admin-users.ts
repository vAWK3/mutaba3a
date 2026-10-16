import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { generateSetupToken, SETUP_LINK_POLICY, setupUrl } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { sessionDigest } from '../auth/sessions.js';
import { normalizeEmail } from '../auth/users.js';
import { ApiError, ownedProfileConflict } from '../errors.js';
import { personalProfileFor, profileOwnerOf } from '../personal-profile.js';
import type { Logger } from '../logger.js';
import { ForeignKeyViolation, UniqueViolation } from '../repositories/memory.js';
import type { AuditEventInput, JsonObject, LedgerStore, Organization, SetupLinkPurpose, UserRecord } from '../repositories/ports.js';
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  ErrorEnvelopeSchema,
  GrantMembershipRequestSchema,
  GrantMembershipResponseSchema,
  IssueSetupLinkRequestSchema,
  IssueSetupLinkResponseSchema,
  RemoveMembershipResponseSchema,
  RevokeSessionsResponseSchema,
  UserDetailSchema,
  UserListSchema,
  UserStatusResponseSchema,
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
}

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;
const notFound = { description: 'Unknown user or organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } as const;

const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });
const MembershipParams = UserIdParam.extend({
  organizationId: z.string().uuid().openapi({ param: { name: 'organizationId', in: 'path' } }),
});

type AuditAction = 'user.created' | 'user.setup_link_issued' | 'user.disabled' | 'user.enabled' | 'membership.granted' | 'membership.revoked';

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
  const { store, logger, sessions } = options;
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

  /**
   * MUT-235: one transaction cancels the person's open link, issues this one and audits it (and, with `lock`,
   * clears the password and revokes every session). Only the token's digest is stored; the URL is returned once.
   */
  async function issueSetupLink(c: Context<AppEnv>, user: UserRecord, options: { purpose: SetupLinkPurpose; validHours?: number | undefined; lock: boolean }) {
    const now = c.get('now')();
    const token = generateSetupToken();
    const expiresAt = new Date(now.getTime() + (options.validHours ?? SETUP_LINK_POLICY.defaultHours) * 3_600_000);
    const metadata: JsonObject = { purpose: options.purpose, expiresAt: expiresAt.toISOString(), ...(options.lock ? { lock: true } : {}) };
    const organizationIds = await memberOrganizations(user.id);
    if (organizationIds.length === 0) logger.info({ requestId: c.get('requestId'), userId: user.id, action: 'user.setup_link_issued' }, 'account change on a user with no memberships; no organization to audit');
    await store.accountSetup.issue({
      userId: user.id,
      tokenDigest: sessionDigest(sessions.pepper, token),
      purpose: options.purpose,
      at: now,
      expiresAt,
      lock: options.lock,
      audit: auditEvents(c, organizationIds, user.id, 'user.setup_link_issued', metadata),
    });
    return { url: setupUrl(sessions.portalOrigin ?? new URL(c.req.url).origin, token), expiresAt: expiresAt.toISOString(), purpose: options.purpose };
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
      try {
        const { user, memberships, personalOrganization } = await store.users.create({
          email,
          displayName: body.displayName,
          // MUT-235: no password until the person sets one through their link.
          passwordHash: null,
          locale: body.locale,
          ...(firm ? { organizationId: firm.id } : {}),
          personal: personalProfileFor(body.locale, settings),
          at: c.get('now')(),
        });
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
        await audit(c, memberships.map((m) => m.organizationId), user.id, 'user.created', { email: user.email, displayName: user.displayName });
        const setupLink = await issueSetupLink(c, user, { purpose: 'SETUP', validHours: body.setupLinkValidHours, lock: false });
        return c.json(
          {
            user: serializeUser(user),
            memberships: memberships.map(serializeMembership),
            personalProfile: { id: personalOrganization.id, name: personalOrganization.name },
            setupLink,
          },
          201,
        );
      } catch (err) {
        // MUT-120: the transaction also writes the personal organization, so only an email clash is reported as one.
        if (err instanceof UniqueViolation) {
          throw new ApiError('CONFLICT', err.constraint.includes('email') ? 'A user with this email already exists' : 'A conflicting record already exists; retry the request');
        }
        if (err instanceof ForeignKeyViolation) throw new ApiError('NOT_FOUND', 'Organization not found');
        throw err;
      }
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
        409: { description: 'The organization is a profile another user owns (CONFLICT, details.reason PERSONAL_PROFILE or OWNED_PROFILE)', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      const { organizationId } = c.req.valid('json');
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
      // MUT-120/182: a user always keeps a profile they own; it cannot be revoked away from them.
      const owned = await store.organizations.getById(organizationId);
      if (owned && profileOwnerOf(owned) === user.id) {
        throw ownedProfileConflict(owned, 'A user keeps the profiles they own; they cannot be revoked');
      }
      const removed = await store.memberships.revoke(user.id, organizationId);
      if (removed) await audit(c, [organizationId], user.id, 'membership.revoked');
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
        409: { description: 'The user is disabled (CONFLICT, details.reason USER_DISABLED); enable them first', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      if (user.status !== 'ACTIVE') throw new ApiError('CONFLICT', 'A disabled user cannot use a setup link; enable them first', { reason: 'USER_DISABLED' });
      // The body is optional: with none, the validator is skipped and nothing is defaulted, hence the explicit fallbacks.
      const body: { validHours?: number | undefined; lock?: boolean | undefined } = c.req.valid('json') ?? {};
      const purpose: SetupLinkPurpose = user.passwordHash === null ? 'SETUP' : 'RESET';
      const setupLink = await issueSetupLink(c, user, { purpose, validHours: body.validHours, lock: body.lock === true });
      return c.json({ user: serializeUser((await store.users.getById(user.id)) ?? user), setupLink }, 200);
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
          ...adminErrors,
        },
      }),
      async (c) => {
        const existing = await mustGetUser(c.req.valid('param').userId);
        const now = c.get('now')();
        const user = await store.users.setStatus(existing.id, status, now);
        if (!user) throw new ApiError('NOT_FOUND', 'User not found');
        if (status === 'DISABLED') await store.sessions.revokeAllForUser(user.id, 'disabled', now);
        if (existing.status !== status) await audit(c, await memberOrganizations(user.id), user.id, action);
        return c.json({ user: serializeUser(user) }, 200);
      },
    );
  }

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
