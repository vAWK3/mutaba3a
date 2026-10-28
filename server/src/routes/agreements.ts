import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, lazyPostingOf, postingActorOf, requireScope, type AppEnv } from '../auth/middleware.js';
import {
  assertIsoDate,
  installmentDueDate,
  installmentView,
  parseAmount,
  postingDateFor,
  todayFor,
  validationError,
} from '../agreements/compose.js';
import { agreementDetail, composePreview, createAgreementFromPreview, paidMap } from '../agreements/create.js';
import { postDueItems } from '../agreements/posting.js';
import { assertReducible, composeReduction, reductionView, reductionWrite } from '../agreements/reduce-compose.js';
import { planSupplement } from '../agreements/supplement.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { previewToken, verifyPreviewToken } from '../preview-token.js';
import type { AgreementRecord, CreateInstallmentInput, LedgerStore, Organization } from '../repositories/ports.js';
import {
  AgreementCreateRequestSchema,
  AgreementDetailSchema,
  AgreementIdParamSchema,
  AgreementPageSchema,
  AgreementPreviewRequestSchema,
  AgreementPreviewResponseSchema,
  CancelAgreementRequestSchema,
  ListAgreementsQuerySchema,
  ReducePreviewRequestSchema,
  ReducePreviewResponseSchema,
  ReduceRequestSchema,
  ReduceResponseSchema,
  SupplementRequestSchema,
  SupplementResponseSchema,
} from '../schemas.js';
import { serializeAgreement, serializeCredit, serializeInstallment, serializeSupplement } from '../serializers.js';
import { computeVat } from '../vat.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });

/** /v1/agreements — fixed-fee and contingency agreements, installments, supplements, cancel (M3 brief §2.3, MUT-100); contingency terms and outcomes are in contingency.ts. */
export function agreementRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  // ---- preview ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/preview',
      tags: ['Agreements'],
      summary: 'Preview a fixed-fee or contingency agreement: totals, installments, due dates, preview token',
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
      summary: 'Create a fixed-fee or contingency agreement from a preview',
      description: 'Same body as the preview plus its previewToken. IMMEDIATE installments and DATE installments whose date has arrived are posted as receivables at once.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(AgreementCreateRequestSchema) },
      responses: { 201: { description: 'Created', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const preview = await composePreview(store, organization, body, today);
      if (!verifyPreviewToken(token, [organization.id, 'agreement', body, preview.vatRateBasisPoints])) {
        throw new ApiError('CONFLICT', 'previewToken does not match this body and the VAT rate in force; preview again', { reason: 'PREVIEW_STALE' });
      }
      const created = await createAgreementFromPreview(store, organization, postingActorOf(c), body, preview, today, now);
      return c.json(await agreementDetail(store, organization, created.agreement, today), 201);
    },
  );

  // ---- list / get ----
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/agreements',
      tags: ['Agreements'],
      summary: 'List agreements (fixed and recurring)',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { query: ListAgreementsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: AgreementPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const now = c.get('now')();
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, todayFor(organization, now), now, posting.actor);
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
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema },
      responses: { 200: { description: 'The agreement', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, today, now, posting.actor);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      return c.json(await agreementDetail(store, organization, agreement, today), 200);
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
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'FIXED') throw validationError('NOT_FIXED', agreement.type === 'CONTINGENCY' ? 'Supplements apply to fixed-fee agreements; reduce a contingency upfront with a credit, and bill extra work as a separate fixed agreement' : 'Supplements apply to fixed-fee agreements; cancel and recreate a retainer instead');
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
      // A new IMMEDIATE installment posts now, exactly as it would on an agreement's creation (found by the e2e run: it used to stay PENDING forever).
      for (const i of result.record.installments) {
        if (!createdIds.includes(i.id) || i.triggerType !== 'IMMEDIATE') continue;
        const postingDate = postingDateFor(i, result.record.agreement.agreementDate, today);
        const posted = await store.agreements.postInstallment(organization.id, i.id, { postingDate, dueDate: installmentDueDate(i, result.record.agreement, postingDate), at: now });
        if (posted?.created) await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'installment.posted', entityType: 'installment', entityId: i.id, metadata: { agreementId: agreement.id, receivableId: posted.receivable.id, trigger: 'IMMEDIATE', supplementId: result.record.supplement.id }, requestId: c.get('requestId') });
      }
      const afterPosting = createdIds.length > 0 ? await store.agreements.listInstallments(organization.id, agreement.id) : result.record.installments;
      const paidByReceivable = await paidMap(store, organization.id, afterPosting);
      return c.json(
        {
          agreement: serializeAgreement(result.record.agreement),
          supplement: serializeSupplement(result.record.supplement, agreement.currency),
          installments: afterPosting.map((i) => serializeInstallment({ installment: i, currency: agreement.currency, ...installmentView(i, result.record.agreement, today, paidByReceivable.get(i.receivableId ?? '')) })),
          effect: { contractualDelta: body.amount, installmentsChanged: plan.changes.map((x) => x.id), installmentsCreated: createdIds },
        },
        200,
      );
    },
  );

  // ---- MUT-480: lower the fee ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/reduce/preview',
      tags: ['Agreements'],
      summary: 'Preview lowering a fixed fee: unbilled installments first, then credits',
      description:
        'Give `by` (the gross to take off) or `to` (the new effective total = live installments’ gross − credits on their receivables). Due installments are billed first, as on any read. The plan voids unbilled installments latest first and lowers at most one partly; anything beyond the unbilled amount is credited on this agreement’s open receivables, latest posting first. On a VAT-exclusive agreement a gross that can’t be hit exactly is reported in `roundedBy` (applied = requested − roundedBy). 422 NOT_FIXED (retainers, contingency), AMOUNT_INVALID, REDUCTION_EXCEEDS_OPEN {unbilled, outstanding, maximum}, USE_CANCEL (nothing billed and the whole fee); 409 AGREEMENT_CANCELLED. The token covers the amount and the ledger (agreement, installment and receivable versions), not the reason.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema, body: jsonBody(ReducePreviewRequestSchema) },
      responses: { 200: { description: 'The plan', content: { 'application/json': { schema: ReducePreviewResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = keyAuth(c);
      const body = c.req.valid('json');
      const agreement = await reducibleAfterPosting(c, organization, c.req.valid('param').agreementId, c.get('now')());
      const composed = await composeReduction(store, organization.id, agreement, body);
      return c.json(reductionView(composed, agreement.currency as Currency, previewToken(composed.tokenParts)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/reduce',
      tags: ['Agreements'],
      summary: 'Lower a fixed fee in one atomic write',
      description:
        'The previewed plan, written at once: installments lowered or voided, credits on the open receivables (reasonCode on each), the totals, and a REDUCTION supplement row. reasonCode is required; OTHER needs a note (422 REASON_REQUIRED). Anything that moved since the preview (a payment, a credit, a posting, another change) is 409 PREVIEW_STALE with nothing written. Its credits sit under agreements:write, like the contingency correction’s. Audits agreement.reduced and one receivable.credited (source REDUCTION) per credit.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.reduce')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ReduceRequestSchema) },
      responses: { 200: { description: 'Lowered', content: { 'application/json': { schema: ReduceResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const requestId = c.get('requestId');
      const agreement = await reducibleAfterPosting(c, organization, c.req.valid('param').agreementId, now);
      const note = body.note?.trim() || null;
      if (body.reasonCode === 'OTHER' && !note) throw validationError('REASON_REQUIRED', 'Say why in a note when the reason is OTHER', { field: 'note' });
      const composed = await composeReduction(store, organization.id, agreement, body);
      if (!verifyPreviewToken(body.previewToken, composed.tokenParts)) throw staleReduction();
      const result = await store.agreements.reduce(organization.id, agreement.id, reductionWrite(composed, agreement, { reasonCode: body.reasonCode, note }, today, requestId), now);
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'stale') throw staleReduction();

      const currency = agreement.currency as Currency;
      const money = (minor: bigint) => formatMoney({ minor, currency });
      const actor = { organizationId: organization.id, actorType: 'API_KEY' as const, actorId: apiKey.id, requestId };
      for (const credit of result.record.credits) {
        const receivable = await store.receivables.getById(organization.id, credit.receivableId);
        await store.audit.append({ ...actor, action: 'receivable.credited', entityType: 'receivable', entityId: credit.receivableId, metadata: { creditId: credit.id, amount: money(credit.amountMinor), reason: credit.reason, reasonCode: body.reasonCode, source: 'REDUCTION', agreementId: agreement.id, settled: receivable?.status === 'SETTLED' } });
      }
      const view = reductionView(composed, currency, body.previewToken);
      await store.audit.append({
        ...actor,
        action: 'agreement.reduced',
        entityType: 'agreement',
        entityId: agreement.id,
        metadata: { supplementId: result.record.supplement.id, reasonCode: body.reasonCode, note, requested: view.requested, applied: view.applied, roundedBy: view.roundedBy, voided: composed.plan.voids.length, lowered: composed.plan.changes.length, credits: result.record.credits.length, before: { effectiveTotal: view.effectiveTotal.before, outstanding: view.outstanding.before }, after: { effectiveTotal: view.effectiveTotal.after, outstanding: view.outstanding.after } },
      });
      const detail = await agreementDetail(store, organization, result.record.agreement, today);
      return c.json({ ...detail, supplement: serializeSupplement(result.record.supplement, agreement.currency), credits: result.record.credits.map((x) => serializeCredit(x, agreement.currency)) }, 200);
    },
  );

  /** R1: due items are billed before anything is planned (as `GET /v1/agreements/{id}` does), so "unbilled" is what it says. */
  async function reducibleAfterPosting(c: Parameters<typeof lazyPostingOf>[0], organization: Organization, agreementId: string, now: Date): Promise<AgreementRecord> {
    assertReducible(await mustGet(store, organization.id, agreementId));
    const posting = lazyPostingOf(c, store);
    await postDueItems(posting.store, organization, todayFor(organization, now), now, posting.actor);
    return mustGet(store, organization.id, agreementId);
  }

  // ---- cancel ----
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/agreements/{agreementId}/cancel',
      tags: ['Agreements'],
      summary: 'Cancel a fixed-fee or contingency agreement while nothing is posted',
      description: 'Idempotent. Refused with 409 AGREEMENT_HAS_POSTED_RECEIVABLES once any installment has posted, and for a contingency agreement with 409 OUTCOME_ALREADY_RECORDED once its outcome is recorded. Retainers cancel through POST /v1/retainers/{id}/cancel.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'agreements.cancel')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: false, content: { 'application/json': { schema: CancelAgreementRequestSchema } } } },
      responses: { 200: { description: 'Cancelled (or already was)', content: { 'application/json': { schema: AgreementDetailSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type === 'RECURRING') throw validationError('NOT_FIXED', 'Use POST /v1/retainers/{id}/cancel for a retainer');
      if (agreement.status === 'ACTIVE') {
        if (agreement.outcome !== null) throw new ApiError('CONFLICT', 'The outcome is recorded; correct it instead of cancelling', { reason: 'OUTCOME_ALREADY_RECORDED' });
        const installments = await store.agreements.listInstallments(organization.id, agreement.id);
        if (installments.some((i) => i.receivableId)) throw new ApiError('CONFLICT', 'Installments have been posted; cancellation needs adjustments (M4)', { reason: 'AGREEMENT_HAS_POSTED_RECEIVABLES' });
        const cancelled = await store.agreements.cancel(organization.id, agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, now);
        // The store refuses once a contingency outcome exists, even one recorded after the read above.
        if (cancelled?.status === 'ACTIVE') throw new ApiError('CONFLICT', 'The outcome is recorded; correct it instead of cancelling', { reason: 'OUTCOME_ALREADY_RECORDED' });
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'agreement.cancelled', entityType: 'agreement', entityId: agreement.id, requestId: c.get('requestId') });
      }
      const fresh = await mustGet(store, organization.id, agreement.id);
      return c.json(await agreementDetail(store, organization, fresh, today), 200);
    },
  );

  return app;
}

export async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<AgreementRecord> {
  const agreement = await store.agreements.getById(organizationId, id);
  if (!agreement) throw new ApiError('NOT_FOUND', 'No such agreement');
  return agreement;
}

function staleReduction(): ApiError {
  return new ApiError('CONFLICT', 'previewToken does not match the amount and the ledger as it stands; preview again', { reason: 'PREVIEW_STALE' });
}
