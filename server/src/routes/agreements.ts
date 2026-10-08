import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import {
  agreementPreviewToken,
  assertIsoDate,
  assertNotAbsurdDate,
  installmentDueDate,
  installmentView,
  loadAgreementContext,
  parseAmount,
  postingDateFor,
  resolveRate,
  scheduleOrThrow,
  toInstallmentSpecs,
  todayFor,
  validationError,
} from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { planSupplement } from '../agreements/supplement.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney } from '../money.js';
import { verifyPreviewToken } from '../preview-token.js';
import type { AgreementRecord, CreateInstallmentInput, InstallmentRecord, LedgerStore, Organization } from '../repositories/ports.js';
import {
  AgreementCreateRequestSchema,
  AgreementDetailSchema,
  AgreementIdParamSchema,
  AgreementPageSchema,
  AgreementPreviewRequestSchema,
  AgreementPreviewResponseSchema,
  CancelAgreementRequestSchema,
  ListAgreementsQuerySchema,
  SupplementRequestSchema,
  SupplementResponseSchema,
} from '../schemas.js';
import { serializeAgreement, serializeInstallment, serializeSupplement } from '../serializers.js';
import { computeVat } from '../vat.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

/** /v1/agreements — fixed-fee agreements, installments, supplements, cancel (M3 brief §2.3). */
export function agreementRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  const actor = (c: { get: (k: 'auth') => { apiKey: { id: string } } } & { get(k: 'requestId'): string }) => ({ actorType: 'API_KEY' as const, actorId: c.get('auth').apiKey.id, requestId: c.get('requestId') });

  async function detail(organization: Organization, agreement: AgreementRecord, today: string) {
    const [installments, supplements] = await Promise.all([store.agreements.listInstallments(organization.id, agreement.id), store.agreements.listSupplements(organization.id, agreement.id)]);
    const paidByReceivable = await paidMap(organization.id, installments);
    return {
      agreement: serializeAgreement(agreement),
      installments: installments.map((i) => serializeInstallment({ installment: i, currency: agreement.currency, ...installmentView(i, agreement, today, paidByReceivable.get(i.receivableId ?? '') ?? 0n) })),
      supplements: supplements.map((s) => serializeSupplement(s, agreement.currency)),
    };
  }

  async function paidMap(organizationId: string, installments: InstallmentRecord[]): Promise<Map<string, bigint>> {
    const map = new Map<string, bigint>();
    for (const i of installments) {
      if (!i.receivableId) continue;
      const r = await store.receivables.getById(organizationId, i.receivableId);
      if (r) map.set(r.id, r.paidMinor);
    }
    return map;
  }

  // ---- preview ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/preview',
      tags: ['Agreements'],
      summary: 'Preview a fixed-fee agreement: totals, installments, due dates, preview token',
      description: 'Writes nothing. The token covers the body and the VAT rate in force on agreementDate, so a rate change before create is refused with 409 PREVIEW_STALE.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { body: jsonBody(AgreementPreviewRequestSchema) },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: AgreementPreviewResponseSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const body = c.req.valid('json');
      const today = todayFor(organization, c.get('now')());
      const preview = await composePreview(store, organization, body, today);
      return c.json(preview.wire, 200);
    },
  );

  // ---- create ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements',
      tags: ['Agreements'],
      summary: 'Create a fixed-fee agreement from a preview',
      description: 'Same body as the preview plus its previewToken. IMMEDIATE installments and DATE installments whose date has arrived are posted as receivables at once.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(AgreementCreateRequestSchema) },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const preview = await composePreview(store, organization, body, today);
      if (!verifyPreviewToken(token, [organization.id, 'agreement', body, preview.vatRateBasisPoints])) {
        throw new ApiError('CONFLICT', 'previewToken does not match this body and the VAT rate in force; preview again', { reason: 'PREVIEW_STALE' });
      }
      const installments: CreateInstallmentInput[] = preview.scheduled.map((i) => ({
        position: i.position,
        label: i.label,
        amountMinor: i.amountMinor,
        netMinor: i.netMinor,
        vatMinor: i.vatMinor,
        grossMinor: i.grossMinor,
        vatTreatment: i.vatTreatment,
        rateBasisPoints: i.rateBasisPoints,
        triggerType: i.trigger.type,
        triggerDate: i.trigger.date ?? null,
        paymentTerms: i.paymentTerms ?? null,
        dueDateOverride: i.dueDate ?? null,
      }));
      const created = await store.agreements.create(
        {
          organizationId: organization.id,
          projectId: preview.context.project.id,
          customerId: preview.context.customer.id,
          type: 'FIXED',
          currency: preview.context.currency,
          pricingBasis: body.pricingBasis,
          vatTreatment: preview.context.defaultTreatment,
          vatRateBasisPoints: preview.vatRateBasisPoints,
          amountMinor: preview.totals.amountMinor,
          netMinor: preview.totals.netMinor,
          vatMinor: preview.totals.vatMinor,
          grossMinor: preview.totals.grossMinor,
          agreementDate: body.agreementDate,
          description: body.description ?? null,
          paymentTerms: body.paymentTerms,
          startMonth: null,
          billingDay: null,
          endMonth: null,
          installments,
        },
        now,
      );
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'agreement.created', entityType: 'agreement', entityId: created.agreement.id, metadata: { projectId: created.agreement.projectId, gross: formatMoney({ minor: created.agreement.grossMinor, currency: preview.context.currency }), installments: installments.length }, requestId: c.get('requestId') });

      // IMMEDIATE installments post now; DATE ones whose date has arrived post through the same lazy path.
      for (const i of created.installments) {
        if (i.triggerType !== 'IMMEDIATE') continue;
        const postingDate = postingDateFor(i, created.agreement.agreementDate, today);
        const posted = await store.agreements.postInstallment(organization.id, i.id, { postingDate, dueDate: installmentDueDate(i, created.agreement, postingDate), at: now });
        if (posted?.created) await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'installment.posted', entityType: 'installment', entityId: i.id, metadata: { agreementId: created.agreement.id, receivableId: posted.receivable.id, trigger: 'IMMEDIATE' }, requestId: c.get('requestId') });
      }
      await postDueItems(store, organization, today, now, actor(c));
      const fresh = await store.agreements.getById(organization.id, created.agreement.id);
      return c.json(await detail(organization, fresh ?? created.agreement, today), 201);
    },
  );

  // ---- list / get ----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agreements',
      tags: ['Agreements'],
      summary: 'List agreements (fixed and recurring)',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { query: ListAgreementsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: AgreementPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const now = c.get('now')();
      await postDueItems(store, organization, todayFor(organization, now), now, actor(c));
      const page = await store.agreements.list(organization.id, { ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}) }, toPageRequest(q));
      return c.json({ items: page.items.map(serializeAgreement), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agreements/{agreementId}',
      tags: ['Agreements'],
      summary: 'Get an agreement with its installments and supplements',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema },
      responses: { 200: { description: 'The agreement', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      await postDueItems(store, organization, today, now, actor(c));
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      return c.json(await detail(organization, agreement, today), 200);
    },
  );

  // ---- supplements ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/supplements',
      tags: ['Agreements'],
      summary: 'Change the contractual amount (positive or negative) on a fixed-fee agreement',
      description: 'Uses the agreement’s frozen VAT rate. Positive: added to the last unposted installment, prorated across unposted ones, or a new installment. Negative: only within the unposted capacity; otherwise 422 SUPPLEMENT_EXCEEDS_UNPOSTED names the posted receivables (adjustments against them arrive with payments in M4).',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.supplement')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(SupplementRequestSchema) },
      responses: { 200: { description: 'Applied', content: { 'application/json': { schema: SupplementResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'FIXED') throw validationError('NOT_FIXED', 'Supplements apply to fixed-fee agreements; cancel and recreate a retainer instead');
      if (agreement.status === 'CANCELLED') throw new ApiError('CONFLICT', 'The agreement is cancelled', { reason: 'AGREEMENT_CANCELLED' });
      assertIsoDate(body.effectiveDate, 'effectiveDate');
      const deltaMinor = parseAmount(body.amount, agreement.currency as 'ILS' | 'USD' | 'EUR');
      if (deltaMinor === 0n) throw validationError('AMOUNT_INVALID', 'amount must not be zero', { field: 'amount' });

      const installments = await store.agreements.listInstallments(organization.id, agreement.id);
      const live = installments.filter((i) => !i.voidedAt);
      const plan = planSupplement({
        deltaMinor,
        distribution: body.distribution,
        pricingBasis: agreement.pricingBasis,
        rateBasisPoints: agreement.vatRateBasisPoints,
        unposted: live.filter((i) => !i.receivableId),
        posted: live.filter((i) => i.receivableId),
        hasNewInstallment: body.newInstallment !== undefined,
      });
      if (!plan.ok) {
        if (plan.reason === 'SUPPLEMENT_EXCEEDS_UNPOSTED') {
          throw validationError(plan.reason, 'The reduction exceeds what is still unposted; posted receivables need an adjustment (M4)', {
            requiresAdjustment: { capacity: formatMoney({ minor: plan.capacityMinor, currency: agreement.currency as 'ILS' }), shortfall: formatMoney({ minor: plan.shortfallMinor, currency: agreement.currency as 'ILS' }), postedReceivables: plan.postedReceivables.map((p) => ({ installmentId: p.installmentId, receivableId: p.receivableId, amount: formatMoney({ minor: p.amountMinor, currency: agreement.currency as 'ILS' }) })) },
          });
        }
        throw validationError(plan.reason, plan.reason === 'NEW_INSTALLMENT_REQUIRED' ? 'Nothing is unposted; provide newInstallment' : 'A new installment must carry a positive amount');
      }

      const newInstallments: CreateInstallmentInput[] = [];
      if (plan.newInstallmentAmountMinor !== null && body.newInstallment) {
        const spec = body.newInstallment;
        if (spec.trigger.type === 'DATE' && !spec.trigger.date) throw validationError('TRIGGER_DATE_REQUIRED', 'newInstallment.trigger.date is required for a DATE trigger');
        const treatment = spec.vatTreatment ?? agreement.vatTreatment;
        const vat = computeVat({ amountMinor: plan.newInstallmentAmountMinor, pricingBasis: agreement.pricingBasis, treatment, rateBasisPoints: agreement.vatRateBasisPoints });
        newInstallments.push({
          position: Math.max(0, ...installments.map((i) => i.position)) + 1,
          label: spec.label,
          amountMinor: plan.newInstallmentAmountMinor,
          netMinor: vat.netMinor,
          vatMinor: vat.vatMinor,
          grossMinor: vat.grossMinor,
          vatTreatment: treatment,
          rateBasisPoints: vat.rateBasisPoints,
          triggerType: spec.trigger.type,
          triggerDate: spec.trigger.date ?? null,
          paymentTerms: spec.paymentTerms ?? null,
          dueDateOverride: spec.dueDate ?? null,
        });
      }

      // Totals = untouched + changed + new.
      const changedIds = new Set(plan.changes.map((x) => x.id));
      const totals = { amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n };
      for (const i of live) {
        const src = changedIds.has(i.id) ? plan.changes.find((x) => x.id === i.id)! : i;
        totals.amountMinor += src.amountMinor;
        totals.netMinor += src.netMinor;
        totals.vatMinor += src.vatMinor;
        totals.grossMinor += src.grossMinor;
      }
      for (const n of newInstallments) {
        totals.amountMinor += n.amountMinor;
        totals.netMinor += n.netMinor;
        totals.vatMinor += n.vatMinor;
        totals.grossMinor += n.grossMinor;
      }

      const result = await store.agreements.applySupplement(organization.id, agreement.id, { supplement: { amountMinor: deltaMinor, description: body.description ?? null, effectiveDate: body.effectiveDate, distribution: body.distribution, requestId: c.get('requestId') }, installmentUpdates: plan.changes, newInstallments, totals, expectedVersion: agreement.version }, now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'stale') throw new ApiError('CONFLICT', 'The agreement changed concurrently; retry', { reason: 'VERSION_MISMATCH', currentVersion: result.record.agreement.version });

      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'agreement.supplemented', entityType: 'agreement', entityId: agreement.id, metadata: { supplementId: result.record.supplement.id, amount: body.amount, distribution: body.distribution }, requestId: c.get('requestId') });
      const createdIds = result.record.installments.filter((i) => !installments.some((x) => x.id === i.id)).map((i) => i.id);
      const paidByReceivable = await paidMap(organization.id, result.record.installments);
      return c.json(
        {
          agreement: serializeAgreement(result.record.agreement),
          supplement: serializeSupplement(result.record.supplement, agreement.currency),
          installments: result.record.installments.map((i) => serializeInstallment({ installment: i, currency: agreement.currency, ...installmentView(i, result.record.agreement, today, paidByReceivable.get(i.receivableId ?? '') ?? 0n) })),
          effect: { contractualDelta: body.amount, installmentsChanged: plan.changes.map((x) => x.id), installmentsCreated: createdIds },
        },
        200,
      );
    },
  );

  // ---- cancel ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/cancel',
      tags: ['Agreements'],
      summary: 'Cancel a fixed-fee agreement while nothing is posted',
      description: 'Idempotent. Refused with 409 AGREEMENT_HAS_POSTED_RECEIVABLES once any installment has posted. Retainers cancel through POST /v1/retainers/{id}/cancel.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.cancel')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: false, content: { 'application/json': { schema: CancelAgreementRequestSchema } } } },
      responses: { 200: { description: 'Cancelled (or already was)', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'FIXED') throw validationError('NOT_FIXED', 'Use POST /v1/retainers/{id}/cancel for a retainer');
      if (agreement.status === 'ACTIVE') {
        const installments = await store.agreements.listInstallments(organization.id, agreement.id);
        if (installments.some((i) => i.receivableId)) throw new ApiError('CONFLICT', 'Installments have been posted; cancellation needs adjustments (M4)', { reason: 'AGREEMENT_HAS_POSTED_RECEIVABLES' });
        await store.agreements.cancel(organization.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, now);
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'agreement.cancelled', entityType: 'agreement', entityId: agreement.id, requestId: c.get('requestId') });
      }
      const fresh = await mustGet(store, organization.id, agreement.id);
      return c.json(await detail(organization, fresh, today), 200);
    },
  );

  return app;
}

export async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<AgreementRecord> {
  const agreement = await store.agreements.getById(organizationId, id);
  if (!agreement) throw new ApiError('NOT_FOUND', 'No such agreement');
  return agreement;
}

type PreviewBody = {
  projectId: string;
  amount: string;
  currency?: string | undefined;
  pricingBasis: 'VAT_EXCLUSIVE' | 'VAT_INCLUSIVE';
  vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined;
  agreementDate: string;
  description?: string | undefined;
  paymentTerms: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60';
  installments: ReadonlyArray<{ label: string; amount?: string | undefined; percentBasisPoints?: number | undefined; vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined; trigger: { type: 'IMMEDIATE' | 'DATE' | 'MANUAL'; date?: string | undefined }; paymentTerms?: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60' | undefined; dueDate?: string | undefined }>;
};

async function composePreview(store: LedgerStore, organization: Organization, body: PreviewBody, today: string) {
  assertIsoDate(body.agreementDate, 'agreementDate');
  assertNotAbsurdDate(body.agreementDate, today, 'agreementDate');
  const context = await loadAgreementContext(store, organization, { projectId: body.projectId, currency: body.currency, vatTreatment: body.vatTreatment, agreementDate: body.agreementDate });
  const rateBasisPoints = await resolveRate(store, organization.id, body.agreementDate, context.defaultTreatment, body.installments.map((i) => i.vatTreatment));
  const amountMinor = parseAmount(body.amount, context.currency);
  if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
  const specs = toInstallmentSpecs(body.installments, context.currency);
  const { items, totals } = scheduleOrThrow({ amountMinor, pricingBasis: body.pricingBasis, defaultTreatment: context.defaultTreatment, rateBasisPoints, installments: specs });
  const draft = { paymentTerms: body.paymentTerms, agreementDate: body.agreementDate };
  const installments = items.map((i) => {
    const asRecord = { triggerType: i.trigger.type, triggerDate: i.trigger.date ?? null, dueDateOverride: i.dueDate ?? null, paymentTerms: i.paymentTerms ?? null };
    const postingDate = postingDateFor(asRecord, body.agreementDate, today);
    const dueDate = installmentDueDate(asRecord, draft, postingDate);
    return {
      position: i.position,
      label: i.label,
      amount: formatMoney({ minor: i.amountMinor, currency: context.currency }),
      net: formatMoney({ minor: i.netMinor, currency: context.currency }),
      vat: formatMoney({ minor: i.vatMinor, currency: context.currency }),
      gross: formatMoney({ minor: i.grossMinor, currency: context.currency }),
      vatTreatment: i.vatTreatment,
      rateBasisPoints: i.rateBasisPoints,
      trigger: { type: i.trigger.type, ...(i.trigger.date ? { date: i.trigger.date } : {}) },
      paymentTerms: i.paymentTerms ?? null,
      dueDate,
      status: 'PENDING' as const,
    };
  });
  const fmt = (minor: bigint) => formatMoney({ minor, currency: context.currency });
  return {
    context,
    scheduled: items,
    totals,
    vatRateBasisPoints: rateBasisPoints,
    wire: {
      totals: { amount: fmt(totals.amountMinor), net: fmt(totals.netMinor), vat: fmt(totals.vatMinor), gross: fmt(totals.grossMinor) },
      vatRateBasisPoints: rateBasisPoints,
      vatTreatment: context.defaultTreatment,
      currency: context.currency,
      installments,
      previewToken: agreementPreviewToken(organization.id, body, rateBasisPoints),
    },
  };
}
