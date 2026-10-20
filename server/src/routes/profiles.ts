import { randomUUID } from 'node:crypto';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { presetFor } from '../expenses/presets.js';
import { profileOwnerOf, profileTypeOf } from '../personal-profile.js';
import { identityIdempotent } from '../idempotency.js';
import { ifMatch } from '../if-match.js';
import type { LedgerStore, Organization, UserRecord } from '../repositories/ports.js';
import {
  CreateProfileRequestSchema,
  FirmRequestResponseSchema,
  HostedProfileSchema,
  IfMatchHeaderSchema,
  ProfileIdParamSchema,
  ProfileTypeChangeQuerySchema,
  ProfileTypeChangeSchema,
  UpdateProfileRequestSchema,
  UpdateProfileResponseSchema,
} from '../schemas.js';
import { hostedProfileFor } from '../serializers.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse, versionMismatch } from './shared.js';

/**
 * How many profiles one person may own, their built-in personal profile
 * included (MUT-182, owner ruling). A product limit, not deploy configuration.
 */
export const MAX_OWNED_PROFILES = 6;

/** These act on the person, like GET /v1/me: no X-Mutaba3a-Profile. The profile they change is in the path. */
export const PROFILE_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/profiles',
  'PATCH /v1/profiles/:profileId',
  'GET /v1/profiles/:profileId/type-change',
  'POST /v1/profiles/:profileId/firm-request',
]);

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const forbiddenResponse = { 403: { description: 'READ_ONLY_PROFILE with details.reason NOT_OWNER: a profile the caller belongs to but does not own', content: errorResponses[403].content } } as const;

/**
 * /v1/profiles — a person's own standalone profiles (MUT-182, ADR-037
 * MUT-182 amendment). A profile created here is an organization hosted
 * entirely on Mutaba3a's servers, owned by its creator: never keyed, bound to
 * Malafat or shared (ownedProfileConflict keeps every such door shut). Its
 * type only picks its expense categories; changing it replaces them.
 */
export function profileRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  /** The profile at `profileId`, if the caller owns it: 404 when they cannot see it at all, 403 when it is a firm they only belong to. */
  async function ownedBy(user: UserRecord, profileId: string): Promise<Organization> {
    const organization = await store.organizations.getById(profileId);
    if (!organization || !(await store.memberships.find(user.id, profileId))) throw new ApiError('NOT_FOUND', 'Profile not found');
    if (profileOwnerOf(organization) !== user.id) {
      throw new ApiError('READ_ONLY_PROFILE', 'Only the person who owns a profile can change it; this one was set up for you by your account administrator', { reason: 'NOT_OWNER' });
    }
    return organization;
  }

  /** The built-in personal profile is always PERSONAL (eng review D2): PATCH refuses to retype it, and the preview of that change says the same. */
  function assertRetypable(organization: Organization, type: 'PERSONAL' | 'BUSINESS' | undefined) {
    if (type && type !== 'PERSONAL' && organization.personalOwnerUserId) {
      throw new ApiError('CONFLICT', 'Your built-in personal profile is always Personal; create another profile for a business', { reason: 'DEFAULT_PERSONAL_PROFILE' });
    }
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/profiles',
      tags: ['Profiles'],
      summary: 'Create a standalone profile you own',
      description: `Hosted entirely on Mutaba3a: never a Malafat organization, never keyed or shared. Fully writable by its owner, like the personal profile. Up to ${MAX_OWNED_PROFILES} owned profiles per person, the personal one included (409 CONFLICT, details.reason PROFILE_LIMIT). The type picks the expense categories.`,
      security: SESSION_ONLY,
      middleware: [identityIdempotent(store, 'profiles.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateProfileRequestSchema) },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: HostedProfileSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const result = await store.organizations.createOwned(
        user.id,
        { name: body.name, slug: `p-${randomUUID()}`, defaultCurrency: body.defaultCurrency, timezone: body.timezone, profileType: body.type, at: c.get('now')() },
        MAX_OWNED_PROFILES,
        // Written inside the create's transaction (qa-reconcile D3): no profile without its record, no duplicate on retry.
        { actorId: user.id, requestId: c.get('requestId') },
      );
      if (result.kind === 'limit') {
        throw new ApiError('CONFLICT', `You already have ${result.count} profiles, the most one person can own`, { reason: 'PROFILE_LIMIT', limit: MAX_OWNED_PROFILES });
      }
      return c.json(hostedProfileFor(result.organization, null, user.id, result.membership), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/profiles/{profileId}',
      tags: ['Profiles'],
      summary: 'Rename a profile you own, change its default currency or its type',
      description:
        'One atomic write under If-Match. The default currency only seeds new records; existing ones keep theirs. A changed type replaces the profile’s expense categories with the new type’s preset, in your language, and leaves every expense that had one uncategorized — preview it with GET /v1/profiles/{profileId}/type-change. The built-in personal profile can be renamed but is always PERSONAL (409 CONFLICT, details.reason DEFAULT_PERSONAL_PROFILE).',
      security: SESSION_ONLY,
      middleware: [ifMatch()] as const,
      request: { params: ProfileIdParamSchema, headers: IfMatchHeaderSchema, body: jsonBody(UpdateProfileRequestSchema) },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: UpdateProfileResponseSchema } } },
        ...notFoundResponse,
        ...conflictResponse,
        ...validationResponse,
        ...errorResponses,
        // Last, so it replaces errorResponses' API-key 403 text: these routes refuse keys before any scope check.
        ...forbiddenResponse,
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const current = await ownedBy(user, c.req.valid('param').profileId);
      assertRetypable(current, body.type);
      const target = body.type ? presetFor({ writerOfRecord: null, profileType: body.type }, user.locale) : null;
      const now = c.get('now')();
      const result = await store.organizations.updateOwned(
        current.id,
        user.id,
        c.get('expectedVersion'),
        { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.defaultCurrency !== undefined ? { defaultCurrency: body.defaultCurrency } : {}), ...(body.type !== undefined ? { profileType: body.type } : {}) },
        target?.categories ?? null,
        now,
        // Audited inside the same transaction (qa-reconcile D3), the type change with what it removed (D4).
        { actorId: user.id, requestId: c.get('requestId'), fields: Object.keys(body), preset: target ? { name: target.preset, locale: user.locale } : null },
      );
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'Profile not found');
      if (result.kind === 'stale') throw versionMismatch(result.record.version);
      const typeChange = result.typeChange && target ? { ...result.typeChange, preset: target.preset } : null;
      // MUT-300: an owned profile can have firm features on (eng review D4); its owner's role comes with it.
      const membership = await store.memberships.find(user.id, result.record.id);
      return c.json({ profile: hostedProfileFor(result.record, null, user.id, membership), typeChange }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/profiles/{profileId}/type-change',
      tags: ['Profiles'],
      summary: 'Preview what changing a profile’s type would do',
      description: 'The counts PATCH /v1/profiles/{profileId} would report for the same `to`, right now: expenses left uncategorized and categories replaced. All zero when `to` is already the profile’s type. Refused exactly where PATCH is (409 DEFAULT_PERSONAL_PROFILE on the built-in personal profile).',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema, query: ProfileTypeChangeQuerySchema },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: ProfileTypeChangeSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses, ...forbiddenResponse },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const current = await ownedBy(user, c.req.valid('param').profileId);
      const to = c.req.valid('query').to;
      assertRetypable(current, to);
      const { preset } = presetFor({ writerOfRecord: null, profileType: to }, user.locale);
      const impact = to === profileTypeOf(current) ? { uncategorizedExpenses: 0, deletedCategories: 0 } : await store.organizations.typeChangeImpact(current.id);
      return c.json({ ...impact, preset }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/profiles/{profileId}/firm-request',
      tags: ['Profiles'],
      summary: 'Ask for firm features on a Business profile you own',
      description:
        'MUT-300 (ADR-099): records the request for an operator, who turns firm features on in place: the profile stays yours. Idempotent: a repeat answers with the first request. Refused on your built-in personal profile (409 CONFLICT, details.reason PERSONAL_PROFILE), on a profile typed PERSONAL (NOT_BUSINESS) and once firm features are on (ALREADY_FIRM).',
      security: SESSION_ONLY,
      middleware: [identityIdempotent(store, 'profiles.firmRequest')] as const,
      request: { params: ProfileIdParamSchema, headers: IdempotencyHeaderSchema },
      responses: {
        202: { description: 'Requested (now or earlier)', content: { 'application/json': { schema: FirmRequestResponseSchema } } },
        ...notFoundResponse,
        ...conflictResponse,
        ...errorResponses,
        ...forbiddenResponse,
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const current = await ownedBy(user, c.req.valid('param').profileId);
      if (current.personalOwnerUserId) {
        throw new ApiError('CONFLICT', 'Your built-in personal profile can’t have firm features; create a Business profile for your firm', { reason: 'PERSONAL_PROFILE' });
      }
      if (profileTypeOf(current) !== 'BUSINESS') {
        throw new ApiError('CONFLICT', 'Firm features are for Business profiles; change this profile’s type first', { reason: 'NOT_BUSINESS' });
      }
      const result = await store.organizations.requestFirm(current.id, user.id, c.get('now')(), { actorId: user.id, requestId: c.get('requestId') });
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'Profile not found');
      if (result.kind === 'already_firm') throw new ApiError('CONFLICT', 'Firm features are already on for this profile', { reason: 'ALREADY_FIRM' });
      return c.json({ firmRequest: { requestedAt: result.organization.firmRequestedAt!.toISOString() } }, 202);
    },
  );

  return app;
}
