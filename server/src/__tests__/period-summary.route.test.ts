import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { addMonths, endOfMonth } from '../dates.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';
import { provisionUser } from './helpers/provision.js';

/**
 * MUT-483 (ADR-227): GET /v1/summaries/period over HTTP, one test per acceptance criterion, over the in-memory store
 * and a fixed clock. The year-long fixture runs through the real routes: fees (one corrected by MUT-444), a retainer, a
 * DATE line that posts on a read, credits, a bounce near local midnight, a MUT-443 correction, a USD fee and a payment
 * with no client.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const COOKIE = '__Host-mut_session';
const SAME_ORIGIN = { origin: 'http://localhost' };
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let seq = 0;
const idem = () => ({ 'idempotency-key': `period-${++seq}-${Math.random().toString(36).slice(2, 8)}` });
const minor = (amount: string) => BigInt(amount.replace('.', ''));
const PERSON = '00000000-0000-4000-8000-0000000000ee';

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2025-11-03T10:00:00Z') };
  const logs: Loose[] = [];
  const sink = new Writable({ write: (chunk: Buffer, _enc, done) => void (logs.push(JSON.parse(chunk.toString())), done()) });
  const app = createApp({
    store,
    logger: pino({ level: 'info' }, sink),
    rateLimiter: new SlidingWindowRateLimiter(1_000_000),
    adminToken: ADMIN_TOKEN,
    keyEnvironment: 'test',
    version: '0.9.0-test',
    now: () => clock.now,
    sessions: { pepper: 'session-pepper-with-at-least-32-chars!!', idleMinutes: 120, absoluteHours: 12, secureCookie: true, trustedProxyHops: 1 },
  });
  const on = (date: string, time = '10:00:00') => void (clock.now = new Date(`${date}T${time}Z`));
  return { app, store, clock, logs, on };
}
type H = ReturnType<typeof harness>;

/** A Malafat-connected firm with an integration key holding every scope. */
async function firm(h: H) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  await h.store.integrations.connect({ organizationId: org.id, provider: 'MALAFAT', externalTenantId: `tenant-${seq}`, displayName: 'Firm', connectedByApiKeyId: key.apiKey.id, at: h.clock.now });
  const auth = { authorization: `Bearer ${key.secret as string}` };
  expect((await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2024-01-01' }, auth, 'PUT'))).status).toBe(201);
  const customer = async (name: string) => read(await h.app.request('/v1/customers', json({ name }, { ...auth, ...idem() })));
  const project = async (customerId: string, name: string, currency = 'ILS') => read(await h.app.request('/v1/projects', json({ customerId, name, currency }, { ...auth, ...idem() })));
  return { org, key, auth, customer, project };
}
type F = Awaited<ReturnType<typeof firm>>;

async function ok(res: Response, status = 200): Promise<Loose> {
  const body = await read(res);
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function agreement(h: H, f: F, body: Record<string, unknown>) {
  const preview = await ok(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  return ok(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })), 201);
}

async function pay(h: H, f: F, customerId: string, amount: string, receivedOn: string, allocations: Array<{ receivableId: string; amount: string }> = [], currency = 'ILS') {
  const p = await ok(await h.app.request('/v1/allocations/preview', json({ customerId, currency, amount, allocations }, f.auth)));
  return ok(await h.app.request('/v1/payments', json({ customerId, currency, amount, receivedOn, method: 'BANK', allocations, previewToken: p.previewToken }, { ...f.auth, ...idem() })), 201);
}

async function previewThenCommit(h: H, f: F, path: string, body: Record<string, unknown>, extra: Record<string, unknown>) {
  const preview = await ok(await h.app.request(`${path}/preview`, json(body, f.auth)));
  return ok(await h.app.request(path, json({ ...body, ...extra, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
}

const period = (h: H, query: string, headers: Record<string, string>) => h.app.request(`/v1/summaries/period${query ? `?${query}` : ''}`, { headers });

/**
 * November 2025 to October 2026. A owes a ₪1,000 + VAT fee billed 2025-11-03, pays ₪500 against it, gets a ₪100 credit
 * in January and a ₪200 payment that bounces at 00:30 local on 3 April; the fee is corrected to ₪1,000 VAT-inclusive
 * on 20 August (MUT-444: the old charge's ₪1,080 remainder credited and ₪1,000 reposted, both dated 2025-11-03). B has
 * a ₪200 + VAT retainer from December, a ₪500 DATE line on 15 March, and ₪300 paid unallocated in February, corrected
 * on 12 May to ₪350 on the same date (MUT-443). A also has a $100 + VAT fee in June and pays $50 in July. A ₪70
 * payment with no client lands in September.
 */
async function year(h: H) {
  const f = await firm(h);
  const a = await f.customer('Haddad');
  const b = await f.customer('Nasser');
  const [aIls, bIls, aUsd] = [await f.project(a.id, 'Sale'), await f.project(b.id, 'Lease'), await f.project(a.id, 'Export', 'USD')];
  const one = (projectId: string, amount: string, pricingBasis: string, agreementDate: string, trigger: Record<string, string> = { type: 'IMMEDIATE' }) => ({ projectId, amount, pricingBasis, agreementDate, paymentTerms: 'EOM', installments: [{ label: 'Fee', amount, trigger }] });

  const fee = await agreement(h, f, one(aIls.id, '1000.00', 'VAT_EXCLUSIVE', '2025-11-03'));
  const feeCharge = fee.installments[0].receivableId as string;
  h.on('2025-11-20');
  await pay(h, f, a.id, '500.00', '2025-11-20', [{ receivableId: feeCharge, amount: '500.00' }]);
  h.on('2025-12-02');
  const retainer = { projectId: bIls.id, monthlyAmount: '200.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2025-12', billingDay: 1, paymentTerms: 'EOM' };
  const rp = await ok(await h.app.request('/v1/retainers/preview', json(retainer, f.auth)));
  await ok(await h.app.request('/v1/retainers', json({ ...retainer, previewToken: rp.previewToken }, { ...f.auth, ...idem() })), 201);
  h.on('2026-01-10');
  await agreement(h, f, one(bIls.id, '500.00', 'VAT_INCLUSIVE', '2026-01-10', { type: 'DATE', date: '2026-03-15' }));
  h.on('2026-01-15');
  await ok(await h.app.request(`/v1/receivables/${feeCharge}/credits`, json({ amount: '100.00', reason: 'Goodwill', effectiveDate: '2026-01-15' }, { ...f.auth, ...idem() })), 201);
  h.on('2026-02-10');
  const unallocated = await pay(h, f, b.id, '300.00', '2026-02-10');
  h.on('2026-03-05');
  const bounce = await pay(h, f, a.id, '200.00', '2026-03-05', [{ receivableId: feeCharge, amount: '200.00' }]);
  h.on('2026-04-02', '21:30:00');
  await ok(await h.app.request(`/v1/payments/${bounce.id}/reverse`, json({ reason: 'Cheque bounced' }, { ...f.auth, ...idem() })));
  h.on('2026-05-12');
  await previewThenCommit(h, f, `/v1/payments/${unallocated.id}/correct`, { amount: '350.00', receivedOn: '2026-02-10', method: 'BANK', allocations: [] }, { reasonCode: 'ENTERED_BY_MISTAKE' });
  h.on('2026-06-01');
  const usd = await agreement(h, f, one(aUsd.id, '100.00', 'VAT_EXCLUSIVE', '2026-06-01'));
  h.on('2026-07-03');
  await pay(h, f, a.id, '50.00', '2026-07-03', [{ receivableId: usd.installments[0].receivableId, amount: '50.00' }], 'USD');
  h.on('2026-08-20');
  await previewThenCommit(h, f, `/v1/agreements/${fee.agreement.id}/correct`, { amount: '1000.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'Fee', amount: '1000.00', trigger: { type: 'IMMEDIATE' } }] }, { reasonCode: 'ENTERED_BY_MISTAKE' });
  h.on('2026-09-09');
  // A person's Received with no client (MUT-65) is a session write on a profile of their own; written through its store method.
  await h.store.payments.capture({ organizationId: f.org.id, customerId: null, projectId: null, currency: 'ILS', amountMinor: 7_000n, receivedOn: '2026-09-09', method: 'CASH', notes: null, requestId: null, createdByUserId: PERSON, captureSource: null }, h.clock.now);
  h.on('2026-10-29');
  return { f, customers: [a.id as string, b.id as string] };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => `${addMonths('2025-11', i)}-01`);
type Totals = { opening: bigint; billed: bigint; credited: bigint; payments: bigint; reversals: bigint; closing: bigint };

/** Σ each customer's statement lines in the month, split by kind, with their opening and closing balances. */
async function statementsFor(h: H, f: F, customers: string[], currency: string, from: string, to: string): Promise<Totals> {
  const t: Totals = { opening: 0n, billed: 0n, credited: 0n, payments: 0n, reversals: 0n, closing: 0n };
  for (const id of customers) {
    const s = await ok(await h.app.request(`/v1/customers/${id}/statement?currency=${currency}&from=${from}&to=${to}&limit=500`, { headers: f.auth }));
    expect(s.nextCursor).toBeNull();
    t.opening += minor(s.openingBalance);
    t.closing += minor(s.closingBalance);
    for (const l of s.lines) {
      if (l.kind === 'CHARGE') t.billed += minor(l.debit);
      if (l.kind === 'CREDIT') t.credited += minor(l.credit);
      if (l.kind === 'PAYMENT') t.payments += minor(l.credit);
      if (l.kind === 'PAYMENT_REVERSAL') t.reversals += minor(l.debit);
    }
  }
  return t;
}

const totalsOf = (block: Loose): Totals => ({ opening: minor(block.openingBalance), billed: minor(block.billed), credited: minor(block.credited), payments: minor(block.payments), reversals: minor(block.reversals), closing: minor(block.closingBalance) });

describe('GET /v1/summaries/period (MUT-483)', () => {
  it('AC1: each month\'s billed, credited, payments and reversals are the customers\' statement lines summed, plus the clientless payment', async () => {
    const h = harness();
    const { f, customers } = await year(h);
    for (const from of MONTHS) {
      const to = endOfMonth(from);
      for (const currency of ['ILS', 'USD']) {
        const body = await ok(await period(h, `from=${from}&to=${to}&currency=${currency}`, f.auth));
        expect(body.currencies).toHaveLength(1);
        const expected = await statementsFor(h, f, customers, currency, from, to);
        // D4: the ₪70 with no client is on no statement; it is in September's payments and every later balance.
        if (currency === 'ILS' && from === '2026-09-01') expected.payments += 7_000n;
        if (currency === 'ILS' && from >= '2026-09-01') expected.closing -= 7_000n;
        if (currency === 'ILS' && from >= '2026-10-01') expected.opening -= 7_000n;
        expect(totalsOf(body.currencies[0]), `${currency} ${from}`).toEqual(expected);
      }
    }
  });

  it('AC1: a corrected month reads in net (R6): November carries the replaced fee, its correction credit and the repost', async () => {
    const h = harness();
    const { f } = await year(h);
    const nov = (await ok(await period(h, 'from=2025-11-01&to=2025-11-30&currency=ILS', f.auth))).currencies[0];
    expect(nov).toEqual({ currency: 'ILS', openingBalance: '0.00', billed: '2180.00', credited: '1080.00', received: '500.00', payments: '500.00', reversals: '0.00', change: '600.00', closingBalance: '600.00' });
    // February: the ₪300 and its ₪350 replacement are both dated 10 February; the original's reversal is May's.
    const feb = (await ok(await period(h, 'from=2026-02-01&to=2026-02-28&currency=ILS', f.auth))).currencies[0];
    expect(feb).toMatchObject({ payments: '650.00', reversals: '0.00', received: '650.00', billed: '236.00' });
    const may = (await ok(await period(h, 'from=2026-05-01&to=2026-05-31&currency=ILS', f.auth))).currencies[0];
    expect(may).toMatchObject({ payments: '0.00', reversals: '300.00', received: '-300.00' });
    // The bounce at 21:30 UTC on 2 April is 00:30 on 3 April in Asia/Jerusalem: April's reversal.
    expect((await ok(await period(h, 'from=2026-04-03&to=2026-04-03&currency=ILS', f.auth))).currencies[0]).toMatchObject({ reversals: '200.00' });
  });

  it('AC2: closing − opening = billed − received − credited = change on every month, and each opening is the month before\'s closing', async () => {
    const h = harness();
    const { f } = await year(h);
    let previous: Loose = null;
    for (const from of MONTHS) {
      const body = await ok(await period(h, `from=${from}&to=${endOfMonth(from)}`, f.auth));
      expect(body.currencies.map((c: Loose) => c.currency)).toEqual(from < '2026-06-01' ? ['ILS'] : ['ILS', 'USD']);
      for (const c of body.currencies) {
        const change = minor(c.closingBalance) - minor(c.openingBalance);
        expect(minor(c.change)).toBe(change);
        expect(minor(c.received)).toBe(minor(c.payments) - minor(c.reversals));
        expect(change).toBe(minor(c.billed) - minor(c.received) - minor(c.credited));
        const before = previous?.currencies.find((x: Loose) => x.currency === c.currency);
        expect(c.openingBalance).toBe(before?.closingBalance ?? '0.00');
      }
      previous = body;
    }
    // With `to` on or after the last line, closing = the organization summary's outstanding − unallocated.
    const summary = await ok(await h.app.request('/v1/summaries/organization', { headers: f.auth }));
    const whole = await ok(await period(h, 'from=2025-11-01&to=2026-10-31', f.auth));
    for (const block of summary.currencies) {
      expect(minor(whole.currencies.find((c: Loose) => c.currency === block.currency).closingBalance)).toBe(minor(block.outstanding) - minor(block.unallocated));
    }
  });

  it('AC3: needs summaries:read; a key, a session and a device session with it read the same figures; another organization never shows', async () => {
    const h = harness();
    const { f } = await year(h);
    const narrow = await read(await h.app.request(`/admin/v1/organizations/${f.org.id}/api-keys`, json({ name: 'Narrow', scopes: SCOPES.filter((s) => s !== 'summaries:read') }, admin)));
    const refused = await period(h, '', { authorization: `Bearer ${narrow.secret as string}` });
    expect(refused.status).toBe(403);
    expect((await read(refused)).error).toMatchObject({ code: 'INSUFFICIENT_SCOPE', details: { required: 'summaries:read' } });

    const email = `partner${++seq}@firm.ps`;
    const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: f.org.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const signIn = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
    const token = new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const device = await read(await h.app.request('/v1/device-sessions', json({ email, password: created.password })));
    const query = 'from=2026-01-01&to=2026-10-31';
    const byKey = await ok(await period(h, query, f.auth));
    expect(await ok(await period(h, query, { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': f.org.id, ...SAME_ORIGIN }))).toEqual(byKey);
    expect(await ok(await period(h, query, { authorization: `Bearer ${device.token as string}`, 'x-mutaba3a-profile': f.org.id }))).toEqual(byKey);

    const other = await firm(h);
    const theirs = await other.customer('Elsewhere');
    await pay(h, other, theirs.id, '999.00', '2026-10-01');
    expect(await ok(await period(h, query, f.auth))).toEqual(byKey);
    expect((await ok(await period(h, 'currency=ILS', other.auth))).currencies).toEqual([expect.objectContaining({ payments: '999.00', closingBalance: '-999.00' })]);
  });

  it('AC4: the contract version is 1.90.0-mut483 and the route is published under Summaries with the API key', async () => {
    const h = harness();
    expect(API_VERSION).toBe('1.90.0-mut483');
    const doc = await read(await h.app.request('/openapi.json'));
    expect(doc.info.version).toBe('1.90.0-mut483');
    const op = doc.paths['/v1/summaries/period'].get;
    expect(op.tags).toEqual(['Summaries']);
    expect(op.security).toEqual([{ apiKey: [] }, { session: [] }, { deviceSession: [] }]);
    expect(op.description).toContain('Figures are the ledger as it stands at asOf');
  });

  describe('the range', () => {
    it('defaults to this month in the organization timezone, to its last day (R11), and echoes asOf and the timezone', async () => {
      const h = harness();
      const { f } = await year(h);
      const body = await ok(await period(h, '', f.auth));
      expect(body).toMatchObject({ from: '2026-10-01', to: '2026-10-31', asOf: '2026-10-29', timezone: 'Asia/Jerusalem' });
      // A line dated later this month counts in the default closing.
      await pay(h, f, (await f.customer('Later')).id, '10.00', '2026-10-30');
      const after = await ok(await period(h, 'currency=ILS', f.auth));
      expect(after.currencies[0].payments).toBe('10.00');
    });

    it.each([
      ['from=2026-02-30', 'DATE_INVALID', 'from'],
      ['to=2026-13-01', 'DATE_INVALID', 'to'],
      ['from=2026-10-10&to=2026-10-01', 'END_BEFORE_START', 'to'],
      ['from=2025-01-01&to=2026-02-01', 'RANGE_TOO_LONG', 'to'],
    ])('%s is 422 %s', async (query, reason, field) => {
      const h = harness();
      const f = await firm(h);
      const res = await period(h, query, f.auth);
      expect(res.status).toBe(422);
      expect((await read(res)).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { reason, field } });
    });

    it('an unknown currency is 422 VALIDATION_FAILED, and ?currency= with no data is one block of zeros (R12)', async () => {
      const h = harness();
      const f = await firm(h);
      expect((await period(h, 'currency=XYZ', f.auth)).status).toBe(422);
      expect((await ok(await period(h, 'currency=JOD', f.auth))).currencies).toEqual([{ currency: 'JOD', openingBalance: '0.000', billed: '0.000', credited: '0.000', received: '0.000', payments: '0.000', reversals: '0.000', change: '0.000', closingBalance: '0.000' }]);
      expect((await ok(await period(h, '', f.auth))).currencies).toEqual([]);
    });
  });

  describe('lazy posting (S5, R7)', () => {
    /** A DATE line due 2026-03-15 and a retainer from March, both unposted until a read on 2026-03-20. */
    async function due(h: H) {
      const f = await firm(h);
      const c = await f.customer('Haddad');
      const p = await f.project(c.id, 'Sale');
      h.on('2026-01-10');
      await agreement(h, f, { projectId: p.id, amount: '500.00', pricingBasis: 'VAT_INCLUSIVE', agreementDate: '2026-01-10', paymentTerms: 'EOM', installments: [{ label: 'Fee', amount: '500.00', trigger: { type: 'DATE', date: '2026-03-15' } }] });
      const retainer = { projectId: p.id, monthlyAmount: '200.00', pricingBasis: 'VAT_EXCLUSIVE', startMonth: '2026-03', billingDay: 1, paymentTerms: 'EOM' };
      const rp = await ok(await h.app.request('/v1/retainers/preview', json(retainer, f.auth)));
      await ok(await h.app.request('/v1/retainers', json({ ...retainer, previewToken: rp.previewToken }, { ...f.auth, ...idem() })), 201);
      h.on('2026-03-20');
      return f;
    }
    const posted = async (h: H, f: F) => (await h.store.audit.list(f.org.id, {}, { limit: 500, cursor: null })).items.filter((e) => e.action === 'installment.posted' || e.action === 'retainer.charged');

    it('a key\'s first read posts the due DATE line and the retainer charge in their own month, as the key', async () => {
      const h = harness();
      const f = await due(h);
      const march = await ok(await period(h, 'from=2026-03-01&to=2026-03-31&currency=ILS', f.auth));
      expect(march.currencies[0]).toMatchObject({ billed: '736.00' });
      const rows = await posted(h, f);
      expect(rows.map((e) => e.action).sort()).toEqual(['installment.posted', 'retainer.charged']);
      for (const e of rows) expect(e).toMatchObject({ actorType: 'API_KEY', actorId: f.key.apiKey.id });
    });

    it('a session\'s read posts as SYSTEM', async () => {
      const h = harness();
      const f = await due(h);
      const email = `partner${++seq}@firm.ps`;
      const created = await provisionUser(h.app, { email, displayName: 'Nour Haddad', organizationId: f.org.id, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const signIn = await h.app.request('/v1/sessions', json({ email, password: created.password }, SAME_ORIGIN));
      const token = new RegExp(`${COOKIE}=([^;]*)`).exec(signIn.headers.get('set-cookie') ?? '')?.[1] ?? '';
      await ok(await period(h, 'from=2026-03-01&to=2026-03-31', { cookie: `${COOKIE}=${token}`, 'x-mutaba3a-profile': f.org.id, ...SAME_ORIGIN }));
      const rows = await posted(h, f);
      expect(rows).toHaveLength(2);
      for (const e of rows) expect(e).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    });

    it('a refused request posts nothing', async () => {
      const h = harness();
      const f = await due(h);
      expect((await period(h, 'from=2026-03-10&to=2026-03-01', f.auth)).status).toBe(422);
      expect((await period(h, 'currency=XYZ', f.auth)).status).toBe(422);
      expect(await posted(h, f)).toEqual([]);
    });
  });

  it('logs one summaries.period line with the rows read and the timings, and no amounts (R5)', async () => {
    const h = harness();
    const { f } = await year(h);
    h.logs.length = 0;
    await ok(await period(h, 'from=2026-10-01&to=2026-10-31', f.auth));
    const lines = h.logs.filter((l) => l.msg === 'summaries.period');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ organizationId: f.org.id, rows: { receivables: expect.any(Number), credits: 2, payments: 6 }, currencies: 2, postingMs: expect.any(Number), readMs: expect.any(Number), sumMs: expect.any(Number) });
    expect(lines[0].rows.receivables).toBeGreaterThan(10);
    expect(JSON.stringify(lines[0])).not.toMatch(/\d+\.\d{2}"/);
  });
});
