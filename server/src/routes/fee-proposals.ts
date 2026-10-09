import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { requireScope, type AppEnv } from '../auth/middleware.js';
import { assertIsoDate, assertNotAbsurdDate, parseAmount, todayFor, validationError } from '../agreements/compose.js';
import { ApiError } from '../errors.js';
import { idempotent } from '../idempotency.js';
import { formatMoney, type Currency } from '../money.js';
import { agreedAmountAfter, allowedFrom, type ProposalVerb } from '../proposals/transitions.js';
import { UniqueViolation } from '../repositories/memory.js';
import type { FeeProposalRecord, FeeProposalTransitionPatch, LedgerStore } from '../repositories/ports.js';
import {
  AgreeFeeProposalRequestSchema,
  ApproveFeeProposalRequestSchema,
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

/**
 * /v1/fee-proposals — the negotiation before a fixed-fee agreement (M7 brief
 * §2–§3): propose → client approved | agreed → converted by POST /v1/agreements
 * with `feeProposalId`, or withdrawn. Nothing here posts a receivable.
 */
export function feeProposalRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals',
      tags: ['Fee proposals'],
      summary: 'Propose a fee on a project',
      description: 'The currency is the project\'s. One proposal may be open (PROPOSED, CLIENT_APPROVED or AGREED) per project: a second one is refused with 409 PROPOSAL_OPEN naming the open proposal.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.create')] as const,
      request: { headers: IdempotencyHeaderSchema, body: jsonBody(CreateFeeProposalRequestSchema) },
      responses: { 201: { description: 'Proposed', ...proposalJson }, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
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
      security: [{ apiKey: [] }],
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
      security: [{ apiKey: [] }],
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
      summary: 'Mark the client\'s approval of the proposed amount',
      description: 'PROPOSED → CLIENT_APPROVED; the agreed amount becomes the proposed amount. 409 PROPOSAL_NOT_OPEN from any other state.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.approve')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(ApproveFeeProposalRequestSchema) },
      responses: { 200: { description: 'Client approved', ...proposalJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      const approvedOn = body.approvedOn ? assertIsoDate(body.approvedOn, 'approvedOn') : today;
      assertNotAbsurdDate(approvedOn, today, 'approvedOn');
      const record = await transition(store, organization.id, current, 'approve', {
        status: 'CLIENT_APPROVED',
        clientApprovedOn: approvedOn,
        clientApprovalNote: body.note ?? null,
        agreedAmountMinor: agreedAmountAfter('approve', current),
      }, now);
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'fee_proposal.client_approved', entityType: 'fee_proposal', entityId: record.id, metadata: { projectId: record.projectId, agreedAmount: amountOf(record, record.agreedAmountMinor), approvedOn }, requestId: c.get('requestId') });
      return c.json(serializeFeeProposal(record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals/{proposalId}/agree',
      tags: ['Fee proposals'],
      summary: 'Set the final agreed amount',
      description: 'PROPOSED | CLIENT_APPROVED → AGREED with an explicit amount (the same as or different from the proposed one). 409 PROPOSAL_NOT_OPEN from AGREED, CONVERTED or WITHDRAWN.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.agree')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(AgreeFeeProposalRequestSchema) },
      responses: { 200: { description: 'Agreed', ...proposalJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
      const body = c.req.valid('json');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const current = await mustGet(store, organization.id, c.req.valid('param').proposalId);
      const agreedAmountMinor = parseAmount(body.amount, current.currency as Currency);
      if (agreedAmountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
      const agreedOn = body.agreedOn ? assertIsoDate(body.agreedOn, 'agreedOn') : today;
      assertNotAbsurdDate(agreedOn, today, 'agreedOn');
      const record = await transition(store, organization.id, current, 'agree', { status: 'AGREED', agreedAmountMinor: agreedAmountAfter('agree', current, agreedAmountMinor), agreedOn, agreedNote: body.note ?? null }, now);
      await store.audit.append({ organizationId: organization.id, actorType: 'API_KEY', actorId: apiKey.id, action: 'fee_proposal.agreed', entityType: 'fee_proposal', entityId: record.id, metadata: { projectId: record.projectId, proposedAmount: amountOf(record, record.proposedAmountMinor), agreedAmount: amountOf(record, record.agreedAmountMinor), agreedOn }, requestId: c.get('requestId') });
      return c.json(serializeFeeProposal(record), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/fee-proposals/{proposalId}/withdraw',
      tags: ['Fee proposals'],
      summary: 'Withdraw a proposal (the firm withdrew it, or the client declined)',
      description: 'Any open state → WITHDRAWN. Idempotent on an already withdrawn proposal; 409 PROPOSAL_NOT_OPEN once converted.',
      security: [{ apiKey: [] }],
      middleware: [requireScope('agreements:write'), idempotent(store, 'fee-proposals.withdraw')] as const,
      request: { params: FeeProposalIdParamSchema, headers: IdempotencyHeaderSchema, body: jsonBody(WithdrawFeeProposalRequestSchema) },
      responses: { 200: { description: 'Withdrawn (or already was)', ...proposalJson }, ...notFoundResponse, ...conflictResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization, apiKey } = c.get('auth');
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

async function mustGet(store: LedgerStore, organizationId: string, id: string): Promise<FeeProposalRecord> {
  const proposal = await store.feeProposals.getById(organizationId, id);
  if (!proposal) throw new ApiError('NOT_FOUND', 'No such fee proposal');
  return proposal;
}

function proposalOpen(open: FeeProposalRecord): ApiError {
  return new ApiError('CONFLICT', 'A proposal is already open on this project; withdraw or convert it first', { reason: 'PROPOSAL_OPEN', openProposalId: open.id, status: open.status });
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

/** POST /v1/agreements with `feeProposalId`: the proposal must exist, belong to the project and be CLIENT_APPROVED or AGREED (M7 brief §2). */
export async function assertConvertible(store: LedgerStore, organizationId: string, feeProposalId: string, projectId: string): Promise<FeeProposalRecord> {
  const proposal = await store.feeProposals.getById(organizationId, feeProposalId);
  if (!proposal) throw validationError('PROPOSAL_NOT_FOUND', 'feeProposalId does not name a fee proposal of this organization', { field: 'feeProposalId' });
  if (proposal.projectId !== projectId) throw validationError('PROPOSAL_PROJECT_MISMATCH', 'The fee proposal belongs to another project', { field: 'feeProposalId', proposalProjectId: proposal.projectId });
  if (!allowedFrom('convert').includes(proposal.status)) throw validationError('PROPOSAL_NOT_AGREED', `The fee proposal is ${proposal.status}; only a client-approved or agreed proposal converts`, { field: 'feeProposalId', status: proposal.status });
  return proposal;
}
