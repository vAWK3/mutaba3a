import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-444 (ADR-226): correcting a fixed or contingency agreement's terms after posting, over HTTP. The fee is ₪1,000
 * VAT-inclusive at 18 %, split 50/50: "On signing" (IMMEDIATE, posted 2026-10-01 as CHG-2026-0001) and "On judgment"
 * (MANUAL). ₪300 was paid on the signing charge on 2026-10-05. Today is 2026-10-29 in Asia/Jerusalem.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const reason = async (res: Response) => (await read(res)).error.details.reason;
let seq = 0;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };

function harness(now = '2026-10-29T10:00:00Z') {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date(now) };
  const app = createApp({
    store,
    logger: pino({ level: 'silent' }),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.3.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  return { app, store, clock };
}
type H = ReturnType<typeof harness>;

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: H, opts: { vat?: boolean } = {}) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  if (opts.vat !== false) expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'))).status).toBe(201);
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}
type F = Awaited<ReturnType<typeof firm>>;

async function keyWith(h: H, f: F, scopes: string[]) {
  const key = await read(await h.app.request(`/admin/v1/organizations/${f.org.id}/api-keys`, json({ name: 'Narrow', scopes }, admin)));
  return { authorization: `Bearer ${key.secret}` };
}

type Line = { label: string; amount: string; trigger: { type: 'IMMEDIATE' | 'MANUAL' | 'DATE'; date?: string }; vatTreatment?: string };
const halves = (amount: string, second: Line['trigger'] = { type: 'MANUAL' }): Line[] => [
  { label: 'On signing', amount, trigger: { type: 'IMMEDIATE' } },
  { label: 'On judgment', amount, trigger: second },
];

async function agreement(h: H, f: F, installments: Line[] = halves('500.00'), over: Record<string, unknown> = {}) {
  const amount = installments.reduce((s, i) => s + Number(i.amount), 0).toFixed(2);
  const body = { projectId: f.project.id, amount, pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-10-01', paymentTerms: 'EOM', installments, ...over };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  const res = await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() }));
  expect(res.status).toBe(201);
  const detail = await read(res);
  return { id: detail.agreement.id as string, installments: detail.installments as Loose[], version: detail.agreement.version as number };
}

async function pay(h: H, f: F, amount: string, allocations: Array<{ receivableId: string; amount: string }>, receivedOn = '2026-10-05', auth = f.auth, customerId = f.customer.id) {
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId, currency: 'ILS', amount, allocations }, auth)));
  const res = await h.app.request('/v1/payments', json({ customerId, currency: 'ILS', amount, receivedOn, method: 'BANK', allocations, previewToken: p.previewToken }, { ...auth, ...idem() }));
  expect(res.status).toBe(201);
  return read(res);
}

/** The QA fixture: the fee, signed (and billed) on 2026-10-01, and ₪300 paid on the signing charge. */
async function paidFee(h: H) {
  const f = await firm(h);
  const today = h.clock.now;
  h.clock.now = new Date('2026-10-01T10:00:00Z');
  const a = await agreement(h, f);
  h.clock.now = today;
  const signing = a.installments[0].receivableId as string;
  const payment = await pay(h, f, '300.00', [{ receivableId: signing, amount: '300.00' }]);
  return { f, a, signing, payment };
}

const exclusive = { amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', installments: halves('500.00') };
const preview = (h: H, f: F, id: string, body: Record<string, unknown>, auth: Record<string, string> = f.auth) => h.app.request(`/v1/agreements/${id}/correct/preview`, json(body, auth));
const commit = (h: H, f: F, id: string, body: Record<string, unknown>, key = idem(), auth: Record<string, string> = f.auth) => h.app.request(`/v1/agreements/${id}/correct`, json(body, { ...auth, ...key }));

async function correct(h: H, f: F, id: string, body: Record<string, unknown>, reasonCode = 'ENTERED_BY_MISTAKE') {
  const p = await preview(h, f, id, body);
  expect(p.status).toBe(200);
  const plan = await read(p);
  const res = await commit(h, f, id, { ...body, reasonCode, previewToken: plan.previewToken });
  expect(res.status).toBe(200);
  return { plan, result: await read(res) };
}

const detail = async (h: H, f: F, id: string) => read(await h.app.request(`/v1/agreements/${id}`, { headers: f.auth }));
const balanceOf = async (h: H, f: F) => {
  const block = (await read(await h.app.request(`/v1/summaries/customers/${f.customer.id}`, { headers: f.auth }))).currencies.find((c: Loose) => c.currency === 'ILS');
  return { outstanding: block.outstanding as string, unallocated: block.unallocated as string, balance: (Number(block.outstanding) - Number(block.unallocated)).toFixed(2) };
};
const statement = async (h: H, f: F) => read(await h.app.request(`/v1/customers/${f.customer.id}/statement?currency=ILS`, { headers: f.auth }));

describe('POST /v1/agreements/{id}/correct', () => {
  it('AC1: a posted VAT-inclusive fee corrected to VAT-exclusive credits the old charge on its date and reposts the new gross there', async () => {
    const h = harness();
    const { f, a, signing, payment } = await paidFee(h);
    const before = await balanceOf(h, f);
    const closingBefore = (await statement(h, f)).closingBalance;
    const { plan, result } = await correct(h, f, a.id, exclusive);

    expect(plan.terms).toEqual({
      before: { amount: '1000.00', net: '847.46', vat: '152.54', gross: '1000.00', pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'STANDARD_RATED', paymentTerms: 'EOM', vatRateBasisPoints: 1800 },
      after: { amount: '1000.00', net: '1000.00', vat: '180.00', gross: '1180.00', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', paymentTerms: 'EOM', vatRateBasisPoints: 1800 },
    });
    expect(plan.installments).toMatchObject([
      { before: { id: a.installments[0].id, position: 1, gross: '500.00', net: '423.73', vat: '76.27', receivableId: signing, receivableNumber: 'CHG-2026-0001', postingDate: '2026-10-01' }, after: { label: 'On signing', net: '500.00', vat: '90.00', gross: '590.00', postingDate: '2026-10-01', dueDate: '2026-10-31' } },
      { before: { position: 2, receivableId: null, postingDate: null }, after: { gross: '590.00', postingDate: null } },
    ]);
    expect(plan.credits).toEqual([{ receivableId: signing, receivableNumber: 'CHG-2026-0001', effectiveDate: '2026-10-01', amount: '500.00', net: '423.73', vat: '76.27', priorCredited: '0.00' }]);
    expect(plan.allocations).toEqual([{ paymentId: payment.id, paymentNumber: payment.number, receivedOn: '2026-10-05', released: [{ receivableId: signing, receivableNumber: 'CHG-2026-0001', amount: '300.00' }], placed: [{ position: 3, amount: '300.00' }], unallocated: '0.00' }]);
    expect(plan).toMatchObject({
      agreement: { effectiveTotal: { before: '1000.00', after: '1180.00' }, outstanding: { before: '200.00', after: '290.00' } },
      customer: { outstanding: { before: '200.00', after: '290.00' }, unallocated: { before: '0.00', after: '0.00' }, balance: { before: '200.00', after: '290.00' } },
      balanceChange: '90.00',
      priorCredited: '0.00',
    });

    // The old lines read VOID; the old charge is SETTLED by a credit dated its own posting date.
    expect(result.installments.map((i: Loose) => [i.position, i.status])).toEqual([[1, 'VOID'], [2, 'VOID'], [3, 'PARTIALLY_PAID'], [4, 'PENDING']]);
    expect(result.credits).toEqual([expect.objectContaining({ receivableId: signing, amount: '500.00', net: '423.73', vat: '76.27', reasonCode: 'ENTERED_BY_MISTAKE', effectiveDate: '2026-10-01' })]);
    const old = await read(await h.app.request(`/v1/receivables/${signing}`, { headers: f.auth }));
    expect(old).toMatchObject({ paid: '0.00', credited: '500.00', status: 'PAID' });
    expect(result.receivables).toEqual([expect.objectContaining({ number: 'CHG-2026-0002', gross: '590.00', paid: '300.00', postingDate: '2026-10-01', dueDate: '2026-10-31' })]);
    expect(result.agreement).toMatchObject({ amount: '1000.00', gross: '1180.00', pricingBasis: 'VAT_EXCLUSIVE', version: a.version + 1 });
    expect(result.supplement).toMatchObject({ distribution: 'CORRECTION', amount: '0.00', resultingAmount: '1000.00', appliedGross: '-180.00', credited: '500.00', reasonCode: 'ENTERED_BY_MISTAKE', effectiveDate: '2026-10-29' });
    expect(result).toMatchObject({ effectiveTotal: '1180.00', unallocated: [] });

    // The balance (outstanding − unallocated) and the statement's closing balance moved by exactly balanceChange.
    const after = await balanceOf(h, f);
    expect(Number(after.balance) - Number(before.balance)).toBeCloseTo(90, 2);
    expect(after).toMatchObject({ outstanding: '290.00', unallocated: '0.00' });
    expect(Number((await statement(h, f)).closingBalance) - Number(closingBefore)).toBeCloseTo(90, 2);
  });

  it('AC2: allocated money moves to the corrected charges oldest first; a lower fee leaves the excess unallocated, none lost', async () => {
    const h = harness();
    const { f, a, payment } = await paidFee(h);
    const { result } = await correct(h, f, a.id, { amount: '200.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('100.00') });
    const repost = result.receivables[0];
    expect(result.allocations).toEqual([{ paymentId: payment.id, receivableId: repost.id, amount: '100.00' }]);
    expect(result.unallocated).toEqual([{ paymentId: payment.id, amount: '200.00' }]);
    const p = await read(await h.app.request(`/v1/payments/${payment.id}`, { headers: f.auth }));
    expect(p).toMatchObject({ amount: '300.00', allocated: '100.00', unallocated: '200.00' });
    expect(p.allocations.map((x: Loose) => [x.receivableId, x.amount])).toEqual([[repost.id, '100.00']]);
    // Σ payments = Σ live allocations + unallocated; Σ receivables' paid = Σ live allocations.
    const receivables = (await read(await h.app.request(`/v1/receivables?customerId=${f.customer.id}`, { headers: f.auth }))).items;
    expect(receivables.reduce((s: number, r: Loose) => s + Number(r.paid), 0)).toBeCloseTo(100, 2);
    expect(await balanceOf(h, f)).toMatchObject({ outstanding: '0.00', unallocated: '200.00' });
  });

  it('AC3: a replay with the same key writes one supplement and one set of credits', async () => {
    const h = harness();
    const { f, a } = await paidFee(h);
    const { previewToken } = await read(await preview(h, f, a.id, exclusive));
    const key = idem();
    const first = await commit(h, f, a.id, { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE', previewToken }, key);
    const second = await commit(h, f, a.id, { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE', previewToken }, key);
    expect(second.status).toBe(200);
    expect(await read(second)).toEqual(await read(first));
    const d = await detail(h, f, a.id);
    expect(d.supplements.filter((s: Loose) => s.distribution === 'CORRECTION')).toHaveLength(1);
    expect((await read(await h.app.request(`/v1/receivables/${a.installments[0].receivableId}/credits`, { headers: f.auth }))).credits).toHaveLength(1);
  });

  it("AC3: a new payment on one of this agreement's charges after the preview is 409 PREVIEW_STALE, writing nothing", async () => {
    const h = harness();
    const { f, a, signing } = await paidFee(h);
    const { previewToken } = await read(await preview(h, f, a.id, exclusive));
    await pay(h, f, '50.00', [{ receivableId: signing, amount: '50.00' }], '2026-10-28');
    const res = await commit(h, f, a.id, { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE', previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect((await detail(h, f, a.id)).agreement.version).toBe(a.version);
  });

  it("AC3: a payment to another client does not make the token stale; a reason added after the preview still commits", async () => {
    const h = harness();
    const { f, a } = await paidFee(h);
    const other = await read(await h.app.request('/v1/customers', json({ name: 'Khoury' }, { ...f.auth, ...idem() })));
    const { previewToken } = await read(await preview(h, f, a.id, exclusive));
    await pay(h, f, '75.00', [], '2026-10-28', f.auth, other.id);
    const res = await commit(h, f, a.id, { ...exclusive, reasonCode: 'OTHER', note: 'Saved with the wrong basis', previewToken });
    expect(res.status).toBe(200);
    expect((await read(res)).credits[0]).toMatchObject({ reason: 'Saved with the wrong basis', reasonCode: 'OTHER' });
  });

  it('AC3: a token previewed late yesterday is stale after midnight', async () => {
    const h = harness('2026-10-29T21:30:00Z'); // 23:30 in Jerusalem
    const { f, a } = await paidFee(h);
    const { previewToken } = await read(await preview(h, f, a.id, exclusive));
    h.clock.now = new Date('2026-10-29T22:30:00Z'); // 00:30 on the 30th
    const res = await commit(h, f, a.id, { ...exclusive, reasonCode: 'ENTERED_BY_MISTAKE', previewToken });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
  });

  it('AC4: cancelled is 409 AGREEMENT_CANCELLED; a contingency with its outcome 409 OUTCOME_ALREADY_RECORDED; a retainer 422 NOT_FIXED', async () => {
    const h = harness();
    const f = await firm(h);
    const manual = await agreement(h, f, [{ label: 'Later', amount: '500.00', trigger: { type: 'MANUAL' } }]);
    expect((await h.app.request(`/v1/agreements/${manual.id}/cancel`, json({}, { ...f.auth, ...idem() }))).status).toBe(200);
    const cancelled = await preview(h, f, manual.id, { amount: '400.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Later', amount: '400.00', trigger: { type: 'MANUAL' } }] });
    expect(cancelled.status).toBe(409);
    expect(await reason(cancelled)).toBe('AGREEMENT_CANCELLED');

    const contingency = await agreement(h, f, [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'IMMEDIATE' } }], { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' } });
    const record = await h.store.agreements.recordOutcome(f.org.id, contingency.id, { outcome: 'NO_RECOVERY', outcomeDate: '2026-10-29', awardedAmountMinor: null, outcomeNote: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commissionInstallment: null, totals: { amountMinor: 150_000n, netMinor: 127_119n, vatMinor: 22_881n, grossMinor: 150_000n }, upfrontReceivables: [], expectedVersion: contingency.version }, h.clock.now);
    expect(record.kind).toBe('updated');
    const outcome = await preview(h, f, contingency.id, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Upfront', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] });
    expect(outcome.status).toBe(409);
    expect(await reason(outcome)).toBe('OUTCOME_ALREADY_RECORDED');

    const retainer = await h.store.agreements.create({ organizationId: f.org.id, projectId: f.project.id, customerId: f.customer.id, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 1800, amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 18_000n, grossMinor: 118_000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: '2026-10', billingDay: 1, endMonth: null, installments: [] }, h.clock.now);
    const notFixed = await preview(h, f, retainer.agreement.id, exclusive);
    expect(notFixed.status).toBe(422);
    expect(await reason(notFixed)).toBe('NOT_FIXED');
  });

  it('a contingency upfront before its outcome may be corrected, to and from zero', async () => {
    const h = harness();
    const f = await firm(h);
    const c = await agreement(h, f, [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'MANUAL' } }], { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } });
    const { result } = await correct(h, f, c.id, { amount: '0.00', pricingBasis: 'VAT_INCLUSIVE', installments: [] });
    expect(result.agreement).toMatchObject({ amount: '0.00', gross: '0.00', type: 'CONTINGENCY' });
    expect(result.installments.map((i: Loose) => i.status)).toEqual(['VOID']);
    const { result: back } = await correct(h, f, c.id, { amount: '800.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Upfront', amount: '800.00', trigger: { type: 'IMMEDIATE' } }] });
    expect(back.receivables).toEqual([expect.objectContaining({ gross: '800.00', postingDate: '2026-10-29' })]);
  });

  it('AC5: the credits, the statement in D5 order and the audit show the correction', async () => {
    const h = harness();
    const { f, a, signing } = await paidFee(h);
    const { result } = await correct(h, f, a.id, exclusive);
    const repost = result.receivables[0];
    const credits = (await read(await h.app.request(`/v1/receivables/${signing}/credits`, { headers: f.auth }))).credits;
    expect(credits).toEqual([expect.objectContaining({ amount: '500.00', reasonCode: 'ENTERED_BY_MISTAKE', effectiveDate: '2026-10-01' })]);
    const onFirst = (await statement(h, f)).lines.filter((l: Loose) => l.date === '2026-10-01').map((l: Loose) => [l.kind, l.number ?? l.receivableNumber]);
    expect(onFirst).toEqual([['CHARGE', 'CHG-2026-0001'], ['CREDIT', 'CHG-2026-0001'], ['CHARGE', 'CHG-2026-0002']]);
    const audit = async (type: string, id: string, action: string) => (await read(await h.app.request(`/v1/audit?entityType=${type}&entityId=${id}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === action);
    const corrected = await audit('agreement', a.id, 'agreement.corrected');
    expect(corrected).toHaveLength(1);
    expect(corrected[0].metadata).toMatchObject({
      supplementId: result.supplement.id,
      reasonCode: 'ENTERED_BY_MISTAKE',
      balanceChange: '90.00',
      before: { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', effectiveTotal: '1000.00', installments: [{ position: 1, gross: '500.00', receivableNumber: 'CHG-2026-0001' }, { position: 2, receivableId: null }] },
      after: { amount: '1000.00', pricingBasis: 'VAT_EXCLUSIVE', effectiveTotal: '1180.00', installments: [{ position: 3, gross: '590.00', receivableId: repost.id, receivableNumber: 'CHG-2026-0002', postingDate: '2026-10-01' }, { position: 4, receivableId: null }] },
      credits: [{ receivableId: signing, receivableNumber: 'CHG-2026-0001', effectiveDate: '2026-10-01', amount: '500.00', priorCredited: '0.00' }],
      moved: [{ released: [{ receivableId: signing, amount: '300.00' }], placed: [{ receivableId: repost.id, amount: '300.00' }], unallocated: '0.00' }],
    });
    expect((await audit('receivable', signing, 'receivable.credited'))[0].metadata).toMatchObject({ source: 'CORRECTION', reasonCode: 'ENTERED_BY_MISTAKE', agreementId: a.id, settled: true });
    expect(await audit('receivable', signing, 'receivable.settled')).toHaveLength(1);
    expect((await audit('installment', result.installments[2].id, 'installment.posted'))[0].metadata).toMatchObject({ trigger: 'CORRECTION', receivableId: repost.id, postingDate: '2026-10-01', agreementId: a.id });
    expect(await audit('receivable', repost.id, 'receivable.settled')).toEqual([]);
  });

  it('AC6: the contract version is 1.90.0-mut483 and both routes are published', async () => {
    const h = harness();
    expect(API_VERSION).toBe('1.90.0-mut483');
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.90.0-mut483');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/v1/agreements/{agreementId}/correct', '/v1/agreements/{agreementId}/correct/preview']));
  });

  describe('refusals', () => {
    it('D2: a posted line whose trigger changes, or that is removed, is 422 POSTED_INSTALLMENT_CHANGED with its position', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const trigger = await preview(h, f, a.id, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '500.00', trigger: { type: 'MANUAL' } }, { label: 'On judgment', amount: '500.00', trigger: { type: 'MANUAL' } }] });
      expect(trigger.status).toBe(422);
      expect((await read(trigger)).error.details).toMatchObject({ reason: 'POSTED_INSTALLMENT_CHANGED', position: 1, change: 'TRIGGER' });
      // Bill the judgment line too: a schedule that drops it is REMOVED at its place.
      expect((await h.app.request(`/v1/installments/${a.installments[1].id}/trigger`, json({}, { ...f.auth, ...idem() }))).status).toBe(201);
      const removed = await preview(h, f, a.id, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] });
      expect((await read(removed)).error.details).toMatchObject({ reason: 'POSTED_INSTALLMENT_CHANGED', position: 2, change: 'REMOVED' });
    });

    it('D2: an unposted line may change its trigger freely', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      expect((await preview(h, f, a.id, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('500.00', { type: 'DATE', date: '2027-01-15' }) })).status).toBe(200);
    });

    it('NOTHING_TO_CORRECT, REASON_REQUIRED and AMOUNT_INVALID', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const same = await preview(h, f, a.id, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('500.00') });
      expect(same.status).toBe(422);
      expect(await reason(same)).toBe('NOTHING_TO_CORRECT');
      const { previewToken } = await read(await preview(h, f, a.id, exclusive));
      expect(await reason(await commit(h, f, a.id, { ...exclusive, reasonCode: 'OTHER', previewToken }))).toBe('REASON_REQUIRED');
      expect(await reason(await commit(h, f, a.id, { ...exclusive, reasonCode: 'OTHER', note: '  ', previewToken }))).toBe('REASON_REQUIRED');
      expect((await commit(h, f, a.id, { ...exclusive, previewToken })).status).toBe(422);
      const zero = await preview(h, f, a.id, { amount: '0.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('0.00') });
      expect(await reason(zero)).toBe('AMOUNT_INVALID');
    });

    it('the body is strict: a field it may not change is 422 VALIDATION_FAILED', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      for (const extra of [{ agreementDate: '2026-10-02' }, { currency: 'USD' }, { projectId: f.project.id }, { description: 'x' }]) {
        const res = await preview(h, f, a.id, { ...exclusive, ...extra });
        expect(res.status).toBe(422);
        expect((await read(res)).error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('an archived customer is 422 CUSTOMER_ARCHIVED; another organization is 404', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const other = await firm(h);
      expect((await preview(h, other, a.id, exclusive)).status).toBe(404);
      expect((await commit(h, other, a.id, { ...exclusive, reasonCode: 'DISCOUNT', previewToken: 'x'.repeat(64) })).status).toBe(404);
      await h.store.customers.archive(f.org.id, f.customer.id, h.clock.now);
      expect(await reason(await preview(h, f, a.id, exclusive))).toBe('CUSTOMER_ARCHIVED');
    });

    it('scopes (R7): preview needs payments:read, commit needs payments:write; sessions are refused', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const noPaymentsRead = await keyWith(h, f, ['agreements:read', 'agreements:write', 'payments:write']);
      expect((await preview(h, f, a.id, exclusive, noPaymentsRead)).status).toBe(403);
      const { previewToken } = await read(await preview(h, f, a.id, exclusive));
      const noPaymentsWrite = await keyWith(h, f, ['agreements:read', 'agreements:write', 'payments:read']);
      expect((await commit(h, f, a.id, { ...exclusive, reasonCode: 'DISCOUNT', previewToken }, idem(), noPaymentsWrite)).status).toBe(403);
      const email = `owner${++seq}@studio.ps`;
      const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: f.org.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const session = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
      const token = new RegExp(`${COOKIE}=([^;]*)`).exec(session.headers.get('set-cookie') ?? '')?.[1] ?? '';
      const as = { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': f.org.id, ...SAME_ORIGIN };
      expect((await preview(h, f, a.id, exclusive, as)).status).toBe(403);
      expect((await commit(h, f, a.id, { ...exclusive, reasonCode: 'DISCOUNT', previewToken }, idem(), as)).status).toBe(403);
    });

    it('due lines post before planning, so a DATE line that came due is a posted line', async () => {
      const h = harness('2026-10-20T10:00:00Z');
      const f = await firm(h);
      const a = await agreement(h, f, halves('500.00', { type: 'DATE', date: '2026-10-25' }));
      h.clock.now = new Date('2026-10-29T10:00:00Z');
      const plan = await read(await preview(h, f, a.id, { ...exclusive, installments: halves('500.00', { type: 'DATE', date: '2026-10-25' }) }));
      expect(plan.installments[1]).toMatchObject({ before: { postingDate: '2026-10-25', receivableNumber: 'CHG-2026-0002' }, after: { postingDate: '2026-10-25' } });
      expect(plan.credits).toHaveLength(2);
      const moved = await preview(h, f, a.id, { ...exclusive, installments: halves('500.00', { type: 'DATE', date: '2026-10-26' }) });
      expect((await read(moved)).error.details).toMatchObject({ reason: 'POSTED_INSTALLMENT_CHANGED', position: 2, change: 'TRIGGER' });
    });

    it('a frozen rate of 0 with a STANDARD_RATED correction resolves the rate on the agreement date, or 422 VAT_RATE_MISSING', async () => {
      const h = harness();
      const f = await firm(h, { vat: false });
      const a = await agreement(h, f, halves('500.00'), { vatTreatment: 'EXEMPT' });
      expect((await detail(h, f, a.id)).agreement.vatRateBasisPoints).toBe(0);
      const standard = { ...exclusive, vatTreatment: 'STANDARD_RATED' };
      expect(await reason(await preview(h, f, a.id, standard))).toBe('VAT_RATE_MISSING');
      h.clock.now = new Date(h.clock.now.getTime() + 60_000);
      expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, f.auth, 'PUT'))).status).toBe(201);
      const { result } = await correct(h, f, a.id, standard);
      expect(result.agreement).toMatchObject({ vatRateBasisPoints: 1800, vatTreatment: 'STANDARD_RATED', gross: '1180.00' });
    });
  });

    it('P2 (review): a real 0 % rate frozen at creation stays 0, even after a rate is set later for that date', async () => {
      const h = harness();
      const f = await firm(h, { vat: false });
      expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 0, effectiveFrom: '2025-01-01' }, f.auth, 'PUT'))).status).toBe(201);
      const a = await agreement(h, f, halves('500.00'));
      expect((await detail(h, f, a.id)).agreement).toMatchObject({ vatRateBasisPoints: 0, vatTreatment: 'STANDARD_RATED' });
      h.clock.now = new Date(h.clock.now.getTime() + 60_000);
      expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2026-09-01' }, f.auth, 'PUT'))).status).toBe(201);
      const { plan, result } = await correct(h, f, a.id, exclusive);
      expect(plan.terms.after).toMatchObject({ vatRateBasisPoints: 0, net: '1000.00', vat: '0.00', gross: '1000.00' });
      expect(result.agreement).toMatchObject({ vatRateBasisPoints: 0, gross: '1000.00' });
    });

  describe('pre-landing review 2026-10-29 (P4)', () => {
    it('AC1 with other charges and unallocated money on the client: the preview\'s balance after is the summary after the commit', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const otherProject = await read(await h.app.request('/v1/projects', json({ customerId: f.customer.id, name: 'Lease', currency: 'ILS' }, { ...f.auth, ...idem() })));
      const other = await agreement(h, { ...f, project: otherProject }, [{ label: 'Retainer fee', amount: '250.00', trigger: { type: 'IMMEDIATE' } }]);
      await pay(h, f, '40.00', [{ receivableId: other.installments[0].receivableId, amount: '40.00' }], '2026-10-20');
      await pay(h, f, '75.00', [], '2026-10-21');
      const before = await balanceOf(h, f);
      const { plan } = await correct(h, f, a.id, exclusive);
      expect(plan.customer).toEqual({
        outstanding: { before: before.outstanding, after: (Number(before.outstanding) + 90).toFixed(2) },
        unallocated: { before: before.unallocated, after: before.unallocated },
        balance: { before: before.balance, after: (Number(before.balance) + 90).toFixed(2) },
      });
      const after = await balanceOf(h, f);
      expect(after).toEqual({ outstanding: plan.customer.outstanding.after, unallocated: plan.customer.unallocated.after, balance: plan.customer.balance.after });
    });

    it('AC2 with D3: an old charge with an earlier credit and a payment on it: the remainder is credited and the payment moves', async () => {
      const h = harness();
      const { f, a, signing, payment } = await paidFee(h);
      expect((await h.app.request(`/v1/receivables/${signing}/credits`, json({ amount: '50.00', reason: 'Discount', reasonCode: 'DISCOUNT' }, { ...f.auth, ...idem() }))).status).toBe(201);
      const { plan, result } = await correct(h, f, a.id, exclusive);
      expect(plan.credits).toEqual([expect.objectContaining({ receivableId: signing, amount: '450.00', priorCredited: '50.00' })]);
      expect(plan.allocations).toEqual([expect.objectContaining({ paymentId: payment.id, released: [expect.objectContaining({ amount: '300.00' })], placed: [expect.objectContaining({ amount: '300.00' })], unallocated: '0.00' })]);
      expect(plan).toMatchObject({ balanceChange: '140.00', priorCredited: '50.00', agreement: { effectiveTotal: { before: '950.00', after: '1180.00' }, outstanding: { before: '150.00', after: '290.00' } } });
      expect(await read(await h.app.request(`/v1/receivables/${signing}`, { headers: f.auth }))).toMatchObject({ paid: '0.00', credited: '500.00', outstanding: '0.00' });
      expect(result.receivables[0]).toMatchObject({ gross: '590.00', paid: '300.00' });
    });

    it('AC5: an old charge already paid in full emits no receivable.settled from the correction (its status did not change)', async () => {
      const h = harness();
      const f = await firm(h);
      h.clock.now = new Date('2026-10-01T10:00:00Z');
      const a = await agreement(h, f);
      h.clock.now = new Date('2026-10-29T10:00:00Z');
      const signing = a.installments[0].receivableId as string;
      await pay(h, f, '500.00', [{ receivableId: signing, amount: '500.00' }]);
      const { result } = await correct(h, f, a.id, exclusive);
      const settled = (await read(await h.app.request(`/v1/audit?entityType=receivable&entityId=${signing}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === 'receivable.settled');
      // One, from the payment that settled it; none from the correction, which left it settled.
      expect(settled).toHaveLength(1);
      expect(settled.filter((e: Loose) => e.metadata.source === 'CORRECTION')).toEqual([]);
      // The repost (₪590, ₪500 paid) stays open: no event for it either.
      expect((await read(await h.app.request(`/v1/audit?entityType=receivable&entityId=${result.receivables[0].id}`, { headers: f.auth }))).items.filter((e: Loose) => e.action === 'receivable.settled')).toEqual([]);
    });
  });

  describe('after a correction', () => {
    it("the old manual line's trigger is 409 INSTALLMENT_VOIDED; the new one posts", async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      const { result } = await correct(h, f, a.id, exclusive);
      const old = await h.app.request(`/v1/installments/${a.installments[1].id}/trigger`, json({}, { ...f.auth, ...idem() }));
      expect(old.status).toBe(409);
      expect(await reason(old)).toBe('INSTALLMENT_VOIDED');
      expect((await h.app.request(`/v1/installments/${result.installments[3].id}/trigger`, json({}, { ...f.auth, ...idem() }))).status).toBe(201);
    });

    it('a reversal releases only the live rows: the new charge reopens, the old one stays credited', async () => {
      const h = harness();
      const { f, a, signing, payment } = await paidFee(h);
      const { result } = await correct(h, f, a.id, exclusive);
      expect((await h.app.request(`/v1/payments/${payment.id}/reverse`, json({ reason: 'Bounced' }, { ...f.auth, ...idem() }))).status).toBe(200);
      expect(await read(await h.app.request(`/v1/receivables/${result.receivables[0].id}`, { headers: f.auth }))).toMatchObject({ paid: '0.00', outstanding: '590.00' });
      expect(await read(await h.app.request(`/v1/receivables/${signing}`, { headers: f.auth }))).toMatchObject({ paid: '0.00', credited: '500.00', status: 'PAID' });
    });

    it('a MUT-443 correction of the moved payment works', async () => {
      const h = harness();
      const { f, a, payment } = await paidFee(h);
      const { result } = await correct(h, f, a.id, exclusive);
      const body = { amount: '350.00', receivedOn: '2026-10-05', method: 'BANK', allocations: [{ receivableId: result.receivables[0].id, amount: '350.00' }] };
      const p = await read(await h.app.request(`/v1/payments/${payment.id}/correct/preview`, json(body, f.auth)));
      const res = await h.app.request(`/v1/payments/${payment.id}/correct`, json({ ...body, reasonCode: 'ENTERED_BY_MISTAKE', previewToken: p.previewToken }, { ...f.auth, ...idem() }));
      expect(res.status).toBe(200);
      expect(await read(await h.app.request(`/v1/receivables/${result.receivables[0].id}`, { headers: f.auth }))).toMatchObject({ paid: '350.00' });
    });

    it('a second correction works; the matter counts the latest repost only (R4)', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      await correct(h, f, a.id, exclusive);
      const { plan, result } = await correct(h, f, a.id, { amount: '200.00', pricingBasis: 'VAT_INCLUSIVE', installments: halves('100.00') });
      expect(plan).toMatchObject({ balanceChange: '-490.00', customer: { outstanding: { before: '290.00', after: '0.00' }, unallocated: { before: '0.00', after: '200.00' } } });
      expect(result.installments.map((i: Loose) => i.position)).toEqual([1, 2, 3, 4, 5, 6]);
      const matter = await read(await h.app.request(`/v1/summaries/projects/${f.project.id}`, { headers: f.auth }));
      expect(matter).toMatchObject({ posted: '100.00', paid: '100.00', credited: '0.00' });
    });

    it('a cancel after the correction is refused (R11): lines are posted', async () => {
      const h = harness();
      const { f, a } = await paidFee(h);
      await correct(h, f, a.id, exclusive);
      const res = await h.app.request(`/v1/agreements/${a.id}/cancel`, json({}, { ...f.auth, ...idem() }));
      expect(res.status).toBe(409);
      expect(await reason(res)).toBe('AGREEMENT_HAS_POSTED_RECEIVABLES');
    });

    it('a cancel whose read lost a race to another write is refused by the state found (R11)', async () => {
      const h = harness();
      const f = await firm(h);
      const manual = await agreement(h, f, [{ label: 'Later', amount: '500.00', trigger: { type: 'MANUAL' } }]);
      // The cancel reads version v; a correction lands before its write: the store refuses v, and nothing is posted.
      const cancel = h.store.agreements.cancel.bind(h.store.agreements);
      h.store.agreements.cancel = async (org, id, input, at) => {
        await correct(h, f, manual.id, { amount: '400.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Later', amount: '400.00', trigger: { type: 'MANUAL' } }] });
        return cancel(org, id, input, at);
      };
      const res = await h.app.request(`/v1/agreements/${manual.id}/cancel`, json({}, { ...f.auth, ...idem() }));
      expect(res.status).toBe(409);
      expect(await reason(res)).toBe('VERSION_MISMATCH');
      expect((await detail(h, f, manual.id)).agreement.status).toBe('ACTIVE');
    });
  });
});
