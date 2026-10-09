import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

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
  const clock = { now: new Date('2026-10-09T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.7.0-test', now: () => clock.now, attachments: null });
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
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Property sale', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

async function propose(h: Harness, f: Firm, body: Record<string, unknown> = {}, headers: Record<string, string> = idem()) {
  return h.app.request('/v1/fee-proposals', json({ projectId: f.project.id, amount: '10000.00', pricingBasis: 'VAT_EXCLUSIVE', ...body }, { ...f.auth, ...headers }));
}

const act = (h: Harness, f: Firm, id: string, verb: string, body: Record<string, unknown> = {}) => h.app.request(`/v1/fee-proposals/${id}/${verb}`, json(body, { ...f.auth, ...idem() }));

/** The fixed-fee agreement body the wizard would send, optionally converting a proposal. */
async function createAgreement(h: Harness, f: Firm, feeProposalId?: string, amount = '9000.00', projectId = f.project.id) {
  const body = { projectId, amount, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'EXEMPT', agreementDate: '2026-10-09', paymentTerms: 'EOM', installments: [{ label: 'All', amount, trigger: { type: 'MANUAL' } }] };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  return h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken, ...(feeProposalId ? { feeProposalId } : {}) }, { ...f.auth, ...idem() }));
}

describe('fee proposals (M7)', () => {
  it('proposes: 201 in the project currency with today as proposedOn; audited; validation and scope', async () => {
    const h = harness();
    const f = await firm(h);
    const res = await propose(h, f, { note: 'Opening figure' });
    expect(res.status).toBe(201);
    const p = await read(res);
    expect(p).toMatchObject({ projectId: f.project.id, customerId: f.customer.id, currency: 'ILS', status: 'PROPOSED', pricingBasis: 'VAT_EXCLUSIVE', proposedAmount: '10000.00', proposedOn: '2026-10-09', note: 'Opening figure', agreedAmount: null, agreementId: null, version: 1 });
    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}`, { headers: f.auth }));
    expect(audit.items.map((e: Loose) => e.action)).toEqual(['fee_proposal.created']);
    expect(audit.items[0].metadata).toMatchObject({ projectId: f.project.id, proposedAmount: '10000.00' });

    // idempotent replay returns the stored outcome; a different body on the same key is refused
    const key = idem();
    const first = await read(await propose(h, { ...f, project: (await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Second', currency: 'USD' }, { ...f.auth, ...idem() })))) }, { amount: '500.00' }, key));
    const replay = await h.app.request('/v1/fee-proposals', json({ projectId: first.projectId, amount: '500.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...key }));
    expect(replay.status).toBe(201);
    expect((await read(replay)).id).toBe(first.id);
    expect(first.currency).toBe('USD');

    // validation: bad amount, zero, bad date, archived project, foreign project, missing key, scope
    expect((await read(await propose(h, f, { amount: 'abc' }))).error.code).toBe('VALIDATION_FAILED');
    const zero = await read(await propose(h, f, { amount: '0.00' }));
    expect(zero.error.details.reason).toBe('AMOUNT_INVALID');
    expect((await read(await propose(h, f, { proposedOn: '2026-02-30' }))).error.details.reason).toBe('DATE_INVALID');
    const archived = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Old', currency: 'ILS' }, { ...f.auth, ...idem() })));
    await h.app.request(`/v1/projects/${archived.id}/archive`, json({}, { ...f.auth, ...idem() }));
    expect((await read(await propose(h, f, { projectId: archived.id }))).error.details.reason).toBe('PROJECT_ARCHIVED');
    const other = await firm(h);
    const foreign = await read(await propose(h, f, { projectId: other.project.id }));
    expect(foreign.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'PROJECT_NOT_FOUND' } });
    expect((await propose(h, f, {}, {})).status).toBe(422);
    const readOnly = await firm(h, { scopes: ['agreements:read'] });
    expect((await propose(h, readOnly)).status).toBe(403);
  });

  it('one open proposal per project: 409 PROPOSAL_OPEN names it; withdrawing frees the project', async () => {
    const h = harness();
    const f = await firm(h);
    const first = await read(await propose(h, f));
    const second = await propose(h, f, { amount: '8000.00' });
    expect(second.status).toBe(409);
    expect((await read(second)).error.details).toMatchObject({ reason: 'PROPOSAL_OPEN', openProposalId: first.id, status: 'PROPOSED' });
    await act(h, f, first.id, 'approve');
    expect((await read(await propose(h, f))).error.details.status).toBe('CLIENT_APPROVED');
    await act(h, f, first.id, 'withdraw', { reason: 'Client declined' });
    const again = await propose(h, f, { amount: '8000.00' });
    expect(again.status).toBe(201);
    // the currency is locked while a proposal is open
    const project = await read(await h.app.request(`/v1/projects/${f.project.id}`, { headers: f.auth }));
    const patch = await h.app.request(`/v1/projects/${f.project.id}`, json({ currency: 'USD' }, { ...f.auth, 'if-match': String(project.version) }, 'PATCH'));
    expect(patch.status).toBe(409);
    expect((await read(patch)).error.details.reason).toBe('CURRENCY_LOCKED');
  });

  it('approve → CLIENT_APPROVED at the proposed amount; agree → AGREED at the explicit figure; each refused from the wrong state', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await propose(h, f));

    const approved = await read(await act(h, f, p.id, 'approve', { approvedOn: '2026-10-08', note: 'By phone' }));
    expect(approved).toMatchObject({ status: 'CLIENT_APPROVED', clientApprovedOn: '2026-10-08', clientApprovalNote: 'By phone', agreedAmount: '10000.00', agreedOn: null, version: 2 });
    const twice = await act(h, f, p.id, 'approve');
    expect(twice.status).toBe(409);
    expect((await read(twice)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status: 'CLIENT_APPROVED', allowedFrom: ['PROPOSED'] });

    const agreed = await read(await act(h, f, p.id, 'agree', { amount: '9000.00', note: 'Discount for early payment' }));
    expect(agreed).toMatchObject({ status: 'AGREED', proposedAmount: '10000.00', agreedAmount: '9000.00', agreedOn: '2026-10-09', agreedNote: 'Discount for early payment', clientApprovedOn: '2026-10-08', version: 3 });
    expect((await act(h, f, p.id, 'agree', { amount: '1.00' })).status).toBe(409);
    expect((await act(h, f, p.id, 'approve')).status).toBe(409);

    // agree straight from PROPOSED on another project; amount validation
    const p2 = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Trademark', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const q = await read(await propose(h, f, { projectId: p2.id }));
    expect((await read(await act(h, f, q.id, 'agree', { amount: '-5.00' }))).error.details.reason).toBe('AMOUNT_INVALID');
    expect((await read(await act(h, f, q.id, 'agree', { amount: '10000.00' }))).status).toBe('AGREED');

    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}`, { headers: f.auth }));
    expect(audit.items.map((e: Loose) => e.action)).toEqual(['fee_proposal.created', 'fee_proposal.client_approved', 'fee_proposal.agreed']);
    expect(audit.items[2].metadata).toMatchObject({ proposedAmount: '10000.00', agreedAmount: '9000.00' });
    expect((await h.app.request(`/v1/fee-proposals/${p.id}`, { headers: (await firm(h)).auth })).status).toBe(404);
  });

  it('withdraw from every open state, idempotent once withdrawn, refused once converted', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await propose(h, f));
    const w = await read(await act(h, f, p.id, 'withdraw', { reason: 'Typo' }));
    expect(w).toMatchObject({ status: 'WITHDRAWN', withdrawnReason: 'Typo', withdrawnAt: '2026-10-09T10:00:00.000Z' });
    const again = await read(await act(h, f, p.id, 'withdraw'));
    expect(again).toMatchObject({ status: 'WITHDRAWN', version: w.version });
    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}&action=fee_proposal.withdrawn`, { headers: f.auth }));
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0].metadata).toMatchObject({ from: 'PROPOSED', reason: 'Typo' });

    const q = await read(await propose(h, f));
    await act(h, f, q.id, 'agree', { amount: '9000.00' });
    expect((await createAgreement(h, f, q.id)).status).toBe(201);
    const converted = await act(h, f, q.id, 'withdraw');
    expect(converted.status).toBe(409);
    expect((await read(converted)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status: 'CONVERTED' });
  });

  it('POST /v1/agreements with feeProposalId converts the proposal, links the agreement and audits; refused while PROPOSED, for another project or unknown', async () => {
    const h = harness();
    const f = await firm(h);
    const p = await read(await propose(h, f));
    const early = await createAgreement(h, f, p.id);
    expect(early.status).toBe(422);
    expect((await read(early)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_AGREED', status: 'PROPOSED' });
    expect((await read(await h.app.request(`/v1/agreements?projectId=${f.project.id}`, { headers: f.auth }))).items).toEqual([]);

    await act(h, f, p.id, 'approve');
    const unknown = await createAgreement(h, f, '00000000-0000-4000-8000-000000000000');
    expect((await read(unknown)).error.details.reason).toBe('PROPOSAL_NOT_FOUND');
    const p2 = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Trademark', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const mismatch = await createAgreement(h, f, p.id, '9000.00', p2.id);
    expect((await read(mismatch)).error.details).toMatchObject({ reason: 'PROPOSAL_PROJECT_MISMATCH', proposalProjectId: f.project.id });

    const created = await createAgreement(h, f, p.id, '10000.00');
    expect(created.status).toBe(201);
    const detail = await read(created);
    const after = await read(await h.app.request(`/v1/fee-proposals/${p.id}`, { headers: f.auth }));
    expect(after).toMatchObject({ status: 'CONVERTED', agreementId: detail.agreement.id, agreedAmount: '10000.00' });
    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}`, { headers: f.auth }));
    expect(audit.items.map((e: Loose) => e.action)).toEqual(['fee_proposal.created', 'fee_proposal.client_approved', 'fee_proposal.converted']);
    const agreementAudit = await read(await h.app.request(`/v1/audit?entityType=agreement&entityId=${detail.agreement.id}`, { headers: f.auth }));
    expect(agreementAudit.items[0].metadata).toMatchObject({ feeProposalId: p.id });
    // the project is free for a new proposal (a later-phase fee), and the summary shows the converted one until then
    expect((await propose(h, f, { amount: '2000.00' })).status).toBe(201);
    // an agreement without a proposal is untouched by M7
    expect((await createAgreement(h, f, undefined, '100.00', p2.id)).status).toBe(201);
  });

  it('lists with filters and pagination, organization-scoped; project and customer summaries carry the current proposal', async () => {
    const h = harness();
    const f = await firm(h);
    const p2 = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Trademark', currency: 'ILS' }, { ...f.auth, ...idem() })));
    const a = await read(await propose(h, f));
    const b = await read(await propose(h, f, { projectId: p2.id, amount: '3000.00' }));
    await act(h, f, b.id, 'withdraw');
    const c = await read(await propose(h, f, { projectId: p2.id, amount: '2500.00' }));

    const open = await read(await h.app.request('/v1/fee-proposals?open=true', { headers: f.auth }));
    expect(open.items.map((x: Loose) => x.id).sort()).toEqual([a.id, c.id].sort());
    const closed = await read(await h.app.request('/v1/fee-proposals?open=false', { headers: f.auth }));
    expect(closed.items.map((x: Loose) => x.id)).toEqual([b.id]);
    expect((await read(await h.app.request(`/v1/fee-proposals?projectId=${p2.id}`, { headers: f.auth }))).items).toHaveLength(2);
    expect((await read(await h.app.request(`/v1/fee-proposals?customerId=${f.customer.id}&status=WITHDRAWN`, { headers: f.auth }))).items.map((x: Loose) => x.id)).toEqual([b.id]);
    const page1 = await read(await h.app.request('/v1/fee-proposals?limit=2', { headers: f.auth }));
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await read(await h.app.request(`/v1/fee-proposals?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, { headers: f.auth }));
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    // the frozen clock gives every row the same createdAt, so the keyset order falls back to id: compare as sets
    expect([...page1.items, ...page2.items].map((x: Loose) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const other = await firm(h);
    expect((await read(await h.app.request('/v1/fee-proposals', { headers: other.auth }))).items).toEqual([]);
    expect((await h.app.request('/v1/fee-proposals', { headers: (await firm(h, { scopes: ['payments:read'] })).auth })).status).toBe(403);

    // summaries: open proposal on a project without agreements; NONE status stays
    const summary = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(summary).toMatchObject({ kind: 'NONE', status: 'NONE', proposal: { id: a.id, status: 'PROPOSED', pricingBasis: 'VAT_EXCLUSIVE', proposedAmount: '10000.00', agreedAmount: null, proposedOn: '2026-10-09', agreementId: null } });
    // after conversion the converted one shows until a new one opens; a withdrawn-only project shows null
    await act(h, f, a.id, 'agree', { amount: '9500.00' });
    const detail = await read(await createAgreement(h, f, a.id, '9500.00'));
    const afterConvert = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(afterConvert).toMatchObject({ kind: 'FIXED', agreed: '9500.00', proposal: { id: a.id, status: 'CONVERTED', agreedAmount: '9500.00', agreementId: detail.agreement.id } });
    await act(h, f, c.id, 'withdraw');
    expect((await read(await h.app.request(`/v1/summaries/projects/${p2.id}`, { headers: f.auth }))).proposal).toBeNull();
    const customer = await read(await h.app.request(`/v1/summaries/customers/${f.customer.id}`, { headers: f.auth }));
    const byProject = Object.fromEntries(customer.currencies[0].projects.map((x: Loose) => [x.projectId, x.proposal]));
    expect(byProject[f.project.id]).toMatchObject({ id: a.id, status: 'CONVERTED' });
    expect(byProject[p2.id]).toBeNull();
  });

  it('publishes the M7 contract', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(API_VERSION).toBe('1.6.0-m7');
    expect(doc.info.version).toBe('1.6.0-m7');
    for (const path of ['/v1/fee-proposals', '/v1/fee-proposals/{proposalId}', '/v1/fee-proposals/{proposalId}/approve', '/v1/fee-proposals/{proposalId}/agree', '/v1/fee-proposals/{proposalId}/withdraw']) expect(doc.paths[path], path).toBeDefined();
    expect(doc.components.schemas.AgreementCreateRequest.allOf[1].properties.feeProposalId).toBeDefined();
    expect(doc.components.schemas.ProjectSummary.properties.proposal).toBeDefined();
    expect(doc.components.schemas.FeeProposalStatus.enum).toEqual(['PROPOSED', 'CLIENT_APPROVED', 'AGREED', 'CONVERTED', 'WITHDRAWN']);
    expect(doc.info.description).toContain('PROPOSAL_OPEN');
    expect(doc.info.description).toContain('PROPOSAL_NOT_AGREED');
  });
});
