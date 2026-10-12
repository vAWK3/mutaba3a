import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * MUT-100: contingency fee agreements over HTTP. Acceptance figures: VAT 18 %
 * on top, upfront ₪1,500, rate 20 %; the agreement is signed 2026-10-01 and
 * the case is decided 2026-10-12 (today is 2026-10-13 in Asia/Jerusalem).
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
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(100_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.3.0-test', now: () => clock.now });
  return { app, store, clock };
}

const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let ik = 0;
const idem = () => ({ 'idempotency-key': `key-${++ik}-${Math.random().toString(36).slice(2, 8)}` });

async function firm(h: Harness, opts: { rates?: Array<[number, string]> } = {}) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  for (const [rateBasisPoints, effectiveFrom] of opts.rates ?? [[1800, '2025-01-01']]) {
    expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints, effectiveFrom }, auth, 'PUT'))).status).toBe(201);
  }
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = await read(await h.app.request('/v1/projects', json({ customerId: customer.id, name: 'Lawsuit', currency: 'ILS' }, { ...auth, ...idem() })));
  return { org, auth, customer, project };
}

const contingent = (projectId: string, over: Record<string, unknown> = {}) => ({
  projectId,
  amount: '1500.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  agreementDate: '2026-10-01',
  paymentTerms: 'EOM',
  installments: [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'IMMEDIATE' } }],
  contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' },
  ...over,
});

const fixed = (projectId: string, over: Record<string, unknown> = {}) => ({
  projectId,
  amount: '800.00',
  pricingBasis: 'VAT_EXCLUSIVE',
  agreementDate: '2026-10-01',
  paymentTerms: 'EOM',
  installments: [{ label: 'Extra hearing', amount: '800.00', trigger: { type: 'IMMEDIATE' } }],
  ...over,
});

const award = (over: Record<string, unknown> = {}) => ({ outcome: 'AWARDED', awardedAmount: '100000.00', outcomeDate: '2026-10-12', commissionLabel: 'Commission', ...over });
const noRecovery = (over: Record<string, unknown> = {}) => ({ outcome: 'NO_RECOVERY', outcomeDate: '2026-10-12', ...over });

async function create(h: Harness, auth: Record<string, string>, body: Record<string, unknown>) {
  const preview = await h.app.request('/v1/agreements/preview', json(body, auth));
  expect(preview.status).toBe(200);
  const p = await read(preview);
  const res = await h.app.request('/v1/agreements', json({ ...body, previewToken: p.previewToken }, { ...auth, ...idem() }));
  expect(res.status).toBe(201);
  return { preview: p, detail: await read(res) };
}

const previewOutcome = (h: Harness, auth: Record<string, string>, id: string, body: Record<string, unknown>) => h.app.request(`/v1/agreements/${id}/outcome/preview`, json(body, auth));

async function record(h: Harness, auth: Record<string, string>, id: string, body: Record<string, unknown>, key = idem()) {
  const preview = await previewOutcome(h, auth, id, body);
  const p = await read(preview);
  if (preview.status !== 200) return { preview: p, res: preview, body: p };
  const res = await h.app.request(`/v1/agreements/${id}/outcome`, json({ ...body, previewToken: p.previewToken }, { ...auth, ...key }));
  return { preview: p, res, body: await read(res) };
}

async function correct(h: Harness, auth: Record<string, string>, id: string, body: Record<string, unknown>) {
  const preview = await previewOutcome(h, auth, id, body);
  const p = await read(preview);
  if (preview.status !== 200) return { preview: p, res: preview, body: p };
  const res = await h.app.request(`/v1/agreements/${id}/outcome/correct`, json({ ...body, previewToken: p.previewToken }, { ...auth, ...idem() }));
  return { preview: p, res, body: await read(res) };
}

async function receivablesOf(h: Harness, auth: Record<string, string>, agreementId: string) {
  const page = await read(await h.app.request('/v1/receivables?limit=200', { headers: auth }));
  return (page.items as Loose[]).filter((r) => r.agreementId === agreementId);
}

const reason = async (res: Response) => (await read(res)).error.details.reason;

describe('creating a contingency agreement', () => {
  it('SEPARATE and CREDITED: the upfront schedules and posts like a fixed fee; the terms are echoed on the preview and the agreement', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    for (const upfrontTreatment of ['SEPARATE', 'CREDITED']) {
      const { preview, detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment } }));
      expect(preview).toMatchObject({ type: 'CONTINGENCY', contingency: { commissionRateBasisPoints: 2000, upfrontTreatment }, totals: { amount: '1500.00', net: '1500.00', vat: '270.00', gross: '1770.00' } });
      expect(detail.agreement).toMatchObject({ type: 'CONTINGENCY', gross: '1770.00', vatRateBasisPoints: 1800, retainer: null, contingency: { commissionRateBasisPoints: 2000, upfrontTreatment, outcome: 'AWAITING', outcomeDate: null, awarded: null, note: null, outcomeRecordedAt: null } });
      expect(detail.installments.map((i: Loose) => [i.label, i.gross, i.status, i.isCommission])).toEqual([['Upfront', '1770.00', 'DUE', false]]);
    }
  });

  it('a ₪0 upfront with no installments posts nothing', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { preview, detail } = await create(h, auth, contingent(project.id, { amount: '0.00', installments: [] }));
    expect(preview.totals).toEqual({ amount: '0.00', net: '0.00', vat: '0.00', gross: '0.00' });
    expect(detail.agreement).toMatchObject({ type: 'CONTINGENCY', gross: '0.00' });
    expect(detail.installments).toEqual([]);
    expect(await receivablesOf(h, auth, detail.agreement.id)).toEqual([]);
  });

  it('a FIXED agreement keeps type FIXED and no terms; with an empty installment list it is refused with NO_INSTALLMENTS (the one intentional change)', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { preview, detail } = await create(h, auth, fixed(project.id));
    expect(preview).toMatchObject({ type: 'FIXED', contingency: null });
    expect(detail.agreement).toMatchObject({ type: 'FIXED', contingency: null });
    expect(detail.installments[0].isCommission).toBe(false);
    const empty = await h.app.request('/v1/agreements/preview', json(fixed(project.id, { installments: [] }), auth));
    expect(empty.status).toBe(422);
    expect((await read(empty)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'NO_INSTALLMENTS' } });
    // An upfront above zero still needs its installments.
    const noLines = await h.app.request('/v1/agreements/preview', json(contingent(project.id, { installments: [] }), auth));
    expect(noLines.status).toBe(422);
    expect(await reason(noLines)).toBe('NO_INSTALLMENTS');
  });

  it('refuses a rate outside 1..10000 and a negative upfront', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    for (const commissionRateBasisPoints of [0, 10001]) {
      const res = await h.app.request('/v1/agreements/preview', json(contingent(project.id, { contingency: { commissionRateBasisPoints, upfrontTreatment: 'SEPARATE' } }), auth));
      expect(res.status).toBe(422);
      expect(await reason(res)).toBe('COMMISSION_RATE_INVALID');
    }
    const fractional = await h.app.request('/v1/agreements/preview', json(contingent(project.id, { contingency: { commissionRateBasisPoints: 20.5, upfrontTreatment: 'SEPARATE' } }), auth));
    expect(fractional.status).toBe(422);
    const negative = await h.app.request('/v1/agreements/preview', json(contingent(project.id, { amount: '-1.00', installments: [] }), auth));
    expect(negative.status).toBe(422);
    expect(await reason(negative)).toBe('AMOUNT_INVALID');
    const noTreatment = await h.app.request('/v1/agreements/preview', json(contingent(project.id, { contingency: { commissionRateBasisPoints: 2000 } }), auth));
    expect(noTreatment.status).toBe(422);
  });

  it('lists by type and refuses supplements; cancels while nothing has posted and no outcome exists', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    await create(h, auth, fixed(project.id));
    const listed = await read(await h.app.request('/v1/agreements?type=CONTINGENCY', { headers: auth }));
    expect(listed.items.map((a: Loose) => a.id)).toEqual([detail.agreement.id]);
    const supplement = await h.app.request(`/v1/agreements/${detail.agreement.id}/supplements`, json({ amount: '100.00', effectiveDate: '2026-10-13', distribution: 'NEW_INSTALLMENT', newInstallment: { label: 'More', trigger: { type: 'MANUAL' } } }, { ...auth, ...idem() }));
    expect(supplement.status).toBe(422);
    expect(await reason(supplement)).toBe('NOT_FIXED');
    // The upfront posted at creation: cancel follows the fixed-fee rule.
    const posted = await h.app.request(`/v1/agreements/${detail.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(posted.status).toBe(409);
    expect(await reason(posted)).toBe('AGREEMENT_HAS_POSTED_RECEIVABLES');

    const zero = await create(h, auth, contingent(project.id, { amount: '0.00', installments: [] }));
    const cancelled = await h.app.request(`/v1/agreements/${zero.detail.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(cancelled.status).toBe(200);
    expect((await read(cancelled)).agreement.status).toBe('CANCELLED');

    const decided = await create(h, auth, contingent(project.id, { amount: '0.00', installments: [] }));
    expect((await record(h, auth, decided.detail.agreement.id, noRecovery())).res.status).toBe(200);
    const late = await h.app.request(`/v1/agreements/${decided.detail.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(late.status).toBe(409);
    expect(await reason(late)).toBe('OUTCOME_ALREADY_RECORDED');
  });
});

describe('changing the terms before an outcome', () => {
  it('PATCH /contingency changes the rate and treatment under If-Match and audits from/to', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const id = detail.agreement.id;
    const patch = (body: unknown, version: number) => h.app.request(`/v1/agreements/${id}/contingency`, json(body, { ...auth, 'if-match': String(version) }, 'PATCH'));

    const res = await patch({ commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED' }, detail.agreement.version);
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.agreement).toMatchObject({ version: detail.agreement.version + 1, contingency: { commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', outcome: 'AWAITING' } });
    const events = await read(await h.app.request(`/v1/audit?entityType=agreement&entityId=${id}`, { headers: auth }));
    expect(events.items.find((e: Loose) => e.action === 'agreement.contingency_terms_changed').metadata).toEqual({ from: { commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE' }, to: { commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED' } });

    const stale = await patch({ commissionRateBasisPoints: 3000 }, detail.agreement.version);
    expect(stale.status).toBe(409);
    expect(await reason(stale)).toBe('VERSION_MISMATCH');
    const same = await patch({ commissionRateBasisPoints: 2500 }, body.agreement.version);
    expect(same.status).toBe(422);
    expect(await reason(same)).toBe('CHANGE_NOTHING_CHANGED');
    const bad = await patch({ commissionRateBasisPoints: 0 }, body.agreement.version);
    expect(await reason(bad)).toBe('COMMISSION_RATE_INVALID');
    expect((await patch({ commissionRateBasisPoints: 3000 }, 0)).status).toBe(422);
    expect((await h.app.request(`/v1/agreements/${id}/contingency`, json({ commissionRateBasisPoints: 3000 }, auth, 'PATCH'))).status).toBe(422);

    const f = await create(h, auth, fixed(project.id));
    const notContingency = await h.app.request(`/v1/agreements/${f.detail.agreement.id}/contingency`, json({ commissionRateBasisPoints: 3000 }, { ...auth, 'if-match': '1' }, 'PATCH'));
    expect(notContingency.status).toBe(422);
    expect(await reason(notContingency)).toBe('NOT_CONTINGENCY');

    // After an outcome the terms are frozen; a correction is the only way to fix them.
    const recorded = await record(h, auth, id, award());
    expect(recorded.res.status).toBe(200);
    const frozen = await patch({ commissionRateBasisPoints: 3000 }, recorded.body.agreement.version);
    expect(frozen.status).toBe(409);
    expect(await reason(frozen)).toBe('OUTCOME_ALREADY_RECORDED');
  });
});

describe('recording the outcome (acceptance examples)', () => {
  it('SEPARATE, award ₪100,000: one commission receivable of ₪20,000 + ₪3,600 = ₪23,600 dated on the outcome date', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const { preview, res, body } = await record(h, auth, detail.agreement.id, award());
    expect(preview).toMatchObject({ mode: 'RECORD', outcome: 'AWARDED', awarded: '100000.00', commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commission: '20000.00', upfrontCounted: '1500.00', appliedUpfront: '0.00', billable: { amount: '20000.00', net: '20000.00', vat: '3600.00', gross: '23600.00' }, vatRateBasisPoints: 1800, postingDate: '2026-10-12', dueDate: '2026-10-31', replaces: null });
    expect(res.status).toBe(200);
    expect(body.agreement).toMatchObject({ gross: '25370.00', contingency: { outcome: 'AWARDED', outcomeDate: '2026-10-12', awarded: '100000.00' } });
    const line = body.installments.find((i: Loose) => i.isCommission);
    expect(line).toMatchObject({ label: 'Commission', net: '20000.00', vat: '3600.00', gross: '23600.00', trigger: { type: 'DATE', date: '2026-10-12' }, status: 'DUE' });
    const commission = (await receivablesOf(h, auth, detail.agreement.id)).find((r) => r.id === line.receivableId);
    expect(commission).toMatchObject({ net: '20000.00', vat: '3600.00', gross: '23600.00', vatRateBasisPoints: 1800, postingDate: '2026-10-12', dueDate: '2026-10-31', outstanding: '23600.00' });
  });

  it('CREDITED, award ₪100,000: one receivable of ₪18,500 + ₪3,330 = ₪21,830', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const { preview, body } = await record(h, auth, detail.agreement.id, award());
    expect(preview).toMatchObject({ commission: '20000.00', upfrontCounted: '1500.00', appliedUpfront: '1500.00', billable: { amount: '18500.00', net: '18500.00', vat: '3330.00', gross: '21830.00' } });
    const receivables = await receivablesOf(h, auth, detail.agreement.id);
    expect(receivables.map((r) => r.gross).sort()).toEqual(['1770.00', '21830.00']);
    expect(body.installments.filter((i: Loose) => i.isCommission)).toHaveLength(1);
  });

  it('CREDITED, award ₪5,000: no receivable; the outcome is recorded with nothing more to bill and the upfront is kept', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const { preview, res, body } = await record(h, auth, detail.agreement.id, award({ awardedAmount: '5000.00' }));
    expect(preview).toMatchObject({ commission: '1000.00', appliedUpfront: '1000.00', billable: { amount: '0.00', gross: '0.00' }, postingDate: null, dueDate: null });
    expect(res.status).toBe(200);
    expect(body.agreement).toMatchObject({ gross: '1770.00', contingency: { outcome: 'AWARDED', awarded: '5000.00' } });
    expect(body.installments.map((i: Loose) => i.isCommission)).toEqual([false]);
    expect((await receivablesOf(h, auth, detail.agreement.id)).map((r) => [r.gross, r.credited])).toEqual([['1770.00', '0.00']]);
  });

  it('NO_RECOVERY: no receivable; the upfront receivables are untouched', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const before = await receivablesOf(h, auth, detail.agreement.id);
    const { preview, res, body } = await record(h, auth, detail.agreement.id, noRecovery({ note: 'Claim dismissed' }));
    expect(preview).toMatchObject({ outcome: 'NO_RECOVERY', awarded: null, commission: '0.00', billable: { gross: '0.00' } });
    expect(res.status).toBe(200);
    expect(body.agreement.contingency).toMatchObject({ outcome: 'NO_RECOVERY', awarded: null, note: 'Claim dismissed' });
    expect(await receivablesOf(h, auth, detail.agreement.id)).toEqual(before);
  });

  it('VAT change: signed at 17 %, decided at 18 % → the upfront bills at 17 %, the commission at 18 %', async () => {
    const h = harness();
    const { auth, project } = await firm(h, { rates: [[1700, '2024-01-01'], [1800, '2025-01-01']] });
    const { detail } = await create(h, auth, contingent(project.id, { agreementDate: '2024-06-01' }));
    expect(detail.installments[0]).toMatchObject({ rateBasisPoints: 1700, vat: '255.00', gross: '1755.00' });
    const { preview, body } = await record(h, auth, detail.agreement.id, award({ outcomeDate: '2026-10-01' }));
    expect(preview).toMatchObject({ vatRateBasisPoints: 1800, billable: { vat: '3600.00', gross: '23600.00' } });
    const rates = (await receivablesOf(h, auth, detail.agreement.id)).map((r) => r.vatRateBasisPoints).sort();
    expect(rates).toEqual([1700, 1800]);
    // The agreement's own frozen rate (the upfront's) does not move.
    expect(body.agreement.vatRateBasisPoints).toBe(1700);
  });

  it('the due date is the outcome date plus the payment terms, unless overridden', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const a = await create(h, auth, contingent(project.id, { paymentTerms: 'EOM_30' }));
    expect((await record(h, auth, a.detail.agreement.id, award())).preview.dueDate).toBe('2026-11-30');
    const b = await create(h, auth, contingent(project.id));
    const { preview, body } = await record(h, auth, b.detail.agreement.id, award({ dueDate: '2026-12-15' }));
    expect(preview.dueDate).toBe('2026-12-15');
    expect(body.installments.find((i: Loose) => i.isCommission).dueDate).toBe('2026-12-15');
  });

  it('credits on the upfront reduce what counts (stored splits); a credit between preview and record is PREVIEW_STALE', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const id = detail.agreement.id;
    const preview = await read(await previewOutcome(h, auth, id, award()));
    expect(preview.upfrontCounted).toBe('1500.00');

    const upfront = detail.installments[0].receivableId;
    const credited = await h.app.request(`/v1/receivables/${upfront}/credits`, json({ amount: '118.00', reason: 'Goodwill' }, { ...auth, ...idem() }));
    expect(credited.status).toBe(201);

    const stale = await h.app.request(`/v1/agreements/${id}/outcome`, json({ ...award(), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(stale.status).toBe(409);
    expect(await reason(stale)).toBe('PREVIEW_STALE');

    // ₪118 gross credit at 18 % = ₪100 net: counted 1,400, billed 20,000 − 1,400 = 18,600.
    const { preview: fresh, res } = await record(h, auth, id, award());
    expect(fresh).toMatchObject({ upfrontCounted: '1400.00', appliedUpfront: '1400.00', billable: { amount: '18600.00' } });
    expect(res.status).toBe(200);
  });

  it('unpaid upfront still counts, and a separate FIXED hearing agreement never changes the contingency maths but counts in agreed', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' }, installments: [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'MANUAL' } }] }));
    await create(h, auth, fixed(project.id));
    const { preview } = await record(h, auth, detail.agreement.id, award());
    expect(preview).toMatchObject({ upfrontCounted: '1500.00', billable: { gross: '21830.00' } });
    const summary = await read(await h.app.request(`/v1/summaries/projects/${project.id}`, { headers: auth }));
    // agreed = fixed 944.00 + contingency (1,770.00 upfront + 21,830.00 commission)
    expect(summary).toMatchObject({ kind: 'FIXED', agreed: '24544.00' });
  });

  it('a second record, or a terms change after the outcome, is 409', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const first = await record(h, auth, detail.agreement.id, award());
    expect(first.res.status).toBe(200);
    // Once an outcome exists the preview answers in CORRECT mode; recording again is refused.
    const again = await previewOutcome(h, auth, detail.agreement.id, award());
    expect(again.status).toBe(200);
    expect((await read(again)).mode).toBe('CORRECT');
    const replay = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome`, json({ ...award(), previewToken: first.preview.previewToken }, { ...auth, ...idem() }));
    expect(replay.status).toBe(409);
    expect(await reason(replay)).toBe('OUTCOME_ALREADY_RECORDED');
  });

  it('two records racing on one fresh preview: one wins, the other is 409 and nothing is billed twice', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const id = detail.agreement.id;
    const preview = await read(await previewOutcome(h, auth, id, award()));
    const send = () => h.app.request(`/v1/agreements/${id}/outcome`, json({ ...award(), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await receivablesOf(h, auth, id)).filter((r) => r.gross === '23600.00')).toHaveLength(1);
  });

  it('an idempotent replay returns the first response and posts once', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const key = idem();
    const first = await record(h, auth, detail.agreement.id, award(), key);
    const replay = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome`, json({ ...award(), previewToken: first.preview.previewToken }, { ...auth, ...key }));
    expect(replay.status).toBe(200);
    expect(await read(replay)).toEqual(first.body);
    expect(await receivablesOf(h, auth, detail.agreement.id)).toHaveLength(2);
  });

  it('a commission line a crash left unposted posts on the next read, dated on the outcome date', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const agreement = (await h.store.agreements.getById(org.id, detail.agreement.id))!;
    const line = { position: 2, label: 'Commission', amountMinor: 2_000_000n, netMinor: 2_000_000n, vatMinor: 360_000n, grossMinor: 2_360_000n, vatTreatment: 'STANDARD_RATED' as const, rateBasisPoints: 1800, triggerType: 'DATE' as const, triggerDate: '2026-10-12', paymentTerms: null, dueDateOverride: null, isCommission: true };
    const written = await h.store.agreements.recordOutcome(org.id, agreement.id, { outcome: 'AWARDED', outcomeDate: '2026-10-12', awardedAmountMinor: 10_000_000n, outcomeNote: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commissionInstallment: line, totals: { amountMinor: 2_150_000n, netMinor: 2_150_000n, vatMinor: 387_000n, grossMinor: 2_537_000n }, upfrontReceivables: [], expectedVersion: agreement.version }, h.clock.now);
    expect(written.kind).toBe('updated');
    const healed = await read(await h.app.request(`/v1/agreements/${agreement.id}`, { headers: auth }));
    expect(healed.installments.find((i: Loose) => i.isCommission)).toMatchObject({ status: 'DUE', receivableId: expect.any(String) });
    expect((await receivablesOf(h, auth, agreement.id)).find((r) => r.gross === '23600.00')).toMatchObject({ postingDate: '2026-10-12', dueDate: '2026-10-31' });
  });

  it('audits the figures behind the bill as decimal strings', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const { body } = await record(h, auth, detail.agreement.id, award({ note: 'Judgment' }));
    const line = body.installments.find((i: Loose) => i.isCommission);
    const events = await read(await h.app.request(`/v1/audit?entityType=agreement&entityId=${detail.agreement.id}`, { headers: auth }));
    expect(events.items.find((e: Loose) => e.action === 'agreement.outcome_recorded').metadata).toEqual({
      outcome: 'AWARDED',
      awarded: '100000.00',
      outcomeDate: '2026-10-12',
      rateBasisPoints: 2000,
      upfrontTreatment: 'CREDITED',
      commission: '20000.00',
      upfrontCounted: '1500.00',
      appliedUpfront: '1500.00',
      billable: { amount: '18500.00', net: '18500.00', vat: '3330.00', gross: '21830.00' },
      vatRateBasisPoints: 1800,
      installmentId: line.id,
      receivableId: line.receivableId,
    });
    const posted = await read(await h.app.request(`/v1/audit?entityType=installment&entityId=${line.id}`, { headers: auth }));
    expect(posted.items.map((e: Loose) => e.action)).toEqual(['installment.posted']);
  });
});

describe('outcome validation', () => {
  it('refuses bad awards, a missing label, bad dates, the wrong type, and a terms override outside a correction', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const id = detail.agreement.id;
    const expect422 = async (body: Record<string, unknown>, r: string, field?: string) => {
      const res = await previewOutcome(h, auth, id, body);
      expect(res.status).toBe(422);
      const details = (await read(res)).error.details;
      expect(details.reason).toBe(r);
      if (field) expect(details.field).toBe(field);
    };
    await expect422(award({ awardedAmount: '0.00' }), 'AMOUNT_INVALID', 'awardedAmount');
    await expect422(award({ awardedAmount: '-5.00' }), 'AMOUNT_INVALID', 'awardedAmount');
    await expect422(award({ awardedAmount: '100.005' }), 'AMOUNT_INVALID', 'awardedAmount');
    await expect422(award({ awardedAmount: undefined }), 'AMOUNT_INVALID', 'awardedAmount');
    await expect422(noRecovery({ awardedAmount: '100.00' }), 'AMOUNT_INVALID', 'awardedAmount');
    await expect422(award({ commissionLabel: undefined }), 'COMMISSION_LABEL_REQUIRED', 'commissionLabel');
    await expect422(award({ outcomeDate: '2026-10-14' }), 'OUTCOME_DATE_INVALID', 'outcomeDate');
    await expect422(award({ outcomeDate: '2026-09-30' }), 'OUTCOME_DATE_INVALID', 'outcomeDate');
    await expect422(award({ outcomeDate: '2026-02-30' }), 'DATE_INVALID', 'outcomeDate');
    // The outcome may fall on the agreement date or today.
    expect((await previewOutcome(h, auth, id, award({ outcomeDate: '2026-10-01' }))).status).toBe(200);
    expect((await previewOutcome(h, auth, id, award({ outcomeDate: '2026-10-13' }))).status).toBe(200);

    const override = await previewOutcome(h, auth, id, award({ commissionRateBasisPoints: 2500 }));
    expect(override.status).toBe(409);
    expect(await reason(override)).toBe('OUTCOME_NOT_RECORDED');

    const f = await create(h, auth, fixed(project.id));
    const wrongType = await previewOutcome(h, auth, f.detail.agreement.id, award());
    expect(wrongType.status).toBe(422);
    expect(await reason(wrongType)).toBe('NOT_CONTINGENCY');
  });

  it('a 20.5 % rate is accepted and rounds half up', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2050, upfrontTreatment: 'SEPARATE' } }));
    // 100.10 × 20.5 % = 20.5205 → 20.52
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, award({ awardedAmount: '100.10' })));
    expect(preview.commission).toBe('20.52');
  });

  it('VAT_RATE_MISSING when a standard-rated commission is billed with no rate in force; an exempt one, or nothing billed, needs none', async () => {
    const h = harness();
    const { org, auth, project, customer } = await firm(h, { rates: [] });
    // Through the API a standard-rated agreement cannot exist without a rate (create resolves one on the agreement date), so this guard is reached with one written to the store directly.
    const { agreement } = await h.store.agreements.create({ organizationId: org.id, projectId: project.id, customerId: customer.id, type: 'CONTINGENCY', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'STANDARD_RATED', vatRateBasisPoints: 0, amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', installments: [] }, h.clock.now);
    const missing = await previewOutcome(h, auth, agreement.id, award());
    expect(missing.status).toBe(422);
    expect(await reason(missing)).toBe('VAT_RATE_MISSING');
    expect((await previewOutcome(h, auth, agreement.id, noRecovery())).status).toBe(200);

    const exempt = await create(h, auth, contingent(project.id, { vatTreatment: 'EXEMPT' }));
    const preview = await read(await previewOutcome(h, auth, exempt.detail.agreement.id, award()));
    expect(preview).toMatchObject({ vatRateBasisPoints: 0, billable: { amount: '20000.00', vat: '0.00', gross: '20000.00' } });
  });
});

describe('correcting an outcome', () => {
  it('while unpaid: the old receivable is credited in full, the old line voided, the new one posted; audited with old and new figures', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const id = detail.agreement.id;
    const first = await record(h, auth, id, award());
    const oldLine = first.body.installments.find((i: Loose) => i.isCommission);

    const { preview, res, body } = await correct(h, auth, id, award({ awardedAmount: '120000.00', correctionReason: 'Award amended on appeal' }));
    expect(preview).toMatchObject({ mode: 'CORRECT', commission: '24000.00', billable: { gross: '28320.00' }, replaces: { installmentId: oldLine.id, receivableId: oldLine.receivableId, gross: '23600.00' } });
    expect(res.status).toBe(200);
    expect(body.agreement).toMatchObject({ gross: '30090.00', contingency: { awarded: '120000.00' } });
    expect(body.installments.find((i: Loose) => i.id === oldLine.id)).toMatchObject({ status: 'VOID' });
    const newLine = body.installments.find((i: Loose) => i.isCommission && i.status !== 'VOID');
    expect(newLine).toMatchObject({ gross: '28320.00', status: 'DUE' });

    const old = await read(await h.app.request(`/v1/receivables/${oldLine.receivableId}/credits`, { headers: auth }));
    expect(old.receivable).toMatchObject({ credited: '23600.00', outstanding: '0.00' });
    expect(old.credits).toHaveLength(1);
    expect(old.credits[0]).toMatchObject({ amount: '23600.00', net: '20000.00', vat: '3600.00', reason: 'Award amended on appeal', effectiveDate: '2026-10-13' });

    const events = await read(await h.app.request(`/v1/audit?entityType=agreement&entityId=${id}`, { headers: auth }));
    expect(events.items.find((e: Loose) => e.action === 'agreement.outcome_corrected').metadata).toEqual({
      reason: 'Award amended on appeal',
      replacedInstallmentId: oldLine.id,
      replacedReceivableId: oldLine.receivableId,
      creditId: old.credits[0].id,
      before: { outcome: 'AWARDED', awarded: '100000.00', outcomeDate: '2026-10-12', rateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commission: '20000.00', billable: { amount: '20000.00', net: '20000.00', vat: '3600.00', gross: '23600.00' } },
      after: {
        outcome: 'AWARDED',
        awarded: '120000.00',
        outcomeDate: '2026-10-12',
        rateBasisPoints: 2000,
        upfrontTreatment: 'SEPARATE',
        commission: '24000.00',
        upfrontCounted: '1500.00',
        appliedUpfront: '0.00',
        billable: { amount: '24000.00', net: '24000.00', vat: '4320.00', gross: '28320.00' },
        vatRateBasisPoints: 1800,
        installmentId: newLine.id,
        receivableId: newLine.receivableId,
      },
    });
    const credits = await read(await h.app.request(`/v1/audit?entityType=receivable&entityId=${oldLine.receivableId}`, { headers: auth }));
    expect(credits.items.find((e: Loose) => e.action === 'receivable.credited').metadata).toMatchObject({ amount: '23600.00', source: 'OUTCOME_CORRECTION', agreementId: id, settled: true });
  });

  it('fixes a wrong rate (20 % → 25 %) and flips the treatment in the same correction', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    await record(h, auth, detail.agreement.id, award());
    const { preview, res, body } = await correct(h, auth, detail.agreement.id, award({ commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', correctionReason: 'Contract says 25 %, credited' }));
    expect(preview).toMatchObject({ commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED', commission: '25000.00', appliedUpfront: '1500.00', billable: { amount: '23500.00' } });
    expect(res.status).toBe(200);
    expect(body.agreement.contingency).toMatchObject({ commissionRateBasisPoints: 2500, upfrontTreatment: 'CREDITED' });
    const bad = await previewOutcome(h, auth, detail.agreement.id, award({ commissionRateBasisPoints: 10001, correctionReason: 'x' }));
    expect(await reason(bad)).toBe('COMMISSION_RATE_INVALID');
  });

  it('matrix: AWARDED → NO_RECOVERY credits and posts nothing; NO_RECOVERY → AWARDED posts without a credit; CREDITED zero-billable → a larger award', async () => {
    const h = harness();
    const { auth, project } = await firm(h);

    const a = await create(h, auth, contingent(project.id));
    await record(h, auth, a.detail.agreement.id, award());
    const toNothing = await correct(h, auth, a.detail.agreement.id, noRecovery({ correctionReason: 'Judgment reversed' }));
    expect(toNothing.res.status).toBe(200);
    expect(toNothing.body.installments.filter((i: Loose) => i.isCommission).map((i: Loose) => i.status)).toEqual(['VOID']);
    expect(toNothing.body.agreement).toMatchObject({ gross: '1770.00', contingency: { outcome: 'NO_RECOVERY', awarded: null } });

    const b = await create(h, auth, contingent(project.id));
    await record(h, auth, b.detail.agreement.id, noRecovery());
    const fromNothing = await correct(h, auth, b.detail.agreement.id, award({ correctionReason: 'Settled after all' }));
    expect(fromNothing.preview.replaces).toBeNull();
    expect(fromNothing.res.status).toBe(200);
    expect(fromNothing.body.installments.filter((i: Loose) => i.isCommission).map((i: Loose) => [i.status, i.gross])).toEqual([['DUE', '23600.00']]);

    const c = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    await record(h, auth, c.detail.agreement.id, award({ awardedAmount: '5000.00' }));
    const larger = await correct(h, auth, c.detail.agreement.id, award({ awardedAmount: '50000.00', correctionReason: 'Award re-assessed' }));
    expect(larger.preview).toMatchObject({ replaces: null, commission: '10000.00', appliedUpfront: '1500.00', billable: { amount: '8500.00' } });
    expect(larger.res.status).toBe(200);
  });

  it('after a payment: 409 OUTCOME_HAS_PAYMENTS; a payment landing between preview and correct is refused too, never a 500', async () => {
    const h = harness();
    const { org, auth, project, customer } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const first = await record(h, auth, detail.agreement.id, award());
    const line = first.body.installments.find((i: Loose) => i.isCommission);
    const body = award({ awardedAmount: '90000.00', correctionReason: 'Typo' });
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, body));

    await h.store.payments.create({ organizationId: org.id, customerId: customer.id, projectId: project.id, currency: 'ILS', amountMinor: 100_000n, receivedOn: '2026-10-13', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: line.receivableId, amountMinor: 100_000n }] }, h.clock.now);

    const raced = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...body, previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(raced.status).toBe(409);
    // The settled-commission check runs before the token check, so the reason is always the actionable one.
    expect(await reason(raced)).toBe('OUTCOME_HAS_PAYMENTS');

    const now = await previewOutcome(h, auth, detail.agreement.id, body);
    expect(now.status).toBe(409);
    expect((await read(now)).error.details).toMatchObject({ reason: 'OUTCOME_HAS_PAYMENTS', receivableId: line.receivableId, paid: '1000.00', credited: '0.00' });
  });

  it('a payment the token cannot see (same receivable version) is still refused inside the store: 409 OUTCOME_HAS_PAYMENTS', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const first = await record(h, auth, detail.agreement.id, award());
    const line = first.body.installments.find((i: Loose) => i.isCommission);
    const body = award({ awardedAmount: '90000.00', correctionReason: 'Typo' });
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, body));
    // Simulate an allocation landing after the route's checks: bump paid without moving the version the token covers.
    const original = h.store.agreements.correctOutcome.bind(h.store.agreements);
    (h.store.agreements as Loose).correctOutcome = async (...args: Parameters<typeof original>) => {
      const r = (await h.store.receivables.getById(org.id, line.receivableId))!;
      (h.store as Loose).recs.get(r.id).paidMinor = 1n;
      return original(...args);
    };
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...body, previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'OUTCOME_HAS_PAYMENTS', receivableId: line.receivableId });
  });

  it('without an outcome: 409 OUTCOME_NOT_RECORDED; without a reason: 422', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, award()));
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...award(), correctionReason: 'x', previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('OUTCOME_NOT_RECORDED');
    await record(h, auth, detail.agreement.id, award());
    const again = await read(await previewOutcome(h, auth, detail.agreement.id, award({ correctionReason: 'x' })));
    const noReason = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...award(), previewToken: again.previewToken }, { ...auth, ...idem() }));
    expect(noReason.status).toBe(422);
  });
});

describe('review fixes (D1–D4)', () => {
  it('a cancelled contingency agreement refuses terms changes and outcomes with 409 AGREEMENT_CANCELLED', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { amount: '0.00', installments: [] }));
    const id = detail.agreement.id;
    const cancelled = await read(await h.app.request(`/v1/agreements/${id}/cancel`, json({}, { ...auth, ...idem() })));
    const patch = await h.app.request(`/v1/agreements/${id}/contingency`, json({ commissionRateBasisPoints: 2500 }, { ...auth, 'if-match': String(cancelled.agreement.version) }, 'PATCH'));
    expect(patch.status).toBe(409);
    expect(await reason(patch)).toBe('AGREEMENT_CANCELLED');
    const preview = await previewOutcome(h, auth, id, award());
    expect(preview.status).toBe(409);
    expect(await reason(preview)).toBe('AGREEMENT_CANCELLED');
    expect(await receivablesOf(h, auth, id)).toEqual([]);
  });

  it('a cancel that loses to a concurrent record is 409 OUTCOME_ALREADY_RECORDED, and nothing is voided', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { amount: '0.00', installments: [] }));
    const original = h.store.agreements.cancel.bind(h.store.agreements);
    // The record lands between the route's read and the store's cancel.
    (h.store.agreements as Loose).cancel = async (...args: Parameters<typeof original>) => {
      const a = (await h.store.agreements.getById(org.id, detail.agreement.id))!;
      await h.store.agreements.recordOutcome(org.id, a.id, { outcome: 'NO_RECOVERY', outcomeDate: '2026-10-12', awardedAmountMinor: null, outcomeNote: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commissionInstallment: null, totals: { amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n }, upfrontReceivables: [], expectedVersion: a.version }, h.clock.now);
      return original(...args);
    };
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/cancel`, json({}, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('OUTCOME_ALREADY_RECORDED');
    expect((await h.store.agreements.getById(org.id, detail.agreement.id))?.status).toBe('ACTIVE');
  });

  it('a credit on the upfront landing after the commit computed the bill is PREVIEW_STALE, nothing written (D2)', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const upfront = detail.installments[0].receivableId;
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, award()));
    const original = h.store.agreements.recordOutcome.bind(h.store.agreements);
    (h.store.agreements as Loose).recordOutcome = async (...args: Parameters<typeof original>) => {
      await h.store.receivables.credit(org.id, upfront, { amountMinor: 11_800n, netMinor: 10_000n, vatMinor: 1_800n, reason: 'Goodwill', effectiveDate: '2026-10-13', requestId: null }, h.clock.now);
      return original(...args);
    };
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome`, json({ ...award(), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
    expect((await h.store.agreements.getById(org.id, detail.agreement.id))?.outcome).toBeNull();
  });

  it('a credit landing between the commit reading the credits and the write is still caught: versions are read first', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    const upfront = detail.installments[0].receivableId;
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, award()));
    const original = h.store.receivables.listCredits.bind(h.store.receivables);
    // The credit commits right after the commit's credit read: counted misses it, so the version check must see it.
    (h.store.receivables as Loose).listCredits = async (...args: Parameters<typeof original>) => {
      const before = await original(...args);
      if (args[1] === upfront) await h.store.receivables.credit(org.id, upfront, { amountMinor: 11_800n, netMinor: 10_000n, vatMinor: 1_800n, reason: 'Goodwill', effectiveDate: '2026-10-13', requestId: null }, h.clock.now);
      return before;
    };
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome`, json({ ...award(), previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('PREVIEW_STALE');
  });

  it('triggering a MANUAL upfront that a cancel voided under the route is 409 AGREEMENT_CANCELLED, not 404', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { installments: [{ label: 'Upfront', amount: '1500.00', trigger: { type: 'MANUAL' } }] }));
    const original = h.store.agreements.postInstallment.bind(h.store.agreements);
    (h.store.agreements as Loose).postInstallment = async (...args: Parameters<typeof original>) => {
      await h.store.agreements.cancel(org.id, detail.agreement.id, { cancelEffectiveMonth: null, finalMonth: null }, h.clock.now);
      return original(...args);
    };
    const res = await h.app.request(`/v1/installments/${detail.installments[0].id}/trigger`, json({}, { ...auth, ...idem() }));
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe('AGREEMENT_CANCELLED');
  });

  it('a correction previewed without its reason commits with one (the reason is not in the token, D3)', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    await record(h, auth, detail.agreement.id, award());
    const preview = await read(await previewOutcome(h, auth, detail.agreement.id, award({ awardedAmount: '90000.00' })));
    expect(preview.mode).toBe('CORRECT');
    // A figure in the body still counts: a different award under the same token is stale.
    const otherAward = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...award({ awardedAmount: '80000.00' }), correctionReason: 'Typo', previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(otherAward.status).toBe(409);
    expect(await reason(otherAward)).toBe('PREVIEW_STALE');
    const res = await h.app.request(`/v1/agreements/${detail.agreement.id}/outcome/correct`, json({ ...award({ awardedAmount: '90000.00' }), correctionReason: 'Typo', previewToken: preview.previewToken }, { ...auth, ...idem() }));
    expect(res.status).toBe(200);
  });

  it('a credited-but-unpaid commission refuses a correction with 409 OUTCOME_HAS_PAYMENTS', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const first = await record(h, auth, detail.agreement.id, award());
    const line = first.body.installments.find((i: Loose) => i.isCommission);
    expect((await h.app.request(`/v1/receivables/${line.receivableId}/credits`, json({ amount: '100.00', reason: 'Goodwill' }, { ...auth, ...idem() }))).status).toBe(201);
    const res = await previewOutcome(h, auth, detail.agreement.id, award({ awardedAmount: '90000.00', correctionReason: 'Typo' }));
    expect(res.status).toBe(409);
    expect((await read(res)).error.details).toMatchObject({ reason: 'OUTCOME_HAS_PAYMENTS', paid: '0.00', credited: '100.00' });
  });

  it('correcting a commission that never posted voids it with no credit and posts the new one', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const agreement = (await h.store.agreements.getById(org.id, detail.agreement.id))!;
    const line = { position: 2, label: 'Commission', amountMinor: 2_000_000n, netMinor: 2_000_000n, vatMinor: 360_000n, grossMinor: 2_360_000n, vatTreatment: 'STANDARD_RATED' as const, rateBasisPoints: 1800, triggerType: 'DATE' as const, triggerDate: '2026-10-12', paymentTerms: null, dueDateOverride: null, isCommission: true };
    await h.store.agreements.recordOutcome(org.id, agreement.id, { outcome: 'AWARDED', outcomeDate: '2026-10-12', awardedAmountMinor: 10_000_000n, outcomeNote: null, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', commissionInstallment: line, totals: { amountMinor: 2_150_000n, netMinor: 2_150_000n, vatMinor: 387_000n, grossMinor: 2_537_000n }, upfrontReceivables: [], expectedVersion: agreement.version }, h.clock.now);
    const { preview, res, body } = await correct(h, auth, agreement.id, award({ awardedAmount: '90000.00', correctionReason: 'Typo' }));
    expect(preview.replaces).toMatchObject({ receivableId: null, gross: '23600.00' });
    expect(res.status).toBe(200);
    const lines = body.installments.filter((i: Loose) => i.isCommission);
    expect(lines.map((i: Loose) => [i.status, i.gross, i.receivableId === null])).toEqual([['VOID', '23600.00', true], ['DUE', '21240.00', false]]);
    const commissions = (await receivablesOf(h, auth, agreement.id)).filter((r) => r.gross !== '1770.00');
    expect(commissions.map((r) => [r.gross, r.credited])).toEqual([['21240.00', '0.00']]);
  });

  it('VAT included, CREDITED: the bill is computed in gross terms and the VAT taken out of it', async () => {
    const h = harness();
    const { auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id, { amount: '1770.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Upfront', amount: '1770.00', trigger: { type: 'IMMEDIATE' } }], contingency: { commissionRateBasisPoints: 2000, upfrontTreatment: 'CREDITED' } }));
    expect(detail.installments[0]).toMatchObject({ net: '1500.00', vat: '270.00', gross: '1770.00' });
    const { preview, body } = await record(h, auth, detail.agreement.id, award({ awardedAmount: '118000.00' }));
    expect(preview).toMatchObject({ commission: '23600.00', upfrontCounted: '1770.00', appliedUpfront: '1770.00', billable: { amount: '21830.00', net: '18500.00', vat: '3330.00', gross: '21830.00' } });
    const line = body.installments.find((i: Loose) => i.isCommission);
    expect((await receivablesOf(h, auth, detail.agreement.id)).find((r) => r.id === line.receivableId)).toMatchObject({ net: '18500.00', vat: '3330.00', gross: '21830.00' });
  });

  it('a key with agreements:read only cannot change terms, record or correct; it may preview', async () => {
    const h = harness();
    const { org, auth, project } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const readKey = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Reader', scopes: ['agreements:read'] }, admin)));
    const reader = { authorization: `Bearer ${readKey.secret}` };
    const id = detail.agreement.id;
    const preview = await previewOutcome(h, reader, id, award());
    expect(preview.status).toBe(200);
    const token = (await read(preview)).previewToken;
    expect((await h.app.request(`/v1/agreements/${id}/contingency`, json({ commissionRateBasisPoints: 2500 }, { ...reader, 'if-match': '1' }, 'PATCH'))).status).toBe(403);
    expect((await h.app.request(`/v1/agreements/${id}/outcome`, json({ ...award(), previewToken: token }, { ...reader, ...idem() }))).status).toBe(403);
    expect((await h.app.request(`/v1/agreements/${id}/outcome/correct`, json({ ...award(), correctionReason: 'x', previewToken: token }, { ...reader, ...idem() }))).status).toBe(403);
    expect((await h.store.agreements.getById(org.id, id))?.outcome).toBeNull();
  });
});

describe('project summary', () => {
  it('kind FIXED with a contingency block; PENDING while the outcome is awaited even when the upfront is paid; owed again once the commission posts', async () => {
    const h = harness();
    const { org, auth, project, customer } = await firm(h);
    const { detail } = await create(h, auth, contingent(project.id));
    const upfront = detail.installments[0].receivableId;
    await h.store.payments.create({ organizationId: org.id, customerId: customer.id, projectId: project.id, currency: 'ILS', amountMinor: 177_000n, receivedOn: '2026-10-13', method: 'BANK', reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: upfront, amountMinor: 177_000n }] }, h.clock.now);

    const awaiting = await read(await h.app.request(`/v1/summaries/projects/${project.id}`, { headers: auth }));
    expect(awaiting).toMatchObject({ kind: 'FIXED', agreed: '1770.00', paid: '1770.00', status: 'PENDING', contingency: { agreementId: detail.agreement.id, commissionRateBasisPoints: 2000, upfrontTreatment: 'SEPARATE', outcome: 'AWAITING', awarded: null } });

    await record(h, auth, detail.agreement.id, award());
    const decided = await read(await h.app.request(`/v1/summaries/projects/${project.id}`, { headers: auth }));
    expect(decided).toMatchObject({ agreed: '25370.00', status: 'PARTIALLY_PAID', contingency: { outcome: 'AWARDED', awarded: '100000.00' } });

    const plain = await firm(h);
    const none = await read(await h.app.request(`/v1/summaries/projects/${plain.project.id}`, { headers: plain.auth }));
    expect(none.contingency).toBeNull();
  });
});
