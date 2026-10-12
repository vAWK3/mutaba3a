import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-107: fee proposals carry contingency terms, and approving one creates a
 * CONTINGENCY agreement (MUT-100 plan §11, D9/D10). Today is 2026-10-13 in
 * Asia/Jerusalem.
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
  const clock = { now: new Date('2026-10-13T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.3.0-test', now: () => clock.now, attachments: null });
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

async function firm(h: Harness, opts: { scopes?: readonly string[] } = {}): Promise<Firm> {
  const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)))) as { id: string };
  const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: opts.scopes ?? SCOPES }, admin)))) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

async function newProject(h: Harness, f: Firm, currency = 'ILS') {
  return read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: `Matter ${++seq}`, currency }, { ...f.auth, ...idem() })));
}

const CONTINGENCY = { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' };

function propose(h: Harness, f: Firm, body: Record<string, unknown> = {}) {
  return h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', contingency: CONTINGENCY, ...body }, { ...f.auth, ...idem() }));
}

const ONCE = { kind: 'ONCE', dueOn: '2026-10-31' };
function approve(h: Harness, f: Firm, id: string, body: Record<string, unknown> = {}) {
  return h.app.request(`/v1/fee-proposals/${id}/approve`, json({ amount: '1500.00', ...body }, { ...f.auth, ...idem() }));
}

async function proposedContingency(h: Harness, f: Firm, body: Record<string, unknown> = {}) {
  const res = await propose(h, f, body);
  expect(res.status).toBe(201);
  return read(res);
}

describe('MUT-107: propose a contingency deal', () => {
  it('upfront 1500: 201, contingency echoed, counts toward Proposed', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f);
    expect(p).toMatchObject({ proposedAmount: '1500.00', pricingBasis: 'VAT_EXCLUSIVE', contingency: CONTINGENCY });
  });

  it('upfront 0: 201', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f, { amount: '0.00' });
    expect(p).toMatchObject({ proposedAmount: '0.00', contingency: CONTINGENCY });
  });

  it('out-of-range rate: 422 COMMISSION_RATE_INVALID', async () => {
    const h = harness();
    const f = await firm(h);
    const tooLow = await propose(h, f, { contingency: { ...CONTINGENCY, commissionRateBasisPoints: 0 } });
    expect((await read(tooLow)).error.details.reason).toBe('COMMISSION_RATE_INVALID');
    const tooHigh = await propose(h, f, { contingency: { ...CONTINGENCY, commissionRateBasisPoints: 10001 } });
    expect((await read(tooHigh)).error.details.reason).toBe('COMMISSION_RATE_INVALID');
  });

  it('negative upfront: 422 AMOUNT_INVALID; FIXED propose at 0 is still refused (regression)', async () => {
    const h = harness();
    const f = await firm(h);
    const negative = await propose(h, f, { amount: '-1.00' });
    expect((await read(negative)).error.details.reason).toBe('AMOUNT_INVALID');
    const fixedZero = await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '0.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() }));
    expect((await read(fixedZero)).error.details.reason).toBe('AMOUNT_INVALID');
  });

  it('one open proposal per project is still enforced across types', async () => {
    const h = harness();
    const f = await firm(h);
    await proposedContingency(h, f);
    const second = await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() }));
    expect(second.status).toBe(409);
    expect((await read(second)).error.details.reason).toBe('PROPOSAL_OPEN');
  });
});

describe('MUT-107: approve a contingency proposal', () => {
  it('no override: the agreement carries the originally proposed terms; FeeProposal.contingency still shows the proposed terms', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f);
    const res = await approve(h, f, p.id, { schedule: ONCE });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.proposal).toMatchObject({ status: 'APPROVED', agreedAmount: '1500.00', contingency: CONTINGENCY });
    expect(body.agreement.agreement).toMatchObject({ type: 'CONTINGENCY', contingency: CONTINGENCY, amount: '1500.00' });
  });

  it('with an override: the agreement carries the overridden terms; the proposal still echoes the original proposed terms', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f);
    const override = { commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED' };
    const res = await approve(h, f, p.id, { schedule: ONCE, contingency: override });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.agreement.agreement).toMatchObject({ type: 'CONTINGENCY', contingency: override });
    expect(body.proposal.contingency).toEqual(CONTINGENCY);

    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}`, { headers: f.auth }));
    expect(audit.items[1].metadata).toMatchObject({ contingency: override });
  });

  it('0-upfront without a schedule: 201, no installments, agreement type CONTINGENCY', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f, { amount: '0.00' });
    const res = await approve(h, f, p.id, { amount: '0.00' });
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.agreement.agreement).toMatchObject({ type: 'CONTINGENCY', amount: '0.00' });
    expect(body.agreement.installments).toHaveLength(0);
  });

  it('upfront > 0 without a schedule: 422 SCHEDULE_REQUIRED', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f);
    const res = await approve(h, f, p.id, {});
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('SCHEDULE_REQUIRED');
  });

  it('a 0-upfront approval with a schedule sent anyway: 422 NON_POSITIVE_INSTALLMENT, the existing schedule guard already covers it', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f, { amount: '0.00' });
    const res = await approve(h, f, p.id, { amount: '0.00', schedule: ONCE });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('NON_POSITIVE_INSTALLMENT');
  });

  it('a FIXED proposal approved with no schedule: 422 SCHEDULE_REQUIRED (the reviewed regression, R8/D10)', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() })));
    const res = await h.app.request(`/v1/fee-proposals/${p.id}/approve`, json({ amount: '10000.00' }, { ...f.auth, ...idem() }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('SCHEDULE_REQUIRED');
  });

  it('a FIXED proposal approved with a contingency override: 422 NOT_CONTINGENCY', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() })));
    const res = await h.app.request(`/v1/fee-proposals/${p.id}/approve`, json({ amount: '10000.00', schedule: ONCE, contingency: CONTINGENCY }, { ...f.auth, ...idem() }));
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('NOT_CONTINGENCY');
  });

  it('a contingency approval with a negative amount: 422 AMOUNT_INVALID', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await proposedContingency(h, f);
    const res = await approve(h, f, p.id, { amount: '-1.00', schedule: ONCE });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details.reason).toBe('AMOUNT_INVALID');
  });
});

describe('MUT-107: CurrencySummary.proposed counts the contingency upfront only', () => {
  it('one FIXED (10000) + one CONTINGENCY (1500 upfront) proposal = 11500; the customer row echoes contingency', async () => {
    const h = harness();
    const f = await firm(h);
    const second = await newProject(h, f);
    await h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...idem() }));
    await propose(h, f, { projectId: second.id });

    const summary = await read(await h.app.request('/v1/summaries/organization', { headers: f.auth }));
    const ils = summary.currencies.find((c: Loose) => c.currency === 'ILS');
    expect(ils).toMatchObject({ proposed: '11500.00', counts: { openProposals: 2 } });
    const row = ils.customers.find((r: Loose) => r.customerId === f.customer.id);
    const contingencyRow = row.proposals.find((pr: Loose) => pr.projectId === second.id);
    expect(contingencyRow).toMatchObject({ amount: '1500.00', contingency: CONTINGENCY });
  });
});
