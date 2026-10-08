import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, loadAgreementContext, parseAmount, retainerPreviewToken, todayFor, validationError } from '../agreements/compose.js';
import { generateCharges, postDueItems } from '../agreements/posting.js';
import { addMonths, dueDateFor, monthOf } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney } from '../money.js';
import { verifyPreviewToken } from '../preview-token.js';
import type { LedgerStore, Organization } from '../repositories/ports.js';
import { chargeDate, chargeMonths, validateRetainerSpec } from '../retainers/schedule.js';
import {
  AgreementDetailSchema,
  AgreementIdParamSchema,
  ReconcileResponseSchema,
  RetainerCancelRequestSchema,
  RetainerChargesResponseSchema,
  RetainerCreateRequestSchema,
  RetainerPreviewRequestSchema,
  RetainerPreviewResponseSchema,
} from '../schemas.js';
import { serializeAgreement, serializeCharge } from '../serializers.js';
import { computeVat } from '../vat.js';
import { mustGet } from './agreements.js';
import { conflictResponse, errorResponses, IdempotencyHeaderSchema, notFoundResponse, validationResponse } from './shared.js';

type PreviewBody = {
  projectId: string;
  monthlyAmount: string;
  currency?: string | undefined;
  pricingBasis: 'VAT_EXCLUSIVE' | 'VAT_INCLUSIVE';
  vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined;
  startMonth: string;
  billingDay: number;
  paymentTerms: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60';
  endMonth?: string | undefined;
  agreementDate?: string | undefined;
  description?: string | undefined;
};

/** /v1/retainers — recurring agreements, basic form (M3 brief rev. 2 §C). */
export function retainerRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  async function compose(organization: Organization, body: PreviewBody, today: string) {
    const agreementDate = body.agreementDate ?? today;
    assertIsoDate(agreementDate, 'agreementDate');
    const specError = validateRetainerSpec({ startMonth: body.startMonth, billingDay: body.billingDay, endMonth: body.endMonth });
    if (specError) throw validationError(specError.reason, `Retainer schedule is invalid: ${specError.reason}`);
    const context = await loadAgreementContext(store, organization, { projectId: body.projectId, currency: body.currency, vatTreatment: body.vatTreatment, agreementDate });
    const amountMinor = parseAmount(body.monthlyAmount, context.currency, 'monthlyAmount');
    if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'monthlyAmount must be positive', { field: 'monthlyAmount' });
    const vat = computeVat({ amountMinor, pricingBasis: body.pricingBasis, treatment: context.defaultTreatment, rateBasisPoints: context.rateBasisPoints });
    const months = chargeMonths({ startMonth: body.startMonth, billingDay: body.billingDay, endMonth: body.endMonth }, today);
    const fmt = (m: bigint) => formatMoney({ minor: m, currency: context.currency });
    const nextMonth = nextChargeMonth(body, months, today);
    return {
      context,
      agreementDate,
      amountMinor,
      vat,
      wire: {
        monthly: { amount: fmt(amountMinor), net: fmt(vat.netMinor), vat: fmt(vat.vatMinor), gross: fmt(vat.grossMinor) },
        vatRateBasisPoints: context.rateBasisPoints,
        vatTreatment: context.defaultTreatment,
        currency: context.currency,
        chargesDueNow: months.map((m) => ({ serviceMonth: m, chargeDate: chargeDate(m, body.billingDay), dueDate: dueDateFor(chargeDate(m, body.billingDay), body.paymentTerms) })),
        nextChargeDate: nextMonth ? chargeDate(nextMonth, body.billingDay) : null,
        previewToken: retainerPreviewToken(organization.id, body, context.rateBasisPoints),
      },
    };
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/preview',
      tags: ['Retainers'],
      summary: 'Preview a recurring retainer: monthly totals, charges that would post now, preview token',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { body: { required: true, content: { 'application/json': { schema: RetainerPreviewRequestSchema } } } },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: RetainerPreviewResponseSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const preview = await compose(organization, c.req.valid('json'), todayFor(organization, c.get('now')()));
      return c.json(preview.wire, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers',
      tags: ['Retainers'],
      summary: 'Create a recurring retainer from a preview',
      description: 'Charges for service months whose charge date has already arrived post immediately; later months post as their charge date arrives (lazily on reads, or through POST /v1/retainers/reconcile).',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'retainers.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: RetainerCreateRequestSchema } } } },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: RetainerChargesResponseSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const preview = await compose(organization, body, today);
      if (!verifyPreviewToken(token, [organization.id, 'retainer', body, preview.context.rateBasisPoints])) {
        throw new ApiError('CONFLICT', 'previewToken does not match this body and the VAT rate in force; preview again', { reason: 'PREVIEW_STALE' });
      }
      const created = await store.agreements.create(
        {
          organizationId: organization.id,
          projectId: preview.context.project.id,
          customerId: preview.context.customer.id,
          type: 'RECURRING',
          currency: preview.context.currency,
          pricingBasis: body.pricingBasis,
          vatTreatment: preview.context.defaultTreatment,
          vatRateBasisPoints: preview.vat.rateBasisPoints,
          amountMinor: preview.amountMinor,
          netMinor: preview.vat.netMinor,
          vatMinor: preview.vat.vatMinor,
          grossMinor: preview.vat.grossMinor,
          agreementDate: preview.agreementDate,
          description: body.description ?? null,
          paymentTerms: body.paymentTerms,
          startMonth: body.startMonth,
          billingDay: body.billingDay,
          endMonth: body.endMonth ?? null,
          installments: [],
        },
        now,
      );
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'retainer.created', entityType: 'agreement', entityId: created.agreement.id, metadata: { projectId: created.agreement.projectId, monthlyGross: preview.wire.monthly.gross, startMonth: body.startMonth }, requestId: c.get('requestId') });
      await generateCharges(store, organization, created.agreement, today, now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      return c.json(await chargesView(organization, created.agreement.id, today), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/retainers/{agreementId}/charges',
      tags: ['Retainers'],
      summary: 'The retainer and its charges to date',
      security: [{ apiKey: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: AgreementIdParamSchema },
      responses: { 200: { description: 'Charges', content: { 'application/json': { schema: RetainerChargesResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
      await generateCharges(store, organization, agreement, today, now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      return c.json(await chargesView(organization, agreement.id, today), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/{agreementId}/cancel',
      tags: ['Retainers'],
      summary: 'Stop a retainer from an effective date (idempotent)',
      description: 'No charges after the effective month. FULL keeps the effective month’s charge; WAIVE skips it if it has not posted yet. Posted charges are never changed (credits arrive in M4).',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'retainers.cancel')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: RetainerCancelRequestSchema } } } },
      responses: { 200: { description: 'Cancelled (or already was)', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      assertIsoDate(body.effectiveDate, 'effectiveDate');
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
      const effectiveMonth = monthOf(body.effectiveDate);
      if (agreement.startMonth && effectiveMonth < agreement.startMonth) throw validationError('END_BEFORE_START', 'effectiveDate is before the retainer started');
      if (agreement.status === 'ACTIVE') {
        await store.agreements.cancel(organization.id, agreement.id, { cancelEffectiveMonth: effectiveMonth, finalMonth: body.finalMonth }, now);
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'retainer.cancelled', entityType: 'agreement', entityId: agreement.id, metadata: { effectiveMonth, finalMonth: body.finalMonth }, requestId: c.get('requestId') });
      }
      const fresh = await mustGet(store, organization.id, agreement.id);
      return c.json({ agreement: serializeAgreement(fresh), installments: [], supplements: [] }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/reconcile',
      tags: ['Retainers'],
      summary: 'Generate any missing charges and post any due installments up to today (idempotent)',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write')] as const,
      responses: { 200: { description: 'What was posted', content: { 'application/json': { schema: ReconcileResponseSchema } } }, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const now = c.get('now')();
      const summary = await postDueItems(store, organization, todayFor(organization, now), now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      return c.json(summary, 200);
    },
  );

  async function chargesView(organization: Organization, agreementId: string, today: string) {
    const agreement = await mustGet(store, organization.id, agreementId);
    const charges = await store.agreements.listCharges(organization.id, agreementId);
    const views = [];
    for (const ch of charges) views.push(serializeCharge(ch, await store.receivables.getById(organization.id, ch.receivableId), agreement.currency, today));
    return { agreement: serializeAgreement(agreement), charges: views };
  }

  return app;
}

/** The first service month not yet chargeable today (null when ended). */
function nextChargeMonth(body: PreviewBody, chargedNow: string[], today: string): string | null {
  const last = chargedNow[chargedNow.length - 1];
  const candidate = last ? addMonths(last, 1) : body.startMonth;
  if (body.endMonth && candidate > body.endMonth) return null;
  if (!last && chargeDate(candidate, body.billingDay) <= today) return null;
  return candidate;
}
