import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, lazyPostingOf, requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, loadAgreementContext, parseAmount, retainerPreviewToken, todayFor, validationError } from '../agreements/compose.js';
import { generateCharges, postDueItems } from '../agreements/posting.js';
import { addMonths, dueDateFor, monthOf } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { previewToken, verifyPreviewToken } from '../preview-token.js';
import type { AgreementRecord, LedgerStore, Organization, ReceivableRecord, RetainerChargeRecord } from '../repositories/ports.js';
import { cancelOutcome, type FinalMonthOption } from '../retainers/proration.js';
import { chargeDate, chargeMonths, validateRetainerSpec } from '../retainers/schedule.js';
import { applyChange, chargesKept, latestTerms, termsFor, termsTimeline, validateChange, type RetainerTerms, type TermsChange } from '../retainers/terms.js';
import {
  AgreementIdParamSchema,
  ReconcileResponseSchema,
  RetainerCancelApplyRequestSchema,
  RetainerCancelPreviewResponseSchema,
  RetainerCancelRequestSchema,
  RetainerChangeApplyRequestSchema,
  RetainerChangePreviewResponseSchema,
  RetainerChangeRequestSchema,
  RetainerChargesResponseSchema,
  RetainerCreateRequestSchema,
  RetainerPreviewRequestSchema,
  RetainerPreviewResponseSchema,
} from '../schemas.js';
import { serializeAgreement, serializeCharge, serializeRetainerTerms } from '../serializers.js';
import { computeVat, type PricingBasis, type VatTreatment } from '../vat.js';
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

type ChangeBody = {
  effectiveMonth: string;
  monthlyAmount?: string | undefined;
  pricingBasis?: PricingBasis | undefined;
  vatTreatment?: VatTreatment | undefined;
  billingDay?: number | undefined;
  paymentTerms?: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60' | undefined;
  endMonth?: string | null | undefined;
  reason: string;
};

/** /v1/retainers — recurring agreements (M3 brief rev. 2 §C; M5: versions, proration, cancel preview). */
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
      const { organization, apiKey } = keyAuth(c);
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
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('payments:read')] as const,
      request: { params: AgreementIdParamSchema },
      responses: { 200: { description: 'Charges', content: { 'application/json': { schema: RetainerChargesResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
      const posting = lazyPostingOf(c, store);
      await generateCharges(posting.store, organization, agreement, today, now, posting.actor);
      return c.json(await chargesView(organization, agreement.id, today), 200);
    },
  );

  // ---- M5: changes (effective-dated versions) ----
  async function composeChange(organization: Organization, agreementId: string, body: ChangeBody, today: string) {
    const agreement = await mustGet(store, organization.id, agreementId);
    if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
    if (agreement.status === 'CANCELLED') throw new ApiError('CONFLICT', 'The retainer is cancelled', { reason: 'AGREEMENT_CANCELLED' });
    const timeline = termsTimeline(agreement, await store.agreements.listVersions(organization.id, agreement.id));
    const previous = latestTerms(timeline);
    const currency = agreement.currency as Currency;
    const change: TermsChange = {
      effectiveMonth: body.effectiveMonth,
      monthlyAmountMinor: body.monthlyAmount === undefined ? undefined : parseAmount(body.monthlyAmount, currency, 'monthlyAmount'),
      pricingBasis: body.pricingBasis,
      vatTreatment: body.vatTreatment,
      billingDay: body.billingDay,
      paymentTerms: body.paymentTerms,
      endMonth: body.endMonth,
    };
    const check = validateChange(timeline, agreement, change);
    if (!check.ok) throw validationError(check.reason, check.detail ?? `Retainer change is invalid: ${check.reason}`, { latestEffectiveMonth: previous.effectiveMonth });
    const merged = applyChange(previous, change);
    // A changed fee is a new commitment, priced at the VAT rate in force when it starts (decision 2).
    const rate = merged.vatTreatment === 'STANDARD_RATED' ? await store.vatRates.effectiveOn(organization.id, `${merged.effectiveMonth}-01`) : null;
    if (merged.vatTreatment === 'STANDARD_RATED' && !rate) throw validationError('VAT_RATE_MISSING', `No VAT rate is in force on ${merged.effectiveMonth}-01; set one with PUT /v1/settings/vat`, { date: `${merged.effectiveMonth}-01` });
    const rateBasisPoints = rate?.rateBasisPoints ?? 0;
    const vat = computeVat({ amountMinor: merged.monthlyAmountMinor, pricingBasis: merged.pricingBasis, treatment: merged.vatTreatment, rateBasisPoints });
    const next: RetainerTerms = { ...merged, version: previous.version + 1, netMinor: vat.netMinor, vatMinor: vat.vatMinor, grossMinor: vat.grossMinor, rateBasisPoints: vat.rateBasisPoints, reason: body.reason };
    const generated = (await store.agreements.listCharges(organization.id, agreement.id)).map((c) => c.serviceMonth);
    const kept = chargesKept(generated, merged.effectiveMonth);
    const firstChargedMonth = firstUnchargedFrom(merged.effectiveMonth, generated, next.endMonth, agreement.cancelEffectiveMonth);
    const token = previewToken([organization.id, 'retainer-change', agreement.id, body, agreement.version, previous.effectiveMonth, rateBasisPoints]);
    void today;
    return {
      agreement,
      previous,
      next,
      changed: check.changed,
      wire: { previous: serializeRetainerTerms(previous, currency), next: serializeRetainerTerms(next, currency), effectiveMonth: merged.effectiveMonth, changed: check.changed, firstChargedMonth, chargesKept: kept, previewToken: token },
    };
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/{agreementId}/changes/preview',
      tags: ['Retainers'],
      summary: 'Preview an effective-dated change of a retainer’s terms',
      description: 'The new terms are priced at the VAT rate in force on the first day of the effective month. Charges already generated keep their terms; the first uncharged month from the effective month picks up the new ones. The change must be after the latest version’s effective month and must change something (422 CHANGE_EFFECTIVE_INVALID, CHANGE_NOTHING_CHANGED).',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema, body: { required: true, content: { 'application/json': { schema: RetainerChangeRequestSchema } } } },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: RetainerChangePreviewResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const preview = await composeChange(organization, c.req.valid('param').agreementId, c.req.valid('json'), todayFor(organization, c.get('now')()));
      return c.json(preview.wire, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/{agreementId}/changes',
      tags: ['Retainers'],
      summary: 'Apply a change of terms from its preview (idempotent)',
      description: 'Appends a new version; the agreement row and every generated charge are untouched. 409 PREVIEW_STALE when the retainer, its versions or the VAT rate changed since the preview.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'retainers.change')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: RetainerChangeApplyRequestSchema } } } },
      responses: { 201: { description: 'Changed', content: { 'application/json': { schema: RetainerChargesResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const preview = await composeChange(organization, c.req.valid('param').agreementId, body, today);
      if (!verifyPreviewToken(token, [organization.id, 'retainer-change', preview.agreement.id, body, preview.agreement.version, preview.previous.effectiveMonth, preview.next.rateBasisPoints])) {
        throw new ApiError('CONFLICT', 'previewToken does not match this change and the retainer’s current state; preview again', { reason: 'PREVIEW_STALE' });
      }
      const result = await store.agreements.appendVersion(
        {
          organizationId: organization.id,
          agreementId: preview.agreement.id,
          version: preview.next.version,
          effectiveMonth: preview.next.effectiveMonth,
          monthlyAmountMinor: preview.next.monthlyAmountMinor,
          netMinor: preview.next.netMinor,
          vatMinor: preview.next.vatMinor,
          grossMinor: preview.next.grossMinor,
          pricingBasis: preview.next.pricingBasis,
          vatTreatment: preview.next.vatTreatment,
          rateBasisPoints: preview.next.rateBasisPoints,
          billingDay: preview.next.billingDay,
          paymentTerms: preview.next.paymentTerms,
          endMonth: preview.next.endMonth,
          reason: body.reason,
          requestId: c.get('requestId'),
          expectedAgreementVersion: preview.agreement.version,
        },
        now,
      );
      if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such agreement');
      if (result.kind === 'stale') throw new ApiError('CONFLICT', 'The retainer changed while applying; preview again', { reason: 'PREVIEW_STALE' });
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'retainer.changed', entityType: 'agreement', entityId: preview.agreement.id, metadata: { version: preview.next.version, effectiveMonth: preview.next.effectiveMonth, changed: preview.changed, monthlyGross: preview.wire.next.gross, reason: body.reason }, requestId: c.get('requestId') });
      await generateCharges(store, organization, result.record.agreement, today, now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      return c.json(await chargesView(organization, preview.agreement.id, today), 201);
    },
  );

  // ---- M5: cancel preview + proration ----
  async function composeCancel(organization: Organization, agreementId: string, body: { effectiveDate: string; finalMonth: FinalMonthOption }, today: string) {
    assertIsoDate(body.effectiveDate, 'effectiveDate');
    const agreement = await mustGet(store, organization.id, agreementId);
    if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
    const effectiveMonth = monthOf(body.effectiveDate);
    if (agreement.startMonth && effectiveMonth < agreement.startMonth) throw validationError('FINAL_MONTH_INVALID', 'effectiveDate is before the retainer started', { startMonth: agreement.startMonth });
    const timeline = termsTimeline(agreement, await store.agreements.listVersions(organization.id, agreement.id));
    const terms = termsFor(timeline, effectiveMonth);
    const charges = await store.agreements.listCharges(organization.id, agreement.id);
    const charge = charges.find((ch) => ch.serviceMonth === effectiveMonth) ?? null;
    const receivable = charge ? await store.receivables.getById(organization.id, charge.receivableId) : null;
    const posted = charge && receivable ? { charge, receivable } : null;
    const outcome = cancelOutcome({ terms, effectiveDate: body.effectiveDate, finalMonth: body.finalMonth, posted });
    const currency = agreement.currency as Currency;
    const fmt = (m: bigint) => formatMoney({ minor: m, currency });
    const outstandingNow = await retainerOutstanding(organization, agreement, charges);
    const outstandingAfter = outstandingNow - (outcome.adjustment?.amountMinor ?? 0n);
    const stoppedFrom = nextStoppedMonth(agreement, timeline, effectiveMonth, body.finalMonth, charges, today);
    const token = previewToken([organization.id, 'retainer-cancel', agreement.id, body, agreement.version, posted ? [posted.receivable.id, posted.receivable.version] : null]);
    return {
      agreement,
      outcome,
      posted,
      wire: {
        effectiveMonth,
        finalMonth: body.finalMonth,
        finalCharge: outcome.finalCharge ? { serviceMonth: outcome.finalCharge.serviceMonth, days: outcome.finalCharge.days, daysInMonth: outcome.finalCharge.daysInMonth, amount: fmt(outcome.finalCharge.amountMinor), net: fmt(outcome.finalCharge.netMinor), vat: fmt(outcome.finalCharge.vatMinor), gross: fmt(outcome.finalCharge.grossMinor), posted: posted !== null } : null,
        postedCharge: posted ? { chargeId: posted.charge.id, receivableId: posted.receivable.id, gross: fmt(posted.receivable.grossMinor), paid: fmt(posted.receivable.paidMinor), credited: fmt(posted.receivable.creditedMinor), outstanding: fmt(outstandingOf(posted.receivable)) } : null,
        adjustment: outcome.adjustment ? { amount: fmt(outcome.adjustment.amountMinor), net: fmt(outcome.adjustment.netMinor), vat: fmt(outcome.adjustment.vatMinor), limitedByPayments: outcome.adjustment.limitedByPayments } : null,
        stoppedFrom,
        outstandingAfter: fmt(outstandingAfter < 0n ? 0n : outstandingAfter),
        previewToken: token,
      },
    };
  }

  async function retainerOutstanding(organization: Organization, agreement: AgreementRecord, charges: RetainerChargeRecord[]): Promise<bigint> {
    let sum = 0n;
    for (const ch of charges) {
      const r = await store.receivables.getById(organization.id, ch.receivableId);
      if (r && r.status === 'OPEN') sum += outstandingOf(r);
    }
    void agreement;
    return sum;
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/{agreementId}/cancel/preview',
      tags: ['Retainers'],
      summary: 'Preview a cancellation: the final month under FULL / PRORATE / WAIVE, the credit a posted month needs, what stops',
      description: 'PRORATE charges the final month for the days up to and including the cancellation date (calendar days, half-up). When the final month is already posted, PRORATE and WAIVE create a credit on its receivable, capped at the outstanding — what was paid is not refunded (adjustment.limitedByPayments). FULL never credits.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: AgreementIdParamSchema, body: { required: true, content: { 'application/json': { schema: RetainerCancelRequestSchema } } } },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: RetainerCancelPreviewResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.status === 'CANCELLED') throw new ApiError('CONFLICT', 'The retainer is already cancelled', { reason: 'AGREEMENT_CANCELLED' });
      const preview = await composeCancel(organization, agreement.id, c.req.valid('json'), todayFor(organization, c.get('now')()));
      return c.json(preview.wire, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/retainers/{agreementId}/cancel',
      tags: ['Retainers'],
      summary: 'Stop a retainer from an effective date (idempotent)',
      description: 'No charges after the effective month. FULL keeps the effective month’s charge; PRORATE charges or credits it down to the days used; WAIVE skips it, or credits it when already posted. A previewToken from /cancel/preview is required whenever a credit would be created (422 PREVIEW_TOKEN_REQUIRED). Already cancelled → the existing cancellation, unchanged.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'retainers.cancel')] as const,
      request: { params: AgreementIdParamSchema, headers: IdempotencyHeaderSchema, body: { required: true, content: { 'application/json': { schema: RetainerCancelApplyRequestSchema } } } },
      responses: { 200: { description: 'Cancelled (or already was): the retainer with its versions and charges, including the prorated or credited final month', content: { 'application/json': { schema: RetainerChargesResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const { previewToken: token, ...body } = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const requestId = c.get('requestId');
      const agreement = await mustGet(store, organization.id, c.req.valid('param').agreementId);
      if (agreement.type !== 'RECURRING') throw validationError('NOT_RECURRING', 'Not a retainer');
      if (agreement.status === 'ACTIVE') {
        const preview = await composeCancel(organization, agreement.id, body, today);
        if (preview.outcome.adjustment) {
          if (!token) throw validationError('PREVIEW_TOKEN_REQUIRED', 'This cancellation credits a posted charge; preview it first and send the previewToken');
          if (!verifyPreviewToken(token, [organization.id, 'retainer-cancel', agreement.id, body, agreement.version, preview.posted ? [preview.posted.receivable.id, preview.posted.receivable.version] : null])) {
            throw new ApiError('CONFLICT', 'previewToken does not match this cancellation and the retainer’s current state; preview again', { reason: 'PREVIEW_STALE' });
          }
        }
        await store.agreements.cancel(organization.id, agreement.id, { cancelEffectiveMonth: preview.outcome.effectiveMonth, cancelEffectiveDate: body.effectiveDate, finalMonth: body.finalMonth }, now);
        await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'retainer.cancelled', entityType: 'agreement', entityId: agreement.id, metadata: { effectiveMonth: preview.outcome.effectiveMonth, effectiveDate: body.effectiveDate, finalMonth: body.finalMonth, ...(preview.wire.adjustment ? { credit: preview.wire.adjustment.amount } : {}) }, requestId });
        if (preview.outcome.adjustment && preview.posted) {
          const credit = await store.receivables.credit(organization.id, preview.posted.receivable.id, { amountMinor: preview.outcome.adjustment.amountMinor, netMinor: preview.outcome.adjustment.netMinor, vatMinor: preview.outcome.adjustment.vatMinor, reason: `Retainer cancelled ${body.effectiveDate} (${body.finalMonth})`, effectiveDate: today, requestId }, now);
          if (credit) await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'receivable.credited', entityType: 'receivable', entityId: credit.receivable.id, metadata: { creditId: credit.credit.id, amount: preview.wire.adjustment?.amount, source: 'RETAINER_CANCEL', agreementId: agreement.id, settled: credit.receivable.status === 'SETTLED' }, requestId });
        }
        const fresh = await mustGet(store, organization.id, agreement.id);
        // A PRORATE final month that has not posted yet posts now (at the prorated amount) if its charge date has arrived.
        await generateCharges(store, organization, fresh, today, now, { actorType: 'API_KEY', actorId: apiKey.id, requestId });
      }
      return c.json(await chargesView(organization, agreement.id, today), 200);
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
      const { organization, apiKey } = keyAuth(c);
      const now = c.get('now')();
      const summary = await postDueItems(store, organization, todayFor(organization, now), now, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') });
      return c.json(summary, 200);
    },
  );

  async function chargesView(organization: Organization, agreementId: string, today: string) {
    const agreement = await mustGet(store, organization.id, agreementId);
    const charges = await store.agreements.listCharges(organization.id, agreementId);
    const timeline = termsTimeline(agreement, await store.agreements.listVersions(organization.id, agreementId));
    const views = [];
    for (const ch of charges) views.push(serializeCharge(ch, await store.receivables.getById(organization.id, ch.receivableId), agreement.currency, today));
    return { agreement: serializeAgreement(agreement), versions: timeline.map((t) => serializeRetainerTerms(t, agreement.currency)), charges: views };
  }

  /** The first month no longer charged after a cancellation, or null when nothing was still to come. */
  function nextStoppedMonth(agreement: AgreementRecord, timeline: RetainerTerms[], effectiveMonth: string, finalMonth: FinalMonthOption, charges: RetainerChargeRecord[], today: string): string | null {
    const endMonth = latestTerms(timeline).endMonth;
    const first = finalMonth === 'WAIVE' && !charges.some((ch) => ch.serviceMonth === effectiveMonth) ? effectiveMonth : addMonths(effectiveMonth, 1);
    if (endMonth && first > endMonth) return null;
    void agreement;
    void today;
    return first;
  }

  return app;
}

function outstandingOf(r: ReceivableRecord): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

/** The first month ≥ `from` without a generated charge, within the end / cancel bounds. */
function firstUnchargedFrom(from: string, generated: readonly string[], endMonth: string | null, cancelMonth: string | null): string | null {
  let month = from;
  for (let i = 0; i < 120; i += 1, month = addMonths(month, 1)) {
    if (endMonth && month > endMonth) return null;
    if (cancelMonth && month > cancelMonth) return null;
    if (!generated.includes(month)) return month;
  }
  return null;
}

/** The first service month not yet chargeable today (null when ended). */
function nextChargeMonth(body: PreviewBody, chargedNow: string[], today: string): string | null {
  const last = chargedNow[chargedNow.length - 1];
  const candidate = last ? addMonths(last, 1) : body.startMonth;
  if (body.endMonth && candidate > body.endMonth) return null;
  if (!last && chargeDate(candidate, body.billingDay) <= today) return null;
  return candidate;
}
