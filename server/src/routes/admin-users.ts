import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { generateOneTimePassword, normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { ForeignKeyViolation, UniqueViolation } from '../repositories/memory.js';
import type { LedgerStore, UserRecord } from '../repositories/ports.js';
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  ErrorEnvelopeSchema,
  GrantMembershipRequestSchema,
  GrantMembershipResponseSchema,
  PasswordResetResponseSchema,
  RemoveMembershipResponseSchema,
  UserDetailSchema,
  UserListSchema,
  UserStatusResponseSchema,
} from '../schemas.js';
import { serializeMembership, serializeUser } from '../serializers.js';

/**
 * Operator-only user accounts (MUT-37, ADR-033 decision 1). Every route sits
 * under /admin/ behind MUTABA3A_ADMIN_TOKEN; nothing here is reachable by an
 * API key or, later, a session. There is deliberately no signup, invite or
 * self-service reset anywhere in the service (no-self-registration.test.ts).
 *
 * Each mutation is audited with actor ADMIN on every organization the user
 * belongs to after it (a removed membership is audited on the organization it
 * removed). Passwords are generated here, returned once, and stored only as
 * argon2id hashes; no route ever returns or logs a hash.
 */
export interface AdminUserOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  logger: Logger;
}

const adminErrors = {
  401: { description: 'Missing or invalid admin token', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
} as const;
const notFound = { description: 'Unknown user or organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } } as const;

const UserIdParam = z.object({ userId: z.string().uuid().openapi({ param: { name: 'userId', in: 'path' } }) });
const MembershipParams = UserIdParam.extend({
  organizationId: z.string().uuid().openapi({ param: { name: 'organizationId', in: 'path' } }),
});

type AuditAction = 'user.created' | 'user.password_reset' | 'user.disabled' | 'user.enabled' | 'membership.granted' | 'membership.revoked';

export function adminUserRoutes(options: AdminUserOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, logger } = options;
  const app = new OpenAPIHono<AppEnv>();

  async function audit(c: Context<AppEnv>, organizationIds: string[], userId: string, action: AuditAction, metadata?: Record<string, unknown>) {
    if (organizationIds.length === 0) {
      logger.info({ requestId: c.get('requestId'), userId, action }, 'account change on a user with no memberships; no organization to audit');
      return;
    }
    for (const organizationId of organizationIds) {
      await store.audit.append({
        organizationId,
        actorType: 'ADMIN',
        actorId: null,
        action,
        entityType: 'user',
        entityId: userId,
        ...(metadata ? { metadata } : {}),
        requestId: c.get('requestId'),
      });
    }
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
      summary: 'Create a user with its first membership (one-time password returned once)',
      security: [{ adminToken: [] }],
      request: { body: { required: true, content: { 'application/json': { schema: CreateUserRequestSchema } } } },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: CreateUserResponseSchema } } },
        404: { description: 'Unknown organization', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        409: { description: 'Email already in use', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        422: { description: 'Validation failed', content: { 'application/json': { schema: ErrorEnvelopeSchema } } },
        ...adminErrors,
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const email = normalizeEmail(body.email);
      if (!(await store.organizations.getById(body.organizationId))) throw new ApiError('NOT_FOUND', 'Organization not found');
      const initialPassword = generateOneTimePassword();
      const passwordHash = await passwordHasher.hash(initialPassword);
      try {
        const { user, membership } = await store.users.create({
          email,
          displayName: body.displayName,
          passwordHash,
          locale: body.locale,
          organizationId: body.organizationId,
          at: c.get('now')(),
        });
        await audit(c, [membership.organizationId], user.id, 'user.created', { email: user.email, displayName: user.displayName });
        return c.json({ user: serializeUser(user), memberships: [serializeMembership(membership)], initialPassword }, 201);
      } catch (err) {
        if (err instanceof UniqueViolation) throw new ApiError('CONFLICT', 'A user with this email already exists');
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
      summary: 'Inspect a user and their memberships',
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
      return c.json({ user: serializeUser(user), memberships: memberships.map(serializeMembership) }, 200);
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
        ...adminErrors,
      },
    }),
    async (c) => {
      const user = await mustGetUser(c.req.valid('param').userId);
      const { organizationId } = c.req.valid('json');
      if (!(await store.organizations.getById(organizationId))) throw new ApiError('NOT_FOUND', 'Organization not found');
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
        ...adminErrors,
      },
    }),
    async (c) => {
      const { userId, organizationId } = c.req.valid('param');
      const user = await mustGetUser(userId);
      const removed = await store.memberships.revoke(user.id, organizationId);
      if (removed) await audit(c, [organizationId], user.id, 'membership.revoked');
      return c.json({ removed }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/admin/v1/users/{userId}/password',
      tags: ['Admin'],
      summary: 'Operator password reset: issue a new one-time password (returned once)',
      security: [{ adminToken: [] }],
      request: { params: UserIdParam },
      responses: {
        200: { description: 'New password issued', content: { 'application/json': { schema: PasswordResetResponseSchema } } },
        404: notFound,
        ...adminErrors,
      },
    }),
    async (c) => {
      const existing = await mustGetUser(c.req.valid('param').userId);
      const password = generateOneTimePassword();
      const user = await store.users.setPassword(existing.id, await passwordHasher.hash(password), c.get('now')());
      if (!user) throw new ApiError('NOT_FOUND', 'User not found');
      await audit(c, await memberOrganizations(user.id), user.id, 'user.password_reset');
      return c.json({ user: serializeUser(user), password }, 200);
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
        const user = await store.users.setStatus(existing.id, status, c.get('now')());
        if (!user) throw new ApiError('NOT_FOUND', 'User not found');
        if (existing.status !== status) await audit(c, await memberOrganizations(user.id), user.id, action);
        return c.json({ user: serializeUser(user) }, 200);
      },
    );
  }

  return app;
}
