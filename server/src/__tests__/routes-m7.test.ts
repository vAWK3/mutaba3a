import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * Fee proposals: the M7 routes that survive M8 (create, list, get, withdraw,
 * the one-open-per-project rule, summaries). The approve path, which now
 * creates the agreement, lives in `routes-m8.test.ts`.
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

describe('fee proposals (M7 routes kept in M8)', () => {
  it('proposes: 201 in the project currency with today as proposedOn; audited; validation and scope', async () => {
    const h = harness();
    const f = await firm(h);
    const res = await propose(h, f, { note: 'Opening figure' });
    expect(res.status).toBe(201);
    const p = await read(res);
    expect(p).toMatchObject({ projectId: f.project.id, customerId: f.customer.id, currency: 'ILS', status: 'PROPOSED', pricingBasis: 'VAT_EXCLUSIVE', proposedAmount: '10000.00', proposedOn: '2026-10-09', note: 'Opening figure', agreedAmount: null, clientApprovedOn: null, agreementId: null, version: 1 });
    const audit = await read(await h.app.request(`/v1/audit?entityType=fee_proposal&entityId=${p.id}`, { headers: f.auth }));
    expect(audit.items.map((e: Loose) => e.action)).toEqual(['fee_proposal.created']);
    expect(audit.items[0].metadata).toMatchObject({ projectId: f.project.id, proposedAmount: '10000.00' });

    // idempotent replay returns the stored outcome
    const key = idem();
    const first = await read(await propose(h, { ...f, project: (await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Second', currency: 'USD' }, { ...f.auth, ...idem() })))) }, { amount: '500.00' }, key));
    const replay = await h.app.request('/v1/fee-proposals', json({ projectId: first.projectId, amount: '500.00', pricingBasis: 'VAT_EXCLUSIVE' }, { ...f.auth, ...key }));
    expect(replay.status).toBe(201);
    expect((await read(replay)).id).toBe(first.id);
    expect(first.currency).toBe('USD');

    // validation: bad amount, zero, bad date, archived project, foreign project, missing key, scope
    expect((await read(await propose(h, f, { amount: 'abc' }))).error.code).toBe('VALIDATION_FAILED');
    expect((await read(await propose(h, f, { amount: '0.00' }))).error.details.reason).toBe('AMOUNT_INVALID');
    expect((await read(await propose(h, f, { proposedOn: '2026-02-30' }))).error.details.reason).toBe('DATE_INVALID');
    const archived = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Old', currency: 'ILS' }, { ...f.auth, ...idem() })));
    await h.app.request(`/v1/projects/${archived.id}/archive`, json({}, { ...f.auth, ...idem() }));
    expect((await read(await propose(h, f, { projectId: archived.id }))).error.details.reason).toBe('PROJECT_ARCHIVED');
    const other = await firm(h);
    expect((await read(await propose(h, f, { projectId: other.project.id }))).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'PROJECT_NOT_FOUND' } });
    expect((await propose(h, f, {}, {})).status).toBe(422);
    const readOnly = await firm(h, { scopes: ['agreements:read'] });
    expect((await propose(h, readOnly)).status).toBe(403);
  });

  it('one open proposal per project: 409 PROPOSAL_OPEN names it; withdrawing frees the project; the currency is locked meanwhile', async () => {
    const h = harness();
    const f = await firm(h);
    const first = await read(await propose(h, f));
    const second = await propose(h, f, { amount: '8000.00' });
    expect(second.status).toBe(409);
    expect((await read(second)).error.details).toMatchObject({ reason: 'PROPOSAL_OPEN', openProposalId: first.id, status: 'PROPOSED' });
    const project = await read(await h.app.request(`/v1/projects/${f.project.id}`, { headers: f.auth }));
    const patch = await h.app.request(`/v1/projects/${f.project.id}`, json({ currency: 'USD' }, { ...f.auth, 'if-match': String(project.version) }, 'PATCH'));
    expect(patch.status).toBe(409);
    expect((await read(patch)).error.details.reason).toBe('CURRENCY_LOCKED');
    await act(h, f, first.id, 'withdraw', { reason: 'Client declined' });
    expect((await propose(h, f, { amount: '8000.00' })).status).toBe(201);
  });

  it('withdraw from PROPOSED, idempotent once withdrawn, refused once approved', async () => {
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
    expect((await act(h, f, q.id, 'approve', { amount: '9000.00', schedule: { kind: 'ONCE', dueOn: '2026-10-31' } })).status).toBe(200);
    const approved = await act(h, f, q.id, 'withdraw');
    expect(approved.status).toBe(409);
    expect((await read(approved)).error.details).toMatchObject({ reason: 'PROPOSAL_NOT_OPEN', status: 'APPROVED' });
    expect((await h.app.request(`/v1/fee-proposals/${q.id}`, { headers: (await firm(h)).auth })).status).toBe(404);
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
    expect([...page1.items, ...page2.items].map((x: Loose) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const other = await firm(h);
    expect((await read(await h.app.request('/v1/fee-proposals', { headers: other.auth }))).items).toEqual([]);
    expect((await h.app.request('/v1/fee-proposals', { headers: (await firm(h, { scopes: ['payments:read'] })).auth })).status).toBe(403);

    // summaries: an open proposal on a project without agreements keeps the NONE status
    const summary = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
    expect(summary).toMatchObject({ kind: 'NONE', status: 'NONE', proposal: { id: a.id, status: 'PROPOSED', pricingBasis: 'VAT_EXCLUSIVE', proposedAmount: '10000.00', agreedAmount: null, proposedOn: '2026-10-09', agreementId: null } });
    // a withdrawn-only project shows null; the customer summary mirrors both
    await act(h, f, c.id, 'withdraw');
    expect((await read(await h.app.request(`/v1/summaries/projects/${p2.id}`, { headers: f.auth }))).proposal).toBeNull();
    const customer = await read(await h.app.request(`/v1/summaries/customers/${f.customer.id}`, { headers: f.auth }));
    const byProject = Object.fromEntries(customer.currencies[0].projects.map((x: Loose) => [x.projectId, x.proposal]));
    expect(byProject[f.project.id]).toMatchObject({ id: a.id, status: 'PROPOSED' });
    expect(byProject[p2.id]).toBeNull();
  });
});
