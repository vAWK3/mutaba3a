import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { verifyCurrentPassword } from '../auth/current-password.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { passkeyNameFor } from '../auth/passkey-names.js';
import { requestClientIp, type SignInThrottle } from '../auth/sessions.js';
import type { PasswordHasher } from '../auth/users.js';
import { CHALLENGE_TTL_MS, creationOptions, PASSKEY_LIMIT, signInOptions, STEP_UP_WINDOW_MS, verifyCreation, type WebauthnConfig } from '../auth/webauthn.js';
import { ApiError } from '../errors.js';
import type { RateLimiter } from '../rate-limit.js';
import { StateConflict, UniqueViolation } from '../repositories/memory.js';
import type { AuditEventInput, JsonObject, LedgerStore, PasskeyRecord, SessionRecord, UserRecord } from '../repositories/ports.js';
import type {
  PasskeyCreationOptionsSchema,
  PasskeyRequestOptionsSchema} from '../schemas.js';
import {
  AddPasskeyRequestSchema,
  ErrorEnvelopeSchema,
  PasskeyCreationChallengeSchema,
  PasskeyCreationOptionsRequestSchema,
  PasskeyListSchema,
  PasskeySchema,
  PasskeySignInChallengeSchema,
  RenamePasskeyRequestSchema,
} from '../schemas.js';

/**
 * MUT-115 (ADR-190): a signed-in person's passkeys, and the public challenge passkey sign-in starts from. The two
 * sign-in routes themselves sit beside their password twins (routes/sessions.ts, routes/device-sessions.ts).
 *
 * Adding a passkey needs a sign-in at most 10 minutes old, or the current password (D4): passkeys survive a password
 * change, so a stolen session must not be able to plant one. Removing a passkey signs out the devices it opened (A2).
 * Without WEBAUTHN_RP_ID every route here answers 404.
 */

/**
 * MUT-414's seam: told after a passkey is added (committed), never able to change the answer. The default does
 * nothing; the "a passkey was added to your account" mail plugs in here once the mailer is live (MUT-359).
 */
export interface PasskeyEvents {
  added(event: { user: UserRecord; passkey: PasskeyRecord; requestId: string | null }): Promise<void>;
}

export const NO_PASSKEY_EVENTS: PasskeyEvents = { added: async () => {} };

export interface PasskeyRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  throttle: SignInThrottle;
  settings: SessionSettings;
  /** The sign-in IP limiter, under its own `passkey-challenge:` key (an unauthenticated challenge writes a row). */
  ipLimiter: RateLimiter;
  webauthn: WebauthnConfig | null;
  events?: PasskeyEvents;
}

/** The person's own passkeys: no X-Mutaba3a-Profile (the lapse gate classifies each as `open`). */
export const PASSKEY_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/passkeys',
  'POST /v1/passkeys/creation-options',
  'POST /v1/passkeys',
  'PATCH /v1/passkeys/:passkeyId',
  'DELETE /v1/passkeys/:passkeyId',
]);

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const PasskeyParams = z.object({ passkeyId: z.string().uuid().openapi({ param: { name: 'passkeyId', in: 'path' } }) });
const OWN = [{ session: [] }, { deviceSession: [] }];
const NOT_CONFIGURED = 'Passkeys are not available on this server';

export function passkeyRoutes(options: PasskeyRouteOptions): OpenAPIHono<AppEnv> {
  const { store, passwordHasher, throttle, settings, ipLimiter, webauthn } = options;
  const events = options.events ?? NO_PASSKEY_EVENTS;
  const app = new OpenAPIHono<AppEnv>();

  const configured = (): WebauthnConfig => {
    if (!webauthn) throw new ApiError('NOT_FOUND', NOT_CONFIGURED);
    return webauthn;
  };

  /** D4 / §11.1: a recent sign-in, else the current password (counted toward lockout like any wrong password). */
  async function stepUp(c: Context<AppEnv>, user: UserRecord, session: SessionRecord, currentPassword: string | undefined): Promise<void> {
    const now = c.get('now')();
    if (now.getTime() - session.credentialsVerifiedAt.getTime() <= STEP_UP_WINDOW_MS) return;
    if (currentPassword === undefined) {
      throw new ApiError('RECENT_SIGN_IN_REQUIRED', 'Enter your password to add a passkey', { windowMinutes: STEP_UP_WINDOW_MS / 60_000 });
    }
    await verifyCurrentPassword({ store, passwordHasher, throttle }, user, currentPassword, now, c.get('requestId'));
  }

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/passkeys',
      tags: ['Passkeys'],
      summary: 'Your passkeys (MUT-115)',
      security: OWN,
      responses: {
        200: { description: 'Oldest first', content: { 'application/json': { schema: PasskeyListSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
      },
    }),
    async (c) => {
      configured();
      const items = await store.passkeys.listByUser(c.get('identity').user.id);
      return c.json({ items: items.map(passkeyJson), limit: PASSKEY_LIMIT }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/passkeys/creation-options',
      tags: ['Passkeys'],
      summary: 'Start adding a passkey: the options for navigator.credentials.create() (MUT-115)',
      description:
        'Needs a sign-in (or password change) at most 10 minutes old; otherwise send `currentPassword` (403 RECENT_SIGN_IN_REQUIRED without it, 403 CURRENT_PASSWORD_WRONG when wrong, counted toward the sign-in lockout). The challenge is single-use, bound to this person, and lives 5 minutes. `excludeCredentials` lists your own passkeys.',
      security: OWN,
      request: { body: { required: false, content: { 'application/json': { schema: PasskeyCreationOptionsRequestSchema } } } },
      responses: {
        200: { description: 'Pass `publicKey` to the platform; send `challengeId` back with the result', content: { 'application/json': { schema: PasskeyCreationChallengeSchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('RECENT_SIGN_IN_REQUIRED, CURRENT_PASSWORD_WRONG, PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
        409: errorResponse('PASSKEY_LIMIT — you already have 10 passkeys'),
        422: errorResponse('Validation failed'),
      },
    }),
    async (c) => {
      const config = configured();
      const { user, session } = c.get('identity');
      const body = (await c.req.json().catch(() => ({}))) as unknown;
      const parsed = PasskeyCreationOptionsRequestSchema.safeParse(body ?? {});
      if (!parsed.success) throw new ApiError('VALIDATION_FAILED', 'Invalid body', parsed.error.issues);
      await stepUp(c, user, session, parsed.data.currentPassword);
      const existing = await store.passkeys.listByUser(user.id);
      if (existing.length >= PASSKEY_LIMIT) throw passkeyLimit();
      const publicKey = await creationOptions(config, user, existing);
      const now = c.get('now')();
      const { id } = await store.passkeys.createChallenge({ challenge: publicKey.challenge, purpose: 'creation', userId: user.id, at: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) });
      return c.json({ challengeId: id, publicKey: publicKey as unknown as z.infer<typeof PasskeyCreationOptionsSchema> }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/passkeys',
      tags: ['Passkeys'],
      summary: 'Finish adding a passkey (MUT-115)',
      description:
        'Send the `challengeId` from creation-options and the platform\'s registration response (WebAuthn JSON). The same recent-sign-in rule applies again (the options call is not trusted). The passkey is named from its provider, or from the device it was added from; rename it with PATCH.',
      security: OWN,
      request: { body: { required: true, content: { 'application/json': { schema: AddPasskeyRequestSchema } } } },
      responses: {
        201: { description: 'Added', content: { 'application/json': { schema: PasskeySchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('RECENT_SIGN_IN_REQUIRED, CURRENT_PASSWORD_WRONG, PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
        409: errorResponse('PASSKEY_LIMIT — you already have 10 passkeys; CONFLICT — this passkey is already registered'),
        422: errorResponse('VALIDATION_FAILED; reason PASSKEY_NOT_VERIFIED when the challenge was used, expired or not yours, or the response did not verify (origin, RP ID, user verification)'),
      },
    }),
    async (c) => {
      const config = configured();
      const { user, session } = c.get('identity');
      const { challengeId, response, currentPassword } = c.req.valid('json');
      await stepUp(c, user, session, currentPassword);
      const now = c.get('now')();
      const challenge = await store.passkeys.consumeChallenge(challengeId, 'creation', user.id, now);
      const verified = challenge ? await verifyCreation(config, response as unknown as RegistrationResponseJSON, challenge.challenge) : null;
      if (!verified) throw new ApiError('VALIDATION_FAILED', 'The passkey could not be verified; try again', { reason: 'PASSKEY_NOT_VERIFIED' });
      const taken = (await store.passkeys.listByUser(user.id)).map((p) => p.name);
      const name = passkeyNameFor(verified.aaguid, c.req.header('user-agent') ?? null, session.kind, taken);
      let passkey: PasskeyRecord;
      try {
        passkey = await store.passkeys.create({ ...verified, userId: user.id, name, at: now, limit: PASSKEY_LIMIT, audit: await passkeyAudit(store, c, user, 'user.passkey_added', { sessionKind: session.kind }) });
      } catch (err) {
        if (err instanceof StateConflict && err.reason === 'PASSKEY_LIMIT') throw passkeyLimit();
        if (err instanceof UniqueViolation) throw new ApiError('CONFLICT', 'This passkey is already registered', { reason: 'PASSKEY_EXISTS' });
        throw err;
      }
      await events.added({ user, passkey, requestId: c.get('requestId') });
      return c.json(passkeyJson(passkey), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/passkeys/{passkeyId}',
      tags: ['Passkeys'],
      summary: 'Rename one of your passkeys (MUT-115)',
      security: OWN,
      request: { params: PasskeyParams, body: { required: true, content: { 'application/json': { schema: RenamePasskeyRequestSchema } } } },
      responses: {
        200: { description: 'Renamed', content: { 'application/json': { schema: PasskeySchema } } },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — no such passkey of yours (or passkeys are not configured)'),
        422: errorResponse('Validation failed (a name is 1–64 characters)'),
      },
    }),
    async (c) => {
      configured();
      const { passkeyId } = c.req.valid('param');
      const { name } = c.req.valid('json');
      const renamed = await store.passkeys.rename(c.get('identity').user.id, passkeyId, name);
      if (!renamed) throw new ApiError('NOT_FOUND', 'No such passkey');
      return c.json(passkeyJson(renamed), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/passkeys/{passkeyId}',
      tags: ['Passkeys'],
      summary: 'Remove one of your passkeys (MUT-115)',
      description: 'It stops signing in at once, and every session it opened is signed out, except the one making this request.',
      security: OWN,
      request: { params: PasskeyParams },
      responses: {
        204: { description: 'Removed' },
        401: errorResponse('No valid session'),
        403: errorResponse('PRINCIPAL_NOT_ACCEPTED, CROSS_SITE_REQUEST or ACCOUNT_CLOSING'),
        404: errorResponse('NOT_FOUND — no such passkey of yours (or passkeys are not configured)'),
      },
    }),
    async (c) => {
      configured();
      const { user, session } = c.get('identity');
      const { passkeyId } = c.req.valid('param');
      const audit = await passkeyAudit(store, c, user, 'user.passkey_removed', { passkeyId });
      const removed = await store.passkeys.remove({ userId: user.id, id: passkeyId, exceptSessionId: session.id, at: c.get('now')(), audit });
      if (!removed) throw new ApiError('NOT_FOUND', 'No such passkey');
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/passkey-challenges',
      tags: ['Passkeys'],
      summary: 'Start a passkey sign-in: the options for navigator.credentials.get() (MUT-115)',
      description:
        'No email first: `allowCredentials` is empty, so the platform offers every passkey it holds for this site. Single-use, 5 minutes. Then POST /v1/sessions/passkey (portal) or /v1/device-sessions/passkey (app).',
      security: [],
      responses: {
        201: { description: 'A sign-in challenge', content: { 'application/json': { schema: PasskeySignInChallengeSchema } } },
        404: errorResponse('NOT_FOUND — passkeys are not configured on this server'),
        429: errorResponse('Too many challenges from this address'),
      },
    }),
    async (c) => {
      const config = configured();
      const now = c.get('now')();
      const ip = await ipLimiter.check(`passkey-challenge:${requestClientIp((name) => c.req.header(name), settings)}`, now);
      if (!ip.allowed) {
        c.header('Retry-After', String(ip.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
      }
      const publicKey = await signInOptions(config);
      const { id } = await store.passkeys.createChallenge({ challenge: publicKey.challenge, purpose: 'authentication', userId: null, at: now, expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS) });
      return c.json({ challengeId: id, publicKey: publicKey as unknown as z.infer<typeof PasskeyRequestOptionsSchema> }, 201);
    },
  );

  return app;
}

function passkeyLimit(): ApiError {
  return new ApiError('PASSKEY_LIMIT', `You can have up to ${PASSKEY_LIMIT} passkeys. Remove one to add another.`, { limit: PASSKEY_LIMIT });
}

export function passkeyJson(p: PasskeyRecord) {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt.toISOString(),
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
  };
}

/** One row per profile the person belongs to, like every identity event (actor USER). */
async function passkeyAudit(store: LedgerStore, c: Context<AppEnv>, user: UserRecord, action: string, metadata: JsonObject): Promise<AuditEventInput[]> {
  return (await store.memberships.listByUser(user.id)).map((m) => ({
    organizationId: m.organizationId,
    actorType: 'USER',
    actorId: user.id,
    action,
    entityType: 'user',
    entityId: user.id,
    requestId: c.get('requestId'),
    metadata,
  }));
}
