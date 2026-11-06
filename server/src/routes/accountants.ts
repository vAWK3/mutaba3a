import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTANT_INVITE_TTL_MS,
  accountantInviteUrl,
  clientOf,
  grantAudit,
  grantStatusView,
  maskEmail,
  ownerNameOf,
} from '../accountants/grants.js';
import { generateSetupToken } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { defaultDisplayName } from '../auth/self-service.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest } from '../auth/sessions.js';
import type { TurnstileVerifier } from '../auth/turnstile.js';
import { normalizeEmail, type PasswordHasher } from '../auth/users.js';
import { setupLinkOrigin } from '../auth/account-setup.js';
import { todayIn } from '../dates.js';
import { DOMAIN_LIST_NAMES, isListedDomain, loadDomainList } from '../email/domains/lists.js';
import { domainOf } from '../email/domains/screen.js';
import type { CalendarDay, Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { CurrentTerms } from '../legal.js';
import type { Logger } from '../logger.js';
import { notOwner, ownsProfile, personalProfileFor } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { AccountantGrantRecord, LedgerStore, Organization, UserRecord } from '../repositories/ports.js';
import {
  AccountantClientSchema,
  AccountantGrantListSchema,
  AccountantGrantParamSchema,
  AccountantGrantSchema,
  AccountantInviteCheckResponseSchema,
  AccountantInviteSignupRequestSchema,
  AccountantInviteSignupResponseSchema,
  AccountantInviteTokenRequestSchema,
  ErrorEnvelopeSchema,
  InviteAccountantRequestSchema,
  ProfileIdParamSchema,
} from '../schemas.js';
import { staleTerms, termsAcceptanceOf } from '../terms-acceptance.js';

/**
 * MUT-559 (ADR-245): accountant access to one profile.
 *
 *   Owner (session; owns the profile, else 403 NOT_OWNER; 404 when they can't see it):
 *     POST   /v1/profiles/{profileId}/accountants             invite (mails the link)
 *     GET    /v1/profiles/{profileId}/accountants             pending, expired and active accountants
 *     DELETE /v1/profiles/{profileId}/accountants/{grantId}   revoke
 *   Accountant:
 *     POST   /v1/accountant-invites/check    public: what an invite is for (one 404 for unknown, used and revoked)
 *     POST   /v1/accountant-invites/accept   session: the invited address, or a colleague on its business domain (D4)
 *     POST   /v1/accountant-invites/signup   public: a new account from the invite, accepted at once
 *     DELETE /v1/clients/{profileId}         session: leave
 *
 * The token travels in a body, never a path (D3). The routes never call ownedProfileConflict: a personal profile can
 * be shared with an accountant (amends MUT-120 decision 3). Reading the shared profile goes through the ordinary
 * routes; selectProfile admits the accountant there.
 */

/** These act on the person (the profile, where there is one, is in the path), like GET /v1/me: no X-Mutaba3a-Profile. */
export const ACCOUNTANT_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/profiles/:profileId/accountants',
  'GET /v1/profiles/:profileId/accountants',
  'DELETE /v1/profiles/:profileId/accountants/:grantId',
  'POST /v1/accountant-invites/accept',
  'DELETE /v1/clients/:profileId',
]);

/** Every endpoint this file adds: the dark-launch switch (ACCOUNTANT_ACCESS off) answers 404 for each. */
export const ACCOUNTANT_ENDPOINTS: ReadonlySet<string> = new Set([...ACCOUNTANT_ORGANIZATION_INDEPENDENT_ROUTES, 'POST /v1/accountant-invites/check', 'POST /v1/accountant-invites/signup']);

export interface AccountantRouteOptions {
  store: LedgerStore;
  settings: SessionSettings;
  passwordHasher: PasswordHasher;
  /** The sign-in IP limiter, shared under its own key by the two public routes. */
  ipLimiter: RateLimiter;
  /** Invites per owner (ACCOUNTANT_INVITE_POLICY). */
  inviteLimiter: RateLimiter;
  /** ACCOUNTANTS_PER_PROFILE_MAX. */
  maxPerProfile: number;
  terms: CurrentTerms;
  mailer: Mailer;
  logger: Logger;
  /** The signup bot check (the self-service verifier), action "signup". */
  turnstile: TurnstileVerifier;
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

/** D4: the webmail, disposable and relay lists (read once per process); a domain on any of them never matches. */
let sharedDomainLists: ReadonlySet<string>[] | null = null;
const sharedMailDomainLists = () => (sharedDomainLists ??= DOMAIN_LIST_NAMES.map((name) => loadDomainList(name)));

/** Decision A: an invite never goes to a disposable or relay address (the same lists signup refuses or reviews). */
let refusedInviteLists: ReadonlySet<string>[] | null = null;
function isRefusedInviteDomain(domain: string): boolean {
  refusedInviteLists ??= (['disposable', 'relay'] as const).map((name) => loadDomainList(name));
  return refusedInviteLists.some((list) => isListedDomain(domain, list));
}

/**
 * MUT-559 (D4): who may accept an invite. The invited address itself; or a colleague on exactly the same domain (no
 * subdomains), when that domain is a business's own: never a free-webmail, disposable or relay domain, where sharing
 * a domain says nothing about sharing a firm.
 */
export function mayAcceptInvite(signedInEmail: string, inviteEmail: string): boolean {
  const mine = normalizeEmail(signedInEmail);
  const invited = normalizeEmail(inviteEmail);
  if (mine === invited) return true;
  const domain = domainOf(invited);
  if (domainOf(mine) !== domain) return false;
  return !sharedMailDomainLists().some((list) => isListedDomain(domain, list));
}

export function accountantRoutes(options: AccountantRouteOptions): OpenAPIHono<AppEnv> {
  const { store, settings, passwordHasher, ipLimiter, inviteLimiter, maxPerProfile, terms, mailer, logger, turnstile } = options;
  const app = new OpenAPIHono<AppEnv>();

  /** The profile at `profileId` if the caller owns it (creator or co-owner): 404 when they can't see it, else 403. */
  async function ownedBy(user: UserRecord, profileId: string): Promise<Organization> {
    const organization = await store.organizations.getById(profileId);
    const membership = organization ? await store.memberships.find(user.id, profileId) : null;
    if (!organization || !membership) throw new ApiError('NOT_FOUND', 'Profile not found');
    if (!ownsProfile(organization, user.id, membership.role)) throw notOwner();
    return organization;
  }


  async function grantView(grant: AccountantGrantRecord, now: Date) {
    // An ACTIVE grant shows who really accepted (a colleague on the invited domain may have, D4); an invite, its address.
    const accountant = grant.status === 'ACTIVE' && grant.accountantUserId ? await store.users.getById(grant.accountantUserId) : null;
    return {
      id: grant.id,
      email: accountant?.email ?? grant.inviteEmail,
      name: accountant?.displayName ?? null,
      status: grantStatusView(grant, now),
      invitedAt: grant.createdAt.toISOString(),
      expiresAt: grant.inviteExpiresAt.toISOString(),
      acceptedAt: grant.acceptedAt?.toISOString() ?? null,
      lastViewedAt: grant.lastViewedAt?.toISOString() ?? null,
    };
  }

  async function clientView(grant: AccountantGrantRecord) {
    const client = await clientOf(store, grant);
    if (!client) throw inviteNotFound();
    return client;
  }

  /** The public routes: same origin only (the portal is the one browser caller), then the client address's budget. */
  async function publicGuard(c: Context<AppEnv>): Promise<Date> {
    if (!isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Open the invite from the MTB3A portal itself');
    const now = c.get('now')();
    const ip = await ipLimiter.check(`accountant-invite:${requestClientIp((name) => c.req.header(name), settings)}`, now);
    if (!ip.allowed) {
      c.header('Retry-After', String(ip.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many attempts; try again in a few minutes', { retryAfterSeconds: ip.retryAfterSeconds });
    }
    return now;
  }

  /** A PENDING grant for this token, unexpired at `now` unless `allowExpired`; anything else is the one 404. */
  async function pendingGrant(token: string, now: Date, allowExpired = false): Promise<AccountantGrantRecord> {
    const grant = await store.accountantGrants.findByDigest(sessionDigest(settings.pepper, token));
    if (!grant || grant.status !== 'PENDING' || (!allowExpired && grant.inviteExpiresAt <= now)) throw inviteNotFound();
    return grant;
  }

  /** Never throws and never changes the answer, like the passkey notice: a failed send leaves the grant PENDING. */
  async function sendInvite(c: Context<AppEnv>, grant: AccountantGrantRecord, token: string, owner: UserRecord, organization: Organization): Promise<void> {
    try {
      const result = await mailer.send({
        to: grant.inviteEmail,
        template: 'accountant-invite',
        locale: grant.locale,
        vars: {
          ownerName: owner.displayName,
          profileName: organization.name,
          link: accountantInviteUrl(setupLinkOrigin(settings.portalOrigin, c.req.url), token),
          expiresOn: calendarDayOf(grant.inviteExpiresAt, organization.timezone),
        },
        idempotencyKey: `accountant-invite:${grant.id}`,
      });
      if (result.status !== 'sent') logger.info({ template: 'accountant-invite', outcome: result.status }, 'accountant invite not sent');
    } catch (err) {
      logger.error({ err, template: 'accountant-invite' }, 'accountant invite failed');
    }
  }

  // ---- The owner -------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/profiles/{profileId}/accountants',
      tags: ['Profiles'],
      summary: 'Invite an accountant to read this profile',
      description: `MUT-559 (ADR-245). Mails the address a link to accept within 14 days; the accountant then reads this profile's expenses, income, receipts and summaries, and changes nothing. At most ${maxPerProfile} pending and active accountants per profile (409 CONFLICT, details.reason ACCOUNTANT_LIMIT); one invite per address (409 ALREADY_INVITED; an expired one is replaced); never your own address (422 VALIDATION_FAILED, details.reason SELF_INVITE). Any profile you own, your personal one included.`,
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema, body: jsonBody(InviteAccountantRequestSchema) },
      responses: {
        201: { description: 'Invited (pending)', content: { 'application/json': { schema: AccountantGrantSchema } } },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER: a profile you belong to but don’t own'),
        404: errorResponse('No such profile for you, or accountant access is off on this server'),
        409: errorResponse('CONFLICT: details.reason ALREADY_INVITED or ACCOUNTANT_LIMIT'),
        422: errorResponse('VALIDATION_FAILED: not an address, or details.reason SELF_INVITE, or INVITE_ADDRESS_REFUSED (a disposable or relay address)'),
        429: errorResponse('RATE_LIMITED: too many invites this hour'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { profileId } = c.req.valid('param');
      const body = c.req.valid('json');
      const organization = await ownedBy(user, profileId);
      const now = c.get('now')();
      const budget = await inviteLimiter.check(`accountant-invite:${user.id}`, now);
      if (!budget.allowed) {
        c.header('Retry-After', String(budget.retryAfterSeconds));
        throw new ApiError('RATE_LIMITED', 'Too many invites; try again later', { retryAfterSeconds: budget.retryAfterSeconds });
      }
      const email = normalizeEmail(body.email);
      if (email === normalizeEmail(user.email)) throw new ApiError('VALIDATION_FAILED', 'You already have this profile; invite your accountant’s address', { reason: 'SELF_INVITE' });
      // Decision A: no invite to a throwaway or forwarding address (webmail is fine: only its exact address can accept).
      if (isRefusedInviteDomain(domainOf(email))) throw new ApiError('VALIDATION_FAILED', 'Invite your accountant’s own address, not a throwaway or forwarding one', { reason: 'INVITE_ADDRESS_REFUSED' });
      const token = generateSetupToken();
      const requestId = c.get('requestId');
      const result = await store.accountantGrants.invite({
        organizationId: organization.id,
        inviteEmail: email,
        locale: body.locale ?? user.locale,
        invitedByUserId: user.id,
        tokenDigest: sessionDigest(settings.pepper, token),
        at: now,
        expiresAt: new Date(now.getTime() + ACCOUNTANT_INVITE_TTL_MS),
        max: maxPerProfile,
        auditFor: (grant) => [grantAudit(grant, 'accountant.invited', user.id, requestId)],
      });
      if (result.kind === 'already_invited') throw new ApiError('CONFLICT', 'This address is already invited to this profile', { reason: 'ALREADY_INVITED' });
      if (result.kind === 'limit') throw new ApiError('CONFLICT', `This profile already has ${result.count} accountants or invites, the most it can`, { reason: 'ACCOUNTANT_LIMIT', limit: maxPerProfile });
      await sendInvite(c, result.grant, token, user, organization);
      return c.json(await grantView(result.grant, now), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/profiles/{profileId}/accountants',
      tags: ['Profiles'],
      summary: 'The accountants invited to this profile: pending, expired and active',
      description: 'MUT-559 (ADR-245). Revoked and left grants are not listed. Oldest first.',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema },
      responses: {
        200: { description: 'The accountants', content: { 'application/json': { schema: AccountantGrantListSchema } } },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile for you, or accountant access is off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const organization = await ownedBy(user, c.req.valid('param').profileId);
      const now = c.get('now')();
      const grants = await store.accountantGrants.listByOrganization(organization.id);
      return c.json({ items: await Promise.all(grants.map((g) => grantView(g, now))), limit: maxPerProfile }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/profiles/{profileId}/accountants/{grantId}',
      tags: ['Profiles'],
      summary: 'Revoke an accountant’s access, or withdraw their invite',
      description: 'MUT-559 (ADR-245). Their next request to the profile answers 404, as if it had never been shared.',
      security: SESSION_ONLY,
      request: { params: AccountantGrantParamSchema },
      responses: {
        204: { description: 'Revoked' },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile, or no pending or active grant with that id on it'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { profileId, grantId } = c.req.valid('param');
      const organization = await ownedBy(user, profileId);
      const requestId = c.get('requestId');
      const revoked = await store.accountantGrants.revoke({ organizationId: organization.id, grantId, at: c.get('now')(), auditFor: (grant) => [grantAudit(grant, 'accountant.revoked', user.id, requestId)] });
      if (!revoked) throw new ApiError('NOT_FOUND', 'Accountant not found');
      return c.body(null, 204);
    },
  );

  // ---- The accountant ----------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant-invites/check',
      tags: ['Sessions'],
      summary: 'What an accountant invite is for, before signing in or up',
      description: 'MUT-559 (ADR-245, D3): the token from the link’s fragment, in the body. Unknown, used and revoked invites all answer the same 404; an expired one answers with `expired: true`.',
      security: [],
      request: { body: jsonBody(AccountantInviteTokenRequestSchema) },
      responses: {
        200: { description: 'The invite', content: { 'application/json': { schema: AccountantInviteCheckResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST'),
        404: errorResponse('NOT_FOUND: no such invite (or accountant access is off)'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const grant = await pendingGrant(c.req.valid('json').token, now, true);
      const organization = await store.organizations.getById(grant.organizationId);
      if (!organization) throw inviteNotFound();
      return c.json(
        {
          profileName: organization.name,
          ownerName: await ownerNameOf(store, organization, grant),
          maskedEmail: maskEmail(grant.inviteEmail),
          expired: grant.inviteExpiresAt <= now,
          expiresAt: grant.inviteExpiresAt.toISOString(),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant-invites/accept',
      tags: ['Sessions'],
      summary: 'Accept an accountant invite as the signed-in person',
      description:
        'MUT-559 (ADR-245, D4). The signed-in address must be the invited one, or on exactly the same domain when that domain is a business’s own (never a webmail, disposable or relay domain, never a subdomain); otherwise 403 INVITE_EMAIL_MISMATCH with details.maskedEmail. 409 CONFLICT (ALREADY_HAS_ACCESS) when the person already owns, belongs to or reads the profile. Of two accepts of one invite, one wins; the other answers 404.',
      security: SESSION_ONLY,
      request: { body: jsonBody(AccountantInviteTokenRequestSchema) },
      responses: {
        200: { description: 'Accepted: the profile is now among /v1/me `clients`', content: { 'application/json': { schema: AccountantClientSchema } } },
        403: errorResponse('INVITE_EMAIL_MISMATCH'),
        404: errorResponse('NOT_FOUND: no such invite, used, revoked or expired'),
        409: errorResponse('CONFLICT, details.reason ALREADY_HAS_ACCESS'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const now = c.get('now')();
      const token = c.req.valid('json').token;
      const grant = await pendingGrant(token, now);
      if (!mayAcceptInvite(user.email, grant.inviteEmail)) {
        throw new ApiError('INVITE_EMAIL_MISMATCH', 'This invite is for another address; sign in with it to accept', { maskedEmail: maskEmail(grant.inviteEmail) });
      }
      const alreadyIn = (await store.memberships.find(user.id, grant.organizationId)) ?? (await store.accountantGrants.findActive(user.id, grant.organizationId));
      if (alreadyIn) throw new ApiError('CONFLICT', 'You can already open this profile', { reason: 'ALREADY_HAS_ACCESS' });
      const requestId = c.get('requestId');
      const accepted = await store.accountantGrants.accept({
        tokenDigest: sessionDigest(settings.pepper, token),
        accountantUserId: user.id,
        at: now,
        auditFor: (g) => [grantAudit(g, 'accountant.accepted', user.id, requestId)],
      });
      if (!accepted) throw inviteNotFound();
      return c.json(await clientView(accepted), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/accountant-invites/signup',
      tags: ['Sessions'],
      summary: 'Create an account from an accountant invite, and accept it',
      description:
        'MUT-559 (ADR-245). The account takes the invited address, which the link proves: ACTIVE at once (no signup review), with its own personal profile (the shared profile’s currency and timezone unless given) and no free trial: that profile is read-only until the person subscribes. Issues no session: sign in through POST /v1/sessions with the email and password, as after /setup. 409 CONFLICT (ACCOUNT_EXISTS) when the address already has an account (sign in and accept instead). The Turnstile check is the signup one (403 CHECK_FAILED).',
      security: [],
      request: { body: jsonBody(AccountantInviteSignupRequestSchema) },
      responses: {
        201: { description: 'Created and accepted', content: { 'application/json': { schema: AccountantInviteSignupResponseSchema } } },
        403: errorResponse('CROSS_SITE_REQUEST or CHECK_FAILED'),
        404: errorResponse('NOT_FOUND: no such invite, used, revoked or expired'),
        409: errorResponse('CONFLICT (ACCOUNT_EXISTS), or TERMS_VERSION_STALE'),
        422: errorResponse('Validation failed (the password is 12 to 128 characters)'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const body = c.req.valid('json');
      const ip = requestClientIp((name) => c.req.header(name), settings);
      // Our own idempotency key, never the client's (self-service review #1).
      if (!(await turnstile.verify(body.turnstileToken, { ip: ip === 'unknown' ? null : ip, action: 'signup', idempotencyKey: randomUUID() }))) {
        throw new ApiError('CHECK_FAILED', 'The check didn’t pass; try again');
      }
      const grant = await pendingGrant(body.token, now);
      if (body.acceptedTermsVersion !== terms.version) throw staleTerms(terms);
      if (await store.users.findByEmail(grant.inviteEmail)) throw accountExists();
      const organization = await store.organizations.getById(grant.organizationId);
      if (!organization) throw inviteNotFound();
      const passwordHash = await passwordHasher.hash(body.password);
      // A fresh instant after the slow hash, as the setup redeem takes.
      const at = c.get('now')();
      const requestId = c.get('requestId');
      const result = await store.accountantGrants.signupAndAccept({
        tokenDigest: sessionDigest(settings.pepper, body.token),
        at,
        passwordHash,
        displayName: body.displayName ?? defaultDisplayName(grant.inviteEmail),
        personal: personalProfileFor(grant.locale, { defaultCurrency: body.defaultCurrency ?? organization.defaultCurrency, timezone: body.timezone ?? organization.timezone }),
        terms: termsAcceptanceOf(terms, body.termsLocale ?? grant.locale, 'cookie', body.clientRelease),
        auditFor: ({ userId, personalOrganizationId, grant: accepted }) => [
          { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'organization.created', entityType: 'organization', entityId: personalOrganizationId, metadata: { personal: true, ownerUserId: userId }, requestId },
          { organizationId: personalOrganizationId, actorType: 'USER', actorId: userId, action: 'user.signed_up', entityType: 'user', entityId: userId, metadata: { via: 'accountant-invite', locale: grant.locale, status: 'ACTIVE' }, requestId },
          grantAudit(accepted, 'accountant.accepted', userId, requestId),
        ],
      });
      if (result.kind === 'account_exists') throw accountExists();
      if (result.kind === 'unusable') throw inviteNotFound();
      return c.json({ email: result.user.email, status: 'ACTIVE' as const, client: await clientView(result.grant) }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/clients/{profileId}',
      tags: ['Sessions'],
      summary: 'Stop reading a profile shared with you as an accountant',
      description: 'MUT-559 (ADR-245). The profile leaves /v1/me `clients`; its owner sees you gone.',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema },
      responses: {
        204: { description: 'Left' },
        404: errorResponse('NOT_FOUND: you don’t read that profile'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { profileId } = c.req.valid('param');
      const requestId = c.get('requestId');
      const left = await store.accountantGrants.leave({ organizationId: profileId, accountantUserId: user.id, at: c.get('now')(), auditFor: (grant) => [grantAudit(grant, 'accountant.left', user.id, requestId)] });
      if (!left) throw new ApiError('NOT_FOUND', 'Profile not found');
      return c.body(null, 204);
    },
  );

  return app;
}

/** One answer for every invite that can't be used: unknown, used, revoked or expired. */
function inviteNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'This invite can’t be used; ask for a new one');
}

function accountExists(): ApiError {
  return new ApiError('CONFLICT', 'This address already has an MTB3A account; sign in and accept the invite', { reason: 'ACCOUNT_EXISTS' });
}

/** The calendar day an instant falls on in the profile's zone (UTC if the zone is unknown). */
function calendarDayOf(instant: Date, timeZone: string): CalendarDay {
  let iso: string;
  try {
    iso = todayIn(timeZone, instant);
  } catch {
    iso = todayIn('UTC', instant);
  }
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}
