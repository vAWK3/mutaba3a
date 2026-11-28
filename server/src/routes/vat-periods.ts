import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../auth/middleware.js';
import { ApiError } from '../errors.js';
import { ownedProfileOf } from '../personal-profile.js';
import type { AuditEventInput, LedgerStore, VatClientView, VatPeriodRecord } from '../repositories/ports.js';
import {
  ClientVatPeriodsResponseSchema,
  CurrentVatPeriodResponseSchema,
  ErrorEnvelopeSchema,
  ProfileIdParamSchema,
  ReviewVatPeriodRequestSchema,
  SetVatPeriodKindRequestSchema,
  SetVatPeriodKindResponseSchema,
  VatPeriodKeyParamSchema,
  VatPeriodViewSchema,
} from '../schemas.js';
import { VAT_PERIOD_POLICY } from '../vat-periods/run.js';
import { vatPackFor } from '../vat-periods/pack.js';
import type { VatPeriodKind } from '../vat-periods/types.js';
import type { z } from '@hono/zod-openapi';

/**
 * MUT-782 (ADR-341): a client's VAT period and its "all receipts sent" state.
 *
 *   Client (session; owns the profile, else 403 NOT_OWNER; 404 when they can't see it):
 *     GET  /v1/profiles/{profileId}/vat-periods/current            the latest announced period, or null
 *     POST /v1/profiles/{profileId}/vat-periods/{periodKey}/done   all receipts sent (a repeat answers 200 and changes nothing)
 *   Accountant (session; an ACTIVE grant on the profile, else 404). Never through a profile: ADR-245 refuses an
 *   accountant every write there, so these live under /v1/clients like Remove (ADR-341 amends ADR-245 d3):
 *     GET  /v1/clients/vat-periods                                     every active client's period and state, in one read
 *     PUT  /v1/clients/{profileId}/vat-period                          choose how often the client files
 *     POST /v1/clients/{profileId}/vat-periods/{periodKey}/review      confirm, or ask for more with a note
 *
 * The daily mail job is routes/vat-period-sweep.ts. A period moves OPEN → CLIENT_DONE → CONFIRMED; Ask for more sends it
 * to MORE_NEEDED and the client says Done again. Anything past CONFIRMED is 409 VAT_PERIOD_STATE.
 */

/** These name their profile in the path: no X-Mutaba3a-Profile. */
export const VAT_PERIOD_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'GET /v1/profiles/:profileId/vat-periods/current',
  'POST /v1/profiles/:profileId/vat-periods/:periodKey/done',
  'GET /v1/clients/vat-periods',
  'PUT /v1/clients/:profileId/vat-period',
  'POST /v1/clients/:profileId/vat-periods/:periodKey/review',
]);

/** Every endpoint this file adds: the dark-launch switch (VAT_PERIOD_REMINDERS off) answers 404 for each. */
export const VAT_PERIOD_ENDPOINTS: ReadonlySet<string> = VAT_PERIOD_ORGANIZATION_INDEPENDENT_ROUTES;

const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];
const DAY_MS = 86_400_000;
const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

type View = z.infer<typeof VatPeriodViewSchema>;

/** The period as the clients read it; null for a stored key the pack no longer reads. */
export function periodView(record: VatPeriodRecord, country: string | null): View | null {
  const periods = vatPackFor(country).vat.periods;
  const period = periods.fromKey(record.periodKey);
  if (!period) return null;
  return {
    periodKey: period.key,
    kind: period.kind,
    year: period.year,
    firstMonth: period.firstMonth,
    lastMonth: period.lastMonth,
    startDate: period.startDate,
    endDate: period.endDate,
    due: periods.dueDate(period),
    state: record.state,
    note: record.note,
    announcedAt: record.announcedAt.toISOString(),
    doneAt: record.doneAt?.toISOString() ?? null,
  };
}

/** What a client files: the accountant's choice, else its business type's default, else none. */
export function effectiveKind(view: Pick<VatClientView, 'chosenKind' | 'dealerType' | 'country'>): VatPeriodKind {
  if (view.chosenKind !== null) return view.chosenKind;
  return view.dealerType === null ? 'NONE' : vatPackFor(view.country).vat.periods.defaultKind(view.dealerType);
}

function audit(organizationId: string, actorId: string, action: string, periodKey: string | null, extra: Record<string, string> = {}, requestId: string | null = null): AuditEventInput {
  return { organizationId, actorType: 'USER', actorId, action, entityType: 'vat_period', entityId: null, metadata: { ...(periodKey ? { periodKey } : {}), ...extra }, requestId };
}

export function vatPeriodRoutes(options: { store: LedgerStore }): OpenAPIHono<AppEnv> {
  const { store } = options;
  const app = new OpenAPIHono<AppEnv>();

  /** The accountant's ACTIVE grant on the profile; anything else is one 404, as if it did not exist. */
  async function assertActiveAccountant(c: Context<AppEnv>, profileId: string): Promise<string> {
    const { user } = c.get('identity');
    if (!(await store.accountantGrants.findActive(user.id, profileId))) throw new ApiError('NOT_FOUND', 'Not found');
    return user.id;
  }

  /** The profile's view, and the period it names: unknown keys (never announced, or malformed) are 404. */
  async function periodOf(profileId: string, periodKey: string): Promise<{ view: VatClientView; record: VatPeriodRecord }> {
    const view = (await store.vatPeriods.viewsOf([profileId])).get(profileId);
    const record = vatPackFor(view?.country ?? null).vat.periods.fromKey(periodKey) ? await store.vatPeriods.recordOf(profileId, periodKey) : null;
    if (!view || !record) throw new ApiError('NOT_FOUND', 'Not found');
    return { view, record };
  }

  const viewOrThrow = (record: VatPeriodRecord, country: string | null): View => {
    const view = periodView(record, country);
    if (!view) throw new ApiError('NOT_FOUND', 'Not found');
    return view;
  };

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/profiles/{profileId}/vat-periods/current',
      tags: ['VAT periods'],
      summary: 'The latest VAT period announced for this profile, and where it stands',
      description: 'MUT-782 (ADR-341). Null until the first period ends (or while the profile files no VAT). Owners only; an accountant reads the same through GET /v1/clients/vat-periods. Additive since 1.215.0-mut782.',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema },
      responses: {
        200: { description: 'The period, or null', content: { 'application/json': { schema: CurrentVatPeriodResponseSchema } } },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile for you, or VAT period reminders are off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const organization = await ownedProfileOf(store, user.id, c.req.valid('param').profileId);
      const view = (await store.vatPeriods.viewsOf([organization.id])).get(organization.id);
      return c.json({ period: view?.latest ? periodView(view.latest, view.country) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/profiles/{profileId}/vat-periods/{periodKey}/done',
      tags: ['VAT periods'],
      summary: 'All receipts for this period are sent',
      description: 'MUT-782 (ADR-341). OPEN or MORE_NEEDED becomes CLIENT_DONE. A repeat answers 200 and changes nothing. A confirmed period is 409 VAT_PERIOD_STATE. Additive since 1.215.0-mut782.',
      security: SESSION_ONLY,
      request: { params: VatPeriodKeyParamSchema },
      responses: {
        200: { description: 'The period now', content: { 'application/json': { schema: VatPeriodViewSchema } } },
        403: errorResponse('READ_ONLY_PROFILE, details.reason NOT_OWNER'),
        404: errorResponse('No such profile or period for you, or VAT period reminders are off on this server'),
        409: errorResponse('VAT_PERIOD_STATE: the period is confirmed'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const { profileId, periodKey } = c.req.valid('param');
      const organization = await ownedProfileOf(store, user.id, profileId);
      const { view } = await periodOf(organization.id, periodKey);
      const at = c.get('now')();
      const result = await store.vatPeriods.markDone({ organizationId: organization.id, periodKey, userId: user.id, at, audit: [audit(organization.id, user.id, 'vat_period.client_done', periodKey, {}, c.get('requestId'))] });
      if (result === 'not_found') throw new ApiError('NOT_FOUND', 'Not found');
      if (result === 'state') throw new ApiError('VAT_PERIOD_STATE', 'This period is already confirmed');
      const record = await store.vatPeriods.recordOf(organization.id, periodKey);
      return c.json(viewOrThrow(record!, view.country), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/clients/vat-periods',
      tags: ['VAT periods'],
      summary: 'Your active clients: how often each files VAT, and where its latest period stands',
      description: 'MUT-782 (ADR-341). One read for the whole desk (three queries however many clients). Ended clients are not listed. Additive since 1.215.0-mut782.',
      security: SESSION_ONLY,
      responses: {
        200: { description: 'One item per active client', content: { 'application/json': { schema: ClientVatPeriodsResponseSchema } } },
        404: errorResponse('VAT period reminders are off on this server'),
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const grants = await store.accountantGrants.listActiveByAccountant(user.id);
      const views = await store.vatPeriods.viewsOf(grants.map((g) => g.organizationId));
      return c.json(
        {
          items: grants.flatMap((g) => {
            const view = views.get(g.organizationId);
            return view ? [{ profileId: g.organizationId, kind: effectiveKind(view), chosenKind: view.chosenKind, period: view.latest ? periodView(view.latest, view.country) : null }] : [];
          }),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/clients/{profileId}/vat-period',
      tags: ['VAT periods'],
      summary: 'Choose how often this client files VAT',
      description: 'MUT-782 (ADR-341). Applies from the next period that ends; periods already announced keep their state. NONE stops the reminders. Additive since 1.215.0-mut782.',
      security: SESSION_ONLY,
      request: { params: ProfileIdParamSchema, body: { required: true, content: { 'application/json': { schema: SetVatPeriodKindRequestSchema } } } },
      responses: {
        200: { description: 'The kind now chosen', content: { 'application/json': { schema: SetVatPeriodKindResponseSchema } } },
        404: errorResponse('Not one of your clients, or VAT period reminders are off on this server'),
      },
    }),
    async (c) => {
      const { profileId } = c.req.valid('param');
      const { kind } = c.req.valid('json');
      const userId = await assertActiveAccountant(c, profileId);
      await store.vatPeriods.setKind({ organizationId: profileId, kind, userId, at: c.get('now')(), audit: [audit(profileId, userId, 'vat_period.kind_set', null, { kind }, c.get('requestId'))] });
      return c.json({ kind }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/clients/{profileId}/vat-periods/{periodKey}/review',
      tags: ['VAT periods'],
      summary: 'Confirm that the receipts are all in, or ask the client for more',
      description: 'MUT-782 (ADR-341). From any state but CONFIRMED. Ask for more takes an optional note (200 characters), re-opens the client\'s reminder five days out, and lets the client say Done again. Additive since 1.215.0-mut782.',
      security: SESSION_ONLY,
      request: { params: VatPeriodKeyParamSchema, body: { required: true, content: { 'application/json': { schema: ReviewVatPeriodRequestSchema } } } },
      responses: {
        200: { description: 'The period now', content: { 'application/json': { schema: VatPeriodViewSchema } } },
        404: errorResponse('Not one of your clients, no such period, or VAT period reminders are off on this server'),
        409: errorResponse('VAT_PERIOD_STATE: the period is already confirmed'),
      },
    }),
    async (c) => {
      const { profileId, periodKey } = c.req.valid('param');
      const { decision, note } = c.req.valid('json');
      const userId = await assertActiveAccountant(c, profileId);
      const { view } = await periodOf(profileId, periodKey);
      const at = c.get('now')();
      const asking = decision === 'MORE_NEEDED';
      const result = await store.vatPeriods.review({
        organizationId: profileId,
        periodKey,
        userId,
        decision,
        note: asking && note ? note : null,
        at,
        followUpDueAt: asking ? new Date(at.getTime() + VAT_PERIOD_POLICY.followUpAfterDays * DAY_MS) : null,
        audit: [audit(profileId, userId, asking ? 'vat_period.more_needed' : 'vat_period.confirmed', periodKey, {}, c.get('requestId'))],
      });
      if (result === 'not_found') throw new ApiError('NOT_FOUND', 'Not found');
      if (result === 'state') throw new ApiError('VAT_PERIOD_STATE', 'This period is already confirmed');
      const record = await store.vatPeriods.recordOf(profileId, periodKey);
      return c.json(viewOrThrow(record!, view.country), 200);
    },
  );

  return app;
}
