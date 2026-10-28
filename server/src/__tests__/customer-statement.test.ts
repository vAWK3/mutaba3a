import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { API_VERSION, createApp } from '../app.js';
import { SCOPES } from '../auth/scopes.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/** MUT-478: GET /v1/customers/{id}/statement, one test per acceptance criterion, over the in-memory store. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const read = (res: Response): Promise<Loose> => res.json() as Promise<Loose>;
const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
let seq = 0;
const idem = () => ({ 'idempotency-key': `key-${++seq}-${Math.random().toString(36).slice(2, 8)}` });
const minor = (amount: string) => BigInt(Math.round(Number(amount) * 100));

function harness() {
  const store = new MemoryLedgerStore();
  const clock = { now: new Date('2026-10-27T10:00:00Z') };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(1_000_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.6.0-test', now: () => clock.now, attachments: null, attachmentUrlTtlSeconds: 600 });
  return { app, store, clock };
}
type H = ReturnType<typeof harness>;

async function firm(h: H) {
  const org = await read(await h.app.request('/admin/v1/organizations', json({ name: `Firm ${++seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, admin)));
  const key = await read(await h.app.request(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin)));
  const auth = { authorization: `Bearer ${key.secret}` };
  await h.app.request('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2025-01-01' }, auth, 'PUT'));
  const customer = await read(await h.app.request('/v1/customers', json({ name: 'Haddad' }, { ...auth, ...idem() })));
  const project = async (name: string) => read(await h.app.request('/v1/projects', json({ customerId: customer.id, name, currency: 'ILS' }, { ...auth, ...idem() })));
  return { auth, customer, p1: await project('Sale'), p2: await project('Lease') };
}
type F = Awaited<ReturnType<typeof firm>>;

/** A fixed, VAT-exclusive, standard-rated agreement whose installments post on its date (DATE triggers, already past). */
async function agreement(h: H, f: F, projectId: string, amounts: string[], agreementDate = '2026-03-01') {
  const body = { projectId, amount: amounts.reduce((s, a) => s + Number(a), 0).toFixed(2), pricingBasis: 'VAT_EXCLUSIVE', agreementDate, paymentTerms: 'EOM', installments: amounts.map((amount, i) => ({ label: `I${i + 1}`, amount, trigger: { type: 'DATE', date: agreementDate } })) };
  const preview = await read(await h.app.request('/v1/agreements/preview', json(body, f.auth)));
  const created = await read(await h.app.request('/v1/agreements', json({ ...body, previewToken: preview.previewToken }, { ...f.auth, ...idem() })));
  return created.installments.map((i: Loose) => i.receivableId) as string[];
}

async function pay(h: H, f: F, amount: string, receivedOn: string, allocations: Array<{ receivableId: string; amount: string }> = []) {
  const p = await read(await h.app.request('/v1/allocations/preview', json({ customerId: f.customer.id, currency: 'ILS', amount, allocations }, f.auth)));
  return read(await h.app.request('/v1/payments', json({ customerId: f.customer.id, currency: 'ILS', amount, receivedOn, method: 'BANK', reference: 'TR-1', allocations, previewToken: p.previewToken }, { ...f.auth, ...idem() })));
}

const statement = async (h: H, f: F, query = 'currency=ILS') => {
  const res = await h.app.request(`/v1/customers/${f.customer.id}/statement?${query}`, { headers: f.auth });
  return { status: res.status, body: await read(res) };
};

/** A customer with two projects, a credit, a split payment, an unallocated payment and a reversed payment. */
async function ledger(h: H) {
  const f = await firm(h);
  const [a1, a2] = await agreement(h, f, f.p1.id, ['1000.00', '500.00']); // gross 1180 + 590
  const [b1] = await agreement(h, f, f.p2.id, ['200.00'], '2026-04-01'); // gross 236
  await h.app.request(`/v1/receivables/${a2}/credits`, json({ amount: '90.00', reason: 'Goodwill', effectiveDate: '2026-05-01' }, { ...f.auth, ...idem() }));
  const split = await pay(h, f, '1300.00', '2026-05-10', [{ receivableId: a1!, amount: '1100.00' }, { receivableId: b1!, amount: '200.00' }]);
  await pay(h, f, '50.00', '2026-06-01');
  const bounced = await pay(h, f, '80.00', '2026-06-15', [{ receivableId: a1!, amount: '80.00' }]);
  await h.app.request(`/v1/payments/${bounced.id}/reverse`, json({ reason: 'Cheque bounced' }, { ...f.auth, ...idem() }));
  return { f, a1: a1!, a2: a2!, b1: b1!, split, bounced };
}

function expectRunning(body: Loose): void {
  let running = minor(body.openingBalance);
  for (const line of body.lines) {
    running += minor(line.debit) - minor(line.credit);
    expect(minor(line.runningBalance)).toBe(running);
  }
}

describe('GET /v1/customers/{id}/statement (MUT-478)', () => {
  it('AC1: with no project and no period, closingBalance = the summary\'s outstanding − unallocated', async () => {
    const h = harness();
    const { f } = await ledger(h);
    const { status, body } = await statement(h, f);
    expect(status).toBe(200);
    const summary = await read(await h.app.request(`/v1/summaries/customers/${f.customer.id}`, { headers: f.auth }));
    const ils = summary.currencies.find((c: Loose) => c.currency === 'ILS');
    expect(minor(body.closingBalance)).toBe(minor(ils.outstanding) - minor(ils.unallocated));
    expect(body.lines.map((l: Loose) => l.kind)).toEqual(['CHARGE', 'CHARGE', 'CHARGE', 'CREDIT', 'PAYMENT', 'PAYMENT', 'PAYMENT', 'PAYMENT_REVERSAL']);
    expect(body).toMatchObject({ customerId: f.customer.id, currency: 'ILS', projectId: null, from: null, to: null, asOf: '2026-10-27', openingBalance: '0.00', nextCursor: null });
  });

  it('AC2: for any period, opening + debits − credits = closing, and each running balance follows from the one before', async () => {
    const h = harness();
    const { f } = await ledger(h);
    for (const query of ['currency=ILS', 'currency=ILS&from=2026-05-01', 'currency=ILS&from=2026-04-01&to=2026-06-01', 'currency=ILS&to=2026-03-31']) {
      const { body } = await statement(h, f, query);
      expect(minor(body.openingBalance) + minor(body.totals.debit) - minor(body.totals.credit)).toBe(minor(body.closingBalance));
      expectRunning(body);
    }
    const { body } = await statement(h, f, 'currency=ILS&from=2026-05-01');
    expect(body.openingBalance).toBe('2006.00');
    expect(body.lines[0].kind).toBe('CREDIT');
  });

  it('AC3: a correction (full credit, then the reposted charge) moves the balance by exactly the difference', async () => {
    const h = harness();
    const f = await firm(h);
    const [old] = await agreement(h, f, f.p1.id, ['1000.00']); // gross 1180
    const before = (await statement(h, f)).body;
    await h.app.request(`/v1/receivables/${old}/credits`, json({ amount: '1180.00', reason: 'Corrected: VAT inclusive' }, { ...f.auth, ...idem() }));
    await agreement(h, f, f.p1.id, ['847.46'], '2026-03-01'); // gross 1000.00 at 18%
    const after = (await statement(h, f)).body;
    expect(minor(after.closingBalance) - minor(before.closingBalance)).toBe(minor('1000.00') - minor('1180.00'));
    const credit = after.lines.find((l: Loose) => l.kind === 'CREDIT');
    expect(credit).toMatchObject({ receivableId: old, credit: '1180.00', reason: 'Corrected: VAT inclusive', number: null });
    expect(credit.receivableNumber).toMatch(/^CHG-2026-\d{4}$/);
    expectRunning(after);
  });

  it('AC4: a reversed payment shows its PAYMENT line and its PAYMENT_REVERSAL line, which net to zero', async () => {
    const h = harness();
    const { f, bounced } = await ledger(h);
    const { body } = await statement(h, f);
    const own = body.lines.filter((l: Loose) => l.paymentId === bounced.id);
    expect(own.map((l: Loose) => l.kind)).toEqual(['PAYMENT', 'PAYMENT_REVERSAL']);
    expect(own[0]).toMatchObject({ date: '2026-06-15', credit: '80.00', number: bounced.number, unallocated: '0.00', allocated: null, method: 'BANK', reference: 'TR-1' });
    expect(own[1]).toMatchObject({ date: '2026-10-27', debit: '80.00', number: bounced.number, reason: 'Cheque bounced' });
  });

  it('AC5: a payment split across two projects shows only what was allocated there, and in full on the customer statement', async () => {
    const h = harness();
    const { f, split } = await ledger(h);
    const whole = (await statement(h, f)).body.lines.filter((l: Loose) => l.paymentId === split.id);
    const p1 = (await statement(h, f, `currency=ILS&projectId=${f.p1.id}`)).body;
    const p2 = (await statement(h, f, `currency=ILS&projectId=${f.p2.id}`)).body;
    expect(whole.map((l: Loose) => l.credit)).toEqual(['1300.00']);
    expect(whole[0].projectId).toBeNull();
    expect(p1.lines.filter((l: Loose) => l.paymentId === split.id).map((l: Loose) => [l.credit, l.allocated, l.date])).toEqual([['1100.00', '1100.00', '2026-05-10']]);
    expect(p2.lines.filter((l: Loose) => l.paymentId === split.id).map((l: Loose) => [l.credit, l.allocated])).toEqual([['200.00', '200.00']]);
    // The unallocated 50.00 appears only on the whole-customer statement.
    expect([...p1.lines, ...p2.lines].some((l: Loose) => l.credit === '50.00')).toBe(false);
    // A project's closing balance is what is still outstanding on it.
    const own = (await read(await h.app.request(`/v1/receivables?projectId=${f.p2.id}`, { headers: f.auth }))).items as Loose[];
    expect(minor(p2.closingBalance)).toBe(own.reduce((sum, r) => sum + minor(r.outstanding), 0n));
    expectRunning(p1);
  });

  it('AC6: 422 without a currency, 404 for an unknown or another firm\'s customer, 422 for another customer\'s project or a reversed period', async () => {
    const h = harness();
    const f = await firm(h);
    const other = await firm(h);
    expect((await statement(h, f, '')).status).toBe(422);
    expect((await h.app.request(`/v1/customers/${other.customer.id}/statement?currency=ILS`, { headers: f.auth })).status).toBe(404);
    expect((await h.app.request('/v1/customers/00000000-0000-4000-8000-000000000000/statement?currency=ILS', { headers: f.auth })).status).toBe(404);
    const foreign = await statement(h, f, `currency=ILS&projectId=${other.p1.id}`);
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.details.reason).toBe('PROJECT_NOT_FOUND');
    const reversed = await statement(h, f, 'currency=ILS&from=2026-06-01&to=2026-05-01');
    expect(reversed.status).toBe(422);
    expect((await statement(h, f, 'currency=ILS&cursor=nope')).status).toBe(422);
  });

  it('AC7: every receivable has a unique CHG number, on the statement and on GET /v1/receivables', async () => {
    const h = harness();
    const { f } = await ledger(h);
    const receivables = (await read(await h.app.request(`/v1/receivables?customerId=${f.customer.id}`, { headers: f.auth }))).items as Loose[];
    const numbers = receivables.map((r) => r.number);
    expect(numbers.every((n) => /^CHG-2026-\d{4}$/.test(n))).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
    const charges = (await statement(h, f)).body.lines.filter((l: Loose) => l.kind === 'CHARGE');
    expect(charges.map((l: Loose) => l.number).sort()).toEqual([...numbers].sort());
  });

  it('charge lines carry their origin, VAT split, status and days overdue against asOf', async () => {
    const h = harness();
    const { f, a1, a2 } = await ledger(h);
    const { body } = await statement(h, f);
    const first = body.lines.find((l: Loose) => l.receivableId === a1 && l.kind === 'CHARGE');
    expect(first).toMatchObject({ origin: { type: 'INSTALLMENT', position: 1, of: 2 }, net: '1000.00', vat: '180.00', gross: '1180.00', debit: '1180.00', outstanding: '80.00', status: 'OVERDUE', dueDate: '2026-03-31' });
    expect(first.daysOverdue).toBe(210);
    expect(body.lines.find((l: Loose) => l.receivableId === a2 && l.kind === 'CHARGE').origin).toMatchObject({ type: 'INSTALLMENT', position: 2, of: 2 });
  });

  it('AC8: 1,000 lines page correctly, and the order is the same on every call', async () => {
    const h = harness();
    const f = await firm(h);
    for (let i = 0; i < 1_000; i++) await pay(h, f, `${1 + (i % 7)}.00`, `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
    const walk = async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const { body } = await statement(h, f, `currency=ILS&limit=300${cursor ? `&cursor=${cursor}` : ''}`);
        expect(body.closingBalance).toBe('-3997.00');
        for (const l of body.lines) seen.push(`${l.id}:${l.runningBalance}`);
        cursor = body.nextCursor;
        pages++;
      } while (cursor);
      return { seen, pages };
    };
    const first = await walk();
    expect(first.pages).toBe(4);
    expect(first.seen).toHaveLength(1_000);
    expect((await walk()).seen).toEqual(first.seen);
    expect((await statement(h, f, 'currency=ILS&limit=501')).status).toBe(422);
  });

  it('AC9: the contract version is bumped for Malafat to re-vendor', () => {
    expect(API_VERSION).toBe('1.83.0-mut478');
  });
});
