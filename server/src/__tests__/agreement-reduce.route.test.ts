import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-480: lowering a fixed fee over HTTP. The fee is ₪3,540.00 VAT-inclusive at 18 %, in three ₪1,180.00 lines: the
 * first posts on signing (2026-10-01), the other two are manual milestones. Today is 2026-10-28 in Asia/Jerusalem.
 */
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

type Line = { label: string; amount: string; trigger: { type: 'IMMEDIATE' | 'MANUAL' | 'DATE'; date?: string } };
const threeLines: Line[] = [
  { label: 'Signing', amount: '1180.00', trigger: { type: 'IMMEDIATE' } },
  { label: 'Hearing', amount: '1180.00', trigger: { type: 'MANUAL' } },
  { label: 'Judgment', amount: '1180.00', trigger: { type: 'MANUAL' } },
];

async function agreement(h: H, f: F, installments: Line[] = threeLines, over: Record<string, unknown> = {}) {
  const amount = installments.reduce((s, i) => s + Number(i.amount), 0).toFixed(2);
  const body = { projectId: f.project.id, amount, pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments, ...over };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  const res = await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() }));
  expect(res.status).toBe(201);
  const detail = await read(res);
  return { id: detail.agreement.id as string, installments: detail.installments as Loose[] };
}

const preview = (h: H, f: F, id: string, body: Record<string, unknown>) => h.app.request(`/v1/agreements/${id}/reduce/preview`, json(body, f.auth));
const commit = (h: H, f: F, id: string, body: Record<string, unknown>, key = idem()) => h.app.request(`/v1/agreements/${id}/reduce`, json(body, { ...f.auth, ...key }));

async function reduce(h: H, f: F, id: string, body: Record<string, unknown>) {
  const p = await preview(h, f, id, body);
  expect(p.status).toBe(200);
  const plan = await read(p);
  const res = await commit(h, f, id, { ...body, previewToken: plan.previewToken });
  expect(res.status).toBe(200);
  return { plan, result: await read(res) };
}

async function pay(h: H, f: F, amount: string, allocations: Array<{ receivableId: string; amount: string }>) {
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId: f.customer.id, currency: 'ILS', amount, allocations }, f.auth)));
  const res = await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount, receivedOn: '2026-10-27', method: 'BANK', allocations, previewToken: p.previewToken }, { ...f.auth, ...idem() }));
  expect(res.status).toBe(201);
}

describe('POST /v1/agreements/{id}/reduce', () => {
  it('AC1: below the unbilled amount, only the latest unbilled installment changes and nothing is credited', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { plan, result } = await reduce(h, f, a.id, { by: '500.00', reasonCode: 'DISCOUNT' });
    expect(plan).toMatchObject({
      requested: '500.00',
      applied: '500.00',
      roundedBy: '0.00',
      credits: [],
      outstanding: { before: '1180.00', after: '1180.00' },
      effectiveTotal: { before: '3540.00', after: '3040.00' },
      installments: [{ id: a.installments[2].id, position: 3, label: 'Judgment', before: { gross: '1180.00' }, after: { amount: '680.00', net: '576.27', vat: '103.73', gross: '680.00' } }],
    });
    expect(result.agreement).toMatchObject({ amount: '3040.00', gross: '3040.00' });
    expect(result).toMatchObject({ credited: '0.00', effectiveTotal: '3040.00', credits: [] });
    expect(result.supplement).toMatchObject({ distribution: 'REDUCTION', amount: '-500.00', resultingAmount: '3040.00', reasonCode: 'DISCOUNT', appliedGross: '500.00', credited: '0.00', effectiveDate: '2026-10-28' });
  });

  it('AC2: above the unbilled amount, every unbilled installment is voided and the rest is credited latest first', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const posted = a.installments[0].receivableId;
    const { plan, result } = await reduce(h, f, a.id, { by: '3000.00', reasonCode: 'GOODWILL', note: 'Long-standing client' });
    expect(plan.installments.map((i: Loose) => [i.position, i.after])).toEqual([[3, null], [2, null]]);
    expect(plan.credits).toEqual([{ receivableId: posted, receivableNumber: 'CHG-2026-0001', amount: '640.00', net: '542.37', vat: '97.63' }]);
    expect(plan).toMatchObject({ applied: '3000.00', outstanding: { before: '1180.00', after: '540.00' }, effectiveTotal: { before: '3540.00', after: '540.00' } });
    expect(result.credits).toEqual([expect.objectContaining({ receivableId: posted, amount: '640.00', reason: 'Long-standing client', reasonCode: 'GOODWILL', effectiveDate: '2026-10-28' })]);
    expect(result.installments.filter((i: Loose) => i.status === 'VOID')).toHaveLength(2);
    // O2: the agreement shows the fee the partner typed, not the posted installment's full gross.
    const detail = await read(await h.app.request(`/v1/agreements/${a.id}`, { headers: f.auth }));
    expect(detail).toMatchObject({ credited: '640.00', effectiveTotal: '540.00' });
    expect(detail.supplements).toEqual([expect.objectContaining({ distribution: 'REDUCTION', appliedGross: '3000.00', credited: '640.00', reasonCode: 'GOODWILL' })]);
    // R8: the statement's CREDIT line carries the reason code; the balance dropped by the credit.
    const statement = await read(await h.app.request(`/v1/customers/${f.customer.id}/statement?currency=ILS`, { headers: f.auth }));
    expect(statement.lines.find((l: Loose) => l.kind === 'CREDIT')).toMatchObject({ credit: '640.00', reason: 'Long-standing client', reasonCode: 'GOODWILL' });
    expect(statement.closingBalance).toBe('540.00');
  });

  it('`to` and `by` give the same plan', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const byPlan = await read(await preview(h, f, a.id, { by: '3000.00' }));
    const toPlan = await read(await preview(h, f, a.id, { to: '540.00' }));
    expect({ ...toPlan, previewToken: null }).toEqual({ ...byPlan, previewToken: null });
  });

  it('AC3: more than unbilled + outstanding is 422 REDUCTION_EXCEEDS_OPEN with the figures; not a reduction is AMOUNT_INVALID', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const res = await preview(h, f, a.id, { by: '3540.01' });
    expect(res.status).toBe(422);
    expect((await read(res)).error.details).toMatchObject({ reason: 'REDUCTION_EXCEEDS_OPEN', unbilled: '2360.00', outstanding: '1180.00', maximum: '3540.00' });
    for (const body of [{ to: '3540.00' }, { to: '4000.00' }, { by: '0.00' }, { by: '-1.00' }, {}, { by: '1.00', to: '1.00' }]) {
      const bad = await preview(h, f, a.id, body);
      expect(bad.status).toBe(422);
      expect(await reason(bad)).toBe('AMOUNT_INVALID');
    }
  });

  it('nothing posted: lowering it all is 422 USE_CANCEL, and the maximum is one agora less (D4, O-F9)', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f, threeLines.map((l) => ({ ...l, trigger: { type: 'MANUAL' as const } })));
    const all = await preview(h, f, a.id, { by: '3540.00' });
    expect(all.status).toBe(422);
    expect(await reason(all)).toBe('USE_CANCEL');
    const over = await preview(h, f, a.id, { by: '3540.01' });
    expect((await read(over)).error.details).toMatchObject({ reason: 'REDUCTION_EXCEEDS_OPEN', maximum: '3539.99' });
    expect((await preview(h, f, a.id, { by: '3539.99' })).status).toBe(200);
  });

  it('AC4: the commit needs a reason code, and OTHER needs a note (422 REASON_REQUIRED)', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { previewToken } = await read(await preview(h, f, a.id, { by: '500.00' }));
    const missing = await commit(h, f, a.id, { by: '500.00', previewToken });
    expect(missing.status).toBe(422);
    const other = await commit(h, f, a.id, { by: '500.00', reasonCode: 'OTHER', previewToken });
    expect(other.status).toBe(422);
    expect(await reason(other)).toBe('REASON_REQUIRED');
    const blank = await commit(h, f, a.id, { by: '500.00', reasonCode: 'OTHER', note: '   ', previewToken });
    expect(await reason(blank)).toBe('REASON_REQUIRED');
    expect((await commit(h, f, a.id, { by: '500.00', reasonCode: 'OTHER', note: 'Agreed at the meeting', previewToken })).status).toBe(200);
  });

  it('AC5: a payment after the preview makes the commit 409 PREVIEW_STALE', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { previewToken } = await read(await preview(h, f, a.id, { by: '3000.00' }));
    await pay(h, f, '100.00', [{ receivableId: a.installments[0].receivableId, amount: '100.00' }]);
    const res = await commit(h, f, a.id, { by: '3000.00', reasonCode: 'DISCOUNT', previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect((await read(await h.app.request(`/v1/agreements/${a.id}`, { headers: f.auth }))).supplements).toEqual([]);
  });

  it('E2: the reason is not in the token: previewed without one, committed with one; a different amount is stale', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { previewToken } = await read(await preview(h, f, a.id, { by: '500.00' }));
    const other = await commit(h, f, a.id, { by: '600.00', reasonCode: 'DISCOUNT', previewToken });
    expect(await reason(other)).toBe('PREVIEW_STALE');
    expect((await commit(h, f, a.id, { by: '500.00', reasonCode: 'CLIENT_DISPUTE', note: 'Disputed the hearing fee', previewToken })).status).toBe(200);
  });

  it('a replay with the same idempotency key reduces once', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { previewToken } = await read(await preview(h, f, a.id, { by: '500.00' }));
    const key = idem();
    const first = await commit(h, f, a.id, { by: '500.00', reasonCode: 'DISCOUNT', previewToken }, key);
    const second = await commit(h, f, a.id, { by: '500.00', reasonCode: 'DISCOUNT', previewToken }, key);
    expect(second.status).toBe(first.status);
    expect(await read(second)).toEqual(await read(first));
    expect((await read(await h.app.request(`/v1/agreements/${a.id}`, { headers: f.auth }))).supplements).toHaveLength(1);
  });

  it('audits one agreement.reduced with before/after, and a receivable.credited per credit (O5)', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const { result } = await reduce(h, f, a.id, { by: '3000.00', reasonCode: 'DISCOUNT' });
    const onAgreement = (await read(await h.app.request(`/v1/audit?entityType=agreement&entityId=${a.id}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === 'agreement.reduced');
    expect(onAgreement).toHaveLength(1);
    expect(onAgreement[0].metadata).toMatchObject({ supplementId: result.supplement.id, reasonCode: 'DISCOUNT', requested: '3000.00', applied: '3000.00', before: { effectiveTotal: '3540.00', outstanding: '1180.00' }, after: { effectiveTotal: '540.00', outstanding: '540.00' }, voided: 2, credits: 1 });
    const onReceivable = (await read(await h.app.request(`/v1/audit?entityType=receivable&entityId=${a.installments[0].receivableId}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === 'receivable.credited');
    expect(onReceivable).toHaveLength(1);
    expect(onReceivable[0].metadata).toMatchObject({ amount: '640.00', reasonCode: 'DISCOUNT', source: 'REDUCTION', agreementId: a.id, settled: false });
  });

  it('R1: a DATE installment whose date has arrived is billed before planning, so it is credited, not lowered', async () => {
    const h = harness('2026-10-20T10:00:00Z');
    const f = await firm(h);
    const a = await agreement(h, f, [threeLines[0]!, { label: 'Hearing', amount: '1180.00', trigger: { type: 'DATE', date: '2026-10-25' } }, threeLines[2]!]);
    expect(a.installments[1].receivableId).toBeNull();
    h.clock.now = new Date('2026-10-28T10:00:00Z');
    const plan = await read(await preview(h, f, a.id, { by: '1500.00' }));
    expect(plan.installments.map((i: Loose) => [i.position, i.after])).toEqual([[3, null]]);
    expect(plan.credits).toHaveLength(1);
    expect(plan).toMatchObject({ outstanding: { before: '2360.00', after: '2040.00' } });
    // Latest posting date first: the line billed 2026-10-25 takes the credit.
    const hearing = (await read(await h.app.request(`/v1/agreements/${a.id}`, { headers: f.auth }))).installments[1];
    expect(plan.credits[0]).toMatchObject({ receivableId: hearing.receivableId, amount: '320.00' });
  });

  it('VAT-exclusive: an unreachable gross is reported as roundedBy, never a stray credit (D5)', async () => {
    const h = harness();
    const f = await firm(h);
    // Nets 999.97 / 999.98 / 999.99 / 1,000.00 give gross 1,179.96 / 1,179.98 / 1,179.99 / 1,180.00: 1,179.97 can't be reached.
    const lines = (rest: string): Line[] => [{ label: 'Signing', amount: '100.00', trigger: { type: 'IMMEDIATE' } }, { label: 'Rest', amount: rest, trigger: { type: 'MANUAL' } }];
    const a = await agreement(h, f, lines('1000.00'), { pricingBasis: 'VAT_EXCLUSIVE' });
    const plan = await read(await preview(h, f, a.id, { by: '0.03' }));
    expect(plan).toMatchObject({ requested: '0.03', applied: '0.02', roundedBy: '0.01', credits: [], installments: [{ after: { net: '999.98', gross: '1179.98' } }] });
    // From 1,179.98, lowering by 0.01 rounds straight back: nothing would change.
    const b = await agreement(h, f, lines('999.98'), { pricingBasis: 'VAT_EXCLUSIVE' });
    expect(await reason(await preview(h, f, b.id, { by: '0.01' }))).toBe('AMOUNT_INVALID');
  });

  it('retainers and contingency fees are 422 NOT_FIXED; a cancelled agreement is 409; another firm’s is 404', async () => {
    const h = harness();
    const f = await firm(h);
    const contingency = await agreement(h, f, [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'IMMEDIATE' } }], { pricingBasis: 'VAT_EXCLUSIVE', contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' } });
    const c = await preview(h, f, contingency.id, { by: '1.00' });
    expect(c.status).toBe(422);
    expect(await reason(c)).toBe('NOT_FIXED');
    const retainer = await h.store.agreements.create({ organizationId: f.org.id, projectId: f.project.id, customerId: f.customer.id, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1800, amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 18_000n, grossMinor: 118_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: '2026-10', billingDay: 1, endMonth: null, installments: [] }, h.clock.now);
    expect(await reason(await preview(h, f, retainer.agreement.id, { by: '1.00' }))).toBe('NOT_FIXED');

    const manual = await agreement(h, f, [{ label: 'Later', amount: '500.00', trigger: { type: 'MANUAL' } }]);
    expect((await h.app.request(`/v1/agreements/${manual.id}/cancel`, json({}, { ...f.auth, ...idem() }))).status).toBe(200);
    const cancelled = await preview(h, f, manual.id, { by: '1.00' });
    expect(cancelled.status).toBe(409);
    expect(await reason(cancelled)).toBe('AGREEMENT_CANCELLED');

    const other = await firm(h);
    expect((await preview(h, other, manual.id, { by: '1.00' })).status).toBe(404);
    expect((await commit(h, other, manual.id, { by: '1.00', reasonCode: 'DISCOUNT', previewToken: 'x'.repeat(64) })).status).toBe(404);
  });
});

describe('POST /v1/installments/{id}/trigger after a reduction (O4)', () => {
  it('a line a reduction voided answers 409 INSTALLMENT_VOIDED, not "agreement cancelled"', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    await reduce(h, f, a.id, { by: '1180.00', reasonCode: 'DISCOUNT' });
    const res = await h.app.request(`/v1/installments/${a.installments[2].id}/trigger`, json({}, { ...f.auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('INSTALLMENT_VOIDED');
  });

  it('a post that loses the race to a change answers 409 VERSION_MISMATCH (retry), not 404', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    // The store reports a lost claim: the line changed between the route's read and its claim.
    h.store.agreements.postInstallment = async () => null;
    const res = await h.app.request(`/v1/installments/${a.installments[1].id}/trigger`, json({}, { ...f.auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('VERSION_MISMATCH');
  });
});

describe('POST /v1/receivables/{id}/credits with a reason code (D3)', () => {
  it('stores and returns the optional reasonCode, and audits it', async () => {
    const h = harness();
    const f = await firm(h);
    const a = await agreement(h, f);
    const receivableId = a.installments[0].receivableId;
    const res = await h.app.request(`/v1/receivables/${receivableId}/credits`, json({ amount: '10.00', reason: 'Retainer month waived', reasonCode: 'GOODWILL' }, { ...f.auth, ...idem() }));
    expect(res.status).toBe(201);
    expect((await read(res)).credit).toMatchObject({ reasonCode: 'GOODWILL' });
    const plain = await read(await h.app.request(`/v1/receivables/${receivableId}/credits`, json({ amount: '1.00', reason: 'Rounding' }, { ...f.auth, ...idem() })));
    expect(plain.credit.reasonCode).toBeNull();
    const audit = (await read(await h.app.request(`/v1/audit?entityType=receivable&entityId=${receivableId}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === 'receivable.credited');
    expect(audit.map((e: Loose) => e.metadata.reasonCode ?? null).sort()).toEqual(['GOODWILL', null].sort());
  });
});
