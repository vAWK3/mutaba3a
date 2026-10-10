import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * Milestone 8 routes (brief `money-v1-m8-overview-ia.md` §6): approving a fee
 * proposal creates the agreement (D5, D15 B, D18), the organization summary
 * carries open proposals (D17), archive is refused while a proposal is open
 * (D19), and the catch-up heals unposted IMMEDIATE installments (D16).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

interface Harness {
  app: ReturnType<typeof createApp>;
  store: MemoryLedgerStore;
  clock: { now: Date };
}

function harness(): Harness {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-10T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.8.0-test', now: () => clock.now, attachments: null });
  return { app, store, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

interface Firm {
  org: { id: string };
  auth: Record<string, string>;
  customer: Loose;
  project: Loose;
}

async function firm(h: Harness, opts: { scopes?: readonly string[]; rate?: number | null; currency?: string } = {}): Promise<Firm> {
  const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: opts.scopes ?? SCOPES }, admin)))) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  if (opts.rate !== null) await h.app.request('/v1/settings/vat', json({ rateBasisPoints: opts.rate ?? 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Property sale', currency: opts.currency ?? 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

async function newProject(h: Harness, f: Firm, currency = 'ILS') {
  return read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: `Matter ${++seq}`, currency }, { ...f.auth, ...idem() })));
}

async function propose(h: Harness, f: Firm, body: Record<string, unknown> = {}) {
  return read(await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE', ...body }, { ...f.auth, ...idem() })));
}

const ONCE = { kind: 'ONCE', dueOn: '2026-10-31' };
const approve = (h: Harness, f: Firm, id: string, body: Record<string, unknown> = {}, headers: Record<string, string> = idem()) =>
  h.app.request(`/v1/fee-proposals/${id}/approve`, json({ amount: '10000.00', schedule: ONCE, ...body }, { ...f.auth, ...headers }));
const withdraw = (h: Harness, f: Firm, id: string) => h.app.request(`/v1/fee-proposals/${id}/withdraw`, json({}, { ...f.auth, ...idem() }));
const audit = async (h: Harness, f: Firm, entityType: string, entityId: string) => (await read(await h.app.request(`/v1/audit?entityType=${entityType}&entityId=${entityId}`, { headers: f.auth }))).items as Loose[];

describe('fee proposal approval creates the agreement (M8)', () => {
  it('ONCE: approves at the final amount, dated approvedOn, one IMMEDIATE installment posted with the due date; links and audits', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await propose(h, f);
    const res = await approve(h, f, p.id, { amount: '9000.00', approvedOn: '2026-10-08', note: 'By phone' });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.proposal).toMatchObject({ id: p.id, status: 'APPROVED', proposedAmount: '10000.00', agreedAmount: '9000.00', clientApprovedOn: '2026-10-08', clientApprovalNote: 'By phone', agreementId: body.agreement.agreement.id, version: 2 });
    expect(Object.keys(body.proposal)).not.toContain('agreedOn');
    expect(body.agreement.agreement).toMatchObject({ projectId: f.project.id, type: 'FIXED', status: 'ACTIVE', amount: '9000.00', net: '9000.00', vat: '1620.00', gross: '10620.00', agreementDate: '2026-10-08', pricingBasis: 'VAT_EXCLUSIVE' });
    expect(body.agreement.installments).toHaveLength(1);
    expect(body.agreement.installments[0]).toMatchObject({ position: 1, trigger: { type: 'IMMEDIATE' }, dueDate: '2026-10-31', status: 'DUE' });
    expect(body.agreement.installments[0].receivableId).not.toBeNull();

    const receivables = await read(await h.app.request(`/v1/receivables?projectId=${f.project.id}`, { headers: f.auth }));
    expect(receivables.items).toHaveLength(1);
    expect(receivables.items[0]).toMatchObject({ gross: '10620.00', outstanding: '10620.00', dueDate: '2026-10-31', status: 'DUE' });

    expect((await audit(h, f, 'fee_proposal', p.id)).map((e) => e.action)).toEqual(['fee_proposal.created', 'fee_proposal.approved']);
    const approvedEvent = (await audit(h, f, 'fee_proposal', p.id))[1];
    expect(approvedEvent.metadata).toMatchObject({ projectId: f.project.id, proposedAmount: '10000.00', agreedAmount: '9000.00', approvedOn: '2026-10-08', agreementId: body.agreement.agreement.id });
    const agreementEvents = await audit(h, f, 'agreement', body.agreement.agreement.id);
    expect(agreementEvents[0].action).toBe('agreement.created');
    expect(agreementEvents[0].metadata).toMatchObject({ feeProposalId: p.id, installments: 1 });

    // the project summary reads the approved proposal beside the agreement
    const summary = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(summary).toMatchObject({ kind: 'FIXED', agreed: '10620.00', proposal: { id: p.id, status: 'APPROVED', agreedAmount: '9000.00', agreementId: body.agreement.agreement.id } });
    // the project is free for a later-phase proposal
    expect((await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '2000.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() }))).status).toBe(201);
  });

  it('INSTALLMENTS: equal shares with the remainder on the first; #1 IMMEDIATE now, the rest DATE monthly (clamped) and posted when due (D15 B)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await propose(h, f);
    const body = await read(await approve(h, f, p.id, { schedule: { kind: 'INSTALLMENTS', count: 3, firstDueOn: '2026-10-31' } }));
    const inst = body.agreement.installments as Loose[];
    expect(inst.map((i) => i.amount)).toEqual(['3333.34', '3333.33', '3333.33']);
    expect(inst[0]).toMatchObject({ position: 1, trigger: { type: 'IMMEDIATE' }, dueDate: '2026-10-31' });
    expect(inst[0].receivableId).not.toBeNull();
    expect(inst[1]).toMatchObject({ position: 2, trigger: { type: 'DATE', date: '2026-11-30' }, dueDate: '2026-11-30', receivableId: null });
    expect(inst[2]).toMatchObject({ position: 3, trigger: { type: 'DATE', date: '2026-12-31' }, dueDate: '2026-12-31', receivableId: null });
    expect(body.agreement.agreement.amount).toBe('10000.00');
    // only the first share is owed today
    const org = await read(await h.app.request('/v1/summaries/organization', { headers: f.auth }));
    expect(org.currencies[0]).toMatchObject({ currency: 'ILS', outstanding: inst[0].gross, proposed: '0.00' });
    // the second posts on its date through the lazy path
    h.clock.now = new Date('2026-12-01T08:00:00Z');
    const detail = await read(await h.app.request(`/v1/agreements/${body.agreement.agreement.id}`, { headers: f.auth }));
    expect(detail.installments[1].receivableId).not.toBeNull();
    expect(detail.installments[2].receivableId).toBeNull();
  });

  it('refuses from APPROVED and WITHDRAWN (409 PROPOSAL_NOT_OPEN), replays idempotently, validates, and needs agreements:write', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await propose(h, f);
    const key = idem();
    const first = await read(await approve(h, f, p.id, {}, key));
    const replay = await approve(h, f, p.id, {}, key);
    expect(replay.status).toBe(200);
    expect((await read(replay)).agreement.agreement.id).toBe(first.agreement.agreement.id);
    expect((await read(await h.app.request(`/v1/agreements?projectId=${f.project.id}`, { headers: f.auth }))).items).toHaveLength(1);

    const again = await approve(h, f, p.id);
    expect(again.status).toBe(409);
    expect((await read(again)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status: 'APPROVED', allowedFrom: ['PROPOSED'] });

    const p2 = await newProject(h, f);
    const q = await propose(h, f, { projectId: p2.id });
    await withdraw(h, f, q.id);
    expect((await read(await approve(h, f, q.id))).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status: 'WITHDRAWN' });

    const p3 = await newProject(h, f);
    const r = await propose(h, f, { projectId: p3.id });
    expect((await read(await approve(h, f, r.id, { amount: '0.00' }))).error.details.reason).toBe('AMOUNT_INVALID');
    expect((await read(await approve(h, f, r.id, { schedule: { kind: 'ONCE', dueOn: '2026-13-01' } }))).error.details.reason).toBe('DATE_INVALID');
    expect((await approve(h, f, r.id, { schedule: { kind: 'INSTALLMENTS', count: 1, firstDueOn: '2026-10-31' } })).status).toBe(422);
    expect((await approve(h, f, r.id, { schedule: { kind: 'INSTALLMENTS', count: 61, firstDueOn: '2026-10-31' } })).status).toBe(422);
    expect((await approve(h, f, r.id, {}, {})).status).toBe(422);
    const readOnly = await firm(h, { scopes: ['agreements:read'] });
    expect((await h.app.request(`/v1/fee-proposals/${r.id}/approve`, json({ amount: '1.00', schedule: ONCE }, { ...readOnly.auth, ...idem() }))).status).toBe(403);
    expect((await h.app.request(`/v1/fee-proposals/${r.id}/approve`, json({ amount: '1.00', schedule: ONCE }, { ...(await firm(h)).auth, ...idem() }))).status).toBe(404);
    // still PROPOSED after every refusal
    expect((await read(await h.app.request(`/v1/fee-proposals/${r.id}`, { headers: f.auth }))).status).toBe('PROPOSED');
  });

  it('422 VAT_RATE_MISSING names the approval date when no rate is in force on it (D18); nothing is created', async () => {
    const h = harness();
    const f = await firm(h, { rate: null });
    const p = await propose(h, f);
    const res = await approve(h, f, p.id, { approvedOn: '2026-10-01' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'VAT_RATE_MISSING', date: '2026-10-01' });
    expect((await read(await h.app.request(`/v1/fee-proposals/${p.id}`, { headers: f.auth }))).status).toBe('PROPOSED');
    expect((await read(await h.app.request(`/v1/agreements?projectId=${f.project.id}`, { headers: f.auth }))).items).toEqual([]);
    // a rate effective after the approval date is still missing on that date; one effective before it works
    await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2026-10-05' }, f.auth, 'PUT'));
    expect((await approve(h, f, p.id, { approvedOn: '2026-10-01' })).status).toBe(422);
    expect((await approve(h, f, p.id, { approvedOn: '2026-10-06' })).status).toBe(200);
  });
});

describe('organization summary carries open proposals (M8, D17)', () => {
  it('a block per currency with proposals, even without receivables; rows list each client\'s PROPOSED proposals; the figure is their sum', async () => {
    const h = harness();
    const f = await firm(h);
    const usd = await newProject(h, f, 'USD');
    const other = await read(await h.app.request('/v1/customers', json({ name: 'Mansour' }, { ...f.auth, ...idem() })));
    const otherProject = await read(await h.app.request('/v1/projects', json({ customerId: other.id, name: 'Lease', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const a = await propose(h, f, { amount: '10000.00' });
    const b = await propose(h, f, { projectId: usd.id, amount: '500.00' });
    const c = await propose(h, f, { projectId: otherProject.id, amount: '2500.00' });
    const withdrawn = await propose(h, f, { projectId: (await newProject(h, f)).id, amount: '99.00' });
    await withdraw(h, f, withdrawn.id);

    const summary = await read(await h.app.request('/v1/summaries/organization', { headers: f.auth }));
    expect(summary.currencies.map((x: Loose) => x.currency)).toEqual(['ILS', 'USD']);
    const ils = summary.currencies[0];
    expect(ils).toMatchObject({ outstanding: '0.00', overdue: '0.00', unallocated: '0.00', proposed: '12500.00', counts: { customers: 2, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 2 } });
    const rows = Object.fromEntries(ils.customers.map((r: Loose) => [r.customerId, r]));
    expect(rows[f.customer.id]).toMatchObject({ outstanding: '0.00', status: 'SETTLED', proposals: [{ proposalId: a.id, projectId: f.project.id, amount: '10000.00', proposedOn: '2026-10-10' }] });
    expect(rows[other.id].proposals).toEqual([{ proposalId: c.id, projectId: otherProject.id, amount: '2500.00', proposedOn: '2026-10-10' }]);
    expect(summary.currencies[1]).toMatchObject({ currency: 'USD', proposed: '500.00', counts: { openProposals: 1 } });
    expect(summary.currencies[1].customers[0].proposals[0]).toMatchObject({ proposalId: b.id, amount: '500.00' });
    const only = await read(await h.app.request('/v1/summaries/organization?currency=USD', { headers: f.auth }));
    expect(only.currencies.map((x: Loose) => x.currency)).toEqual(['USD']);

    // approving moves the money from proposed to outstanding and the row loses its pill
    await approve(h, f, a.id);
    const after = await read(await h.app.request('/v1/summaries/organization?currency=ILS', { headers: f.auth }));
    expect(after.currencies[0]).toMatchObject({ outstanding: '11800.00', proposed: '2500.00', counts: { openProposals: 1 } });
    const afterRows = Object.fromEntries(after.currencies[0].customers.map((r: Loose) => [r.customerId, r]));
    expect(afterRows[f.customer.id]).toMatchObject({ outstanding: '11800.00', status: 'UP_TO_DATE', proposals: [] });
    // another organization sees none of it
    expect((await read(await h.app.request('/v1/summaries/organization', { headers: (await firm(h)).auth }))).currencies).toEqual([]);
  });
});

describe('archive is refused while a proposal is open (M8, D19)', () => {
  it('409 PROPOSAL_OPEN names the proposal; archiving works once it is withdrawn', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await propose(h, f);
    const refused = await h.app.request(`/v1/projects/${f.project.id}/archive`, json({}, { ...f.auth, ...idem() }));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details).toMatchObject({ reason: 'PROPOSAL_OPEN', openProposalId: p.id });
    expect((await read(await h.app.request(`/v1/projects/${f.project.id}`, { headers: f.auth }))).status).toBe('ACTIVE');
    await withdraw(h, f, p.id);
    expect((await h.app.request(`/v1/projects/${f.project.id}/archive`, json({}, { ...f.auth, ...idem() }))).status).toBe(200);
  });
});

describe('the catch-up heals an unposted IMMEDIATE installment (M8, D16)', () => {
  it('an IMMEDIATE installment left unposted is posted on the next read and audited with its own trigger', async () => {
    const h = harness();
    const f = await firm(h);
    const body = { projectId: f.project.id, amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', agreementDate: '2026-10-10', paymentTerms: 'EOM', installments: [{ label: 'Now', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] };
    const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
    // simulate the crash window: create through the store without the route's posting step
    const created = await h.store.agreements.create(
      {
        organizationId: f.org.id,
        projectId: f.project.id,
        customerId: f.customer.id,
        type: 'FIXED',
        currency: 'ILS',
        pricingBasis: 'VAT_EXCLUSIVE',
        vatTreatment: 'STANDARD_RATED',
        vatRateBasisPoints: 1800,
        amountMinor: 100_000n,
        netMinor: 100_000n,
        vatMinor: 18_000n,
        grossMinor: 118_000n,
        agreementDate: '2026-10-10',
        description: null,
        paymentTerms: 'EOM',
        startMonth: null,
        billingDay: null,
        endMonth: null,
        installments: [{ position: 1, label: 'Now', amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 18_000n, grossMinor: 118_000n, vatTreatment: 'STANDARD_RATED', rateBasisPoints: 1800, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null }],
        approveProposal: null,
      },
      h.clock.now,
    );
    expect(preview.previewToken).toBeDefined();
    const only = created.installments[0]!;
    expect(only.receivableId).toBeNull();
    const detail = await read(await h.app.request(`/v1/agreements/${created.agreement.id}`, { headers: f.auth }));
    expect(detail.installments[0].receivableId).not.toBeNull();
    const events = await audit(h, f, 'installment', only.id);
    expect(events.map((e) => e.action)).toEqual(['installment.posted']);
    expect(events[0].metadata).toMatchObject({ trigger: 'IMMEDIATE' });
  });
});

describe('the M8 contract', () => {
  it('publishes 1.7.0-m8 with the three-state lifecycle, the approve body and the summary fields; the agree route and feeProposalId are gone', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(API_VERSION).toBe('1.7.0-m8');
    expect(doc.info.version).toBe('1.7.0-m8');
    for (const path of ['/v1/fee-proposals', '/v1/fee-proposals/{proposalId}', '/v1/fee-proposals/{proposalId}/approve', '/v1/fee-proposals/{proposalId}/withdraw']) expect(doc.paths[path], path).toBeDefined();
    expect(doc.paths['/v1/fee-proposals/{proposalId}/agree']).toBeUndefined();
    expect(doc.components.schemas.FeeProposalStatus.enum).toEqual(['PROPOSED', 'APPROVED', 'WITHDRAWN']);
    expect(doc.components.schemas.AgreementCreateRequest.allOf[1].properties.feeProposalId).toBeUndefined();
    expect(doc.components.schemas.ApproveFeeProposalRequest.properties.schedule).toBeDefined();
    expect(doc.components.schemas.ApproveFeeProposalResponse.properties.agreement).toBeDefined();
    expect(doc.components.schemas.CurrencySummary.properties.proposed).toBeDefined();
    expect(doc.components.schemas.CustomerSummaryRow.properties.proposals).toBeDefined();
    expect(doc.components.schemas.FeeProposal.properties.agreedOn).toBeUndefined();
    expect(doc.info.description).toContain('PROPOSAL_OPEN');
    expect(doc.info.description).not.toContain('PROPOSAL_NOT_AGREED');
  });
});
