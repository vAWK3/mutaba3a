import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { lazyPostingOf, requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { todayFor, validationError } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { addDays, addMonths, compareIsoDates, endOfMonth, monthOf } from '../dates.js';
import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import { currentProposal } from '../proposals/transitions.js';
import type { AgreementRecord, ExpenseRecord, FeeProposalRecord, InstallmentRecord, LedgerStore, Organization, ProjectRecord, ReceivableRecord } from '../repositories/ports.js';
import { latestTerms, termsTimeline } from '../retainers/terms.js';
import { ACTIVITY_RANGE_MAX_MONTHS, ActivitySummaryQuerySchema, ActivitySummarySchema, CustomerIdParamSchema, CustomerSummarySchema, OrganizationSummarySchema, ProjectIdParamSchema, ProjectSummaryResponseSchema, SummaryCurrencyQuerySchema } from '../schemas.js';
import { serializeFeeProposalSummary } from '../serializers.js';
import { historyStart, summarizeActivity } from '../summaries/activity.js';
import { addBuckets, bucketize, countsOn, customerStatus, emptyBuckets, lastPaymentOn, projectFigures, unallocatedOf, type Buckets, type ProjectFigures } from '../summaries/compute.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

/** MUT-175: Reports reads a hosted profile's expenses too, so like /v1/summaries/expenses it is session-only. */
const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];

/** /v1/summaries — the figures Malafat renders (M6 brief §2). Computed on read; nothing is materialized. */
export function summaryRoutes(store: LedgerStore): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/organization',
      tags: ['Summaries'],
      summary: 'Outstanding, overdue, due today, not yet due, unallocated and proposed per currency, with a row, a status and the open proposals per customer',
      description: 'outstanding = overdue + dueToday + notYetDue over OPEN receivables, where an Owed dated ahead counts from its own date and until then adds no customer row or currency block (MUT-392); unallocated over POSTED payments; proposed over PROPOSED fee proposals (M8), which also appear on their customer\'s row. Due items are posted before the figures are read. ?currency= narrows to one block.',
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
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
      // MUT-392 review: an Owed dated ahead is left out here, not just from the buckets, so a client or currency with
      // nothing else gets no row of zeros (and no Settled status) until its day.
      const receivables = (await listAll((cursor) => store.receivables.list(organization.id, { status: 'OPEN' }, { limit: 200, cursor }))).filter((r) => countsOn(r, today));
      const payments = await listAll((cursor) => store.payments.list(organization.id, { status: 'POSTED' }, { limit: 200, cursor }));
      // M8 (D17): open proposals ride the summary, so the overview's figure and its pills share one source; a currency with proposals only still gets a block.
      const proposals = await listAll((cursor) => store.feeProposals.list(organization.id, { open: true }, { limit: 200, cursor }));
      const wanted = c.req.valid('query').currency;
      const currencies = [...new Set([...receivables.map((r) => r.currency), ...payments.map((p) => p.currency), ...proposals.map((p) => p.currency)])].sort().filter((cur) => !wanted || cur === wanted);
      const blocks = currencies.map((currency) => {
        const recs = receivables.filter((r) => r.currency === currency);
        const pays = payments.filter((p) => p.currency === currency);
        const props = proposals.filter((p) => p.currency === currency);
        // A session's clientless "Received" capture (MUT-65) has no customer to key a row by; it still counts in this
        // block's own totals above (`total`/`u`, computed over every receivable/payment regardless of customer).
        const byCustomer = new Set([...recs.map((r) => r.customerId), ...pays.map((p) => p.customerId), ...props.map((p) => p.customerId)].filter((id): id is string => id !== null));
        const fmt = (m: bigint) => formatMoney({ minor: m, currency: currency as Currency });
        const rows = [...byCustomer].sort().map((customerId) => {
          const b = bucketize(recs.filter((r) => r.customerId === customerId), today);
          const own = pays.filter((p) => p.customerId === customerId);
          const u = unallocatedOf(own);
          const ownProposals = props
            .filter((p) => p.customerId === customerId)
            .map((p) => ({ proposalId: p.id, projectId: p.projectId, amount: fmt(p.proposedAmountMinor), proposedOn: p.proposedOn, contingency: p.commissionRateBasisPoints === null ? null : { commissionRateBasisPoints: p.commissionRateBasisPoints, upfrontTreatment: p.upfrontTreatment } }));
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
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
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
      // "Owed with a client, no matter" is MUT-65's default capture shape and belongs to no project, so it
      // would otherwise reach no bucket here while the organization summary counts it — the same client,
      // two different answers. Bucketed through the very helper that summary uses (ADR-033: one definition).
      // MUT-392 review: as on the organization summary, a matterless Owed dated ahead opens no block until its day.
      const matterless = receivables.filter((r) => r.projectId === null && countsOn(r, today));
      const currencies = [...new Set([...projects.map((p) => p.currency), ...payments.map((p) => p.currency), ...matterless.map((r) => r.currency)])].sort();
      const blocks = currencies.map((currency) => {
        const fmt = (m: bigint) => formatMoney({ minor: m, currency: currency as Currency });
        const own = projects.filter((p) => p.currency === currency);
        const b = addBuckets(
          own.reduce((acc, p) => addBuckets(acc, figures.get(p.id)!.figures.buckets), emptyBuckets()),
          bucketize(matterless.filter((r) => r.currency === currency), today),
        );
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
      security: [{ apiKey: [] }, { session: [] }, { deviceSession: [] }],
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

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/activity',
      tags: ['Summaries'],
      summary: 'Received and spent per day or month over a range, per currency, with a 12-month history and days to get paid (portal Reports)',
      description:
        'MUT-175. Received = POSTED payments by receivedOn; spent = expenses by occurredOn. One block per currency — never summed across currencies. The read window is the 12 calendar months ending with `to`, so `history` and `dataSince` come from the same rows; `daysToPaid` is the median over fully settled Owed entries whose last payment falls in that window, null below 3.',
      security: SESSION_ONLY,
      middleware: [requireScope('summaries:read'), requireScope('expenses:read')] as const,
      request: { query: ActivitySummaryQuerySchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: ActivitySummarySchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const today = todayFor(organization, c.get('now')());
      const from = q.from ?? `${monthOf(today)}-01`;
      const to = q.to ?? endOfMonth(today);
      const bucket = q.bucket;
      if (compareIsoDates(from, to) > 0) throw validationError('END_BEFORE_START', '`to` is before `from`', { field: 'to' });
      if (compareIsoDates(to, addDays(`${addMonths(monthOf(from), ACTIVITY_RANGE_MAX_MONTHS)}-01`, -1)) > 0) {
        throw validationError('RANGE_TOO_LONG', `A range covers at most ${ACTIVITY_RANGE_MAX_MONTHS} months`, { field: 'to', maxMonths: ACTIVITY_RANGE_MAX_MONTHS });
      }
      const start = compareIsoDates(from, historyStart(to)) < 0 ? from : historyStart(to);
      const payments = await listAll((cursor) => store.payments.list(organization.id, { status: 'POSTED', receivedAfter: start, receivedBefore: to }, { limit: 200, cursor }));
      // Expenses page on their own cursor shape (occurredOn first), so they walk here rather than through listAll
      const expenses: ExpenseRecord[] = [];
      let cursor = null;
      do {
        const page = await store.expenses.list(organization.id, { from: start, to }, { limit: 200, cursor });
        expenses.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const allocations = await store.payments.listAllocationsFor(organization.id, payments.map((p) => p.id));
      const receivables = await store.receivables.getByIds(organization.id, [...new Set(allocations.map((a) => a.receivableId))]);
      const before = addDays(start, -1);
      const earlierData =
        (await store.payments.list(organization.id, { status: 'POSTED', receivedBefore: before }, { limit: 1, cursor: null })).items.length > 0 ||
        (await store.expenses.list(organization.id, { to: before }, { limit: 1, cursor: null })).items.length > 0;
      const summary = summarizeActivity({ payments, expenses, allocations, receivables, from, to, bucket });
      return c.json({ from, to, bucket, asOf: today, earlierData, ...summary }, 200);
    },
  );

  async function projectSummary(organization: Organization, project: ProjectRecord, receivables: ReceivableRecord[], today: string): Promise<ProjectView> {
    const proposals: FeeProposalRecord[] = await listAll((cursor) => store.feeProposals.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const agreements: AgreementRecord[] = await listAll((cursor) => store.agreements.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const installments: InstallmentRecord[] = [];
    let monthlyMinor: bigint | null = null;
    for (const a of agreements) {
      if ((a.type === 'FIXED' || a.type === 'CONTINGENCY') && a.status === 'ACTIVE') installments.push(...(await store.agreements.listInstallments(organization.id, a.id)));
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
    contingency: f.contingency
      ? { agreementId: f.contingency.agreementId, commissionRateBasisPoints: f.contingency.commissionRateBasisPoints, upfrontTreatment: f.contingency.upfrontTreatment, outcome: f.contingency.outcome, awarded: f.contingency.awardedMinor === null ? null : fmt(f.contingency.awardedMinor) }
      : null,
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

