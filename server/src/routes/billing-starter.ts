import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { entitlementsWithFactsFor, type ProfileForBilling } from '../billing/coverage.js';
import { businessCapView as viewOf, type BusinessCapState } from '../billing/business-cap.js';
import { coveringState, profilePlanSubscriptions } from '../billing/entitlement.js';
import { ApiError } from '../errors.js';
import { ownedProfilesOf, profileOwnerOf } from '../personal-profile.js';
import type { AuditEventInput, BillingFactsRecord, LedgerStore, UserRecord } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';
import { SESSION_ONLY } from './billing.js';

/**
 * MUT-731 (ADR-284): the person's own Starter choices. Person-level (no X-Mutaba3a-Profile), 'open' in the lapse gate
 * (choosing a plan is how a read-only person writes again), 404 with STARTER_PLAN off.
 *
 *   POST /v1/billing/starter            "Continue free on Starter" after a cancel (starterChosenAt)
 *   PUT  /v1/billing/active-businesses  which business stays active on Starter (Basel Q5: they must pick)
 *   POST /v1/billing/solo-trial/offered the onboarding step showed the one-time Solo trial (Basel Q7: shown = gone)
 */
export const BILLING_STARTER_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/billing/starter',
  'PUT /v1/billing/active-businesses',
  'POST /v1/billing/solo-trial/offered',
]);

const StarterChoiceSchema = z
  .object({ starterChosenAt: z.string().datetime(), changed: z.boolean().openapi({ description: 'False when Starter was already chosen since the latest plan began.' }) })
  .openapi('StarterChoice');

const ActiveBusinessesRequestSchema = z
  .object({ organizationIds: z.array(z.string().uuid()).min(1).max(6) })
  .strict()
  .openapi('ActiveBusinessesRequest');

export const ActiveBusinessesSchema = z
  .object({
    cap: z.number().int(),
    active: z.array(z.string().uuid()),
    readOnly: z.array(z.string().uuid()),
    mustChoose: z.boolean(),
  })
  .openapi('ActiveBusinesses');

const SoloTrialOfferSchema = z.object({ offeredAt: z.string().datetime() }).openapi('SoloTrialOffer');

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

export function billingStarterRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  const off = () => new ApiError('NOT_FOUND', 'Not found');

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/starter',
      tags: ['Billing'],
      summary: 'Continue free on Starter',
      description:
        'MUT-731 (ADR-284, Basel 13540 Q3): after a paid plan was cancelled (read-only), the person moves to the free Starter plan: their own profiles are ACTIVE on Starter at once. ' +
        'Idempotent: a choice already made since the latest plan began is kept (`changed: false`). 409 CONFLICT `details.reason` NOTHING_TO_LEAVE while a plan covers them (change plans instead, MUT-734). ' +
        'Audited `billing.starter_chosen` on each profile the person created. 404 with STARTER_PLAN off. Additive since 1.145.0-mut731.',
      security: SESSION_ONLY,
      responses: {
        200: { description: 'On Starter', content: { 'application/json': { schema: StarterChoiceSchema } } },
        404: errorResponse('NOT_FOUND: Starter is off on this server'),
        409: errorResponse('CONFLICT, details.reason NOTHING_TO_LEAVE: a plan covers the person now'),
      },
    }),
    async (c) => {
      if (!store.billing.starterPlan) throw off();
      const { user } = c.get('identity');
      const now = c.get('now')();
      const { profiles, facts } = await ownedFacts(store, user, now);
      const own = profilePlanSubscriptions(facts.subscriptions).filter((s) => s.userId === user.id);
      if (own.some((s) => coveringState(s) !== undefined && s.currentPeriodEnd > now && !s.endedAt)) {
        throw new ApiError('CONFLICT', 'A plan covers you now; change plans instead', { reason: 'NOTHING_TO_LEAVE' });
      }
      const chosenAt = facts.starterChosen?.get(user.id) ?? null;
      const latestStart = own.reduce<Date | null>((latest, s) => (s.createdAt > (latest ?? new Date(0)) ? s.createdAt : latest), null);
      if (chosenAt && (!latestStart || chosenAt >= latestStart)) return c.json({ starterChosenAt: chosenAt.toISOString(), changed: false }, 200);
      await store.billing.chooseStarter(user.id, now, personAudit(profiles.map((p) => p.organization.id), user, 'billing.starter_chosen', c.get('requestId')));
      return c.json({ starterChosenAt: now.toISOString(), changed: true }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/billing/active-businesses',
      tags: ['Billing'],
      summary: 'Choose which business stays active on Starter',
      description:
        'MUT-731 (ADR-284, Basel Q5): someone on Starter with more businesses than it includes picks the one that stays active; the others are read-only (visible, exportable, never deleted) until they switch or upgrade. ' +
        'Exactly the plan’s count of businesses, each one the person created and still on Starter (422 VALIDATION_FAILED `details.reason` WRONG_COUNT; 404 NOT_FOUND for another’s). ' +
        '409 CONFLICT `details.reason` NOTHING_TO_CHOOSE when the person isn’t over the count. Audited `billing.active_businesses_chosen`. 404 with STARTER_PLAN off. Additive since 1.145.0-mut731.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: ActiveBusinessesRequestSchema } } } },
      responses: {
        200: { description: 'The businesses now', content: { 'application/json': { schema: ActiveBusinessesSchema } } },
        404: errorResponse('NOT_FOUND: Starter is off, or a business that isn’t one the person created'),
        409: errorResponse('CONFLICT, details.reason NOTHING_TO_CHOOSE'),
        422: errorResponse('VALIDATION_FAILED, details.reason WRONG_COUNT'),
      },
    }),
    async (c) => {
      if (!store.billing.starterPlan) throw off();
      const { user } = c.get('identity');
      const now = c.get('now')();
      const chosen = [...new Set(c.req.valid('json').organizationIds)];
      const { businessCaps } = await ownedFacts(store, user, now);
      const state = businessCaps.get(user.id);
      if (!state || state.businesses.length <= state.cap) throw new ApiError('CONFLICT', 'You keep every business you have', { reason: 'NOTHING_TO_CHOOSE' });
      if (chosen.some((id) => !state.businesses.includes(id))) throw new ApiError('NOT_FOUND', 'No such business of yours', { field: 'organizationIds' });
      if (chosen.length !== state.cap) throw new ApiError('VALIDATION_FAILED', `Choose ${state.cap} business(es)`, { field: 'organizationIds', reason: 'WRONG_COUNT', cap: state.cap });
      await store.billing.setActiveBusinesses(user.id, chosen, now, personAudit(state.businesses, user, 'billing.active_businesses_chosen', c.get('requestId'), { active: chosen }));
      return c.json(viewOf({ ...state, active: chosen, readOnly: state.businesses.filter((id) => !chosen.includes(id)), mustChoose: false }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/solo-trial/offered',
      tags: ['Billing'],
      summary: 'The one-time Solo trial step was shown',
      description:
        'MUT-731 (ADR-284, Basel Q7 and 13554 #2): the portal calls this when web onboarding shows the 14-day Solo trial. It is offered once: from here `GET /v1/me` `plan.soloTrialOffer` is false, whatever the person chose. ' +
        'Idempotent (the first date is kept). 404 with STARTER_PLAN off. Additive since 1.145.0-mut731.',
      security: SESSION_ONLY,
      responses: { 200: { description: 'Recorded', content: { 'application/json': { schema: SoloTrialOfferSchema } } }, 404: errorResponse('NOT_FOUND: Starter is off on this server') },
    }),
    async (c) => {
      if (!store.billing.starterPlan) throw off();
      const { user } = c.get('identity');
      const trial = await store.billing.markPaidTrialOffered(user.id, c.get('now')());
      if (!trial?.offeredAt) throw off();
      return c.json({ offeredAt: trial.offeredAt.toISOString() }, 200);
    },
  );

  return app;
}

/** The person's own profiles, their facts and the Starter business cap, from one coverage read. */
async function ownedFacts(store: LedgerStore, user: UserRecord, now: Date): Promise<{ profiles: ProfileForBilling[]; facts: BillingFactsRecord; businessCaps: Map<string, BusinessCapState> }> {
  const owned = (await ownedProfilesOf(store, user.id)).filter((o) => profileOwnerOf(o) === user.id);
  const profiles = await Promise.all(
    owned.map(async (organization) => ({ organization, malafatConnected: (await store.integrations.findByOrganizationAndProvider(organization.id, 'MALAFAT'))?.status === 'CONNECTED' })),
  );
  const { facts, businessCaps } = await entitlementsWithFactsFor(store, profiles, now, user.id);
  return { profiles, facts, businessCaps };
}

function personAudit(organizationIds: readonly string[], user: UserRecord, action: string, requestId: string, metadata?: Record<string, string[]>): AuditEventInput[] {
  return organizationIds.map((organizationId) => ({ organizationId, actorType: 'USER', actorId: user.id, action, entityType: 'user', entityId: user.id, requestId, ...(metadata ? { metadata } : {}) }));
}
