import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../auth/middleware.js';
import { PAID_HARD_CAP_PLANS } from '../billing/plans.js';
import { ApiError } from '../errors.js';
import { ownedProfilesOf, profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore } from '../repositories/ports.js';
import { ErrorEnvelopeSchema } from '../schemas.js';
import { capOf } from '../usage/caps.js';
import { giftCovers, giftUntil } from '../usage/gift.js';
import { usageMonthOf } from '../usage/month.js';
import { personPlanOf } from '../usage/plan-of.js';
import { userSubjectKey } from '../usage/subject.js';
import { SESSION_ONLY } from './billing.js';

/**
 * MUT-733 (ADR-293): the account's once-ever over-cap gift. A Solo or Business payer whose monthly meter is at its cap
 * (with PAID_HARD_CAPS on) takes it here after the refusal said `gift: 'available'`; the held request is then retried
 * and that meter has no cap until the 1st of the next Jerusalem month. A partner acting on the owner's business takes
 * the owner's gift (Q3: the same business): `organizationId` names it. Person-level, never billing-gated.
 *
 *   POST /v1/billing/over-cap-gift   { meter, organizationId? }  →  { meter, until }
 */
export const BILLING_GIFT_ROUTES: ReadonlySet<string> = new Set(['POST /v1/billing/over-cap-gift']);

const GiftRequestSchema = z
  .object({
    meter: z.enum(['documents', 'scans']),
    /** The business the refusal came from, when it isn't the caller's own (a partner): its owner's gift is taken. */
    organizationId: z.string().uuid().optional(),
  })
  .openapi('OverCapGiftRequest');

const GiftSchema = z.object({ meter: z.enum(['documents', 'scans']), until: z.string().datetime() }).openapi('OverCapGift');
const errorContent = { content: { 'application/json': { schema: ErrorEnvelopeSchema } } };

export function billingGiftRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/billing/over-cap-gift',
      tags: ['Billing'],
      summary: 'Take the once-ever over-cap gift for a monthly meter (MUT-733)',
      description:
        'Only after a 409 PLAN_LIMIT that said `gift: "available"`: the meter must be at its cap this month on a Solo or Business plan with PAID_HARD_CAPS on ' +
        '(409 GIFT_NOT_AVAILABLE otherwise). Once per account, ever, for one meter (409 GIFT_USED after; a repeat for the same meter in the same month answers 200). ' +
        'Audited `billing.over_cap_gift`. Additive since 1.159.0-mut733.',
      security: SESSION_ONLY,
      request: { body: { required: true, content: { 'application/json': { schema: GiftRequestSchema } } } },
      responses: {
        200: { description: 'The meter has no cap until `until`', content: { 'application/json': { schema: GiftSchema } } },
        401: { description: 'Not signed in', ...errorContent },
        403: { description: 'CROSS_SITE_REQUEST', ...errorContent },
        404: { description: 'No such business among the caller’s', ...errorContent },
        409: { description: 'GIFT_USED, or GIFT_NOT_AVAILABLE', ...errorContent },
      },
    }),
    async (c) => {
      const { user } = c.get('identity');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const payer = body.organizationId ? await ownerOf(store, user.id, body.organizationId) : user.id;
      const meter = body.meter === 'documents' ? ('DOCUMENTS' as const) : ('SCANS' as const);
      const month = usageMonthOf(now);
      const gift = await store.billing.overCapGiftOf(payer);
      if (!gift) throw new ApiError('NOT_FOUND', 'No such account');
      // A retry after a lost answer: the same meter, this month.
      if (giftCovers(gift, meter, month)) return c.json({ meter: body.meter, until: giftUntil(month).toISOString() }, 200);
      if (gift.usedAt) throw new ApiError('GIFT_USED', 'The over-cap gift was already used on this account');
      const plan = await personPlanOf(store, payer, now);
      const cap = capOf(plan, meter);
      if (!store.billing.paidHardCaps || !PAID_HARD_CAP_PLANS.has(plan) || cap === null) throw notAvailable();
      const used = (await store.usage.countersFor(userSubjectKey(payer), [month])).find((counter) => counter.meter === meter)?.count ?? 0;
      if (used < cap) throw notAvailable();
      const profiles = await ownedProfilesOf(store, payer);
      const audit = profiles.map((p) => ({ organizationId: p.id, actorType: 'USER' as const, actorId: user.id, action: 'billing.over_cap_gift', entityType: 'user', entityId: payer, metadata: { meter, month, plan }, requestId: c.get('requestId') }));
      const taken = await store.billing.claimOverCapGift({ userId: payer, meter, month, at: now, audit });
      if (!taken) {
        // Another tab won: fine when it took this meter this month.
        const after = await store.billing.overCapGiftOf(payer);
        if (after && giftCovers(after, meter, month)) return c.json({ meter: body.meter, until: giftUntil(month).toISOString() }, 200);
        throw new ApiError('GIFT_USED', 'The over-cap gift was already used on this account');
      }
      return c.json({ meter: body.meter, until: giftUntil(month).toISOString() }, 200);
    },
  );

  return app;
}

function notAvailable(): ApiError {
  return new ApiError('GIFT_NOT_AVAILABLE', 'The over-cap gift isn’t available for this meter now');
}

/** The owner of a business the caller belongs to (a partner takes the owner's gift, Q3). */
async function ownerOf(store: LedgerStore, userId: string, organizationId: string): Promise<string> {
  const member = (await store.memberships.listByUser(userId)).some((m) => m.organizationId === organizationId);
  const organization = member ? await store.organizations.getById(organizationId) : null;
  const owner = organization ? profileOwnerOf(organization) : null;
  if (!owner) throw new ApiError('NOT_FOUND', 'No such business');
  return owner;
}
