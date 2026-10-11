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
  const clock = { now: new Date('2026-10-08T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.3.0-test', now: () => clock.now });
  return { app, store, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: Harness, opts: { timezone?: string; scopes?: readonly string[]; rate?: number | null; customerTreatment?: string; currency?: string } = {}) {
  const orgRes = await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: opts.timezone ?? 'Asia/Jerusalem' }, admin));
  const org = (await read(orgRes)) as { id: string };
  const keyRes = await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: opts.scopes ?? SCOPES }, admin));
  const key = (await read(keyRes)) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  if (opts.rate !== null) {
    const r = await h.app.request('/v1/settings/vat', json({ rateBasisPoints: opts.rate ?? 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
    expect(r.status).toBe(201);
  }
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme', ...(opts.customerTreatment ? { vatTreatment: opts.customerTreatment } : {}) }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Case', currency: opts.currency ?? 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

const fixed = (projectId: string, over: Record<string, unknown> = {}) => ({
  projectId,
  amount: '1000.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  agreementDate: '2026-10-08',
  paymentTerms: 'EOM',
  installments: [
    { label: 'Signing', amount: '400.00', trigger: { type: 'IMMEDIATE' } },
    { label: 'Hearing', amount: '300.00', trigger: { type: 'DATE', date: '2026-11-15' } },
    { label: 'Judgment', amount: '300.00', trigger: { type: 'MANUAL' } },
  ],
  ...over,
});

async function previewAndCreate(h: Harness, auth: Record<string, string>, body: Record<string, unknown>) {
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, auth)));
  const res = await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...auth, ...idem() }));
  return { preview, res, body: res.status === 201 ? await read(res) : null };
}

describe('VAT rates', () => {
  it('append-only, effective-dated, with current; scopes enforced', async () => {
    const h = harness();
    const { auth } = await firm(h, { rate: null });
    expect((await h.app.request('/v1/vat-rates', { headers: auth })).status).toBe(200);
    expect((await read(await h.app.request('/v1/vat-rates', { headers: auth }))).current).toBeNull();
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1700, effectiveFrom: '2024-01-01' }, auth, 'PUT'))).status).toBe(201);
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(201);
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(200);
    const conflict = await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1750, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
    expect(conflict.status).toBe(409);
    expect((await read(conflict)).error.details).toMatchObject({ reason: 'RATE_ALREADY_SET', existingRateBasisPoints: 1800 });
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 10001, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(422);
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-02-30' }, auth, 'PUT'))).status).toBe(422);
    const list = await read(await h.app.request('/v1/vat-rates', { headers: auth }));
    expect(list.rates.map((r: Loose) => [r.effectiveFrom, r.rateBasisPoints])).toEqual([['2025-01-01', 1800], ['2024-01-01', 1700]]);
    expect(list.current.rateBasisPoints).toBe(1800);
    const readOnly = await firm(h, { scopes: ['agreements:read', 'customers:write', 'projects:write'], rate: null });
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, readOnly.auth, 'PUT'))).status).toBe(403);
  });
});

describe('agreement preview + create', () => {
  it('previews totals and installments with due dates, and the token proves the body and the rate', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { preview, res, body } = await previewAndCreate(h, auth, fixed(project.id));
    expect(preview.totals).toEqual({ amount: '1000.00', net: '1000.00', vat: '180.00', gross: '1180.00' });
    expect(preview.vatRateBasisPoints).toBe(1800);
    expect(preview.installments.map((i: Loose) => [i.label, i.gross, i.dueDate, i.status])).toEqual([
      ['Signing', '472.00', '2026-10-31', 'PENDING'],
      ['Hearing', '354.00', '2026-11-30', 'PENDING'],
      ['Judgment', '354.00', '2026-10-31', 'PENDING'],
    ]);
    expect(res.status).toBe(201);
    expect(body.agreement).toMatchObject({ type: 'FIXED', status: 'ACTIVE', gross: '1180.00', vatRateBasisPoints: 1800, currency: 'ILS', version: 1 });
    expect(body.installments.map((i: Loose) => [i.label, i.status, i.receivableId !== null])).toEqual([
      ['Signing', 'DUE', true],
      ['Hearing', 'PENDING', false],
      ['Judgment', 'PENDING', false],
    ]);
    // the signing receivable is due end of month under EOM terms
    const receivables = await read(await h.app.request('/v1/receivables', { headers: auth }));
    expect(receivables.items).toHaveLength(1);
    expect(receivables.items[0]).toMatchObject({ origin: 'INSTALLMENT', gross: '472.00', outstanding: '472.00', dueDate: '2026-10-31', status: 'DUE', vatRateBasisPoints: 1800 });

    // stale token: body changed
    const tampered = await h.app.request('/v1/agreements', json({ ...fixed(project.id, { amount: '2000.00', installments: [{ label: 'All', amount: '2000.00', trigger: { type: 'MANUAL' } }] }), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(tampered.status).toBe(409);
    expect((await read(tampered)).error.details.reason).toBe('PREVIEW_STALE');
  });

  it('refuses the create when the VAT rate changed after the preview', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const body = fixed(project.id);
    const preview = await read(await h.app.request('/v1/agreements/preview', json(body, auth)));
    await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1700, effectiveFrom: '2026-10-01' }, auth, 'PUT'));
    const res = await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details.reason).toBe('PREVIEW_STALE');
  });

  it('needs a rate for standard-rated items but not for a foreign client, and resolves the treatment chain', async () => {
    const h = harness();
    const noRate = await firm(h, { rate: null });
    const missing = await h.app.request('/v1/agreements/preview', json(fixed(noRate.project.id), noRate.auth));
    expect(missing.status).toBe(422);
    expect((await read(missing)).error.details.reason).toBe('VAT_RATE_MISSING');

    const foreign = await firm(h, { rate: null, customerTreatment: 'OUT_OF_SCOPE' });
    const preview = await read(await h.app.request('/v1/agreements/preview', json(fixed(foreign.project.id), foreign.auth)));
    expect(preview.vatTreatment).toBe('OUT_OF_SCOPE');
    expect(preview.totals).toMatchObject({ vat: '0.00', gross: '1000.00' });
    expect(preview.vatRateBasisPoints).toBe(0);

    // per-installment override to standard on a foreign client needs the rate again
    const override = await h.app.request('/v1/agreements/preview', json(fixed(foreign.project.id, { installments: [{ label: 'Local part', amount: '1000.00', vatTreatment: 'STANDARD_RATED', trigger: { type: 'MANUAL' } }] }), foreign.auth));
    expect(override.status).toBe(422);
    expect((await read(override)).error.details.reason).toBe('VAT_RATE_MISSING');
  });

  it('validates project state, currency, amounts and installments', async () => {
    const h = harness();
    const { auth, project, customer } = await firm(h);
    const bad = async (over: Record<string, unknown>) => {
      const res = await h.app.request('/v1/agreements/preview', json(fixed(project.id, over), auth));
      expect(res.status).toBe(422);
      return (await read(res)).error.details?.reason;
    };
    expect(await bad({ currency: 'USD' })).toBe('CURRENCY_MISMATCH');
    expect(await bad({ amount: '1000.005' })).toBe('AMOUNT_INVALID');
    expect(await bad({ amount: '-5.00' })).toBe('AMOUNT_INVALID');
    expect(await bad({ installments: [{ label: 'A', amount: '999.99', trigger: { type: 'MANUAL' } }] })).toBe('INSTALLMENTS_DO_NOT_SUM');
    expect(await bad({ installments: [{ label: 'A', percentBasisPoints: 9000, trigger: { type: 'MANUAL' } }] })).toBe('PERCENTS_DO_NOT_SUM');
    expect(await bad({ installments: [{ label: 'A', amount: '1000.00', trigger: { type: 'DATE' } }] })).toBe('TRIGGER_DATE_REQUIRED');
    expect(await bad({ agreementDate: '2026-13-01' })).toBe('DATE_INVALID');
    expect(await bad({ projectId: '00000000-0000-4000-8000-000000000000' })).toBe('PROJECT_NOT_FOUND');
    await h.app.request(`/v1/projects/${project.id}/archive`, json({}, { ...auth, ...idem() }));
    expect(await bad({})).toBe('PROJECT_ARCHIVED');
    void customer;
  });

  it('replays the create with the same Idempotency-Key and audits the creation and postings', async () => {
    const h = harness();
    const { auth, project, org } = await firm(h);
    const body = fixed(project.id);
    const preview = await read(await h.app.request('/v1/agreements/preview', json(body, auth)));
    const key = idem();
    const first = await read(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...auth, ...key })));
    const replay = await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...auth, ...key }));
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect((await read(replay)).agreement.id).toBe(first.agreement.id);
    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    expect(events.filter((e) => e.action === 'agreement.created')).toHaveLength(1);
    expect(events.filter((e) => e.action === 'installment.posted')).toHaveLength(1);
    expect((await read(await h.app.request('/v1/agreements', { headers: auth }))).items).toHaveLength(1);
  });
});

describe('lazy posting and triggers', () => {
  it('posts a DATE installment exactly once when its date arrives in the organization timezone', async () => {
    const h = harness();
    const { auth, project, org } = await firm(h);
    const { body } = await previewAndCreate(h, auth, fixed(project.id));
    const before = await read(await h.app.request(`/v1/agreements/${body.agreement.id}`, { headers: auth }));
    expect(before.installments[1].status).toBe('PENDING');
    // 2026-11-14 23:30 UTC is already 2026-11-15 in Jerusalem
    h.clock.now = new Date('2026-11-14T23:30:00Z');
    const after = await read(await h.app.request(`/v1/agreements/${body.agreement.id}`, { headers: auth }));
    expect(after.installments[1]).toMatchObject({ status: 'DUE', dueDate: '2026-11-30' });
    await h.app.request('/v1/receivables', { headers: auth });
    await h.app.request(`/v1/agreements/${body.agreement.id}`, { headers: auth });
    const receivables = await read(await h.app.request('/v1/receivables', { headers: auth }));
    expect(receivables.items.map((r: Loose) => r.gross)).toEqual(['472.00', '354.00']);
    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    expect(events.filter((e) => e.action === 'installment.posted' && e.metadata?.trigger === 'DATE')).toHaveLength(1);
  });

  it('manual trigger posts once with an optional due date; non-manual and cancelled are refused', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { body } = await previewAndCreate(h, auth, fixed(project.id));
    const [signing, , judgment] = body.installments as Loose[];
    const first = await h.app.request(`/v1/installments/${judgment.id}/trigger`, json({ dueDate: '2026-12-31' }, { ...auth, ...idem() }));
    expect(first.status).toBe(201);
    const firstBody = await read(first);
    expect(firstBody.receivable).toMatchObject({ dueDate: '2026-12-31', gross: '354.00', status: 'DUE' });
    const again = await h.app.request(`/v1/installments/${judgment.id}/trigger`, json({}, { ...auth, ...idem() }));
    expect(again.status).toBe(200);
    expect((await read(again)).receivable.id).toBe(firstBody.receivable.id);
    const notManual = await h.app.request(`/v1/installments/${signing.id}/trigger`, json({}, { ...auth, ...idem() }));
    expect(notManual.status).toBe(422);
    expect((await read(notManual)).error.details.reason).toBe('NOT_MANUAL');
    expect((await h.app.request(`/v1/installments/${judgment.id}/trigger`, json({}, { ...auth }))).status).toBe(422); // Idempotency-Key required

    const other = await previewAndCreate(h, auth, fixed(project.id, { installments: [{ label: 'Later', amount: '1000.00', trigger: { type: 'MANUAL' } }] }));
    await h.app.request(`/v1/agreements/${other.body.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    const cancelled = await h.app.request(`/v1/installments/${other.body.installments[0].id}/trigger`, json({}, { ...auth, ...idem() }));
    expect(cancelled.status).toBe(409);
    expect((await read(cancelled)).error.details.reason).toBe('AGREEMENT_CANCELLED');
  });
});

describe('receivables', () => {
  it('computes DUE / OVERDUE by the organization timezone and PARTIALLY_PAID / PAID from real payments', async () => {
    const h = harness();
    const jerusalem = await firm(h, { timezone: 'Asia/Jerusalem' });
    const auckland = await firm(h, { timezone: 'Pacific/Auckland' });
    const { body: a } = await previewAndCreate(h, jerusalem.auth, fixed(jerusalem.project.id, { paymentTerms: 'IMMEDIATE', installments: [{ label: 'Now', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }));
    const { body: b } = await previewAndCreate(h, auckland.auth, fixed(auckland.project.id, { paymentTerms: 'IMMEDIATE', installments: [{ label: 'Now', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }));
    expect(a.installments[0].dueDate).toBe('2026-10-08');
    expect(b.installments[0].dueDate).toBe('2026-10-08');
    // 2026-10-08 19:30 UTC: 22:30 on the 8th in Jerusalem (UTC+3), 08:30 on the 9th in Auckland (UTC+13)
    h.clock.now = new Date('2026-10-08T19:30:00Z');
    expect((await read(await h.app.request('/v1/receivables', { headers: jerusalem.auth }))).items[0].status).toBe('DUE');
    expect((await read(await h.app.request('/v1/receivables', { headers: auckland.auth }))).items[0].status).toBe('OVERDUE');

    const rec = (await read(await h.app.request('/v1/receivables', { headers: jerusalem.auth }))).items[0];
    const pay = async (amount: string) => {
      const body = { customerId: jerusalem.customer.id, currency: 'ILS', amount, allocations: [{ receivableId: rec.id, amount }] };
      const preview = await read(await h.app.request('/v1/allocations/preview', json(body, jerusalem.auth)));
      const res = await h.app.request('/v1/payments', json({ ...body, receivedOn: '2026-10-08', method: 'BANK', previewToken: preview.previewToken }, { ...jerusalem.auth, ...idem() }));
      expect(res.status).toBe(201);
    };
    await pay('500.00');
    expect((await read(await h.app.request(`/v1/receivables/${rec.id}`, { headers: jerusalem.auth })))).toMatchObject({ status: 'PARTIALLY_PAID', paid: '500.00', outstanding: '680.00' });
    await pay('680.00');
    expect((await read(await h.app.request(`/v1/receivables/${rec.id}`, { headers: jerusalem.auth })))).toMatchObject({ status: 'PAID', outstanding: '0.00' });
    expect((await h.app.request(`/v1/receivables/${rec.id}`, { headers: auckland.auth })).status).toBe(404);
  });

  it('filters by due range, project and currency; needs payments:read', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    await previewAndCreate(h, auth, fixed(project.id));
    const q = async (s: string) => ((await read(await h.app.request(`/v1/receivables${s}`, { headers: auth }))).items as Loose[]).map((r) => r.gross);
    expect(await q('')).toEqual(['472.00']);
    expect(await q('?dueBefore=2026-10-30')).toEqual([]);
    expect(await q('?dueAfter=2026-10-31')).toEqual(['472.00']);
    expect(await q(`?projectId=${project.id}&currency=ILS`)).toEqual(['472.00']);
    expect(await q('?currency=USD')).toEqual([]);
    const noScope = await firm(h, { scopes: ['agreements:read', 'agreements:write', 'customers:write', 'projects:write'] });
    expect((await h.app.request('/v1/receivables', { headers: noScope.auth })).status).toBe(403);
  });
});

describe('supplements and cancel', () => {
  async function agreementWithUnposted(h: Harness, auth: Record<string, string>, projectId: string) {
    const { body } = await previewAndCreate(h, auth, fixed(projectId, { installments: [
      { label: 'Signing', amount: '400.00', trigger: { type: 'IMMEDIATE' } },
      { label: 'A', amount: '300.00', trigger: { type: 'MANUAL' } },
      { label: 'B', amount: '300.00', trigger: { type: 'MANUAL' } },
    ] }));
    return body;
  }

  it('positive supplement lands on the last unposted installment, bumps totals and version, and audits', async () => {
    const h = harness();
    const { auth, project, org } = await firm(h);
    const a = await agreementWithUnposted(h, auth, project.id);
    const res = await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '100.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED', description: 'extra work' }, { ...auth, ...idem() }));
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.agreement).toMatchObject({ amount: '1100.00', vat: '198.00', gross: '1298.00', version: 2 });
    expect(body.installments.map((i: Loose) => [i.label, i.amount, i.gross])).toEqual([['Signing', '400.00', '472.00'], ['A', '300.00', '354.00'], ['B', '400.00', '472.00']]);
    expect(body.effect).toEqual({ contractualDelta: '100.00', installmentsChanged: [a.installments[2].id], installmentsCreated: [] });
    expect(body.supplement).toMatchObject({ amount: '100.00', resultingAmount: '1100.00', distribution: 'LAST_UNPOSTED' });
    const events = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/audit`, { headers: admin }))).events as Loose[];
    expect(events.some((e) => e.action === 'agreement.supplemented')).toBe(true);
  });

  it('prorates across unposted installments with the last absorbing', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const a = await agreementWithUnposted(h, auth, project.id);
    const body = await read(await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '0.03', effectiveDate: '2026-10-09', distribution: 'PRORATE_UNPOSTED' }, { ...auth, ...idem() })));
    expect(body.installments.map((i: Loose) => i.amount)).toEqual(['400.00', '300.02', '300.01']);
    expect(body.agreement.amount).toBe('1000.03');
  });

  it('new installment when nothing is unposted; negative beyond capacity is refused naming the posted receivables', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { body: a } = await previewAndCreate(h, auth, fixed(project.id, { installments: [{ label: 'All', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }));
    const needs = await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '100.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED' }, { ...auth, ...idem() }));
    expect(needs.status).toBe(422);
    expect((await read(needs)).error.details.reason).toBe('NEW_INSTALLMENT_REQUIRED');
    const created = await read(await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '100.00', effectiveDate: '2026-10-09', distribution: 'NEW_INSTALLMENT', newInstallment: { label: 'Extra', trigger: { type: 'MANUAL' }, vatTreatment: 'EXEMPT' } }, { ...auth, ...idem() })));
    expect(created.installments.map((i: Loose) => [i.position, i.label, i.gross, i.vatTreatment, i.status])).toEqual([[1, 'All', '1180.00', 'STANDARD_RATED', 'DUE'], [2, 'Extra', '100.00', 'EXEMPT', 'PENDING']]);
    expect(created.agreement).toMatchObject({ amount: '1100.00', gross: '1280.00' });
    expect(created.effect.installmentsCreated).toHaveLength(1);

    const tooNegative = await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '-500.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED' }, { ...auth, ...idem() }));
    expect(tooNegative.status).toBe(422);
    const details = (await read(tooNegative)).error.details;
    expect(details.reason).toBe('SUPPLEMENT_EXCEEDS_UNPOSTED');
    expect(details.requiresAdjustment.postedReceivables).toHaveLength(1);
    expect(details.requiresAdjustment.postedReceivables[0]).toMatchObject({ installmentId: a.installments[0].id, amount: '1000.00' });
    const ok = await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '-50.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED' }, { ...auth, ...idem() }));
    expect(ok.status).toBe(200);
    expect((await read(ok)).installments[1].amount).toBe('50.00');
    expect((await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '-10.00', effectiveDate: '2026-10-09', distribution: 'NEW_INSTALLMENT' }, { ...auth, ...idem() }))).status).toBe(422);
  });

  it('a supplement\'s new IMMEDIATE installment posts at once (DUE with a receivable), like on creation', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { body: a } = await previewAndCreate(h, auth, fixed(project.id, { installments: [{ label: 'All', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }));
    const created = await read(await h.app.request(`/v1/agreements/${a.agreement.id}/supplements`, json({ amount: '100.00', effectiveDate: '2026-10-09', distribution: 'NEW_INSTALLMENT', newInstallment: { label: 'Extra hearing', trigger: { type: 'IMMEDIATE' } } }, { ...auth, ...idem() })));
    const extra = created.installments.find((i: Loose) => i.label === 'Extra hearing');
    expect(extra).toMatchObject({ status: 'DUE', gross: '118.00' });
    expect(extra.receivableId).toEqual(expect.any(String));
    const receivables = await read(await h.app.request(`/v1/receivables?projectId=${project.id}`, { headers: auth }));
    expect(receivables.items.map((r: Loose) => r.gross).sort()).toEqual(['118.00', '1180.00']);
    const detail = await read(await h.app.request(`/v1/agreements/${a.agreement.id}`, { headers: auth }));
    expect(detail.installments.filter((i: Loose) => i.receivableId)).toHaveLength(2);
  });

  it('cancel only while nothing is posted; cancelled agreements refuse supplements', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const posted = await agreementWithUnposted(h, auth, project.id);
    const refused = await h.app.request(`/v1/agreements/${posted.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(refused.status).toBe(409);
    expect((await read(refused)).error.details.reason).toBe('AGREEMENT_HAS_POSTED_RECEIVABLES');

    const { body: pending } = await previewAndCreate(h, auth, fixed(project.id, { installments: [{ label: 'Later', amount: '1000.00', trigger: { type: 'DATE', date: '2027-01-01' } }] }));
    const first = await h.app.request(`/v1/agreements/${pending.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(first.status).toBe(200);
    const firstBody = await read(first);
    expect(firstBody.agreement.status).toBe('CANCELLED');
    expect(firstBody.installments[0].status).toBe('VOID');
    const again = await h.app.request(`/v1/agreements/${pending.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(again.status).toBe(200);
    const supp = await h.app.request(`/v1/agreements/${pending.agreement.id}/supplements`, json({ amount: '1.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED' }, { ...auth, ...idem() }));
    expect(supp.status).toBe(409);
    // the cancelled DATE installment never posts
    h.clock.now = new Date('2027-02-01T10:00:00Z');
    expect((await read(await h.app.request(`/v1/receivables?projectId=${project.id}`, { headers: auth }))).items.map((r: Loose) => r.gross)).toEqual(['472.00']);
  });

  it('project currency locks once an agreement exists, and archive is refused while receivables are outstanding', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    await agreementWithUnposted(h, auth, project.id);
    const locked = await h.app.request(`/v1/projects/${project.id}`, json({ currency: 'USD' }, { ...auth, 'if-match': '1' }, 'PATCH'));
    expect(locked.status).toBe(409);
    expect((await read(locked)).error.details.reason).toBe('CURRENCY_LOCKED');
    const archive = await h.app.request(`/v1/projects/${project.id}/archive`, json({}, { ...auth, ...idem() }));
    expect(archive.status).toBe(409);
    expect((await read(archive)).error.details.reason).toBe('PROJECT_HAS_OUTSTANDING');
  });
});

describe('retainers', () => {
  const retainer = (projectId: string, over: Record<string, unknown> = {}) => ({ projectId, monthlyAmount: '2000.00', pricingBasis: 'VAT_INCLUSIVE', startMonth: '2026-08', billingDay: 1, paymentTerms: 'EOM_15', ...over });

  it('preview shows monthly totals and the charges that would post now; create posts them', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const preview = await read(await h.app.request('/v1/retainers/preview', json(retainer(project.id), auth)));
    expect(preview.monthly).toEqual({ amount: '2000.00', net: '1694.92', vat: '305.08', gross: '2000.00' });
    expect(preview.chargesDueNow.map((c: Loose) => [c.serviceMonth, c.chargeDate, c.dueDate])).toEqual([
      ['2026-08', '2026-08-01', '2026-09-15'],
      ['2026-09', '2026-09-01', '2026-10-15'],
      ['2026-10', '2026-10-01', '2026-11-15'],
    ]);
    expect(preview.nextChargeDate).toBe('2026-11-01');
    const res = await h.app.request('/v1/retainers', json({ ...retainer(project.id), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(201);
    const body = await read(res);
    expect(body.agreement).toMatchObject({ type: 'RECURRING', retainer: { startMonth: '2026-08', billingDay: 1, endMonth: null }, gross: '2000.00' });
    expect(body.charges.map((c: Loose) => [c.serviceMonth, c.gross, c.dueDate, c.status])).toEqual([
      ['2026-08', '2000.00', '2026-09-15', 'OVERDUE'],
      ['2026-09', '2000.00', '2026-10-15', 'DUE'],
      ['2026-10', '2000.00', '2026-11-15', 'DUE'],
    ]);
    const receivables = await read(await h.app.request('/v1/receivables', { headers: auth }));
    expect(receivables.items.every((r: Loose) => r.origin === 'RETAINER_CHARGE')).toBe(true);
    expect(receivables.items).toHaveLength(3);
    expect((await read(await h.app.request('/v1/agreements?type=RECURRING', { headers: auth }))).items).toHaveLength(1);
  });

  it('generates the next charge lazily when its date arrives, never twice; reconcile reports counts', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const preview = await read(await h.app.request('/v1/retainers/preview', json(retainer(project.id, { startMonth: '2026-10' }), auth)));
    const created = await read(await h.app.request('/v1/retainers', json({ ...retainer(project.id, { startMonth: '2026-10' }), previewToken: preview.previewToken }, { ...auth, ...idem() })));
    expect(created.charges).toHaveLength(1);
    expect((await read(await h.app.request('/v1/retainers/reconcile', json({}, auth)))).chargesCreated).toBe(0);
    h.clock.now = new Date('2026-11-01T06:00:00Z');
    const summary = await read(await h.app.request('/v1/retainers/reconcile', json({}, auth)));
    expect(summary).toMatchObject({ chargesCreated: 1, installmentsPosted: 0, today: '2026-11-01' });
    expect((await read(await h.app.request('/v1/retainers/reconcile', json({}, auth)))).chargesCreated).toBe(0);
    const charges = await read(await h.app.request(`/v1/retainers/${created.agreement.id}/charges`, { headers: auth }));
    expect(charges.charges.map((c: Loose) => c.serviceMonth)).toEqual(['2026-10', '2026-11']);
  });

  it('cancel stops generation after the effective month, FULL vs WAIVE; validation of the schedule', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const make = async (over: Record<string, unknown>) => {
      const p = await read(await h.app.request('/v1/retainers/preview', json(retainer(project.id, over), auth)));
      return read(await h.app.request('/v1/retainers', json({ ...retainer(project.id, over), previewToken: p.previewToken }, { ...auth, ...idem() })));
    };
    const full = await make({ startMonth: '2026-10' });
    const waive = await make({ startMonth: '2026-10' });
    expect((await h.app.request(`/v1/retainers/${full.agreement.id}/cancel`, json({ effectiveDate: '2026-11-20', finalMonth: 'FULL' }, { ...auth, ...idem() }))).status).toBe(200);
    expect((await h.app.request(`/v1/retainers/${waive.agreement.id}/cancel`, json({ effectiveDate: '2026-11-20', finalMonth: 'WAIVE' }, { ...auth, ...idem() }))).status).toBe(200);
    h.clock.now = new Date('2027-01-15T06:00:00Z');
    await h.app.request('/v1/retainers/reconcile', json({}, auth));
    const months = async (id: string) => ((await read(await h.app.request(`/v1/retainers/${id}/charges`, { headers: auth }))).charges as Loose[]).map((c) => c.serviceMonth);
    expect(await months(full.agreement.id)).toEqual(['2026-10', '2026-11']);
    expect(await months(waive.agreement.id)).toEqual(['2026-10']);
    expect((await read(await h.app.request(`/v1/retainers/${full.agreement.id}/charges`, { headers: auth }))).agreement).toMatchObject({ status: 'CANCELLED', retainer: { cancelEffectiveMonth: '2026-11', finalMonth: 'FULL' } });
    const again = await h.app.request(`/v1/retainers/${full.agreement.id}/cancel`, json({ effectiveDate: '2026-12-01', finalMonth: 'WAIVE' }, { ...auth, ...idem() }));
    expect(again.status).toBe(200);
    const againBody = await read(again);
    expect(againBody.agreement.retainer.cancelEffectiveMonth).toBe('2026-11');
    // Cancel answers with the retainer's charges view (versions + charges), the same shape as GET …/charges and POST …/changes.
    expect(Object.keys(againBody).sort()).toEqual(['agreement', 'charges', 'versions']);
    expect(againBody.charges.map((c: Loose) => c.serviceMonth)).toEqual(['2026-10', '2026-11']);
    expect(againBody.versions).toHaveLength(1);

    const bad = async (over: Record<string, unknown>) => (await read(await h.app.request('/v1/retainers/preview', json(retainer(project.id, over), auth)))).error.details.reason;
    expect(await bad({ billingDay: 29 })).toBeUndefined(); // schema rejects 29 before the business rule (zod issues, no reason)
    expect(await bad({ startMonth: '2026-13' })).toBe('START_MONTH_INVALID');
    expect(await bad({ endMonth: '2026-07' })).toBe('END_BEFORE_START');
    expect(await bad({ monthlyAmount: '0.00' })).toBe('AMOUNT_INVALID');
    const supp = await h.app.request(`/v1/agreements/${full.agreement.id}/supplements`, json({ amount: '1.00', effectiveDate: '2026-10-09', distribution: 'LAST_UNPOSTED' }, { ...auth, ...idem() }));
    expect((await read(supp)).error.details.reason).toBe('NOT_FIXED');
    const fixedCancel = await h.app.request(`/v1/agreements/${full.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect((await read(fixedCancel)).error.details.reason).toBe('NOT_FIXED');
  });
});

describe('contract', () => {
  it('publishes every M3 path, the reason vocabularies and the version', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.10.0-mut39');
    expect(API_VERSION).toBe('1.10.0-mut39');
    for (const path of ['/v1/vat-rates', '/v1/settings/vat', '/v1/agreements/preview', '/v1/agreements', '/v1/agreements/{agreementId}', '/v1/agreements/{agreementId}/supplements', '/v1/agreements/{agreementId}/cancel', '/v1/installments/{installmentId}/trigger', '/v1/retainers/preview', '/v1/retainers', '/v1/retainers/{agreementId}/charges', '/v1/retainers/{agreementId}/cancel', '/v1/retainers/reconcile', '/v1/receivables', '/v1/receivables/{receivableId}']) {
      expect(doc.paths[path], path).toBeDefined();
    }
    for (const reason of ['VAT_RATE_MISSING', 'SUPPLEMENT_EXCEEDS_UNPOSTED', 'RATE_ALREADY_SET', 'AGREEMENT_HAS_POSTED_RECEIVABLES', 'PROJECT_HAS_OUTSTANDING', 'INSTALLMENTS_DO_NOT_SUM']) {
      expect(doc.info.description).toContain(reason);
    }
  });
});
