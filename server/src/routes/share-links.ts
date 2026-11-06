import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { displayNameOf } from '../accountants/grants.js';
import type { AttachmentStorage } from '../attachments/storage.js';
import { generateSetupToken, setupLinkOrigin } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest } from '../auth/sessions.js';
import { shareLinkStoreGuard } from '../auth/store-guard.js';
import type { PasswordHasher } from '../auth/users.js';
import { decodeFeedCursor, encodeFeedCursor, rowKindOf } from '../entries/merge.js';
import { ApiError } from '../errors.js';
import { hasFeature } from '../features.js';
import { summarizeExpenses } from '../expenses/summary.js';
import { formatMoney, type Currency } from '../money.js';
import { ownedProfileOf, profileOwnerOf } from '../personal-profile.js';
import type { RateLimiter } from '../rate-limit.js';
import type { EntryRow, ExpenseRecord, LedgerStore, Organization, PaymentRecord, ShareLinkWithViewers, UserLocale } from '../repositories/ports.js';
import {
  CreateShareLinkRequestSchema,
  ErrorEnvelopeSchema,
  ProfileIdParamSchema,
  ShareLinkCheckRequestSchema,
  ShareLinkCheckResponseSchema,
  ShareLinkCreatedSchema,
  ShareLinkDownloadTicketRequestSchema,
  PeriodDownloadTicketSchema,
  ShareLinkEntriesRequestSchema,
  ShareLinkEntryPageSchema,
  ShareLinkListSchema,
  ShareLinkParamSchema,
  ShareLinkReceiptListSchema,
  ShareLinkReceiptsRequestSchema,
  ShareLinkSummarySchema,
  ShareLinkUnlockRequestSchema,
  ShareLinkUnlockResponseSchema,
  ShareLinkViewRequestSchema,
} from '../schemas.js';
import { openLinkProfile, shareLinkAccess, type ShareLinkAccess } from '../share-links/access.js';
import {
  SHARE_LINK_MAX_VIEWERS,
  SHARE_LINK_PIN_ATTEMPTS,
  SHARE_LINK_SUMMARY_POLICY,
  normalizePin,
  pinHashInput,
  shareLinkAudit,
  shareLinkRefused,
  shareLinkUnavailable,
  shareLinkUrl,
  SHARE_LINK_ENDED_VISIBLE_MS,
  SHARE_LINK_ENTRY_KINDS,
  isListedAt,
  linkStateAt,
  receiptUrlTtlSeconds,
  viewerAccessExpiry,
} from '../share-links/links.js';
import { clampToRange, feedBoundsOf, isInRange, shareLinkRangeAt } from '../share-links/period.js';
import { shareRowId, shareRowKey } from '../share-links/row-key.js';
import { isVisitorRow, namedIds, visitorEntry, visitorExpenseSummary, type VisitorContext } from '../share-links/visitor.js';
import { displayCategoryNames } from '../expenses/presets.js';
import { preferredLanguage } from './shared.js';
import { mintDownload, resolveAsOf } from '../period-pack/index.js';
import { checkMintBudget, type PeriodDownloadServices } from './period-downloads.js';

/**
 * MUT-560 (ADR-247): one-time share links to a period of one profile, opened with a PIN and no account.
 *
 *   Owner (session; owns the profile, else 403 NOT_OWNER; 404 when they can't see it):
 *     POST   /v1/profiles/{profileId}/share-links            create (the URL, with its token, is answered only here)
 *     GET    /v1/profiles/{profileId}/share-links            live links (active and locked)
 *     DELETE /v1/profiles/{profileId}/share-links/{linkId}   revoke
 *   Visitor (public, POST only, tokens only in bodies):
 *     POST   /v1/share-links/check              does the link open (a PIN is asked); nothing about the profile
 *     POST   /v1/share-links/unlock             the PIN → a viewer token (8 h, never past the link's expiry)
 *     POST   /v1/share-links/entries            the period's entries, by money date
 *     POST   /v1/share-links/summary            the period's totals per currency
 *     POST   /v1/share-links/expense-receipts   an in-period expense's receipts, as short-lived signed URLs
 *     POST   /v1/share-links/download-ticket    MUT-314: a ticket for the period's Excel report or receipts zip
 *
 * The view routes reach data only through shareLinkAccess (share-links/access.ts), which resolves the link and its
 * frozen range, and run under shareLinkStoreGuard, so nothing below them can write. No route of the main API is
 * reachable with a link, by construction: a viewer token is no credential there.
 */

/** These act on the person, the profile in the path, like the accountant routes: no X-Mutaba3a-Profile. */
export const SHARE_LINK_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/profiles/:profileId/share-links',
  'GET /v1/profiles/:profileId/share-links',
  'DELETE /v1/profiles/:profileId/share-links/:linkId',
]);

/** The visitor's routes: public, POST only. */
export const SHARE_LINK_PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/share-links/check',
  'POST /v1/share-links/unlock',
  'POST /v1/share-links/entries',
  'POST /v1/share-links/summary',
  'POST /v1/share-links/expense-receipts',
  // MUT-314 (ADR-248): also behind PERIOD_DOWNLOADS (routes/period-downloads.ts).
  'POST /v1/share-links/download-ticket',
]);

/** Every endpoint this file adds: the dark-launch switch (SHARE_LINKS off) answers the uniform 404 for each. */
export const SHARE_LINK_ENDPOINTS: ReadonlySet<string> = new Set([...SHARE_LINK_ORGANIZATION_INDEPENDENT_ROUTES, ...SHARE_LINK_PUBLIC_ROUTES]);

export interface ShareLinkRouteOptions {
  /** The guarded store every route reads the profile through. */
  store: LedgerStore;
  /** The store beneath the guard: the link's own lookups, PIN count, viewers and stamps (as authenticate() reads sessions). */
  linkStore: LedgerStore;
  settings: SessionSettings;
  passwordHasher: PasswordHasher;
  /** The sign-in IP limiter, under its own key, on check and unlock (A7). */
  ipLimiter: RateLimiter;
  /** Creates per owner (SHARE_LINK_CREATE_POLICY). */
  createLimiter: RateLimiter;
  /** Requests per viewer on the view routes (SHARE_LINK_VIEW_POLICY). */
  viewLimiter: RateLimiter;
  /** Requests per client address on the view routes, counted before the viewer token is read (SHARE_LINK_VIEW_IP_POLICY). */
  viewIpLimiter: RateLimiter;
  /** Summaries per viewer (SHARE_LINK_SUMMARY_POLICY): a whole-profile summary walks every row in the range. */
  summaryLimiter: RateLimiter;
  /** SHARE_LINKS_PER_PROFILE_MAX. */
  maxPerProfile: number;
  storage: AttachmentStorage | null;
  urlTtlSeconds: number;
  /** MUT-314: the period download's limits, mint budget and stream slots, shared with routes/period-downloads.ts. */
  downloads: PeriodDownloadServices;
}

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const DAY_MS = 86_400_000;
/** The summary walks the range a page at a time, as /v1/summaries/expenses does. */
const SUMMARY_PAGE = 200;
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });
const unavailable = errorResponse('NOT_FOUND, details.reason SHARE_LINK_UNAVAILABLE: unknown, revoked, expired or locked, its profile gone or its owner closing their account, or share links are off. The same answer for every cause.');
const viewRefusals = {
  401: errorResponse('UNAUTHENTICATED, details.reason SHARE_VIEW_EXPIRED: this viewer’s 8 hours have passed; unlock again with the PIN (and this viewer token, to keep its place)'),
  403: errorResponse('CROSS_SITE_REQUEST'),
  404: unavailable,
  422: errorResponse('Validation failed'),
  429: errorResponse('RATE_LIMITED: too many requests from this viewer'),
};

export function shareLinkRoutes(options: ShareLinkRouteOptions): OpenAPIHono<AppEnv> {
  const { store, linkStore, settings, passwordHasher, ipLimiter, createLimiter, viewLimiter, viewIpLimiter, summaryLimiter, maxPerProfile } = options;
  const app = new OpenAPIHono<AppEnv>();
  const digest = (token: string) => sessionDigest(settings.pepper, token);

  function rateLimited(c: Context<AppEnv>, retryAfterSeconds: number, message: string): ApiError {
    c.header('Retry-After', String(retryAfterSeconds));
    return new ApiError('RATE_LIMITED', message, { retryAfterSeconds });
  }

  /** Check and unlock: same origin only (the portal's link page is the one caller), then the client address's budget. */
  async function publicGuard(c: Context<AppEnv>): Promise<Date> {
    if (!isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Open the link from the MTB3A portal itself');
    const now = c.get('now')();
    const ip = await ipLimiter.check(`share-link:${requestClientIp((name) => c.req.header(name), settings)}`, now);
    if (!ip.allowed) throw rateLimited(c, ip.retryAfterSeconds, 'Too many attempts; try again in a few minutes');
    return now;
  }

  /**
   * The view routes: same origin, the client address's budget (before any lookup, so guessing viewer tokens costs a
   * budget too), the read-only guard set before anything reads, the one door, then the viewer's budget.
   */
  async function viewAccess(c: Context<AppEnv>, viewerToken: string): Promise<ShareLinkAccess> {
    if (!isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Open the link from the MTB3A portal itself');
    const now = c.get('now')();
    const ip = await viewIpLimiter.check(`share-view-ip:${requestClientIp((name) => c.req.header(name), settings)}`, now);
    if (!ip.allowed) throw rateLimited(c, ip.retryAfterSeconds, 'Too many requests; wait a moment');
    c.set('storeGuard', shareLinkStoreGuard());
    const access = await shareLinkAccess(linkStore, settings.pepper, viewerToken, now);
    const budget = await viewLimiter.check(`share-view:${access.viewer.id}`, now);
    if (!budget.allowed) throw rateLimited(c, budget.retryAfterSeconds, 'Too many requests; wait a moment');
    return access;
  }

  /** A link the token names, live, its profile there and its owner not closing; else the uniform 404. */
  async function openLink(token: string, now: Date): Promise<{ link: ShareLinkWithViewers; organization: Organization }> {
    const link = await linkStore.shareLinks.findByTokenDigest(digest(token));
    if (!link) throw shareLinkUnavailable();
    return { link, organization: await openLinkProfile(linkStore, link, now) };
  }

  /** The visitor's language: Accept-Language, else Arabic (ADR-077). */
  function visitorLanguage(c: Context<AppEnv>): UserLocale {
    c.header('Vary', 'Accept-Language', { append: true });
    const lang = preferredLanguage(c.req.header('accept-language')) ?? 'ar';
    c.header('Content-Language', lang);
    return lang;
  }

  /** One batch of name lookups for the rows' categories, clients and projects, and the link's row keys. */
  async function visitorContext(
    access: ShareLinkAccess,
    rows: readonly EntryRow[],
    lang: UserLocale,
    extra: Pick<VisitorContext, 'receiptCounts' | 'settledOwed'> = { receiptCounts: new Map(), settledOwed: new Map() },
  ): Promise<VisitorContext> {
    const organizationId = access.organization.id;
    const ids = namedIds(rows);
    const categories = new Map<string, string>();
    if (ids.categories.size > 0) {
      for (const c of displayCategoryNames(await store.expenseCategories.list(organizationId, { includeArchived: true }), lang)) categories.set(c.id, c.name);
    }
    const names = async (set: Set<string>, get: (id: string) => Promise<{ id: string; name: string } | null>) =>
      new Map((await Promise.all([...set].map(get))).flatMap((r) => (r ? [[r.id, r.name] as const] : [])));
    const [clients, projects] = await Promise.all([names(ids.customers, (id) => store.customers.getById(organizationId, id)), names(ids.projects, (id) => store.projects.getById(organizationId, id))]);
    const lookup = (map: ReadonlyMap<string, string>) => (id: string | null) => (id ? (map.get(id) ?? null) : null);
    return { key: (id) => shareRowKey(settings.pepper, access.link.id, id), category: lookup(categories), client: lookup(clients), project: lookup(projects), ...extra };
  }

  async function linkView(link: ShareLinkWithViewers, now: Date) {
    const { status, endedAt } = linkStateAt(link, now);
    return {
      id: link.id,
      period: link.period,
      from: link.periodFrom,
      to: link.periodTo,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
      status,
      endedAt: endedAt?.toISOString() ?? null,
      viewers: link.viewers,
      maxViewers: SHARE_LINK_MAX_VIEWERS,
      createdByName: await displayNameOf(store, link.createdByUserId),
    };
  }

  // ---- The owner -------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/profiles/{profileId}/share-links',
      tags: ['Profiles'],
      summary: 'Make a one-time link to a period of this profile, opened with a PIN',
      description: `MUT-560 (ADR-247). Whoever holds the link and its PIN reads the period's entries, totals and expense receipts, and changes nothing, on up to ${SHARE_LINK_MAX_VIEWERS} devices, until it expires (1, 7 or 30 days), is revoked, or locks after ${SHARE_LINK_PIN_ATTEMPTS} wrong PINs. The answer's \`url\` is the only time the link is shown: share it with the PIN, separately. At most ${maxPerProfile} live links per profile (409 CONFLICT, details.reason SHARE_LINK_LIMIT). Any profile you own, your personal one included.`,
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema, body: jsonBody(CreateShareLinkRequestSchema) },
      responses: {
        201: { description: 'Made', content: { 'application/json': { schema: ShareLinkCreatedSchema } } },
        402: errorResponse('SUBSCRIPTION_LAPSED: the profile is locked'),
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER: a profile you belong to but don’t own'),
        404: errorResponse('No such profile for you, or share links are off on this server or for your account (the operator’s accountant_access feature, MUT-577)'),
        409: errorResponse('CONFLICT, details.reason SHARE_LINK_LIMIT'),
        422: errorResponse('VALIDATION_FAILED: details.reason PIN_FORMAT (not 4–8 digits), or another field'),
        429: errorResponse('RATE_LIMITED: too many links this hour'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      // MUT-577: making a link needs the operator's accountant_access feature, else the switched-off 404.
      if (!(await hasFeature(store, user.id, 'accountant_access'))) throw shareLinkUnavailable();
      const { profileId } = c.req.valid('param');
      const body = c.req.valid('json');
      const organization = await ownedProfileOf(store, user.id, profileId);
      const now = c.get('now')();
      const budget = await createLimiter.check(`share-link-create:${user.id}`, now);
      if (!budget.allowed) throw rateLimited(c, budget.retryAfterSeconds, 'Too many links; try again later');
      const pin = normalizePin(body.pin);
      if (!pin) throw new ApiError('VALIDATION_FAILED', 'The PIN is 4 to 8 digits', { reason: 'PIN_FORMAT', field: 'pin' });
      const id = randomUUID();
      const token = generateSetupToken();
      const range = shareLinkRangeAt(body.period, organization.timezone, now);
      const pinHash = await passwordHasher.hash(digest(pinHashInput(id, pin)));
      const requestId = c.get('requestId');
      const result = await store.shareLinks.create({
        id,
        organizationId: organization.id,
        createdByUserId: user.id,
        tokenDigest: digest(token),
        pinHash,
        period: body.period,
        periodFrom: range.from,
        periodTo: range.to,
        expiresAt: new Date(now.getTime() + body.expiresInDays * DAY_MS),
        at: now,
        max: maxPerProfile,
        auditFor: (link) => [shareLinkAudit(link, 'share_link.created', user.id, requestId, { period: link.period, expiresInDays: body.expiresInDays })],
      });
      if (result.kind === 'limit') throw new ApiError('CONFLICT', `This profile already has ${result.count} live links, the most it can`, { reason: 'SHARE_LINK_LIMIT', limit: maxPerProfile });
      const link = result.link;
      return c.json(
        {
          id: link.id,
          url: shareLinkUrl(setupLinkOrigin(settings.portalOrigin, c.req.url), token),
          period: link.period,
          from: link.periodFrom,
          to: link.periodTo,
          expiresAt: link.expiresAt.toISOString(),
          createdAt: link.createdAt.toISOString(),
        },
        201,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/profiles/{profileId}/share-links',
      tags: ['Profiles'],
      summary: 'The share links on this profile: active, and those that ended in the last day',
      description: 'MUT-560 (ADR-247, OW5). Every owner sees every link on the profile, each with its `status` (active, locked, expired, revoked) and `endedAt`. Locked, expired and revoked links stay listed for 24 hours after they ended or locked, then drop out. A link’s URL is never shown again. Oldest first.',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema },
      responses: {
        200: { description: 'The links', content: { 'application/json': { schema: ShareLinkListSchema } } },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile for you, or share links are off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const organization = await ownedProfileOf(store, user.id, c.req.valid('param').profileId);
      const now = c.get('now')();
      const links = (await store.shareLinks.listRecentByOrganization(organization.id, new Date(now.getTime() - SHARE_LINK_ENDED_VISIBLE_MS))).filter((link) => isListedAt(link, now));
      return c.json({ items: await Promise.all(links.map((link) => linkView(link, now))), limit: maxPerProfile }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/profiles/{profileId}/share-links/{linkId}',
      tags: ['Profiles'],
      summary: 'Revoke a share link',
      description: 'MUT-560 (ADR-247). Every viewer’s next request answers 404, as if it had never been shared. Any owner of the profile may revoke any of its links.',
      security: SESSION_ONLY,
      request: { params: ShareLinkParamSchema },
      responses: {
        204: { description: 'Revoked' },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile, or no live link with that id on it'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { profileId, linkId } = c.req.valid('param');
      const organization = await ownedProfileOf(store, user.id, profileId);
      const requestId = c.get('requestId');
      const revoked = await store.shareLinks.revoke({ organizationId: organization.id, linkId, at: c.get('now')(), auditFor: (link) => [shareLinkAudit(link, 'share_link.revoked', user.id, requestId)] });
      if (!revoked) throw new ApiError('NOT_FOUND', 'Share link not found');
      return c.body(null, 204);
    },
  );

  // ---- The visitor ---------------------------------------------------------------

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/check',
      tags: ['Share links'],
      summary: 'Whether a share link opens, before its PIN',
      description: 'MUT-560 (ADR-247). The token from the link’s fragment, in the body. Says nothing about the profile or its owner: names come with the PIN (unlock).',
      security: [],
      request: { body: jsonBody(ShareLinkCheckRequestSchema) },
      responses: {
        200: { description: 'It opens with its PIN', content: { 'application/json': { schema: ShareLinkCheckResponseSchema } } },
        403: errorResponse('SHARE_LINK_REFUSED, details.reason LOCKED; or CROSS_SITE_REQUEST'),
        404: unavailable,
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const { link } = await openLink(c.req.valid('json').token, now);
      if (link.lockedAt) throw shareLinkRefused('LOCKED');
      return c.json({ state: 'pin' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/unlock',
      tags: ['Share links'],
      summary: 'Open a share link with its PIN',
      description: `MUT-560 (ADR-247). The right PIN answers a viewer token, good for 8 hours (never past the link's expiry), and the names of the profile and its owner. Send the viewer token this browser held before for this link (even an ended one) to keep its place: at most ${SHARE_LINK_MAX_VIEWERS} devices open a link (403 SHARE_LINK_REFUSED, VIEWER_LIMIT). A wrong PIN answers PIN_WRONG with details.attemptsLeft; the ${SHARE_LINK_PIN_ATTEMPTS}th locks the link for everyone (LOCKED), viewers already in included.`,
      security: [],
      request: { body: jsonBody(ShareLinkUnlockRequestSchema) },
      responses: {
        200: { description: 'Opened', content: { 'application/json': { schema: ShareLinkUnlockResponseSchema } } },
        403: errorResponse('SHARE_LINK_REFUSED, details.reason PIN_WRONG (attemptsLeft), LOCKED or VIEWER_LIMIT; or CROSS_SITE_REQUEST'),
        404: unavailable,
        409: errorResponse('CONFLICT, details.reason SHARE_LINK_STALE_VIEWER: a parallel unlock from this device renewed its viewer token first; keep the token that answer holds (unlocking again with the old one counts as a new device)'),
        422: errorResponse('Validation failed'),
        429: errorResponse('Too many attempts from this address'),
      },
    }),
    async (c) => {
      const now = await publicGuard(c);
      const body = c.req.valid('json');
      const { link, organization } = await openLink(body.token, now);
      if (link.lockedAt) throw shareLinkRefused('LOCKED');
      const previous = body.viewerToken ? digest(body.viewerToken) : null;
      const returning = previous !== null && (await linkStore.shareLinks.findViewerByDigest(previous))?.link.id === link.id;
      // A full link refuses a new device before its PIN is tried, so a 4th device's guesses never count toward the lock.
      if (!returning && link.viewers >= SHARE_LINK_MAX_VIEWERS) throw shareLinkRefused('VIEWER_LIMIT');
      const requestId = c.get('requestId');
      const pin = normalizePin(body.pin);
      if (!pin || !(await passwordHasher.verify(link.pinHash, digest(pinHashInput(link.id, pin))))) {
        const counted = await linkStore.shareLinks.recordFailedPin({
          linkId: link.id,
          at: now,
          maxAttempts: SHARE_LINK_PIN_ATTEMPTS,
          lockAudit: (locked) => [shareLinkAudit(locked, 'share_link.locked', null, requestId)],
        });
        if (!counted || counted.locked) throw shareLinkRefused('LOCKED');
        throw shareLinkRefused('PIN_WRONG', SHARE_LINK_PIN_ATTEMPTS - counted.failedPinAttempts);
      }
      const viewerToken = generateSetupToken();
      // A fresh instant after the slow hash, as the setup redeem takes.
      const at = c.get('now')();
      const added = await linkStore.shareLinks.addOrRotateViewer({
        linkId: link.id,
        previousTokenDigest: returning ? previous : null,
        tokenDigest: digest(viewerToken),
        accessExpiresAt: viewerAccessExpiry(link, at),
        at,
        max: SHARE_LINK_MAX_VIEWERS,
        auditFor: (_viewer, viewerNumber) => [shareLinkAudit(link, 'share_link.unlocked', null, requestId, { viewerNumber })],
      });
      if (added.kind === 'limit') throw shareLinkRefused('VIEWER_LIMIT');
      // A parallel unlock from this browser renewed this viewer first: its answer holds the viewer token to keep.
      if (added.kind === 'stale') throw new ApiError('CONFLICT', 'This device was just let in by another request; use the viewer token that request answered, or unlock again', { reason: 'SHARE_LINK_STALE_VIEWER' });
      if (added.kind === 'unusable') {
        // Locked, revoked or expired between the read above and the viewer's insert.
        if ((await linkStore.shareLinks.findByTokenDigest(link.tokenDigest))?.lockedAt) throw shareLinkRefused('LOCKED');
        throw shareLinkUnavailable();
      }
      return c.json(
        {
          viewerToken,
          viewerExpiresAt: added.viewer.accessExpiresAt.toISOString(),
          linkExpiresAt: link.expiresAt.toISOString(),
          profileName: organization.name,
          ownerName: (await displayNameOf(linkStore, profileOwnerOf(organization))) ?? (await displayNameOf(linkStore, link.createdByUserId)),
          period: link.period,
          from: link.periodFrom,
          to: link.periodTo,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/entries',
      tags: ['Share links'],
      summary: 'The shared period’s entries, newest money date first',
      description:
        'MUT-560 (ADR-247). Expenses and received payments of the shared profile whose money date is in the link’s period (what the period’s report holds: no Owed entries, no conversions), newest money date first, by name: no profile, person, client, project, category or vendor id; each entry has an opaque `key` for this link. Category names follow Accept-Language (Arabic by default). Read live: an entry edited into the period shows, one edited out of it disappears.',
      security: [],
      request: { body: jsonBody(ShareLinkEntriesRequestSchema) },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: ShareLinkEntryPageSchema } } }, ...viewRefusals },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const access = await viewAccess(c, body.viewerToken);
      const { organization, range } = access;
      const lang = visitorLanguage(c);
      const organizationIds = [organization.id];
      // MUT-575 (S5): the visitor's filters narrow within the link: kinds inside the link's, dates clamped to its range.
      const kinds = body.kinds ? SHARE_LINK_ENTRY_KINDS.filter((kind) => body.kinds!.map(rowKindOf).includes(kind)) : SHARE_LINK_ENTRY_KINDS;
      const page = await store.entries.list(organizationIds, { limit: body.limit, order: 'occurredOn', kinds, cursor: body.cursor ? decodeFeedCursor(body.cursor, 'occurredOn') : null, ...clampToRange(range, body.occurredFrom, body.occurredBefore) });
      const expenseIds = page.items.flatMap((row) => (row.kind === 'expense' ? [row.record.id] : []));
      const settleCandidates = page.items.flatMap((row) => (row.kind === 'payment' && row.record.origin === 'CAPTURE' && row.record.allocatedMinor > 0n ? [row.record.id] : []));
      const [receiptCounts, settledOwed] = await Promise.all([store.expenseReceipts.countReadyByExpenseIds(organizationIds, expenseIds), store.entries.settledOwedIds(organizationIds, settleCandidates)]);
      const ctx = await visitorContext(access, page.items, lang, { receiptCounts, settledOwed });
      return c.json({ items: page.items.filter(isVisitorRow).map((row) => visitorEntry(row, ctx)), nextCursor: page.nextCursor ? encodeFeedCursor(page.nextCursor) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/summary',
      tags: ['Share links'],
      summary: 'The shared period’s totals, per currency',
      description: `MUT-560 (ADR-247). At most ${SHARE_LINK_SUMMARY_POLICY.perViewerPerMinute} a minute per viewer (429 RATE_LIMITED). Expenses (by category and client name) and received payments, each per currency and never summed across currencies, over the link’s period. Reversed payments are left out.`,
      security: [],
      request: { body: jsonBody(ShareLinkViewRequestSchema) },
      responses: { 200: { description: 'The totals', content: { 'application/json': { schema: ShareLinkSummarySchema } } }, ...viewRefusals },
    }),
    async (c) => {
      const access = await viewAccess(c, c.req.valid('json').viewerToken);
      const { organization, range } = access;
      const budget = await summaryLimiter.check(`share-summary:${access.viewer.id}`, c.get('now')());
      if (!budget.allowed) throw rateLimited(c, budget.retryAfterSeconds, 'Too many summaries; wait a moment');
      const lang = visitorLanguage(c);
      const rows = await walkRange(organization.id, range);
      const expenses: ExpenseRecord[] = [];
      const received: PaymentRecord[] = [];
      for (const row of rows) {
        if (row.kind === 'expense') expenses.push(row.record);
        if (row.kind === 'payment' && row.record.status !== 'REVERSED') received.push(row.record);
      }
      const ctx = await visitorContext(access, rows.filter((row) => row.kind === 'expense'), lang);
      return c.json({ from: range.from, to: range.to, expenses: visitorExpenseSummary(summarizeExpenses(expenses), ctx), received: receivedByCurrency(received) }, 200);
    },
  );

  /** Every feed row in the range, a page at a time (bounded both ends by the index). */
  async function walkRange(organizationId: string, range: ShareLinkAccess['range']): Promise<EntryRow[]> {
    const rows: EntryRow[] = [];
    let cursor = null;
    do {
      const page = await store.entries.list([organizationId], { limit: SUMMARY_PAGE, order: 'occurredOn', kinds: SHARE_LINK_ENTRY_KINDS, cursor, ...feedBoundsOf(range) });
      rows.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/expense-receipts',
      tags: ['Share links'],
      summary: 'An expense’s receipts in the shared period, as short-lived download URLs',
      description: 'MUT-560 (ADR-247). READY receipts of a live expense whose date is in the link’s period, named by its entry `key`, each with a signed URL that lives at most 60 seconds and never past this viewer’s access or the link’s expiry (with under 5 seconds left: the uniform 404). Any other key (outside the period, deleted, another profile’s, not a key) answers 404.',
      security: [],
      request: { body: jsonBody(ShareLinkReceiptsRequestSchema) },
      responses: {
        200: { description: 'The receipts', content: { 'application/json': { schema: ShareLinkReceiptListSchema } } },
        ...viewRefusals,
        404: errorResponse('NOT_FOUND: the uniform SHARE_LINK_UNAVAILABLE, or no such expense in this link’s period'),
        503: errorResponse('ATTACHMENTS_NOT_CONFIGURED'),
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const { organization, range, link, viewer } = await viewAccess(c, body.viewerToken);
      const storage = options.storage;
      if (!storage) throw new ApiError('ATTACHMENTS_NOT_CONFIGURED', 'Attachments are not configured on this deployment (ATTACHMENTS_BUCKET)');
      const now = c.get('now')();
      // At most a minute, never past this viewer's access or the link's end: a revoke or a lock cuts receipts within 60 s.
      const ttlSeconds = receiptUrlTtlSeconds(options.urlTtlSeconds, [viewer.accessExpiresAt, link.expiresAt], now);
      if (ttlSeconds === null) throw shareLinkUnavailable();
      const expenseId = shareRowId(settings.pepper, link.id, body.entryKey);
      const expense = expenseId ? await store.expenses.getById(organization.id, expenseId) : null;
      if (!expense || !isInRange(expense.occurredOn, range)) throw new ApiError('NOT_FOUND', 'Expense not found');
      const ready = (await store.expenseReceipts.listByExpense(organization.id, expense.id)).filter((r) => r.status === 'READY' && r.deletedAt === null);
      const items = await Promise.all(
        ready.map(async (r) => {
          const signed = await storage.signDownload(r.storageKey, { filename: r.filename, mimeType: r.mimeType, ttlSeconds, now });
          return { filename: r.filename, mimeType: r.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png', url: signed.url, expiresAt: signed.expiresAt.toISOString() };
        }),
      );
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/share-links/download-ticket',
      tags: ['Share links'],
      summary: 'Start a download of the shared period: its size, and a ticket for the stream',
      description:
        'MUT-314 (ADR-248). The link’s own period, never another: `type=report` is the Excel report, `type=receipts` the receipt files with index.csv. POST the answer’s ticket with this viewer token to /v1/period-downloads/stream within 120 seconds. Headers follow `lang`, else Accept-Language (Arabic by default). 422 PERIOD_TOO_LARGE over a cap. Also needs period downloads switched on.',
      security: [],
      request: { body: jsonBody(ShareLinkDownloadTicketRequestSchema) },
      responses: { 200: { description: 'The ticket', content: { 'application/json': { schema: PeriodDownloadTicketSchema } } }, ...viewRefusals },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const access = await viewAccess(c, body.viewerToken);
      const now = c.get('now')();
      await checkMintBudget(c, options.downloads.mintLimiter, `viewer:${access.viewer.id}`);
      const minted = await mintDownload(store, {
        pepper: settings.pepper,
        type: body.type,
        kind: 'link',
        organization: access.organization,
        sub: access.viewer.id,
        sid: null,
        range: access.range,
        asOf: resolveAsOf(body.asOf, now),
        lang: body.lang ?? visitorLanguage(c),
        now,
        limits: options.downloads.limits,
      });
      return c.json(minted, 200);
    },
  );

  return app;
}

/** Received payments per currency, never summed across currencies (ADR-004). */
function receivedByCurrency(payments: readonly PaymentRecord[]) {
  const byCurrency = new Map<string, { minor: bigint; count: number }>();
  for (const p of payments) {
    const total = byCurrency.get(p.currency) ?? { minor: 0n, count: 0 };
    byCurrency.set(p.currency, { minor: total.minor + p.amountMinor, count: total.count + 1 });
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, { minor, count }]) => ({ currency: currency as Currency, total: formatMoney({ minor, currency: currency as Currency }), count }));
}

