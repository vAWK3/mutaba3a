import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-479: a fee proposal stores a full draft agreement, and approving takes the full body with a preview token. Today is 2026-10-28 in Asia/Jerusalem. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const reason = async (res: Response) => (await read(res)).error.details.reason;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };

function harness(now = '2026-10-28T10:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(now) };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.3.0-test', now: () => clock.now });
  return { app, store, clock };
}
type H = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: H) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(201);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}
type F = Awaited<ReturnType<typeof firm>>;

const SPLIT = {
  kind: 'FIXED',
  amount: '10000.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  installments: [
    { label: 'On signing', percentBasisPoints: 3000, trigger: { type: 'IMMEDIATE' } },
    { label: 'On judgment', percentBasisPoints: 7000, trigger: { type: 'MANUAL' } },
  ],
};
const RETAINER = { kind: 'RETAINER', monthlyAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-09', billingDay: 1, description: 'Monthly advice' };
const CONTINGENCY = { kind: 'CONTINGENCY', amount: '0.00', pricingBasis: 'VAT_EXCLUSIVE', installments: [], contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } };

const propose = (h: H, f: F, body: Record<string, unknown>, project = f.project) => h.app.request('/v1/fee-proposals', json({ projectId: project.id, ...body }, { ...f.auth, ...idem() }));
async function proposed(h: H, f: F, draft: unknown, extra: Record<string, unknown> = {}) {
  const res = await propose(h, f, { draft, ...extra });
  expect(res.status).toBe(201);
  return read(res);
}
const previewApprove = (h: H, f: F, id: string, body: Record<string, unknown>) => h.app.request(`/v1/fee-proposals/${id}/approve/preview`, json(body, f.auth));
const approve = (h: H, f: F, id: string, body: Record<string, unknown>, headers: Record<string, string> = idem()) => h.app.request(`/v1/fee-proposals/${id}/approve`, json(body, { ...f.auth, ...headers }));
async function previewed(h: H, f: F, id: string, body: Record<string, unknown>) {
  const res = await previewApprove(h, f, id, body);
  expect(res.status).toBe(200);
  return read(res);
}
async function approved(h: H, f: F, id: string, body: Record<string, unknown>) {
  const p = await previewed(h, f, id, body);
  const res = await approve(h, f, id, { ...body, previewToken: p.previewToken });
  expect(res.status).toBe(200);
  return read(res);
}
const audit = async (h: H, f: F, entityType: string, entityId: string) => (await read(await h.app.request(`/v1/audit?entityType=${entityType}&entityId=${entityId}`, { headers: f.auth }))).items as Loose[];

describe('AC1: a 30/70 split with a MANUAL second stage', () => {
  it('is stored as the proposal’s draft and read back on GET', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT, { note: 'Sent by email' });
    expect(p).toMatchObject({ status: 'PROPOSED', agreementType: 'FIXED', proposedAmount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE', contingency: null, note: 'Sent by email' });
    const got = await read(await h.app.request(`/v1/fee-proposals/${p.id}`, { headers: f.auth }));
    expect(got.draft).toEqual({ schemaVersion: 1, ...SPLIT, paymentTerms: 'EOM' });
  });

  it('previews, then approves into exactly those installments: the first posted, the MANUAL one pending', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT);
    const preview = await previewed(h, f, p.id, { agreement: SPLIT });
    expect(preview).toMatchObject({ kind: 'FIXED', type: 'FIXED', totals: { amount: '10000.00', gross: '11800.00' }, previewToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(preview.installments.map((i: Loose) => [i.amount, i.trigger.type])).toEqual([['3000.00', 'IMMEDIATE'], ['7000.00', 'MANUAL']]);
    const res = await approve(h, f, p.id, { agreement: SPLIT, previewToken: preview.previewToken, note: 'Signed' });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '10000.00', clientApprovedOn: '2026-10-28', clientApprovalNote: 'Signed', agreementId: body.agreement.agreement.id, agreementType: 'FIXED' });
    expect(body.agreement.agreement).toMatchObject({ type: 'FIXED', amount: '10000.00', agreementDate: '2026-10-28', projectId: f.project.id });
    const [first, second] = body.agreement.installments;
    expect(first).toMatchObject({ amount: '3000.00', trigger: { type: 'IMMEDIATE' }, receivableId: expect.any(String) });
    expect(second).toMatchObject({ amount: '7000.00', trigger: { type: 'MANUAL' }, receivableId: null, status: 'PENDING' });
    expect(body.charges).toEqual([]);
  });
});

describe('AC2: a retainer proposal', () => {
  it('approves into a retainer starting on the draft’s month, with the charges due by today posted', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, RETAINER);
    expect(p).toMatchObject({ agreementType: 'RECURRING', proposedAmount: '1500.00', contingency: null });
    const preview = await previewed(h, f, p.id, { agreement: RETAINER });
    expect(preview).toMatchObject({ kind: 'RETAINER', monthly: { amount: '1500.00', gross: '1770.00' } });
    expect(preview.chargesDueNow.map((c: Loose) => c.serviceMonth)).toEqual(['2026-09', '2026-10']);
    const body = await read(await approve(h, f, p.id, { agreement: RETAINER, previewToken: preview.previewToken }));
    expect(body.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '1500.00', agreementType: 'RECURRING' });
    expect(body.agreement.agreement).toMatchObject({ type: 'RECURRING', amount: '1500.00', description: 'Monthly advice', retainer: { startMonth: '2026-09', billingDay: 1, endMonth: null } });
    expect(body.agreement.installments).toEqual([]);
    expect(body.charges.map((c: Loose) => [c.serviceMonth, c.gross])).toEqual([['2026-09', '1770.00'], ['2026-10', '1770.00']]);
    const created = await audit(h, f, 'agreement', body.agreement.agreement.id);
    expect(created.find((e) => e.action === 'retainer.created').metadata).toMatchObject({ feeProposalId: p.id, startMonth: '2026-09' });
    const events = await audit(h, f, 'fee_proposal', p.id);
    expect(events.find((e) => e.action === 'fee_proposal.approved').metadata).toMatchObject({ agreementType: 'RECURRING', draftChanged: false, agreedAmount: '1500.00' });
  });

  it('refuses the legacy {amount, schedule} approve with DRAFT_REQUIRED (R1)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, RETAINER);
    const res = await approve(h, f, p.id, { amount: '1500.00', schedule: { kind: 'ONCE', dueOn: '2026-10-31' } });
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe('DRAFT_REQUIRED');
  });
});

describe('AC3: stale previews and closed proposals', () => {
  it('an agreement edited after its preview is 409 PREVIEW_STALE, and nothing is approved', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT);
    const preview = await previewed(h, f, p.id, { agreement: SPLIT });
    const res = await approve(h, f, p.id, { agreement: { ...SPLIT, amount: '9000.00' }, previewToken: preview.previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect((await read(await h.app.request(`/v1/fee-proposals/${p.id}`, { headers: f.auth }))).status).toBe('PROPOSED');
  });

  it('an omitted approvedOn that crosses midnight is PREVIEW_STALE (R5)', async () => {
    const h = harness('2026-10-28T20:00:00Z');
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT);
    const preview = await previewed(h, f, p.id, { agreement: SPLIT });
    h.clock.now = new Date('2026-10-28T22:30:00Z');
    const res = await approve(h, f, p.id, { agreement: SPLIT, previewToken: preview.previewToken });
    expect(await reason(res)).toBe('PREVIEW_STALE');
  });

  it('an approved or withdrawn proposal is 409 PROPOSAL_NOT_OPEN at both preview and approve', async () => {
    const h = harness();
    const f = await firm(h);
    const done = await proposed(h, f, SPLIT);
    const token = (await previewed(h, f, done.id, { agreement: SPLIT })).previewToken;
    await approved(h, f, done.id, { agreement: SPLIT });
    const other = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Appeal', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const gone = await read(await propose(h, f, { draft: SPLIT }, other));
    expect((await h.app.request(`/v1/fee-proposals/${gone.id}/withdraw`, json({}, { ...f.auth, ...idem() }))).status).toBe(200);
    for (const [id, status] of [[done.id, 'APPROVED'], [gone.id, 'WITHDRAWN']]) {
      const pre = await previewApprove(h, f, id, { agreement: SPLIT });
      expect(pre.status).toBe(409);
      expect((await read(pre)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status });
      const res = await approve(h, f, id, { agreement: SPLIT, previewToken: token });
      expect(res.status).toBe(409);
      expect((await read(res)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status });
    }
  });
});

describe('AC4: the contract', () => {
  it('publishes 1.87.0-mut479 with the approve preview, the draft and the agreement type', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(API_VERSION).toBe('1.87.0-mut479');
    expect(doc.info.version).toBe('1.87.0-mut479');
    expect(doc.paths['/v1/fee-proposals/{proposalId}/approve/preview']).toBeDefined();
    expect(doc.components.schemas.AgreementDraft).toBeDefined();
    expect(doc.components.schemas.FeeProposal.properties).toHaveProperty('draft');
    expect(doc.components.schemas.FeeProposal.properties).toHaveProperty('agreementType');
    expect(doc.components.schemas.CustomerSummaryProposal.properties).toHaveProperty('agreementType');
    expect(doc.components.schemas.FeeProposalSummary.properties).toHaveProperty('agreementType');
    expect(doc.components.schemas.ApproveFeeProposalResponse.properties).toHaveProperty('charges');
  });
});

describe('creating a proposal with a draft (D2, R8)', () => {
  it('refuses a draft that could never approve, and stores nothing', async () => {
    const h = harness();
    const f = await firm(h);
    const res = await propose(h, f, { draft: { ...SPLIT, installments: [{ label: 'Half', percentBasisPoints: 5000, trigger: { type: 'IMMEDIATE' } }, { label: 'Rest', percentBasisPoints: 4000, trigger: { type: 'MANUAL' } }] } });
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe('PERCENTS_DO_NOT_SUM');
    expect((await read(await h.app.request(`/v1/fee-proposals?projectId=${f.project.id}`, { headers: f.auth }))).items).toEqual([]);
  });

  it('composes on proposedOn, so a backdated draft with no VAT rate in force is VAT_RATE_MISSING', async () => {
    const h = harness();
    const f = await firm(h);
    const res = await propose(h, f, { draft: SPLIT, proposedOn: '2024-12-01' });
    expect(await reason(res)).toBe('VAT_RATE_MISSING');
  });

  it('DRAFT_CONFLICT when both forms are sent; AMOUNT_REQUIRED when neither is', async () => {
    const h = harness();
    const f = await firm(h);
    for (const extra of [{ amount: '10000.00' }, { pricingBasis: 'VAT_EXCLUSIVE' }, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' } }]) {
      const res = await propose(h, f, { draft: SPLIT, ...extra });
      expect(res.status).toBe(422);
      expect(await reason(res)).toBe('DRAFT_CONFLICT');
    }
    expect(await reason(await propose(h, f, { note: 'nothing else' }))).toBe('AMOUNT_REQUIRED');
    expect(await reason(await propose(h, f, { amount: '100.00' }))).toBe('AMOUNT_REQUIRED');
  });

  it('a FIXED draft carrying contingency terms is refused (R7)', async () => {
    const h = harness();
    const f = await firm(h);
    const res = await propose(h, f, { draft: { ...SPLIT, contingency: CONTINGENCY.contingency } });
    expect(res.status).toBe(422);
  });

  it('the legacy form still works and records its type, with no draft', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await propose(h, f, { amount: '0.00', pricingBasis: 'VAT_EXCLUSIVE', contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' } }));
    expect(p).toMatchObject({ agreementType: 'CONTINGENCY', draft: null, proposedAmount: '0.00' });
  });
});

describe('approving with the full body', () => {
  it('a contingency draft approves into CONTINGENCY with its terms', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, CONTINGENCY);
    expect(p).toMatchObject({ agreementType: 'CONTINGENCY', proposedAmount: '0.00', contingency: CONTINGENCY.contingency });
    const body = await approved(h, f, p.id, { agreement: CONTINGENCY });
    expect(body.agreement.agreement).toMatchObject({ type: 'CONTINGENCY', contingency: CONTINGENCY.contingency });
    expect(body.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '0.00' });
  });

  it('the agreement may be edited at approval: the approved amount is the edited one and the audit says so (D5)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT);
    const edited = { ...SPLIT, amount: '9000.00' };
    const body = await approved(h, f, p.id, { agreement: edited, approvedOn: '2026-10-27' });
    expect(body.proposal).toMatchObject({ proposedAmount: '10000.00', agreedAmount: '9000.00', clientApprovedOn: '2026-10-27' });
    expect(body.agreement.agreement).toMatchObject({ amount: '9000.00', agreementDate: '2026-10-27' });
    const event = (await audit(h, f, 'fee_proposal', p.id)).find((e) => e.action === 'fee_proposal.approved');
    expect(event.metadata).toMatchObject({ agreementType: 'FIXED', draftChanged: true, proposedAmount: '10000.00', agreedAmount: '9000.00' });
  });

  it('a legacy proposal (no draft) approves with the full body; draftChanged is null', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await propose(h, f, { amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE' }));
    const body = await approved(h, f, p.id, { agreement: SPLIT });
    expect(body.agreement.installments).toHaveLength(2);
    const event = (await audit(h, f, 'fee_proposal', p.id)).find((e) => e.action === 'fee_proposal.approved');
    expect(event.metadata.draftChanged).toBeNull();
  });

  it('PREVIEW_TOKEN_REQUIRED without a token; DRAFT_CONFLICT when mixed with the legacy fields', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, SPLIT);
    expect(await reason(await approve(h, f, p.id, { agreement: SPLIT }))).toBe('PREVIEW_TOKEN_REQUIRED');
    const token = (await previewed(h, f, p.id, { agreement: SPLIT })).previewToken;
    for (const extra of [{ amount: '10000.00' }, { schedule: { kind: 'ONCE', dueOn: '2026-10-31' } }, { contingency: CONTINGENCY.contingency }]) {
      expect(await reason(await approve(h, f, p.id, { agreement: SPLIT, previewToken: token, ...extra }))).toBe('DRAFT_CONFLICT');
    }
    expect(await reason(await approve(h, f, p.id, { note: 'no amount, no agreement' }))).toBe('AMOUNT_REQUIRED');
  });

  it('replays an approval with the same idempotency key: the same answer, one agreement', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposed(h, f, RETAINER);
    const token = (await previewed(h, f, p.id, { agreement: RETAINER })).previewToken;
    const key = idem();
    const first = await approve(h, f, p.id, { agreement: RETAINER, previewToken: token }, key);
    const again = await approve(h, f, p.id, { agreement: RETAINER, previewToken: token }, key);
    expect(again.status).toBe(200);
    expect(await read(again)).toEqual(await read(first));
    expect((await read(await h.app.request(`/v1/agreements?projectId=${f.project.id}`, { headers: f.auth }))).items).toHaveLength(1);
  });
});

describe('summaries (D3, R9)', () => {
  it('the organization summary’s proposed leaves a retainer proposal out, but its customer row lists it and counts it', async () => {
    const h = harness();
    const f = await firm(h);
    await proposed(h, f, SPLIT);
    const other = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Advice', currency: 'ILS' }, { ...f.auth, ...idem() })));
    await read(await propose(h, f, { draft: RETAINER }, other));
    const summary = await read(await h.app.request('/v1/summaries/organization', { headers: f.auth }));
    const block = summary.currencies.find((c: Loose) => c.currency === 'ILS');
    expect(block.proposed).toBe('10000.00');
    expect(block.counts.openProposals).toBe(2);
    const row = block.customers.find((r: Loose) => r.customerId === f.customer.id);
    expect(row.proposals.map((x: Loose) => [x.amount, x.agreementType]).sort()).toEqual([['10000.00', 'FIXED'], ['1500.00', 'RECURRING']]);
    const project = await read(await h.app.request(`/v1/summaries/projects/${other.id}`, { headers: f.auth }));
    expect(project.proposal).toMatchObject({ agreementType: 'RECURRING', proposedAmount: '1500.00' });
  });
});
