import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { lazyPostingOf, requireScope, type AppEnv } from '../auth/middleware.js';
import { todayFor } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import { currentProposal } from '../proposals/transitions.js';
import type { AgreementRecord, FeeProposalRecord, InstallmentRecord, LedgerStore, Organization, ProjectRecord, ReceivableRecord } from '../repositories/ports.js';
import { latestTerms, termsTimeline } from '../retainers/terms.js';
import { CustomerIdParamSchema, CustomerSummarySchema, OrganizationSummarySchema, ProjectIdParamSchema, ProjectSummaryResponseSchema, SummaryCurrencyQuerySchema } from '../schemas.js';
import { serializeFeeProposalSummary } from '../serializers.js';
import { addBuckets, bucketize, customerStatus, emptyBuckets, lastPaymentOn, projectFigures, unallocatedOf, type Buckets, type ProjectFigures } from '../summaries/compute.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

/** /v1/summaries — the figures Malafat renders (M6 brief §2). Computed on read; nothing is materialized. */
export function summaryRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/organization',
      tags: ['Summaries'],
      summary: 'Outstanding, overdue, due today, not yet due, unallocated and proposed per currency, with a row, a status and the open proposals per customer',
      description: 'outstanding = overdue + dueToday + notYetDue over OPEN receivables; unallocated over POSTED payments; proposed over PROPOSED fee proposals (M8), which also appear on their customer\'s row. Due items are posted before the figures are read. ?currency= narrows to one block.',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('summaries:read')] as const,
      request: { query: SummaryCurrencyQuerySchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: OrganizationSummarySchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, today, now, posting.actor);
      const receivables = await listAll((cursor) => store.receivables.list(organization.id, { status: 'OPEN' }, { limit: 200, cursor }));
      const payments = await listAll((cursor) => store.payments.list(organization.id, { status: 'POSTED' }, { limit: 200, cursor }));
      // M8 (D17): open proposals ride the summary, so the overview's figure and its pills share one source; a currency with proposals only still gets a block.
      const proposals = await listAll((cursor) => store.feeProposals.list(organization.id, { open: true }, { limit: 200, cursor }));
      const wanted = c.req.valid('query').currency;
      const currencies = [...new Set([...receivables.map((r) => r.currency), ...payments.map((p) => p.currency), ...proposals.map((p) => p.currency)])].sort().filter((cur) => !wanted || cur === wanted);
      const blocks = currencies.map((currency) => {
        const recs = receivables.filter((r) => r.currency === currency);
        const pays = payments.filter((p) => p.currency === currency);
        const props = proposals.filter((p) => p.currency === currency);
        const byCustomer = new Set([...recs.map((r) => r.customerId), ...pays.map((p) => p.customerId), ...props.map((p) => p.customerId)]);
        const fmt = (m: bigint) => formatMoney({ minor: m, currency: currency as Currency });
        const rows = [...byCustomer].sort().map((customerId) => {
          const b = bucketize(recs.filter((r) => r.customerId === customerId), today);
          const own = pays.filter((p) => p.customerId === customerId);
          const u = unallocatedOf(own);
          const ownProposals = props.filter((p) => p.customerId === customerId).map((p) => ({ proposalId: p.id, projectId: p.projectId, amount: fmt(p.proposedAmountMinor), proposedOn: p.proposedOn }));
          return { customerId, ...bucketsWire(b, fmt), unallocated: fmt(u.amount), lastPaymentOn: lastPaymentOn(own), status: customerStatus(b), proposals: ownProposals };
        });
        const total = bucketize(recs, today);
        const u = unallocatedOf(pays);
        return {
          currency: currency as Currency,
          ...bucketsWire(total, fmt),
          unallocated: fmt(u.amount),
          proposed: fmt(props.reduce((sum, p) => sum + p.proposedAmountMinor, 0n)),
          counts: { customers: rows.length, overdueCustomers: rows.filter((r) => r.status === 'OVERDUE').length, unallocatedPayments: u.count, openProposals: props.length },
          customers: rows,
        };
      });
      return c.json({ asOf: today, currencies: blocks }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/customers/{customerId}',
      tags: ['Summaries'],
      summary: 'One customer: buckets, unallocated and status per currency, with a summary per project',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('summaries:read')] as const,
      request: { params: CustomerIdParamSchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: CustomerSummarySchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const customerId = c.req.valid('param').customerId;
      const customer = await store.customers.getById(organization.id, customerId);
      if (!customer) throw new ApiError('NOT_FOUND', 'No such customer');
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, today, now, posting.actor);
      const projects = await listAll((cursor) => store.projects.list(organization.id, { customerId }, { limit: 200, cursor }));
      const receivables = await listAll((cursor) => store.receivables.list(organization.id, { customerId }, { limit: 200, cursor }));
      const payments = await listAll((cursor) => store.payments.list(organization.id, { customerId, status: 'POSTED' }, { limit: 200, cursor }));
      const figures = new Map<string, ProjectView>();
      for (const p of projects) figures.set(p.id, await projectSummary(organization, p, receivables.filter((r) => r.projectId === p.id), today));
      const currencies = [...new Set([...projects.map((p) => p.currency), ...payments.map((p) => p.currency)])].sort();
      const blocks = currencies.map((currency) => {
        const fmt = (m: bigint) => formatMoney({ minor: m, currency: currency as Currency });
        const own = projects.filter((p) => p.currency === currency);
        const b = own.reduce((acc, p) => addBuckets(acc, figures.get(p.id)!.figures.buckets), emptyBuckets());
        const u = unallocatedOf(payments.filter((p) => p.currency === currency));
        return { currency: currency as Currency, ...bucketsWire(b, fmt), unallocated: fmt(u.amount), status: customerStatus(b), projects: own.map((p) => projectWire(p, figures.get(p.id)!)) };
      });
      return c.json({ customerId, asOf: today, lastPaymentOn: lastPaymentOn(payments), currencies: blocks }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/projects/{projectId}',
      tags: ['Summaries'],
      summary: 'One project: agreed / monthly, posted, paid, credited, buckets, pending installments and status',
      security: [{ apiKey: [] }, { session: [] }],
      middleware: [requireScope('summaries:read')] as const,
      request: { params: ProjectIdParamSchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: ProjectSummaryResponseSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = c.get('auth');
      const now = c.get('now')();
      const today = todayFor(organization, now);
      const project = await store.projects.getById(organization.id, c.req.valid('param').projectId);
      if (!project) throw new ApiError('NOT_FOUND', 'No such project');
      const posting = lazyPostingOf(c, store);
      await postDueItems(posting.store, organization, today, now, posting.actor);
      const receivables = await listAll((cursor) => store.receivables.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
      const figures = await projectSummary(organization, project, receivables, today);
      return c.json({ ...projectWire(project, figures), asOf: today }, 200);
    },
  );

  async function projectSummary(organization: Organization, project: ProjectRecord, receivables: ReceivableRecord[], today: string): Promise<ProjectView> {
    const proposals: FeeProposalRecord[] = await listAll((cursor) => store.feeProposals.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const agreements: AgreementRecord[] = await listAll((cursor) => store.agreements.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const installments: InstallmentRecord[] = [];
    let monthlyMinor: bigint | null = null;
    for (const a of agreements) {
      if (a.type === 'FIXED' && a.status === 'ACTIVE') installments.push(...(await store.agreements.listInstallments(organization.id, a.id)));
      if (a.type === 'RECURRING' && a.status === 'ACTIVE') monthlyMinor = latestTerms(termsTimeline(a, await store.agreements.listVersions(organization.id, a.id))).grossMinor;
    }
    return { figures: projectFigures({ agreements, installments, receivables, monthlyMinor, today }), proposal: currentProposal(proposals) };
  }

  return app;
}

function bucketsWire(b: Buckets, fmt: (m: bigint) => string) {
  return { outstanding: fmt(b.outstanding), overdue: fmt(b.overdue), dueToday: fmt(b.dueToday), notYetDue: fmt(b.notYetDue) };
}

/** A project's figures plus its current fee proposal (M7). */
interface ProjectView {
  figures: ProjectFigures;
  proposal: FeeProposalRecord | null;
}

function projectWire(project: ProjectRecord, view: ProjectView) {
  const f = view.figures;
  const fmt = (m: bigint) => formatMoney({ minor: m, currency: project.currency as Currency });
  return {
    projectId: project.id,
    currency: project.currency as Currency,
    kind: f.kind,
    agreed: f.agreedMinor === null ? null : fmt(f.agreedMinor),
    monthly: f.monthlyMinor === null ? null : fmt(f.monthlyMinor),
    posted: fmt(f.postedMinor),
    paid: fmt(f.paidMinor),
    credited: fmt(f.creditedMinor),
    ...bucketsWire(f.buckets, fmt),
    pending: { count: f.pending.count, amount: fmt(f.pending.amountMinor) },
    status: f.status,
    proposal: serializeFeeProposalSummary(view.proposal),
  };
}

/** Walks every page of a keyset-paginated list. */
export async function listAll<T>(fetchPage: (cursor: { createdAt: Date; id: string } | null) => Promise<{ items: T[]; nextCursor: { createdAt: Date; id: string } | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  for (let i = 0; i < 1000; i += 1) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

