import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { lazyPostingOf, requireScope, sessionAuth, type AppEnv } from '../auth/middleware.js';
import { crossRates, type CachedFxRates, type FxRate } from '../fx-rates.js';
import { verdictProfilesOf } from '../personal-profile.js';
import { baseProfileOf, composeVerdict, owedOf, type VerdictProfileInput } from '../summaries/verdict.js';
import { SENTRY_RULES } from '../observability/sentry-rules.js';
import type { VerdictUnavailableCode } from '../schemas.js';
import { assertIsoDate, DAYS_IN_FUTURE_LIMIT, DAYS_IN_PAST_LIMIT, todayFor, validationError, type DateBound } from '../agreements/compose.js';
import { postDueItems } from '../agreements/posting.js';
import { addDays, addMonths, compareIsoDates, endOfMonth, monthOf, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import { currentProposal } from '../proposals/transitions.js';
import type { AgreementRecord, ExpenseCursor, ExpenseRecord, FeeProposalRecord, PageCursor, InstallmentRecord, LedgerStore, Organization, ProjectRecord, ReceivableRecord } from '../repositories/ports.js';
import { latestTerms, termsTimeline } from '../retainers/terms.js';
import { ACTIVITY_RANGE_MAX_MONTHS, ActivitySummaryQuerySchema, ActivitySummarySchema, VerdictQuerySchema, VerdictSchema, CustomerIdParamSchema, CustomerSummarySchema, OrganizationSummarySchema, ProjectIdParamSchema, ProjectSummaryResponseSchema, SummaryCurrencyQuerySchema } from '../schemas.js';
import { serializeFeeProposalSummary } from '../serializers.js';
import { historyEnd, historyStart, summarizeActivity } from '../summaries/activity.js';
import { addBuckets, bucketize, countsOn, customerStatus, emptyBuckets, lastPaymentOn, projectFigures, unallocatedOf, type Buckets, type ProjectFigures } from '../summaries/compute.js';
import { errorResponses, notFoundResponse, validationResponse } from './shared.js';

/** MUT-175: Reports reads a hosted profile's expenses too, so like /v1/summaries/expenses it is session-only. */
const SESSION_ONLY = [{ session: [] }, { deviceSession: [] }];

/**
 * MUT-447: the verdict reads across the person's profiles, so it carries no `X-Mutaba3a-Profile`, like
 * `GET /v1/entries`. Merged into `app.ts`'s and the local app's organization-independent sets.
 */
export const SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES: ReadonlySet<string> = new Set(['GET /v1/summaries/verdict']);

/** /v1/summaries — the figures Malafat renders (M6 brief §2). Computed on read; nothing is materialized. */
export function summaryRoutes(store: LedgerStore, fxRates: CachedFxRates | null = null): OpenAPIHono<AppEnv> {
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
      description: 'Each currency block totals only receivables and payments in that currency (ADR-004). A project row lists under its own currency and counts only its receivables in that currency; an Owed on the project in another currency counts in that currency\'s block, as an Owed with no project does, with no project row there (MUT-488). An Owed dated ahead opens no block until its day (MUT-392).',
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
      // MUT-488: so is an Owed on a matter in another currency — the matter's row counts only its own currency
      // (projectSummary), so the Owed counts here, in its own currency's block (ADR-004).
      // MUT-392 review: as on the organization summary, such an Owed dated ahead opens no block until its day.
      const projectCurrency = new Map(projects.map((p) => [p.id, p.currency]));
      const outsideRows = receivables.filter((r) => (r.projectId === null || r.currency !== projectCurrency.get(r.projectId)) && countsOn(r, today));
      const currencies = [...new Set([...projects.map((p) => p.currency), ...payments.map((p) => p.currency), ...outsideRows.map((r) => r.currency)])].sort();
      const blocks = currencies.map((currency) => {
        const fmt = (m: bigint) => formatMoney({ minor: m, currency: currency as Currency });
        const own = projects.filter((p) => p.currency === currency);
        const b = addBuckets(
          own.reduce((acc, p) => addBuckets(acc, figures.get(p.id)!.figures.buckets), emptyBuckets()),
          bucketize(outsideRows.filter((r) => r.currency === currency), today),
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
      description: 'In the project\'s currency only: an Owed on the project in another currency is left out here and counts in that currency\'s block of GET /v1/summaries/customers/{customerId} (MUT-488).',
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
        'MUT-175. Received = POSTED payments by receivedOn; spent = expenses by occurredOn. One block per currency — never summed across currencies. The read window runs from `from` (or the first of the 12 calendar months ending with `to`’s month, if earlier) through the last day of `to`’s month, so `history` holds whole months and `dataSince` comes from the same rows; the period figures and buckets cover `from`–`to` only. `daysToPaid` is over Owed entries paid in full, measured to their last payment read in the window; null below 3.',
      security: SESSION_ONLY,
      middleware: [requireScope('summaries:read'), requireScope('expenses:read')] as const,
      request: { query: ActivitySummaryQuerySchema },
      responses: { 200: { description: 'Summary', content: { 'application/json': { schema: ActivitySummarySchema } } }, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const { organization } = sessionAuth(c);
      const q = c.req.valid('query');
      const today = todayFor(organization, c.get('now')());
      const { from, to } = reportRange(q, today);
      const bucket = q.bucket;
      const { payments, expenses, earlierData } = await readActivityWindow(organization.id, from, to);
      const allocations = await store.payments.listAllocationsFor(organization.id, payments.map((p) => p.id));
      const receivables = await store.receivables.getByIds(organization.id, [...new Set(allocations.map((a) => a.receivableId))]);
      const summary = summarizeActivity({ payments, expenses, allocations, receivables, from, to, bucket });
      return c.json({ from, to, bucket, asOf: today, earlierData, ...summary }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/summaries/verdict',
      tags: ['Summaries'],
      summary: 'What you kept across your profiles over a range: per profile, per currency and converted, with your usual and what you are owed (portal + phone Reports)',
      description:
        'MUT-447 (ADR-204). Names no profile (no X-Mutaba3a-Profile): it reads the profiles you own or co-own, plus operator firms where your membership is OWNER, never a firm you staff. A profile LOCKED by billing is left out and listed in `unavailable`. ' +
        'Per profile, as GET /v1/summaries/activity: received = POSTED payments by receivedOn, spent = expenses by occurredOn, history = the 12 months ending with to’s month. Due installments are posted first, so owed matches GET /v1/summaries/organization (each profile in its own timezone). ' +
        'Totals are per currency (never summed across currencies) plus one figure converted to `base` at today’s ECB rates; when rates are unavailable the converted figures that need them are null and the read still answers 200. ' +
        'from/to default to this month in the base profile’s timezone; usual is set only for a whole calendar month. A profile that fails to read is listed in `unavailable` and the rest answers.',
      security: SESSION_ONLY,
      request: { query: VerdictQuerySchema },
      responses: { 200: { description: 'Verdict', content: { 'application/json': { schema: VerdictSchema } } }, ...notFoundResponse, ...validationResponse, ...errorResponses },
    }),
    async (c) => {
      const now = c.get('now')();
      // MUT-361 (ADR-181): a LOCKED profile answers only its records export, so the verdict leaves it out (the person-level gate set the map).
      const entitlements = c.get('personEntitlements');
      const locked = new Set([...(entitlements ?? [])].filter(([, e]) => e.state === 'LOCKED').map(([id]) => id));
      const all = await verdictProfilesOf(store, c.get('identity').user.id);
      const held = all.filter((p) => !locked.has(p.organization.id));
      // Review: base and calendar come from a profile that is shown, unless every one is locked.
      const baseRef = baseProfileOf((held.length > 0 ? held : all).map((p) => ({ ...p, createdAt: p.organization.createdAt })));
      if (!baseRef) throw new ApiError('NOT_FOUND', 'No profiles to report on');
      const base = baseRef.organization.defaultCurrency as Currency;
      const asOf = todayFor(baseRef.organization, now);
      const { from, to } = reportRange(c.req.valid('query'), asOf);
      const unavailable: Array<{ profileId: string; name: string; code: VerdictUnavailableCode }> = all
        .filter((p) => locked.has(p.organization.id))
        .map((p) => ({ profileId: p.organization.id, name: p.organization.name, code: 'SUBSCRIPTION_LAPSED' }));
      // Rates read nothing from the profiles, so they load while the profiles do (review).
      const ratesRead = ratesFor(base, c.get('reportError'));
      // LOCKED profiles are dropped above, before any posting (eng review A1); posting is SYSTEM through the one door (D3/D7).
      const posting = lazyPostingOf(c, store);
      const read = await settledWithLimit(held, VERDICT_PROFILE_CONCURRENCY, async ({ organization, kind, shared }): Promise<VerdictProfileInput> => {
        const today = todayFor(organization, now);
        await postDueItems(posting.store, organization, today, now, posting.actor);
        const [window, receivables] = await Promise.all([
          readActivityWindow(organization.id, from, to),
          listAll((cursor) => store.receivables.list(organization.id, { status: 'OPEN' }, { limit: 200, cursor })),
        ]);
        return {
          profileId: organization.id,
          name: organization.name,
          kind,
          shared,
          createdAt: organization.createdAt,
          defaultCurrency: organization.defaultCurrency as Currency,
          timezone: organization.timezone,
          earlierData: window.earlierData,
          activity: summarizeActivity({ payments: window.payments, expenses: window.expenses, allocations: [], receivables: [], from, to, bucket: 'month' }),
          owed: owedOf(receivables, today),
        };
      });
      const profiles: VerdictProfileInput[] = [];
      read.forEach((result, i) => {
        if (result.status === 'fulfilled') return void profiles.push(result.value);
        const { organization } = held[i]!;
        const err: unknown = result.reason;
        // As the shell would for an unhandled error (ADR-091): our bugs and server errors are reported; the client sees INTERNAL either way.
        if (!(err instanceof ApiError) || err.status >= SENTRY_RULES.serverReportsStatusAtLeast) c.get('reportError')(err);
        unavailable.push({ profileId: organization.id, name: organization.name, code: 'INTERNAL' });
      });
      const { rates, meta } = await ratesRead;
      const verdict = composeVerdict({ from, to, base, rates, profiles, partial: unavailable.length > 0, heldKinds: all.map((p) => p.kind) });
      return c.json({ from, to, asOf, rates: meta, ...verdict, unavailable }, 200);
    },
  );

  /**
   * X3 (D4): rates when the cache has them; null — never a 503 or a 500 — when it doesn't, on a server with no rate
   * source, or when reading them fails unexpectedly (reported, review): the verdict's writes have already happened.
   */
  async function ratesFor(base: Currency, reportError: (err: unknown) => void): Promise<{ rates: FxRate[] | null; meta: { date: string; source: 'live' | 'stale' } | null }> {
    if (!fxRates) return { rates: null, meta: null };
    try {
      const reading = await fxRates.get();
      return { rates: crossRates(reading.snapshot, base), meta: { date: reading.snapshot.rateDate, source: reading.source } };
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'FX_RATES_UNAVAILABLE')) reportError(err);
      return { rates: null, meta: null };
    }
  }

  /**
   * MUT-175 (shared with MUT-447): one profile's POSTED payments and expenses over the read window — from (or the 12
   * months ending with to's month, if earlier) through the end of to's month — and whether records exist before it.
   */
  async function readActivityWindow(organizationId: string, from: IsoDate, to: IsoDate) {
    const start = compareIsoDates(from, historyStart(to)) < 0 ? from : historyStart(to);
    const end = historyEnd(to);
    const before = addDays(start, -1);
    const [payments, expenses, paidEarlier, spentEarlier] = await Promise.all([
      listAll((cursor) => store.payments.list(organizationId, { status: 'POSTED', receivedAfter: start, receivedBefore: end }, { limit: 200, cursor })),
      listAll<ExpenseRecord, ExpenseCursor>((cursor) => store.expenses.list(organizationId, { from: start, to: end }, { limit: 200, cursor })),
      store.payments.list(organizationId, { status: 'POSTED', receivedBefore: before }, { limit: 1, cursor: null }),
      store.expenses.list(organizationId, { to: before }, { limit: 1, cursor: null }),
    ]);
    return { payments, expenses, earlierData: paidEarlier.items.length > 0 || spentEarlier.items.length > 0 };
  }

  async function projectSummary(organization: Organization, project: ProjectRecord, receivables: ReceivableRecord[], today: string): Promise<ProjectView> {
    const proposals: FeeProposalRecord[] = await listAll((cursor) => store.feeProposals.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const agreements: AgreementRecord[] = await listAll((cursor) => store.agreements.list(organization.id, { projectId: project.id }, { limit: 200, cursor }));
    const installments: InstallmentRecord[] = [];
    let monthlyMinor: bigint | null = null;
    for (const a of agreements) {
      if ((a.type === 'FIXED' || a.type === 'CONTINGENCY') && a.status === 'ACTIVE') installments.push(...(await store.agreements.listInstallments(organization.id, a.id)));
      if (a.type === 'RECURRING' && a.status === 'ACTIVE') monthlyMinor = latestTerms(termsTimeline(a, await store.agreements.listVersions(organization.id, a.id))).grossMinor;
    }
    // MUT-488: a project's figures are formatted in its currency, so they count only its receivables in that currency;
    // an Owed on it in another currency counts in the customer summary's block for that currency instead.
    const inCurrency = receivables.filter((r) => r.currency === project.currency);
    return { figures: projectFigures({ agreements, installments, receivables: inCurrency, monthlyMinor, today }), proposal: currentProposal(proposals) };
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

/**
 * MUT-175: a Reports date — a real calendar date (422 DATE_INVALID), no further back than the money-date floor plus
 * one year (a Year view may start before the floor day) and no further ahead than the money-date ceiling.
 */
function activityDate(value: string, today: string, field: 'from' | 'to'): string {
  const date = assertIsoDate(value, field);
  if (compareIsoDates(date, addDays(today, -DAYS_IN_PAST_LIMIT - DAYS_IN_YEAR)) < 0) throw validationError('DATE_INVALID', `${field} is too far in the past`, { field, bound: 'past' satisfies DateBound });
  if (compareIsoDates(date, addDays(today, DAYS_IN_FUTURE_LIMIT)) > 0) throw validationError('DATE_INVALID', `${field} is too far ahead`, { field, bound: 'future' satisfies DateBound });
  return date;
}

const DAYS_IN_YEAR = 366;

/** MUT-447 (review): how many of a person's profiles the verdict reads at once, so one request can't take the whole connection pool. */
const VERDICT_PROFILE_CONCURRENCY = 3;

/** Promise.allSettled over `items`, running at most `limit` of `run` at a time; results keep the input order. */
async function settledWithLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      try {
        results[i] = { status: 'fulfilled', value: await run(items[i]!) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** MUT-175 (shared with MUT-447, eng review D5): a Reports range — real dates, from ≤ to, at most 13 calendar months; defaults to `today`'s month. */
function reportRange(q: { from?: string | undefined; to?: string | undefined }, today: IsoDate): { from: IsoDate; to: IsoDate } {
  // Review: the shape regex lets 2026-02-30 or 9999-12-31 through; refuse them before any date arithmetic
  const from = q.from ? activityDate(q.from, today, 'from') : `${monthOf(today)}-01`;
  const to = q.to ? activityDate(q.to, today, 'to') : endOfMonth(today);
  if (compareIsoDates(from, to) > 0) throw validationError('END_BEFORE_START', '`to` is before `from`', { field: 'to' });
  if (compareIsoDates(to, addDays(`${addMonths(monthOf(from), ACTIVITY_RANGE_MAX_MONTHS)}-01`, -1)) > 0) {
    throw validationError('RANGE_TOO_LONG', `A range covers at most the ${ACTIVITY_RANGE_MAX_MONTHS} calendar months starting with from's month`, { field: 'to', maxMonths: ACTIVITY_RANGE_MAX_MONTHS });
  }
  return { from, to };
}

/** Walks every page of a keyset-paginated list, whatever its cursor's shape. */
export async function listAll<T, C = PageCursor>(fetchPage: (cursor: C | null) => Promise<{ items: T[]; nextCursor: C | null }>): Promise<T[]> {
  const all: T[] = [];
  let cursor: C | null = null;
  for (let i = 0; i < 1000; i += 1) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return all;
}

