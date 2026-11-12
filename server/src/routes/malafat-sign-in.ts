import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { defaultDisplayName } from '../auth/self-service.js';
import { isSamePortalOrigin, requestClientIp, sessionCookieName, sessionDigest, sessionLifetime, type SignInThrottle } from '../auth/sessions.js';
import { auditToMembers, invalidCredentials, issueSession, verifyPasskey, verifyPassword } from '../auth/sign-in.js';
import { normalizeEmail, type PasswordHasher } from '../auth/users.js';
import type { WebauthnConfig } from '../auth/webauthn.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import { malafatOrigin, MalafatSignInClient, type MalafatSignInConfig } from '../malafat/sign-in-client.js';
import { s256Challenge, verifyS256 } from '../oauth/protocol.js';
import { personalProfileFor } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { LedgerStore, MalafatSignInRecord, UserLocale, UserRecord } from '../repositories/ports.js';
import { CurrencySchema, ErrorEnvelopeSchema, MeSchema } from '../schemas.js';
import { isValidTimezone } from '../dates.js';
import { termsAcceptanceOf, termsAcceptedEvent } from '../terms-acceptance.js';
import { buildMe, passkeysClockOf } from './me.js';
import { ownedProfileCap } from './profiles.js';

/**
 * MUT-595 (ADR-254 D1, D4, D5, D8, DF1; brief §4.3): Sign in with Malafat. MTB3A is a public OAuth client of the
 * person's own Malafat firm (MAL-1539). One round trip, each step single use:
 *
 *   start → Malafat → callback → result code (#result=, 2 min) → exchange → signed in
 *                                                                        → needs_link (an account has that email)
 *                                                                        → needs_consent (creates, or after the link)
 *
 * Nothing about a person is written before consent (R8). Never linked by email alone (D4): an existing account is proven
 * with its own password or passkey first. The phone (client=app) gets its result at mutaba3a://auth/malafat and must
 * present the verifier of the S256 challenge it sent to /start (R3), so another app on the device that catches the
 * custom scheme can't use the code. Works with the firm's Malafat access switch off: the person reaches their own
 * profiles, and their seat (MUT-594) is claimed if Malafat has synced one.
 */

export const MALAFAT_SIGN_IN_ENDPOINTS: ReadonlySet<string> = new Set([
  'GET /v1/auth/malafat/office',
  'GET /v1/auth/malafat/start',
  'GET /v1/auth/malafat/callback',
  'POST /v1/auth/malafat/exchange',
  'POST /v1/auth/malafat/link',
  'POST /v1/auth/malafat/consent',
]);

/** Where the phone's result goes (R1): fixed, never a caller's URL. */
export const MALAFAT_APP_RETURN = 'mutaba3a://auth/malafat';
/** The portal page that reads the result from the fragment (MUT-596). */
export const MALAFAT_WEB_RETURN_PATH = '/malafat/return';
export const MALAFAT_CALLBACK_PATH = '/v1/auth/malafat/callback';

const FLOW_TTL_MS = 10 * 60_000;
const RESULT_TTL_MS = 2 * 60_000;
const TICKET_TTL_MS = 15 * 60_000;
const SECRET_BYTES = 32;

/** R7: what a failed round trip says, in the fragment of the client's return. */
type FailureCode = 'office_not_found' | 'access_denied' | 'malafat_unavailable' | 'state_invalid';

export interface MalafatSignInRouteOptions {
  store: LedgerStore;
  passwordHasher: PasswordHasher;
  settings: SessionSettings;
  throttle: SignInThrottle;
  ipLimiter: RateLimiter;
  terms: CurrentTerms;
  webauthn: WebauthnConfig | null;
  config: MalafatSignInConfig | null;
}

const secret = () => randomBytes(SECRET_BYTES).toString('base64url');
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

const TenantQuery = z.object({ tenant: z.string().min(1).max(63).openapi({ description: 'The firm’s Malafat address, e.g. sader for sader.malafat.app' }) });
const StartQuery = TenantQuery.extend({
  client: z.enum(['web', 'app']).default('web'),
  app_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional().openapi({ description: 'client=app: the S256 challenge of a verifier the app keeps; /exchange must present it (R3)' }),
});
const CallbackQuery = z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(64).optional() });

const OfficeSchema = z.object({ host: z.string() }).openapi('MalafatOffice');
const ExchangeRequestSchema = z.object({ result: z.string().min(1).max(128), app_verifier: z.string().min(43).max(128).optional() }).openapi('MalafatExchangeRequest');
const LinkRequestSchema = z
  .object({
    ticket: z.string().min(1).max(128),
    password: z.string().max(1024).optional(),
    passkey: z.object({ challengeId: z.string().uuid(), response: z.record(z.string(), z.unknown()) }).optional(),
  })
  .refine((b) => (b.password === undefined) !== (b.passkey === undefined), { message: 'Send a password or a passkey assertion, not both' })
  .openapi('MalafatLinkRequest');
const ConsentRequestSchema = z
  .object({
    ticket: z.string().min(1).max(128),
    acceptedTermsVersion: z.string().max(32).optional(),
    defaultCurrency: CurrencySchema.optional(),
    timezone: z.string().max(64).refine(isValidTimezone, 'Not an IANA timezone').optional(),
  })
  .openapi('MalafatConsentRequest');
const SignInStateSchema = z
  .object({
    state: z.enum(['signed_in', 'needs_consent', 'needs_link']),
    me: MeSchema.optional().openapi({ description: 'signed_in: the person, as GET /v1/me' }),
    token: z.string().optional().openapi({ description: 'signed_in with client=app: a device session token, as POST /v1/device-sessions' }),
    ticket: z.string().optional().openapi({ description: 'needs_link / needs_consent: for /link and /consent, 15 minutes' }),
    creates: z.boolean().optional().openapi({ description: 'needs_consent: true when consent creates a new account (send defaultCurrency and timezone)' }),
    office: z.object({ name: z.string() }).optional(),
    email: z.string().optional().openapi({ description: 'The Malafat account’s verified email' }),
  })
  .openapi('MalafatSignInState');

export function malafatSignInRoutes(options: MalafatSignInRouteOptions): OpenAPIHono<AppEnv> {
  const { store, settings, terms } = options;
  const app = new OpenAPIHono<AppEnv>();
  const client = options.config ? new MalafatSignInClient(options.config) : null;
  const cookieName = sessionCookieName(settings.secureCookie);
  const cookieOptions = { path: '/', httpOnly: true, secure: settings.secureCookie, sameSite: 'Strict' } as const;
  const digest = (kind: string, value: string) => sessionDigest(settings.pepper, `malafat-${kind}:${value}`);
  const signInDeps = { store, passwordHasher: options.passwordHasher, throttle: options.throttle, pepper: settings.pepper };

  const configured = (): { client: MalafatSignInClient; config: MalafatSignInConfig } => {
    if (!client || !options.config || !settings.portalOrigin) throw new ApiError('NOT_FOUND', 'Not found');
    return { client, config: options.config };
  };
  const redirectUri = () => `${settings.portalOrigin}${MALAFAT_CALLBACK_PATH}`;
  const returnTo = (kind: 'web' | 'app', fragment: Record<string, string>) =>
    `${kind === 'app' ? MALAFAT_APP_RETURN : `${settings.portalOrigin}${MALAFAT_WEB_RETURN_PATH}`}#${new URLSearchParams(fragment).toString()}`;
  const fail = (c: Context<AppEnv>, kind: 'web' | 'app', error: FailureCode) => c.redirect(returnTo(kind, { error }), 302);

  /** Every POST: the sign-in IP limiter (R9), and a portal call from the portal's own origin. */
  async function guard(c: Context<AppEnv>, kind: 'web' | 'app'): Promise<void> {
    const ip = requestClientIp((h) => c.req.header(h), settings);
    const decision = await options.ipLimiter.check(`sign-in:${ip}`, c.get('now')());
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many sign-in attempts from this address', { retryAfterSeconds: decision.retryAfterSeconds });
    }
    if (kind === 'web' && !isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'This request must come from the MTB3A portal itself');
  }

  /** A session as the client takes it: the portal's cookie, or the phone's device token (R4). */
  async function signedIn(c: Context<AppEnv>, kind: 'web' | 'app', user: UserRecord) {
    const sessionKind = kind === 'app' ? 'device' : 'cookie';
    const { user: person, token } = await issueSession(c, signInDeps, user, { sessionKind, method: 'malafat' }, sessionLifetime(sessionKind, settings));
    if (kind === 'web') setCookie(c, cookieName, token, { ...cookieOptions, maxAge: settings.absoluteHours * 3600 });
    const me = await buildMe(store, person, terms, c.get('now')(), c.get('billingGate'), passkeysClockOf(c), ownedProfileCap(c), c.get('accountantAccess'), c.get('accountantPlan'));
    return { state: 'signed_in' as const, me, ...(kind === 'app' ? { token } : {}) };
  }

  async function ticketFor(flow: MalafatSignInRecord, state: 'needs_link' | 'needs_consent', now: Date) {
    const ticket = secret();
    await store.malafatSignIns.issueTicket({ id: flow.id, ticketDigest: digest('ticket', ticket), ticketExpiresAt: new Date(now.getTime() + TICKET_TTL_MS) });
    return ticketState(flow, state, ticket);
  }

  const ticketState = (flow: MalafatSignInRecord, state: 'needs_link' | 'needs_consent', ticket: string) => ({
    state,
    ticket,
    ...(state === 'needs_consent' ? { creates: flow.outcome === 'needs_consent' } : {}),
    office: { name: flow.facts?.tenantName ?? '' },
    email: flow.facts?.email ?? '',
  });

  const usable = (user: UserRecord | null): user is UserRecord => user !== null && user.status === 'ACTIVE' && user.passwordHash !== null;

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/auth/malafat/office',
      tags: ['Sign in with Malafat'],
      summary: 'Whether an address is a Malafat office (MUT-595)',
      security: [],
      request: { query: TenantQuery },
      responses: { 200: { description: 'It is', content: { 'application/json': { schema: OfficeSchema } } }, 404: errorResponse('No such office, or Sign in with Malafat is off on this server') },
    }),
    async (c) => {
      const { client: malafat, config } = configured();
      const origin = malafatOrigin(config, c.req.valid('query').tenant);
      if (!origin || !(await malafat.isOffice(origin))) throw new ApiError('NOT_FOUND', 'No Malafat office at that address', { reason: 'OFFICE_NOT_FOUND' });
      return c.json({ host: new URL(origin).host }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/auth/malafat/start',
      tags: ['Sign in with Malafat'],
      summary: 'Start Sign in with Malafat: redirects to the firm’s Malafat (MUT-595)',
      description: 'Open in the browser (the phone: an in-app browser). 302 to Malafat; a refusal 302s to the client’s return with #error= (R7).',
      security: [],
      request: { query: StartQuery },
      responses: { 302: { description: 'To Malafat, or back with #error=' }, 404: errorResponse('Sign in with Malafat is off on this server') },
    }),
    async (c) => {
      const { client: malafat, config } = configured();
      const query = c.req.valid('query');
      const kind = query.client;
      const origin = malafatOrigin(config, query.tenant);
      if (!origin) return fail(c, kind, 'office_not_found');
      if (kind === 'app' && !query.app_challenge) return fail(c, kind, 'state_invalid');
      const now = c.get('now')();
      const state = secret();
      const codeVerifier = secret();
      await store.malafatSignIns.create({ stateDigest: digest('state', state), codeVerifier, tenantSlug: query.tenant, client: kind, appChallenge: query.app_challenge ?? null, at: now, expiresAt: new Date(now.getTime() + FLOW_TTL_MS) });
      return c.redirect(malafat.authorizeUrl(origin, { redirectUri: redirectUri(), state, codeChallenge: s256Challenge(codeVerifier) }), 302);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/auth/malafat/callback',
      tags: ['Sign in with Malafat'],
      summary: 'Malafat sends the person back here (MUT-595)',
      description: 'Malafat’s redirect target. 302 to the client’s return with #result=<code> (2 minutes, single use) or #error=.',
      security: [],
      request: { query: CallbackQuery },
      responses: { 302: { description: 'To the client’s return' } },
    }),
    async (c) => {
      const { client: malafat, config } = configured();
      const query = c.req.valid('query');
      const now = c.get('now')();
      const flow = query.state ? await store.malafatSignIns.claimCallback(digest('state', query.state), now) : null;
      if (!flow) return fail(c, 'web', 'state_invalid');
      if (query.error || !query.code) return fail(c, flow.client, query.error === 'access_denied' ? 'access_denied' : 'malafat_unavailable');
      const origin = malafatOrigin(config, flow.tenantSlug);
      const facts = origin ? await malafat.signIn(origin, { code: query.code, codeVerifier: flow.codeVerifier, redirectUri: redirectUri() }) : null;
      // The tenant Malafat names must be the office the person started at.
      if (!facts || facts.tenantSlug !== flow.tenantSlug) return fail(c, flow.client, 'malafat_unavailable');

      const identity = await store.externalIdentities.findBySubject('MALAFAT', facts.tenantId, facts.subject);
      const linked = identity?.userId ? await store.users.getById(identity.userId) : null;
      const byEmail = linked ? null : await store.users.findByEmail(normalizeEmail(facts.email));
      const outcome = usable(linked) ? 'signed_in' : byEmail ? 'needs_link' : 'needs_consent';
      const result = secret();
      await store.malafatSignIns.recordResult({ id: flow.id, facts, outcome, userId: linked?.id ?? byEmail?.id ?? null, resultDigest: digest('result', result), resultExpiresAt: new Date(now.getTime() + RESULT_TTL_MS) });
      return c.redirect(returnTo(flow.client, { result }), 302);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/auth/malafat/exchange',
      tags: ['Sign in with Malafat'],
      summary: 'Exchange the result code (MUT-595)',
      description: 'Single use: the code burns on the first attempt, right or wrong. client=app must send app_verifier (R3).',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: ExchangeRequestSchema } } } },
      responses: {
        200: { description: 'Signed in, or the next step', content: { 'application/json': { schema: SignInStateSchema } } },
        401: errorResponse('INVALID_CREDENTIALS: the linked account can no longer sign in'),
        404: errorResponse('NOT_FOUND reason MALAFAT_RESULT_INVALID: used, expired, unknown, or the verifier does not match'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      configured();
      const body = c.req.valid('json');
      const now = c.get('now')();
      const flow = await store.malafatSignIns.claimResult(digest('result', body.result), now);
      if (!flow?.outcome) throw resultInvalid();
      await guard(c, flow.client);
      if (flow.client === 'app' && !(flow.appChallenge && body.app_verifier && verifiesChallenge(body.app_verifier, flow.appChallenge))) throw resultInvalid();
      if (flow.outcome === 'signed_in') {
        const user = flow.userId ? await store.users.getById(flow.userId) : null;
        if (!usable(user)) throw invalidCredentials();
        return c.json(await signedIn(c, flow.client, user), 200);
      }
      return c.json(await ticketFor(flow, flow.outcome, now), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/auth/malafat/link',
      tags: ['Sign in with Malafat'],
      summary: 'Prove the MTB3A account that has this email, to link it (MUT-595, D4)',
      description: 'With its password, or a passkey assertion from POST /v1/passkey-challenges. Writes nothing (R8): consent links.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: LinkRequestSchema } } } },
      responses: {
        200: { description: 'Proven: consent next', content: { 'application/json': { schema: SignInStateSchema } } },
        401: errorResponse('INVALID_CREDENTIALS (counts toward the account’s lockout)'),
        404: errorResponse('NOT_FOUND reason MALAFAT_TICKET_INVALID'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      configured();
      const body = c.req.valid('json');
      const now = c.get('now')();
      const flow = await store.malafatSignIns.findByTicket(digest('ticket', body.ticket), now);
      if (!flow || flow.outcome !== 'needs_link' || flow.linkProvenAt || !flow.userId) throw ticketInvalid();
      await guard(c, flow.client);
      const target = await store.users.getById(flow.userId);
      if (!target) throw ticketInvalid();
      const sessionKind = flow.client === 'app' ? 'device' : 'cookie';
      let proven: UserRecord;
      if (body.password !== undefined) {
        proven = await verifyPassword(c, signInDeps, { email: target.email, password: body.password }, sessionKind);
      } else {
        if (!options.webauthn || !body.passkey) throw invalidCredentials();
        const presented = { challengeId: body.passkey.challengeId, response: body.passkey.response as unknown as AuthenticationResponseJSON };
        proven = (await verifyPasskey(c, { ...signInDeps, webauthn: options.webauthn }, presented, sessionKind)).user;
      }
      // A passkey of another account proves nothing about this one.
      if (proven.id !== target.id) throw invalidCredentials();
      await store.malafatSignIns.proveLink({ id: flow.id, userId: target.id, at: now });
      return c.json(ticketState({ ...flow, linkProvenAt: now }, 'needs_consent', body.ticket), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/auth/malafat/consent',
      tags: ['Sign in with Malafat'],
      summary: 'Consent: create or link the account, claim the firm seat, sign in (MUT-595, D8)',
      description:
        'Everything is written here and nowhere before (R8). A new account (creates) needs defaultCurrency and timezone; it is ACTIVE with no review (DF1) and starts the normal trial (D5). acceptedTermsVersion records the terms now; without it, GET /v1/me asks as for anyone.',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: ConsentRequestSchema } } } },
      responses: {
        200: { description: 'Signed in', content: { 'application/json': { schema: SignInStateSchema } } },
        404: errorResponse('NOT_FOUND reason MALAFAT_TICKET_INVALID: used, expired, unknown, or the link was not proven'),
        409: errorResponse('CONFLICT reason IDENTITY_LINKED_ELSEWHERE (this Malafat person is another account’s) or EMAIL_TAKEN; TERMS_VERSION_STALE'),
        422: errorResponse('VALIDATION_FAILED: a new account without defaultCurrency or timezone'),
        429: errorResponse('RATE_LIMITED'),
      },
    }),
    async (c) => {
      configured();
      const body = c.req.valid('json');
      const now = c.get('now')();
      const ticketDigest = digest('ticket', body.ticket);
      const flow = await store.malafatSignIns.findByTicket(ticketDigest, now);
      const facts = flow?.facts;
      if (!flow || !facts || (flow.outcome === 'needs_link' && !flow.linkProvenAt) || flow.outcome === 'signed_in') throw ticketInvalid();
      await guard(c, flow.client);
      const creates = flow.outcome === 'needs_consent';
      if (creates && (!body.defaultCurrency || !body.timezone)) throw new ApiError('VALIDATION_FAILED', 'A new account needs a currency and a timezone', { field: body.defaultCurrency ? 'timezone' : 'defaultCurrency' });
      if (body.acceptedTermsVersion !== undefined && body.acceptedTermsVersion !== terms.version) throw new ApiError('TERMS_VERSION_STALE', 'The terms changed; read the current version and accept it', { current: terms.version });
      // Refused before anything is written: the Malafat person is already another account's.
      const existing = await store.externalIdentities.findBySubject('MALAFAT', facts.tenantId, facts.subject);
      if (existing?.userId && existing.userId !== flow.userId) throw linkedElsewhere();
      if (creates && (await store.users.findByEmail(normalizeEmail(facts.email)))) throw new ApiError('CONFLICT', 'An MTB3A account already has this email; sign in to it to connect Malafat', { reason: 'EMAIL_TAKEN' });
      if (!(await store.malafatSignIns.claimCompletion(ticketDigest, now))) throw ticketInvalid();

      const locale: UserLocale = facts.locale?.startsWith('en') ? 'en' : 'ar';
      let user: UserRecord | null;
      if (creates) {
        // D5/DF1: an ordinary account, ACTIVE, the normal trial. Its password is a random one nobody holds, so every
        // session rule that binds to a password hash holds; the person can set their own through account recovery.
        const passwordHash = await options.passwordHasher.hash(secret());
        const created = await store.users.create({
          email: normalizeEmail(facts.email),
          displayName: facts.name?.trim() || defaultDisplayName(facts.email),
          passwordHash,
          locale,
          personal: personalProfileFor(locale, { defaultCurrency: body.defaultCurrency!, timezone: body.timezone! }),
          at: now,
        });
        await store.billing.setTrialStart(created.user.id, now);
        user = created.user;
      } else {
        user = flow.userId ? await store.users.getById(flow.userId) : null;
      }
      if (!usable(user)) throw invalidCredentials();
      if (body.acceptedTermsVersion !== undefined) {
        const acceptance = termsAcceptanceOf(terms, user.locale, flow.client === 'app' ? 'device' : 'cookie', undefined);
        const personal = (await store.memberships.listByUser(user.id))[0];
        await store.users.acceptTerms({ ...acceptance, userId: user.id, at: now, audit: personal ? [termsAcceptedEvent(personal.organizationId, user.id, acceptance, c.get('requestId'))] : [] });
      }
      const integration = await store.integrations.findByProviderAndTenant('MALAFAT', facts.tenantId);
      const linked = await store.externalIdentities.link({
        provider: 'MALAFAT',
        tenantId: facts.tenantId,
        subject: facts.subject,
        userId: user.id,
        email: facts.email,
        malafatRole: facts.role,
        organizationId: integration?.status === 'CONNECTED' ? integration.organizationId : null,
        at: now,
        audit: [],
      });
      if (linked.kind === 'elsewhere') throw linkedElsewhere();
      await auditToMembers(c, store, user, 'user.malafat_linked', { sessionKind: flow.client === 'app' ? 'device' : 'cookie', method: 'malafat' });
      return c.json(await signedIn(c, flow.client, user), 200);
    },
  );

  return app;
}

/** R3/R9: the phone's verifier, checked in constant time against the challenge it sent to /start. */
function verifiesChallenge(verifier: string, challenge: string): boolean {
  if (!verifyS256(verifier, challenge)) return false;
  const a = Buffer.from(s256Challenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resultInvalid(): ApiError {
  return new ApiError('NOT_FOUND', 'This sign-in has expired or was already used; start again', { reason: 'MALAFAT_RESULT_INVALID' });
}

function ticketInvalid(): ApiError {
  return new ApiError('NOT_FOUND', 'This sign-in has expired or was already used; start again', { reason: 'MALAFAT_TICKET_INVALID' });
}

function linkedElsewhere(): ApiError {
  return new ApiError('CONFLICT', 'This Malafat account is already connected to another MTB3A account', { reason: 'IDENTITY_LINKED_ELSEWHERE' });
}
