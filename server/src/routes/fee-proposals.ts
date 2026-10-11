import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { keyAuth, requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, assertNotAbsurdDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { agreementDetail, composePreview, createAgreementFromPreview, type PreviewBody } from '../agreements/create.js';
import { addMonths, clampDay, monthOf, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { allowedFrom, type ProposalVerb } from '../proposals/transitions.js';
import { StateConflict, UniqueViolation } from '../repositories/memory.js';
import type { FeeProposalRecord, FeeProposalTransitionPatch, LedgerStore } from '../repositories/ports.js';
import {
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
 * /v1/fee-proposals — the negotiation before a fixed-fee agreement (M7 brief
 * §2–§3, lifecycle revised by M8 brief §6): propose → approve, which creates
 * the agreement in the same transaction and posts its first installment, or
 * withdraw. Nothing is posted while a proposal is open.
 */
export function feeProposalRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals',
      tags: ['Fee proposals'],
      summary: 'Propose a fee on a project',
      description: 'The currency is the project\'s. One proposal may be open (PROPOSED) per project: a second one is refused with 409 PROPOSAL_OPEN naming the open proposal.',
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
      const proposedAmountMinor = parseAmount(body.amount, currency);
      if (proposedAmountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const proposedOn = body.proposedOn ? assertIsoDate(body.proposedOn, 'proposedOn') : today;
      assertNotAbsurdDate(proposedOn, today, 'proposedOn');

      const open = await store.feeProposals.findOpenByProject(organization.id, project.id);
      if (open) throw proposalOpen(open);

      let proposal: FeeProposalRecord;
      try {
        proposal = await store.feeProposals.create(
          { organizationId: organization.id, projectId: project.id, customerId: project.customerId, currency, pricingBasis: body.pricingBasis, proposedAmountMinor, proposedOn, note: body.note ?? null, requestId: c.get('requestId') },
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
        metadata: { projectId: proposal.projectId, customerId: proposal.customerId, proposedAmount: formatMoney({ minor: proposal.proposedAmountMinor, currency }), pricingBasis: proposal.pricingBasis, proposedOn },
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
      security: [{ apiKey: [] }, { session: [] }],
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
      security: [{ apiKey: [] }, { session: [] }],
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
      path: '/v1/fee-proposals/{proposalId}/approve',
      tags: ['Fee proposals'],
      summary: 'Approve: the client accepted the fee; creates the agreement and posts its first installment',
      description:
        'PROPOSED → APPROVED. Creates a fixed-fee agreement on the project dated approvedOn (so the VAT rate in force on that date applies; 422 VAT_RATE_MISSING otherwise) at the final amount, in one transaction with the status change. ONCE posts one installment now, due on dueOn; INSTALLMENTS splits the amount into equal monthly shares (remainder on the first), posts the first now and the rest on their due dates. 409 PROPOSAL_NOT_OPEN from any other state.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.approve')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ApproveFeeProposalRequestSchema) },
      responses: { 200: { description: 'Approved; the agreement and its installments', content: { 'application/json': { schema: ApproveFeeProposalResponseSchema } } }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = keyAuth(c);
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      if (!allowedFrom('approve').includes(current.status)) throw proposalNotOpen(current.status, 'approve');
      const currency = current.currency as Currency;
      const agreedAmountMinor = parseAmount(body.amount, currency);
      if (agreedAmountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const approvedOn = body.approvedOn ? assertIsoDate(body.approvedOn, 'approvedOn') : today;
      assertNotAbsurdDate(approvedOn, today, 'approvedOn');

      const previewBody: PreviewBody = {
        projectId: current.projectId,
        amount: body.amount,
        pricingBasis: current.pricingBasis,
        agreementDate: approvedOn,
        paymentTerms: 'EOM',
        installments: approveInstallments(body.schedule, agreedAmountMinor, currency, today),
      };
      const preview = await composePreview(store, organization, previewBody, today);
      const created = await createAgreementFromPreview(store, organization, { actorType: 'API_KEY', actorId: apiKey.id, requestId: c.get('requestId') }, previewBody, preview, today, now, {
        approveProposal: { id: current.id, agreedAmountMinor, approvedOn, note: body.note ?? null },
      }).catch((err: unknown) => {
        if (err instanceof StateConflict && err.entity === 'fee_proposal') throw proposalNotOpen(current.status, 'approve');
        throw err;
      });
      const proposal = await mustGet(store, organization.id, current.id);
      await store.audit.append({
        organizationId: organization.id,
        actorType: 'API_KEY',
        actorId: apiKey.id,
        action: 'fee_proposal.approved',
        entityType: 'fee_proposal',
        entityId: proposal.id,
        metadata: { projectId: proposal.projectId, proposedAmount: amountOf(proposal, proposal.proposedAmountMinor), agreedAmount: amountOf(proposal, proposal.agreedAmountMinor), approvedOn, agreementId: created.agreement.id, schedule: body.schedule.kind },
        requestId: c.get('requestId'),
      });
      return c.json({ proposal: serializeFeeProposal(proposal), agreement: await agreementDetail(store, organization, created.agreement, today) }, 200);
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
