import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, postingActorOf, requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, assertNotAbsurdDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { agreementDetail, composePreview, createAgreementFromPreview, type PreviewBody } from '../agreements/create.js';
import { COMMISSION_RATE_RULE, isCommissionRate, type UpfrontTreatment } from '../agreements/contingency.js';
import { addMonths, clampDay, monthOf, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { previewToken, verifyPreviewToken } from '../preview-token.js';
import { agreedAmountOf, agreementTypeOf, approveTokenParts, composeDraft, draftChanged, storedDraftOf, type AgreementDraft, type ComposedDraft } from '../proposals/draft.js';
import { allowedFrom, type ProposalVerb } from '../proposals/transitions.js';
import { StateConflict, UniqueViolation } from '../repositories/memory.js';
import type { AgreementType, ApproveProposalInput, FeeProposalRecord, FeeProposalTransitionPatch, JsonObject, LedgerStore, Organization } from '../repositories/ports.js';
import { createRetainerFromPreview, retainerChargesView } from '../retainers/create.js';
import {
  ApproveFeeProposalPreviewRequestSchema,
  ApproveFeeProposalPreviewResponseSchema,
  ApproveFeeProposalRequestSchema,
  ApproveFeeProposalResponseSchema,
  CreateFeeProposalRequestSchema,
  FeeProposalIdParamSchema,
  FeeProposalPageSchema,
  FeeProposalSchema,
  ListFeeProposalsQuerySchema,
  WithdrawFeeProposalRequestSchema,
} from '../schemas.js';
import { serializeFeeProposal } from '../serializers.js';
import { conflictResponse, encodeNextCursor, errorResponses, IdempotencyHeaderSchema, notFoundResponse, toPageRequest, validationResponse } from './shared.js';

const jsonBody = <T>(schema: T) => ({ required: true as const, content: { 'application/json': { schema } } });
const proposalJson = { content: { 'application/json': { schema: FeeProposalSchema } } };

type ApproveSchedule = { kind: 'ONCE'; dueOn: string } | { kind: 'INSTALLMENTS'; count: number; firstDueOn: string };

/**
 * /v1/fee-proposals — the negotiation before an agreement (M7 brief
 * §2–§3, lifecycle revised by M8 brief §6): propose → approve, which creates
 * the agreement in the same transaction and posts its first installment, or
 * withdraw. Nothing is posted while a proposal is open. MUT-479: a proposal may
 * carry the full draft agreement (any schedule, a retainer, contingency), and
 * approving may take the full body with a preview token.
 */
export function feeProposalRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals',
      tags: ['Fee proposals'],
      summary: 'Propose a fee on a project',
      description:
        'The currency is the project\'s. One proposal may be open (PROPOSED) per project: a second one is refused with 409 PROPOSAL_OPEN naming the open proposal. Either amount and pricingBasis (with optional contingency terms), or a full `draft` agreement (MUT-479): FIXED with any schedule, CONTINGENCY, or RETAINER; both forms are 422 DRAFT_CONFLICT, neither is 422 AMOUNT_REQUIRED. A draft is composed on proposedOn as POST /v1/agreements or /v1/retainers would compose it, so its refusals apply now (e.g. 422 PERCENTS_DO_NOT_SUM, VAT_RATE_MISSING for a backdated proposal before any rate, CUSTOMER_ARCHIVED); proposedAmount is then the fixed total, the contingency upfront or the retainer\'s monthly amount.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateFeeProposalRequestSchema) },
      responses: { 201: { description: 'Proposed', ...proposalJson }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);

      const project = await store.projects.getById(organization.id, body.projectId);
      if (!project) throw validationError('PROJECT_NOT_FOUND', 'projectId does not name a project of this organization', { field: 'projectId' });
      if (project.status === 'ARCHIVED') throw validationError('PROJECT_ARCHIVED', 'The project is archived', { field: 'projectId' });
      const currency = project.currency as Currency;
      const proposedOn = body.proposedOn ? assertIsoDate(body.proposedOn, 'proposedOn') : today;
      assertNotAbsurdDate(proposedOn, today, 'proposedOn');
      const terms = body.draft ? await draftTerms(store, organization, body, project.id, proposedOn, today, currency) : legacyTerms(body, currency);
      const { proposedAmountMinor, contingency } = terms;

      const open = await store.feeProposals.findOpenByProject(organization.id, project.id);
      if (open) throw proposalOpen(open);

      let proposal: FeeProposalRecord;
      try {
        proposal = await store.feeProposals.create(
          {
            organizationId: organization.id,
            projectId: project.id,
            customerId: project.customerId,
            currency,
            pricingBasis: terms.pricingBasis,
            proposedAmountMinor,
            proposedOn,
            note: body.note ?? null,
            requestId: c.get('requestId'),
            agreementType: terms.agreementType,
            draft: terms.draft,
            ...(contingency ? { commissionRateBasisPoints: contingency.commissionRateBasisPoints, upfrontTreatment: contingency.upfrontTreatment } : {}),
          },
          now,
        );
      } catch (err) {
        if (err instanceof UniqueViolation) {
          const raced = await store.feeProposals.findOpenByProject(organization.id, project.id);
          if (raced) throw proposalOpen(raced);
        }
        throw err;
      }
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'fee_proposal.created',
        entityType: 'fee_proposal',
        entityId: proposal.id,
        metadata: {
          projectId: proposal.projectId,
          customerId: proposal.customerId,
          proposedAmount: formatMoney({ minor: proposal.proposedAmountMinor, currency }),
          pricingBasis: proposal.pricingBasis,
          proposedOn,
          agreementType: proposal.agreementType,
          ...(contingency ? { contingency } : {}),
          ...(body.draft ? { draft: body.draft.kind } : {}),
        },
        requestId: c.get('requestId'),
      });
      return c.json(serializeFeeProposal(proposal), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/fee-proposals',
      tags: ['Fee proposals'],
      summary: 'List fee proposals',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { query: ListFeeProposalsQuerySchema },
      responses: { 200: { description: 'A page', content: { 'application/json': { schema: FeeProposalPageSchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const q = c.req.valid('query');
      const page = await store.feeProposals.list(
        organization.id,
        {
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
          ...(q.status ? { status: q.status } : {}),
          ...(q.open !== undefined ? { open: q.open === 'true' } : {}),
        },
        toPageRequest(q),
      );
      return c.json({ items: page.items.map(serializeFeeProposal), nextCursor: encodeNextCursor(page.nextCursor) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/fee-proposals/{proposalId}',
      tags: ['Fee proposals'],
      summary: 'Get a fee proposal',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: FeeProposalIdParamSchema },
      responses: { 200: { description: 'The proposal', ...proposalJson }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      return c.json(serializeFeeProposal(await mustGet(store, organization.id, c.req.valid('param').proposalId)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals/{proposalId}/approve/preview',
      tags: ['Fee proposals'],
      summary: 'Preview approving with a full agreement: what it makes, and the previewToken approve needs',
      description:
        'MUT-479 (D4). The agreement is composed on the proposal\'s project, dated approvedOn (default today), as POST /v1/agreements/preview (FIXED, CONTINGENCY) or POST /v1/retainers/preview (RETAINER) would compose it, and answers in the same shape with `kind`. Its kind and pricingBasis must be the proposal\'s (422 AGREEMENT_TYPE_MISMATCH, PRICING_BASIS_MISMATCH). The previewToken covers the proposal and its version, the resolved approvedOn, the agreement and the VAT rate, so any change before approve is 409 PREVIEW_STALE there. 409 PROPOSAL_NOT_OPEN unless the proposal is PROPOSED.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:read')] as const,
      request: { params: FeeProposalIdParamSchema, body: jsonBody(ApproveFeeProposalPreviewRequestSchema) },
      responses: { 200: { description: 'Preview', content: { 'application/json': { schema: ApproveFeeProposalPreviewResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = keyAuth(c);
      const body = c.req.valid('json');
      const today = todayFor(organization, c.get('now')());
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      if (!allowedFrom('approve').includes(current.status)) throw proposalNotOpen(current.status, 'approve');
      const approvedOn = approvalDate(body.approvedOn, today);
      assertSameKind(current, body.agreement);
      const composed = await composeDraft(store, organization, body.agreement, current.projectId, approvedOn, today);
      const previewToken = approveToken(organization.id, current, approvedOn, body.agreement, composed);
      return c.json(composed.kind === 'RETAINER' ? { ...composed.preview.wire, kind: 'RETAINER' as const, previewToken } : { ...composed.preview.wire, kind: composed.preview.type, previewToken }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals/{proposalId}/approve',
      tags: ['Fee proposals'],
      summary: 'Approve: the client accepted the fee; creates the agreement and posts its first installment',
      description:
        'PROPOSED → APPROVED. Creates an agreement on the project dated approvedOn (so the VAT rate in force on that date applies; 422 VAT_RATE_MISSING otherwise) in one transaction with the status change. Two forms. (1) MUT-479: `agreement`, the full agreement (prefilled from the proposal\'s draft and editable), with the previewToken from approve/preview (422 PREVIEW_TOKEN_REQUIRED without one; 409 PREVIEW_STALE when anything changed): FIXED or CONTINGENCY with any schedule, or RETAINER, whose charges due by today post at once and come back in `charges`; agreedAmount is the fixed total, the contingency upfront or the monthly amount. Its kind and pricingBasis must be the proposal\'s (422 AGREEMENT_TYPE_MISMATCH, PRICING_BASIS_MISMATCH; withdraw and re-propose to change them). Mixing it with amount, schedule or contingency is 422 DRAFT_CONFLICT. (2) amount and schedule: FIXED, or CONTINGENCY if the proposal carried contingency terms (an optional contingency here overrides them); refused with 422 DRAFT_REQUIRED on a proposal that carries a draft (a retainer proposal always does), and with DRAFT_CONFLICT when a previewToken is sent. schedule is required only when the agreed amount is greater than 0 (422 SCHEDULE_REQUIRED otherwise, e.g. a 0-upfront contingency approval). ONCE posts one installment now, due on dueOn; INSTALLMENTS splits the amount into equal monthly shares (remainder on the first), posts the first now and the rest on their due dates. Neither form is 422 AMOUNT_REQUIRED. 409 PROPOSAL_NOT_OPEN from any other state.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.approve')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ApproveFeeProposalRequestSchema) },
      responses: { 200: { description: 'Approved; the agreement and its installments (a retainer: its charges)', content: { 'application/json': { schema: ApproveFeeProposalResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const actor = postingActorOf(c);
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      if (!allowedFrom('approve').includes(current.status)) throw proposalNotOpen(current.status, 'approve');
      const approvedOn = approvalDate(body.approvedOn, today);
      const approval = (agreedAmountMinor: bigint): ApproveProposalInput => ({ id: current.id, agreedAmountMinor, approvedOn, note: body.note ?? null });
      // The store refuses the whole create when the proposal moved since it was read; report the state it moved to (R6).
      const raced = async (err: unknown): Promise<never> => {
        if (err instanceof StateConflict && err.entity === 'fee_proposal') throw proposalNotOpen((await mustGet(store, organization.id, current.id)).status, 'approve');
        throw err;
      };

      let agreementId: string;
      let auditExtra: JsonObject;
      if (body.agreement) {
        if (body.amount !== undefined || body.schedule || body.contingency) throw draftConflict('agreement', 'amount, schedule or contingency');
        assertSameKind(current, body.agreement);
        if (!body.previewToken) throw validationError('PREVIEW_TOKEN_REQUIRED', 'Approving with an agreement needs the previewToken from POST /v1/fee-proposals/{id}/approve/preview', { field: 'previewToken' });
        const composed = await composeDraft(store, organization, body.agreement, current.projectId, approvedOn, today);
        if (!verifyPreviewToken(body.previewToken, approveTokenParts(organization.id, current, approvedOn, body.agreement, composed.rateBasisPoints))) {
          throw new ApiError('CONFLICT', 'previewToken does not match this proposal, approval date, agreement and the VAT rate in force; preview again', { reason: 'PREVIEW_STALE' });
        }
        const input = approval(agreedAmountOf(body.agreement, current.currency as Currency));
        agreementId =
          composed.kind === 'RETAINER'
            ? (await createRetainerFromPreview(store, organization, actor, composed.body, composed.preview, today, now, { approveProposal: input }).catch(raced)).id
            : (await createAgreementFromPreview(store, organization, actor, composed.body, composed.preview, today, now, { approveProposal: input }).catch(raced)).agreement.id;
        auditExtra = { agreementType: agreementTypeOf(body.agreement), draftChanged: draftChanged(current.draft, body.agreement), schedule: null, ...(body.agreement.kind === 'CONTINGENCY' ? { contingency: body.agreement.contingency } : {}) };
      } else {
        if (body.previewToken) throw draftConflict('previewToken', 'amount and schedule (a previewToken goes with agreement)');
        if (body.amount === undefined) throw validationError('AMOUNT_REQUIRED', 'amount (with schedule), or agreement, is required', { field: 'amount' });
        // R1, and the review: amount and schedule can't express a retainer, nor the schedule a stored draft proposed.
        if (current.agreementType === 'RECURRING' || current.draft !== null) throw validationError('DRAFT_REQUIRED', 'This proposal carries a draft agreement; approve it with agreement and previewToken', { field: 'agreement' });
        const legacy = legacyApproveBody(body as LegacyApproveBody, current, approvedOn, today);
        const preview = await composePreview(store, organization, legacy.previewBody, today);
        const created = await createAgreementFromPreview(store, organization, actor, legacy.previewBody, preview, today, now, { approveProposal: approval(legacy.agreedAmountMinor) }).catch(raced);
        agreementId = created.agreement.id;
        auditExtra = { agreementType: preview.type, draftChanged: null, schedule: body.schedule?.kind ?? null, ...(legacy.previewBody.contingency ? { contingency: legacy.previewBody.contingency } : {}) };
      }

      const proposal = await mustGet(store, organization.id, current.id);
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'fee_proposal.approved',
        entityType: 'fee_proposal',
        entityId: proposal.id,
        metadata: {
          projectId: proposal.projectId,
          proposedAmount: amountOf(proposal, proposal.proposedAmountMinor),
          agreedAmount: amountOf(proposal, proposal.agreedAmountMinor),
          approvedOn,
          agreementId,
          ...auditExtra,
        },
        requestId: c.get('requestId'),
      });
      const agreement = await store.agreements.getById(organization.id, agreementId);
      if (!agreement) throw new ApiError('NOT_FOUND', 'No such agreement');
      const charges = agreement.type === 'RECURRING' ? (await retainerChargesView(store, organization, agreement.id, today)).charges : [];
      return c.json({ proposal: serializeFeeProposal(proposal), agreement: await agreementDetail(store, organization, agreement, today), charges }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals/{proposalId}/withdraw',
      tags: ['Fee proposals'],
      summary: 'Withdraw a proposal (the firm withdrew it, or the client declined)',
      description: 'PROPOSED → WITHDRAWN. Idempotent on an already withdrawn proposal; 409 PROPOSAL_NOT_OPEN once approved.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.withdraw')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(WithdrawFeeProposalRequestSchema) },
      responses: { 200: { description: 'Withdrawn (or already was)', ...proposalJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      if (current.status === 'WITHDRAWN') return c.json(serializeFeeProposal(current), 200);
      const record = await transition(store, organization.id, current, 'withdraw', { status: 'WITHDRAWN', withdrawnAt: now, withdrawnReason: body.reason ?? null }, now);
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'fee_proposal.withdrawn', entityType: 'fee_proposal', entityId: record.id, metadata: { projectId: record.projectId, from: current.status, reason: record.withdrawnReason }, requestId: c.get('requestId') });
      return c.json(serializeFeeProposal(record), 200);
    },
  );

  return app;
}

/**
 * The installments an approval creates (M8 brief §6, D15 B): ONCE is one
 * IMMEDIATE installment due on `dueOn`; INSTALLMENTS are equal minor-unit
 * shares with the remainder on the first, #1 IMMEDIATE and due on
 * `firstDueOn`, #2..n DATE-triggered one month apart (day clamped to the
 * month) and due on their trigger date, so they post through the lazy path.
 */
export function approveInstallments(schedule: ApproveSchedule, amountMinor: bigint, currency: Currency, today: IsoDate): PreviewBody['installments'] {
  const fmt = (minor: bigint) => formatMoney({ minor, currency });
  if (schedule.kind === 'ONCE') {
    const dueOn = assertIsoDate(schedule.dueOn, 'schedule.dueOn');
    assertNotAbsurdDate(dueOn, today, 'schedule.dueOn');
    return [{ label: 'Fee', amount: fmt(amountMinor), trigger: { type: 'IMMEDIATE' }, dueDate: dueOn }];
  }
  const firstDueOn = assertIsoDate(schedule.firstDueOn, 'schedule.firstDueOn');
  assertNotAbsurdDate(firstDueOn, today, 'schedule.firstDueOn');
  const count = BigInt(schedule.count);
  const share = amountMinor / count;
  const remainder = amountMinor - share * count;
  const day = Number(firstDueOn.slice(8, 10));
  return Array.from({ length: schedule.count }, (_, i) => {
    const amount = fmt(i === 0 ? share + remainder : share);
    const dueDate = i === 0 ? firstDueOn : clampDay(addMonths(monthOf(firstDueOn), i), day);
    return i === 0 ? { label: `Installment 1 of ${schedule.count}`, amount, trigger: { type: 'IMMEDIATE' as const }, dueDate } : { label: `Installment ${i + 1} of ${schedule.count}`, amount, trigger: { type: 'DATE' as const, date: dueDate }, dueDate };
  });
}

type ProposalTerms = { proposedAmountMinor: bigint; pricingBasis: FeeProposalRecord['pricingBasis']; contingency: { commissionRateBasisPoints: number; upfrontTreatment: UpfrontTreatment } | null; agreementType: AgreementType; draft: JsonObject | null };
type CreateBody = { amount?: string | undefined; pricingBasis?: FeeProposalRecord['pricingBasis'] | undefined; contingency?: { commissionRateBasisPoints: number; upfrontTreatment: UpfrontTreatment } | undefined; draft?: AgreementDraft | undefined };

/** The legacy create (M7, MUT-107): amount and pricingBasis, with optional contingency terms. */
function legacyTerms(body: CreateBody, currency: Currency): ProposalTerms {
  if (body.amount === undefined || body.pricingBasis === undefined) throw validationError('AMOUNT_REQUIRED', 'amount and pricingBasis, or draft, are required', { field: body.amount === undefined ? 'amount' : 'pricingBasis' });
  const proposedAmountMinor = parseAmount(body.amount, currency);
  const contingency = body.contingency ?? null;
  if (contingency && !isCommissionRate(contingency.commissionRateBasisPoints)) {
    throw validationError('COMMISSION_RATE_INVALID', `contingency.${COMMISSION_RATE_RULE}`, { field: 'contingency.commissionRateBasisPoints' });
  }
  if (contingency ? proposedAmountMinor < 0n : proposedAmountMinor <= 0n) {
    throw validationError('AMOUNT_INVALID', contingency ? 'the upfront (amount) must not be negative' : 'amount must be positive', { field: 'amount' });
  }
  return { proposedAmountMinor, pricingBasis: body.pricingBasis, contingency, agreementType: contingency ? 'CONTINGENCY' : 'FIXED', draft: null };
}

/** MUT-479 (D2): a draft's terms, after composing it on proposedOn so a draft that could never approve is refused now. */
async function draftTerms(store: LedgerStore, organization: Organization, body: CreateBody, projectId: string, proposedOn: string, today: string, currency: Currency): Promise<ProposalTerms> {
  const draft = body.draft!;
  if (body.amount !== undefined || body.pricingBasis !== undefined || body.contingency) throw draftConflict('draft', 'amount, pricingBasis or contingency');
  await composeDraft(store, organization, draft, projectId, proposedOn, today);
  return {
    proposedAmountMinor: agreedAmountOf(draft, currency, 'draft'),
    pricingBasis: draft.pricingBasis,
    contingency: draft.kind === 'CONTINGENCY' ? draft.contingency : null,
    agreementType: agreementTypeOf(draft),
    draft: storedDraftOf(draft),
  };
}

type LegacyApproveBody = { amount: string; schedule?: ApproveSchedule | undefined; contingency?: { commissionRateBasisPoints: number; upfrontTreatment: UpfrontTreatment } | undefined };

/** The legacy approve (M8, MUT-107): the agreed amount and a ONCE / INSTALLMENTS schedule over the proposal's terms. */
function legacyApproveBody(body: LegacyApproveBody, current: FeeProposalRecord, approvedOn: string, today: string): { previewBody: PreviewBody; agreedAmountMinor: bigint } {
  const currency = current.currency as Currency;
  const isContingency = current.commissionRateBasisPoints !== null;
  const agreedAmountMinor = parseAmount(body.amount, currency);
  if (isContingency ? agreedAmountMinor < 0n : agreedAmountMinor <= 0n) {
    throw validationError('AMOUNT_INVALID', isContingency ? 'the agreed upfront (amount) must not be negative' : 'amount must be positive', { field: 'amount' });
  }
  if (body.contingency && !isContingency) {
    throw validationError('NOT_CONTINGENCY', 'contingency override given for a proposal that was not proposed as a contingency deal', { field: 'contingency' });
  }
  if (body.contingency && !isCommissionRate(body.contingency.commissionRateBasisPoints)) {
    throw validationError('COMMISSION_RATE_INVALID', `contingency.${COMMISSION_RATE_RULE}`, { field: 'contingency.commissionRateBasisPoints' });
  }
  if (agreedAmountMinor > 0n && !body.schedule) {
    throw validationError('SCHEDULE_REQUIRED', 'schedule is required when the agreed amount is greater than 0', { field: 'schedule' });
  }
  const previewBody: PreviewBody = {
    projectId: current.projectId,
    amount: body.amount,
    pricingBasis: current.pricingBasis,
    agreementDate: approvedOn,
    paymentTerms: 'EOM',
    installments: body.schedule ? approveInstallments(body.schedule, agreedAmountMinor, currency, today) : [],
    ...(isContingency
      ? { contingency: { commissionRateBasisPoints: body.contingency?.commissionRateBasisPoints ?? current.commissionRateBasisPoints!, upfrontTreatment: body.contingency?.upfrontTreatment ?? current.upfrontTreatment! } }
      : {}),
  };
  return { previewBody, agreedAmountMinor };
}

function approvalDate(approvedOn: string | undefined, today: string): string {
  const date = approvedOn ? assertIsoDate(approvedOn, 'approvedOn') : today;
  assertNotAbsurdDate(date, today, 'approvedOn');
  return date;
}

function approveToken(organizationId: string, proposal: FeeProposalRecord, approvedOn: string, agreement: AgreementDraft, composed: ComposedDraft): string {
  return previewToken(approveTokenParts(organizationId, proposal, approvedOn, agreement, composed.rateBasisPoints));
}

/**
 * The approval may edit the agreement (D5), but not turn it into another kind or pricing basis than proposed: the
 * proposal's agreementType, pricingBasis and contingency terms stay what was proposed, and its agreedAmount is read in
 * that basis (as the legacy form refuses NOT_CONTINGENCY). Withdraw and re-propose instead.
 */
function assertSameKind(current: FeeProposalRecord, agreement: AgreementDraft): void {
  if (agreementTypeOf(agreement) !== current.agreementType) {
    throw validationError('AGREEMENT_TYPE_MISMATCH', `The proposal is ${current.agreementType}; withdraw it and propose a ${agreementTypeOf(agreement)} agreement instead`, { field: 'agreement.kind', agreementType: current.agreementType });
  }
  if (agreement.pricingBasis !== current.pricingBasis) {
    throw validationError('PRICING_BASIS_MISMATCH', `The proposal is priced ${current.pricingBasis}`, { field: 'agreement.pricingBasis', pricingBasis: current.pricingBasis });
  }
}

function draftConflict(field: string, others: string): ApiError {
  return validationError('DRAFT_CONFLICT', `${field} replaces ${others}; send one form`, { field });
}

async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<FeeProposalRecord> {
  const proposal = await store.feeProposals.getById(organizationId, id);
  if (!proposal) throw new ApiError('NOT_FOUND', 'No such fee proposal');
  return proposal;
}

function proposalOpen(open: FeeProposalRecord): ApiError {
  return new ApiError('CONFLICT', 'A proposal is already open on this project; withdraw or approve it first', { reason: 'PROPOSAL_OPEN', openProposalId: open.id, status: open.status });
}

export function proposalNotOpen(status: FeeProposalRecord['status'], verb: ProposalVerb): ApiError {
  return new ApiError('CONFLICT', `Cannot ${verb} a proposal that is ${status}`, { reason: 'PROPOSAL_NOT_OPEN', status, allowedFrom: allowedFrom(verb) });
}

/** Refuses from the wrong state in words, then applies the conditional store transition (which re-checks the state). */
async function transition(store: LedgerStore, organizationId: string, current: FeeProposalRecord, verb: ProposalVerb, patch: FeeProposalTransitionPatch, at: Date): Promise<FeeProposalRecord> {
  if (!allowedFrom(verb).includes(current.status)) throw proposalNotOpen(current.status, verb);
  const result = await store.feeProposals.transition(organizationId, current.id, allowedFrom(verb), patch, at);
  if (result.kind === 'not_found') throw new ApiError('NOT_FOUND', 'No such fee proposal');
  if (result.kind === 'wrong_status') throw proposalNotOpen(result.record.status, verb);
  return result.record;
}

function amountOf(record: FeeProposalRecord, minor: bigint | null): string | null {
  return minor === null ? null : formatMoney({ minor, currency: record.currency as Currency });
}
