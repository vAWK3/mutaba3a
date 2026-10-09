import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp, API_VERSION } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { reconcileAll } from '../scripts/reconcile.js';

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
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.5.0-test', now: () => clock.now });
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

async function firm(h: Harness, opts: { timezone?: string } = {}): Promise<Firm> {
  const org = (await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: opts.timezone ?? 'Asia/Jerusalem' }, admin)))) as { id: string };
  const key = (await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)))) as { secret: string };
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Acme' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'General services', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

const retainerBody = (projectId: string, over: Record<string, unknown> = {}) => ({ projectId, monthlyAmount: '2000.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-10', billingDay: 1, paymentTerms: 'EOM_30', ...over });

async function createRetainer(h: Harness, f: Firm, over: Record<string, unknown> = {}) {
  const body = retainerBody(f.project.id, over);
  const preview = await read(await h.app.request('/v1/retainers/preview', json(body, f.auth)));
  const res = await h.app.request('/v1/retainers', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() }));
  expect(res.status).toBe(201);
  return read(res);
}

const changePreview = (h: Harness, f: Firm, id: string, body: Record<string, unknown>) => h.app.request(`/v1/retainers/${id}/changes/preview`, json(body, f.auth));
const applyChange = (h: Harness, f: Firm, id: string, body: Record<string, unknown>, headers = idem()) => h.app.request(`/v1/retainers/${id}/changes`, json(body, { ...f.auth, ...headers }));
const cancelPreview = (h: Harness, f: Firm, id: string, body: Record<string, unknown>) => h.app.request(`/v1/retainers/${id}/cancel/preview`, json(body, f.auth));
const cancel = (h: Harness, f: Firm, id: string, body: Record<string, unknown>, headers = idem()) => h.app.request(`/v1/retainers/${id}/cancel`, json(body, { ...f.auth, ...headers }));
const charges = async (h: Harness, f: Firm, id: string) => read(await h.app.request(`/v1/retainers/${id}/charges`, { headers: f.auth }));
const auditActions = async (h: Harness, orgId: string): Promise<string[]> => ((await read(await h.app.request(`/admin/v1/organizations/${orgId}/audit`, { headers: admin }))).events as Loose[]).map((e) => e.action);

describe('retainer changes', () => {
  it('previews previous vs next terms at the rate in force, names what changed and the first charged month; refuses bad changes', async () => {
    const h = harness();
    const f = await firm(h);
    const created = await createRetainer(h, f);
    const id = created.agreement.id;
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]).toMatchObject({ version: 1, effectiveMonth: '2026-10', monthlyAmount: '2000.00', gross: '2360.00', billingDay: 1, paymentTerms: 'EOM_30', reason: null });
    expect(created.charges.map((c: Loose) => c.version)).toEqual([1]);

    // a later VAT rate applies to the new version only
    await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1700, effectiveFrom: '2027-01-01' }, f.auth, 'PUT'));
    const res = await changePreview(h, f, id, { effectiveMonth: '2027-01', monthlyAmount: '2500.00', paymentTerms: 'EOM', reason: 'Annual review' });
    expect(res.status).toBe(200);
    const preview = await read(res);
    expect(preview.previous).toMatchObject({ version: 1, monthlyAmount: '2000.00', rateBasisPoints: 1800 });
    expect(preview.next).toMatchObject({ version: 2, effectiveMonth: '2027-01', monthlyAmount: '2500.00', net: '2500.00', vat: '425.00', gross: '2925.00', rateBasisPoints: 1700, paymentTerms: 'EOM', billingDay: 1, reason: 'Annual review' });
    expect(preview).toMatchObject({ effectiveMonth: '2027-01', changed: ['monthlyAmount', 'paymentTerms'], firstChargedMonth: '2027-01', chargesKept: [] });
    expect(preview.previewToken).toMatch(/^[0-9a-f]{64}$/);

    const reason = async (body: Record<string, unknown>) => (await read(await changePreview(h, f, id, body))).error.details.reason;
    expect(await reason({ effectiveMonth: '2026-10', monthlyAmount: '2500.00', reason: 'x' })).toBe('CHANGE_EFFECTIVE_INVALID');
    expect(await reason({ effectiveMonth: '2027-01', monthlyAmount: '2000.00', reason: 'x' })).toBe('CHANGE_NOTHING_CHANGED');
    expect(await reason({ effectiveMonth: '2027-01', reason: 'x' })).toBe('CHANGE_NOTHING_CHANGED');
    expect(await reason({ effectiveMonth: '2027-01', monthlyAmount: '0.00', reason: 'x' })).toBe('AMOUNT_INVALID');
    expect(await reason({ effectiveMonth: '2027-01', endMonth: '2026-12', reason: 'x' })).toBe('END_BEFORE_START');
    expect((await changePreview(h, f, id, { effectiveMonth: '2027-01', billingDay: 29, reason: 'x' })).status).toBe(422);
    const noRate = await firm(h);
    const bare = await createRetainer(h, noRate, { startMonth: '2024-06', endMonth: '2024-07' });
    // the rate table starts 2025-01-01: a change effective before it cannot be priced
    expect(await (async () => (await read(await changePreview(h, noRate, bare.agreement.id, { effectiveMonth: '2024-07', monthlyAmount: '1.00', reason: 'x' }))).error.details.reason)()).toBe('VAT_RATE_MISSING');
    // not a retainer
    const fixedBody = { projectId: f.project.id, amount: '100.00', pricingBasis: 'VAT_EXCLUSIVE', agreementDate: '2026-10-08', paymentTerms: 'EOM', installments: [{ label: 'One', amount: '100.00', trigger: { type: 'MANUAL' } }] };
    const fp = await read(await h.app.request('/v1/agreements/preview', json(fixedBody, f.auth)));
    const fixed = await read(await h.app.request('/v1/agreements', json({ ...fixedBody, previewToken: fp.previewToken }, { ...f.auth, ...idem() })));
    expect((await read(await changePreview(h, f, fixed.agreement.id, { effectiveMonth: '2027-01', monthlyAmount: '1.00', reason: 'x' }))).error.details.reason).toBe('NOT_RECURRING');
  });

  it('applies a change from its preview: generated charges keep their terms, later months carry the new version; replay, stale token, version order, audit', async () => {
    const h = harness();
    const f = await firm(h);
    const created = await createRetainer(h, f);
    const id = created.agreement.id;
    const body = { effectiveMonth: '2026-12', monthlyAmount: '2500.00', billingDay: 15, reason: 'Scope grew' };
    const preview = await read(await changePreview(h, f, id, body));
    expect((await applyChange(h, f, id, { ...body, previewToken: 'f'.repeat(64) })).status).toBe(409);
    const headers = idem();
    const res = await applyChange(h, f, id, { ...body, previewToken: preview.previewToken }, headers);
    expect(res.status).toBe(201);
    const applied = await read(res);
    expect(applied.versions.map((v: Loose) => [v.version, v.effectiveMonth, v.monthlyAmount, v.billingDay])).toEqual([
      [1, '2026-10', '2000.00', 1],
      [2, '2026-12', '2500.00', 15],
    ]);
    expect(applied.agreement).toMatchObject({ amount: '2000.00', version: 2 });
    const replay = await applyChange(h, f, id, { ...body, previewToken: preview.previewToken }, headers);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    // same body, new key → the retainer moved on: the change is no longer after the latest version
    expect((await read(await applyChange(h, f, id, { ...body, previewToken: preview.previewToken }))).error.details.reason).toBe('CHANGE_EFFECTIVE_INVALID');

    // November charges at the old terms on the 1st; December waits for the new billing day (15th), then carries version 2
    h.clock.now = new Date('2026-12-01T06:00:00Z');
    await h.app.request('/v1/retainers/reconcile', json({}, f.auth));
    let view = await charges(h, f, id);
    expect(view.charges.map((c: Loose) => [c.serviceMonth, c.version, c.gross, c.chargeDate])).toEqual([
      ['2026-10', 1, '2360.00', '2026-10-01'],
      ['2026-11', 1, '2360.00', '2026-11-01'],
    ]);
    h.clock.now = new Date('2026-12-15T06:00:00Z');
    await h.app.request('/v1/retainers/reconcile', json({}, f.auth));
    view = await charges(h, f, id);
    expect(view.charges.map((c: Loose) => [c.serviceMonth, c.version, c.gross, c.chargeDate, c.dueDate])).toEqual([
      ['2026-10', 1, '2360.00', '2026-10-01', '2026-11-30'],
      ['2026-11', 1, '2360.00', '2026-11-01', '2026-12-30'],
      ['2026-12', 2, '2950.00', '2026-12-15', '2027-01-30'],
    ]);

    // a change effective in an already charged month keeps that charge and names it
    const late = await read(await changePreview(h, f, id, { effectiveMonth: '2026-12', monthlyAmount: '2600.00', reason: 'x' }));
    expect(late.error.details.reason).toBe('CHANGE_EFFECTIVE_INVALID'); // not after version 2's month
    const kept = await read(await changePreview(h, f, id, { effectiveMonth: '2027-01', monthlyAmount: '2600.00', reason: 'x' }));
    expect(kept).toMatchObject({ firstChargedMonth: '2027-01', chargesKept: [] });
    h.clock.now = new Date('2027-02-20T06:00:00Z');
    await h.app.request('/v1/retainers/reconcile', json({}, f.auth));
    const backdated = await read(await changePreview(h, f, id, { effectiveMonth: '2027-01', monthlyAmount: '2600.00', reason: 'late' }));
    expect(backdated).toMatchObject({ chargesKept: ['2027-01', '2027-02'], firstChargedMonth: '2027-03' });

    // a preview minted before another change lands is stale once the agreement version moved
    const laterBody = { effectiveMonth: '2027-06', monthlyAmount: '2700.00', reason: 'x' };
    const earlyPreview = await read(await changePreview(h, f, id, laterBody));
    const otherBody = { effectiveMonth: '2027-05', monthlyAmount: '2650.00', reason: 'y' };
    const otherPreview = await read(await changePreview(h, f, id, otherBody));
    expect((await applyChange(h, f, id, { ...otherBody, previewToken: otherPreview.previewToken })).status).toBe(201);
    expect((await read(await applyChange(h, f, id, { ...laterBody, previewToken: earlyPreview.previewToken }))).error.details.reason).toBe('PREVIEW_STALE');

    expect(await auditActions(h, f.org.id)).toContain('retainer.changed');
    const cancelled = await cancel(h, f, id, { effectiveDate: '2027-05-31', finalMonth: 'FULL' });
    expect(cancelled.status).toBe(200);
    expect((await read(await changePreview(h, f, id, { effectiveMonth: '2027-06', monthlyAmount: '1.00', reason: 'x' }))).error.details.reason).toBe('AGREEMENT_CANCELLED');
  });
});

describe('cancel preview and proration', () => {
  it('shows the final month under FULL / PRORATE / WAIVE for an unposted month, and what stops', async () => {
    const h = harness();
    const f = await firm(h);
    const created = await createRetainer(h, f);
    const id = created.agreement.id;
    const full = await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'FULL' }));
    expect(full).toMatchObject({ effectiveMonth: '2026-11', finalMonth: 'FULL', finalCharge: { serviceMonth: '2026-11', days: 30, daysInMonth: 30, amount: '2000.00', gross: '2360.00', posted: false }, postedCharge: null, adjustment: null, stoppedFrom: '2026-12', outstandingAfter: '2360.00' });
    const prorate = await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE' }));
    expect(prorate.finalCharge).toEqual({ serviceMonth: '2026-11', days: 18, daysInMonth: 30, amount: '1200.00', net: '1200.00', vat: '216.00', gross: '1416.00', posted: false });
    expect(prorate.adjustment).toBeNull();
    const waive = await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'WAIVE' }));
    expect(waive).toMatchObject({ finalCharge: null, adjustment: null, stoppedFrom: '2026-11' });
    expect((await read(await cancelPreview(h, f, id, { effectiveDate: '2026-09-18', finalMonth: 'FULL' }))).error.details.reason).toBe('FINAL_MONTH_INVALID');
    expect((await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'HALF' })).status).toBe(422);
  });

  it('PRORATE on an unposted final month posts the prorated charge when its date arrives', async () => {
    const h = harness();
    const f = await firm(h);
    const created = await createRetainer(h, f);
    const id = created.agreement.id;
    const preview = await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE' }));
    const res = await cancel(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE', previewToken: preview.previewToken });
    expect(res.status).toBe(200);
    expect((await read(res)).agreement.retainer).toMatchObject({ cancelEffectiveMonth: '2026-11', cancelEffectiveDate: '2026-11-18', finalMonth: 'PRORATE' });
    h.clock.now = new Date('2026-12-20T06:00:00Z');
    await h.app.request('/v1/retainers/reconcile', json({}, f.auth));
    const view = await charges(h, f, id);
    expect(view.charges.map((c: Loose) => [c.serviceMonth, c.amount, c.gross])).toEqual([
      ['2026-10', '2000.00', '2360.00'],
      ['2026-11', '1200.00', '1416.00'],
    ]);
    // a token is not needed when nothing is credited
    const other = await createRetainer(h, f);
    expect((await cancel(h, f, other.agreement.id, { effectiveDate: '2027-01-10', finalMonth: 'PRORATE' })).status).toBe(200);
  });

  it('PRORATE / WAIVE on a posted final month credit the receivable, capped by what was paid; token required; idempotent', async () => {
    const h = harness();
    const f = await firm(h);
    h.clock.now = new Date('2026-11-20T10:00:00Z');
    const created = await createRetainer(h, f);
    const id = created.agreement.id;
    expect(created.charges.map((c: Loose) => c.serviceMonth)).toEqual(['2026-10', '2026-11']);
    const november = created.charges[1];
    // pay 1000.00 of November
    const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId: f.customer.id, currency: 'ILS', amount: '1000.00', allocations: [{ receivableId: november.receivableId, amount: '1000.00' }] }, f.auth)));
    expect((await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount: '1000.00', receivedOn: '2026-11-20', method: 'BANK', allocations: [{ receivableId: november.receivableId, amount: '1000.00' }], previewToken: p.previewToken }, { ...f.auth, ...idem() }))).status).toBe(201);

    const preview = await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE' }));
    expect(preview.finalCharge).toMatchObject({ days: 18, gross: '1416.00', posted: true });
    expect(preview.postedCharge).toMatchObject({ receivableId: november.receivableId, gross: '2360.00', paid: '1000.00', credited: '0.00', outstanding: '1360.00' });
    // wanted 2360 − 1416 = 944.00 ≤ outstanding 1360 → not limited
    expect(preview.adjustment).toEqual({ amount: '944.00', net: '800.00', vat: '144.00', limitedByPayments: false });
    expect(preview).toMatchObject({ stoppedFrom: '2026-12', outstandingAfter: '2776.00' }); // 2360 (Oct) + 1360 − 944

    const noToken = await cancel(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE' });
    expect((await read(noToken)).error.details.reason).toBe('PREVIEW_TOKEN_REQUIRED');
    const headers = idem();
    const res = await cancel(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE', previewToken: preview.previewToken }, headers);
    expect(res.status).toBe(200);
    const receivable = await read(await h.app.request(`/v1/receivables/${november.receivableId}`, { headers: f.auth }));
    expect(receivable).toMatchObject({ paid: '1000.00', credited: '944.00', outstanding: '416.00', status: 'PARTIALLY_PAID' });
    const credits = await read(await h.app.request(`/v1/receivables/${november.receivableId}/credits`, { headers: f.auth }));
    expect(credits.credits).toHaveLength(1);
    expect(credits.credits[0].reason).toContain('Retainer cancelled 2026-11-18');
    // replay with the same key is the same body; a new key on the cancelled retainer changes nothing more
    expect((await cancel(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'PRORATE', previewToken: preview.previewToken }, headers)).headers.get('idempotent-replayed')).toBe('true');
    const again = await cancel(h, f, id, { effectiveDate: '2026-12-01', finalMonth: 'WAIVE' });
    expect((await read(again)).agreement.retainer.cancelEffectiveMonth).toBe('2026-11');
    expect((await read(await h.app.request(`/v1/receivables/${november.receivableId}/credits`, { headers: f.auth }))).credits).toHaveLength(1);
    const actions = await auditActions(h, f.org.id);
    expect(actions).toContain('retainer.cancelled');
    expect(actions.filter((a) => a === 'receivable.credited')).toHaveLength(1);
    expect((await read(await cancelPreview(h, f, id, { effectiveDate: '2026-11-18', finalMonth: 'FULL' }))).error.details.reason).toBe('AGREEMENT_CANCELLED');

    // WAIVE on a posted, partly paid month: credit everything outstanding, limited by the payment
    const g = await firm(h);
    const second = await createRetainer(h, g);
    const nov = second.charges[1];
    const p2 = await read(await h.app.request('/v1/allocations/preview', json({ customerId: g.customer.id, currency: 'ILS', amount: '2000.00', allocations: [{ receivableId: nov.receivableId, amount: '2000.00' }] }, g.auth)));
    await h.app.request('/v1/payments', json({ customerId: g.customer.id, currency: 'ILS', amount: '2000.00', receivedOn: '2026-11-20', method: 'CASH', allocations: [{ receivableId: nov.receivableId, amount: '2000.00' }], previewToken: p2.previewToken }, { ...g.auth, ...idem() }));
    const wp = await read(await cancelPreview(h, g, second.agreement.id, { effectiveDate: '2026-11-05', finalMonth: 'WAIVE' }));
    expect(wp.adjustment).toEqual({ amount: '360.00', net: '305.08', vat: '54.92', limitedByPayments: true });
    expect((await cancel(h, g, second.agreement.id, { effectiveDate: '2026-11-05', finalMonth: 'WAIVE', previewToken: wp.previewToken })).status).toBe(200);
    expect(await read(await h.app.request(`/v1/receivables/${nov.receivableId}`, { headers: g.auth }))).toMatchObject({ credited: '360.00', outstanding: '0.00', status: 'PAID' });
  });
});

describe('reconcile script', () => {
  it('posts due items for every organization in its own timezone and reports per organization', async () => {
    const h = harness();
    const f = await firm(h, { timezone: 'Asia/Jerusalem' });
    const g = await firm(h, { timezone: 'Pacific/Honolulu' });
    await createRetainer(h, f, { startMonth: '2026-11' });
    await createRetainer(h, g, { startMonth: '2026-11' });
    const dry = await reconcileAll(h.store, new Date('2026-11-01T06:00:00Z'), { dry: true });
    expect(dry.map((l) => [l.organizationId, l.today])).toEqual([
      [f.org.id, '2026-11-01'],
      [g.org.id, '2026-10-31'],
    ]);
    const lines = await reconcileAll(h.store, new Date('2026-11-01T06:00:00Z'));
    // 06:00Z is already 1 November in Jerusalem, still 31 October in Honolulu
    expect(lines.map((l) => [l.slug.length > 0, l.chargesCreated])).toEqual([
      [true, 1],
      [true, 0],
    ]);
    expect((await reconcileAll(h.store, new Date('2026-11-01T06:00:00Z'))).map((l) => l.chargesCreated)).toEqual([0, 0]);
  });
});

describe('contract', () => {
  it('publishes the M5 paths, reasons and version', async () => {
    const h = harness();
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.6.0-m7');
    expect(API_VERSION).toBe('1.6.0-m7');
    for (const path of ['/v1/retainers/{agreementId}/changes/preview', '/v1/retainers/{agreementId}/changes', '/v1/retainers/{agreementId}/cancel/preview', '/v1/retainers/{agreementId}/cancel']) {
      expect(doc.paths[path], path).toBeDefined();
    }
    expect(doc.components.schemas.FinalMonth.enum).toEqual(['FULL', 'PRORATE', 'WAIVE']);
    expect(doc.components.schemas.RetainerChargesResponse.properties.versions).toBeDefined();
    expect(doc.components.schemas.RetainerCharge.properties.version).toBeDefined();
    for (const reason of ['CHANGE_EFFECTIVE_INVALID', 'CHANGE_NOTHING_CHANGED', 'FINAL_MONTH_INVALID', 'PREVIEW_TOKEN_REQUIRED']) expect(doc.info.description).toContain(reason);
  });
});
