import pino from 'pino';
import { createApp } from '../../app.js';
import { SCOPES } from '../../auth/scopes.js';
import { addDays, todayIn, type IsoDate } from '../../dates.js';
import { dueDateAfterRedate } from '../../income/compose.js';
import { formatMoney, type Currency } from '../../money.js';
import { SlidingWindowRateLimiter } from '../../rate-limit.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { AgreementRecord, Organization, PaymentRecord, ReceivableRecord } from '../../repositories/ports.js';
import { listAll } from '../../routes/summaries.js';

/**
 * MUT-483 (eng review R2): random organizations built from real writes, never a free row generator, so a property test
 * only ever sees ledgers the system can produce. A seeded (mulberry32) driver over `MemoryLedgerStore`:
 *
 * - Malafat's writes go through the real HTTP routes with an integration key (agreements fixed with DATE, IMMEDIATE and
 *   MANUAL lines, retainers, contingency with an outcome and an outcome correction, payments with explicit allocations
 *   or a strategy, allocating later, reversals, credits with any effectiveDate, MUT-480 reduce, MUT-443 and MUT-444
 *   corrections, billing a MANUAL line).
 * - A person's writes (Owed, dated ahead too; captures with and without a client; undoing a capture; redating an Owed
 *   or a capture; voiding an Owed) are session-only routes, and an API key and a session never write the same profile
 *   (an owned profile refuses keys). So they call the very store methods those routes call, with the routes' own
 *   guards (build note B1 in the plan).
 *
 * The clock moves between writes, sometimes to just before or after local midnight, so reversal instants land on
 * either side of a day boundary. The last step is a read that posts every due item, as every route does first.
 */

const ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters';
const admin = { 'x-admin-token': ADMIN_TOKEN };
const PERSON = '00000000-0000-4000-8000-0000000000ee';
const CURRENCIES: readonly Currency[] = ['ILS', 'USD', 'JOD'];
const TIMEZONE = 'Asia/Jerusalem';

/** A seeded PRNG (mulberry32), so a failing case is reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DrivenLedger {
  seed: number;
  store: MemoryLedgerStore;
  organization: Organization;
  asOf: IsoDate;
  customers: string[];
  /** customerId → currency → projectId */
  projects: Map<string, Map<Currency, string>>;
  currencies: Currency[];
  /** How many writes of each kind succeeded. */
  ops: Partial<Record<DriverOp, number>>;
}

/** Writes that make money first, then the ones that move it, so most runs exercise most kinds. */
const DRIVER_WEIGHTS = [
  ['fixed', 5], ['retainer', 1], ['contingency', 1], ['outcome', 3], ['outcomeCorrect', 2], ['manual', 2], ['owed', 3],
  ['pay', 6], ['allocateLater', 2], ['reverse', 2], ['capture', 2], ['undoCapture', 1], ['credit', 3], ['reduce', 1],
  ['correctPayment', 2], ['correctTerms', 2], ['redateOwed', 1], ['redateCapture', 1], ['voidOwed', 1],
] as const satisfies ReadonlyArray<readonly [string, number]>;

export type DriverOp = (typeof DRIVER_WEIGHTS)[number][0];
/** Every kind of write the driver makes; a property test asserts each one happened somewhere across its seeds. */
export const DRIVER_OPS: readonly DriverOp[] = DRIVER_WEIGHTS.map(([name]) => name);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
type Op = () => Promise<boolean>;

export async function driveLedger(seed: number, steps = 24): Promise<DrivenLedger> {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const chance = (p: number) => r() < p;

  const store = new MemoryLedgerStore();
  const clock = { now: new Date(Date.UTC(2026, 0, 1, 8, 0, 0) + int(0, 200) * 86_400_000) };
  const app = createApp({ store, logger: pino({ level: 'silent' }), rateLimiter: new SlidingWindowRateLimiter(1_000_000), adminToken: ADMIN_TOKEN, keyEnvironment: 'test', version: '0.0.0-driver', now: () => clock.now, attachments: null, attachmentUrlTtlSeconds: 600 });
  let seq = 0;
  const json = (body: unknown, headers: Record<string, string> = {}, method = 'POST') => ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const idem = () => ({ 'idempotency-key': `driver-${seed}-${String(++seq).padStart(6, '0')}` });

  /** A 5xx is a bug the driver must surface; a 4xx is a refused random choice, which simply doesn't happen. */
  async function call(path: string, init: RequestInit): Promise<{ ok: boolean; body: Loose }> {
    const res = await app.request(path, init);
    const body = res.status === 204 ? null : await res.json();
    if (res.status >= 500) throw new Error(`driver seed ${seed}: ${init.method ?? 'GET'} ${path} answered ${res.status} ${JSON.stringify(body)}`);
    return { ok: res.status < 300, body };
  }
  /** Setup must succeed; a refusal there is the driver's bug. */
  async function must(path: string, init: RequestInit): Promise<Loose> {
    const { ok, body } = await call(path, init);
    if (!ok) throw new Error(`driver seed ${seed}: ${path} refused ${JSON.stringify(body)}`);
    return body;
  }

  const org = await must('/admin/v1/organizations', json({ name: `Driven ${seed}`, defaultCurrency: 'ILS', timezone: TIMEZONE }, admin));
  const key = await must(`/admin/v1/organizations/${org.id}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, admin));
  const auth = { authorization: `Bearer ${key.secret as string}` };
  await must('/v1/settings/vat', json({ rateBasisPoints: 1800, effectiveFrom: '2024-01-01' }, auth, 'PUT'));

  const currencies = [...CURRENCIES].sort(() => r() - 0.5).slice(0, int(1, 3));
  const customers: string[] = [];
  const projects = new Map<string, Map<Currency, string>>();
  for (let i = 0, n = int(1, 6); i < n; i++) {
    const c = await must('/v1/customers', json({ name: `Client ${i}` }, { ...auth, ...idem() }));
    customers.push(c.id);
    const own = new Map<Currency, string>();
    for (const currency of currencies) own.set(currency, (await must('/v1/projects', json({ customerId: c.id, name: `Matter ${i} ${currency}`, currency }, { ...auth, ...idem() }))).id);
    projects.set(c.id, own);
  }

  const today = () => todayIn(TIMEZONE, clock.now);
  const money = (minor: bigint, currency: string) => formatMoney({ minor, currency: currency as Currency });
  const amountIn = (currency: string) => BigInt(int(10, 5_000)) * (currency === 'JOD' ? 1_000n : 100n) + BigInt(int(0, 99));
  const receivables = async () => listAll<ReceivableRecord>((cursor) => store.receivables.list(org.id, {}, { limit: 200, cursor }));
  const payments = async () => listAll<PaymentRecord>((cursor) => store.payments.list(org.id, {}, { limit: 200, cursor }));
  const agreements = async () => listAll<AgreementRecord>((cursor) => store.agreements.list(org.id, {}, { limit: 200, cursor }));
  const outstanding = (x: ReceivableRecord) => x.grossMinor - x.paidMinor - x.creditedMinor;
  const someProject = () => {
    const customerId = pick(customers);
    const currency = pick(currencies);
    return { customerId, currency, projectId: projects.get(customerId)!.get(currency)! };
  };

  function advanceClock(): void {
    const hours = chance(0.5) ? int(1, 30) : int(24, 24 * 20);
    const next = new Date(clock.now.getTime() + hours * 3_600_000);
    // A quarter of the time, land within an hour or so of local midnight (UTC+2 or +3).
    if (chance(0.25)) next.setUTCHours(int(20, 22), int(0, 59), int(0, 59), 0);
    clock.now = next > clock.now ? next : new Date(clock.now.getTime() + 60_000);
  }

  async function createAgreement(body: Record<string, unknown>): Promise<boolean> {
    const preview = await call('/v1/agreements/preview', json(body, auth));
    if (!preview.ok) return false;
    return (await call('/v1/agreements', json({ ...body, previewToken: preview.body.previewToken }, { ...auth, ...idem() }))).ok;
  }

  async function previewThenCommit(previewPath: string, commitPath: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<boolean> {
    const preview = await call(previewPath, json(body, auth));
    if (!preview.ok) return false;
    return (await call(commitPath, json({ ...body, ...extra, previewToken: preview.body.previewToken }, { ...auth, ...idem() }))).ok;
  }

  const line = (currency: string, agreementDate: IsoDate) => {
    const kind = pick(['IMMEDIATE', 'DATE', 'DATE', 'MANUAL'] as const);
    const trigger = kind === 'DATE' ? { type: 'DATE', date: addDays(agreementDate, int(-5, 60)) } : { type: kind };
    return { label: `L-${++seq}`, amount: money(amountIn(currency), currency), trigger };
  };
  const sum = (lines: Array<{ amount: string }>, currency: string) => money(lines.reduce((s, l) => s + BigInt(l.amount.replace('.', '')), 0n), currency);

  const ops: Record<DriverOp, Op> = {
    fixed: async () => {
      const { currency, projectId } = someProject();
      const agreementDate = addDays(today(), int(-90, 20));
      const installments = Array.from({ length: int(1, 3) }, () => line(currency, agreementDate));
      return createAgreement({ projectId, amount: sum(installments, currency), pricingBasis: pick(['VAT_EXCLUSIVE', 'VAT_INCLUSIVE']), agreementDate, paymentTerms: pick(['EOM', 'IMMEDIATE', 'EOM_30']), installments });
    },
    retainer: async () => {
      const { currency, projectId } = someProject();
      return previewThenCommit('/v1/retainers/preview', '/v1/retainers', { projectId, monthlyAmount: money(amountIn(currency), currency), pricingBasis: 'VAT_EXCLUSIVE', startMonth: addDays(today(), int(-70, 20)).slice(0, 7), billingDay: int(1, 28), paymentTerms: 'EOM' });
    },
    contingency: async () => {
      const { currency, projectId } = someProject();
      const upfront = money(amountIn(currency), currency);
      return createAgreement({ projectId, amount: upfront, pricingBasis: 'VAT_EXCLUSIVE', agreementDate: addDays(today(), int(-60, 0)), paymentTerms: 'EOM', installments: [{ label: 'Upfront', amount: upfront, trigger: { type: 'IMMEDIATE' } }], contingency: { commissionRateBasisPoints: pick([1000, 2000, 2500]), upfrontTreatment: pick(['SEPARATE', 'CREDITED']) } });
    },
    outcome: async () => {
      const awaiting = (await agreements()).filter((a) => a.type === 'CONTINGENCY' && a.status === 'ACTIVE' && a.outcome === null);
      if (awaiting.length === 0) return false;
      const a = pick(awaiting);
      const outcomeDate = addDays(today(), -int(0, 20)) < a.agreementDate ? a.agreementDate : addDays(today(), -int(0, 20));
      return previewThenCommit(`/v1/agreements/${a.id}/outcome/preview`, `/v1/agreements/${a.id}/outcome`, { outcome: 'AWARDED', awardedAmount: money(amountIn(a.currency) * 10n, a.currency), outcomeDate, commissionLabel: 'Commission' });
    },
    outcomeCorrect: async () => {
      const decided = (await agreements()).filter((a) => a.type === 'CONTINGENCY' && a.outcome === 'AWARDED');
      if (decided.length === 0) return false;
      const a = pick(decided);
      return previewThenCommit(`/v1/agreements/${a.id}/outcome/preview`, `/v1/agreements/${a.id}/outcome/correct`, { outcome: 'AWARDED', awardedAmount: money(amountIn(a.currency) * 10n, a.currency), outcomeDate: a.outcomeDate ?? a.agreementDate, commissionLabel: 'Commission', correctionReason: 'Award amended on appeal' });
    },
    manual: async () => {
      const fixed = (await agreements()).filter((a) => a.status === 'ACTIVE' && a.type !== 'RECURRING');
      for (const a of fixed.sort(() => r() - 0.5)) {
        const pending = (await store.agreements.listInstallments(org.id, a.id)).filter((i) => i.triggerType === 'MANUAL' && i.receivableId === null && i.voidedAt === null);
        if (pending.length > 0) return (await call(`/v1/installments/${pick(pending).id}/trigger`, json({}, { ...auth, ...idem() }))).ok;
      }
      return false;
    },
    owed: async () => {
      const { customerId, currency, projectId } = someProject();
      const postingDate = addDays(today(), int(-40, 30));
      await store.receivables.createAdjustment({ organizationId: org.id, customerId, projectId: chance(0.5) ? projectId : null, currency, netMinor: 0n, vatMinor: 0n, grossMinor: amountIn(currency), vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Work', dueDate: addDays(postingDate, int(0, 30)), postingDate, postedAt: clock.now, createdByUserId: PERSON, requestId: null }, clock.now);
      return true;
    },
    pay: async () => {
      const { customerId, currency } = someProject();
      const open = (await receivables()).filter((x) => x.customerId === customerId && x.currency === currency && x.status === 'OPEN' && x.projectId !== null && outstanding(x) > 0n);
      const chosen = open.sort(() => r() - 0.5).slice(0, int(0, 2));
      const allocations = chosen.map((x) => ({ receivableId: x.id, amount: money(BigInt(int(1, Number(outstanding(x)))), currency) }));
      const allocated = allocations.reduce((s, a) => s + BigInt(a.amount.replace('.', '')), 0n);
      const amount = money(allocated + (chance(0.5) ? amountIn(currency) : chosen.length === 0 ? amountIn(currency) : 0n), currency);
      const strategy = chance(0.3) ? 'OLDEST_FIRST' : undefined;
      const preview = await call('/v1/allocations/preview', json({ customerId, currency, amount, ...(strategy ? { strategy } : { allocations }) }, auth));
      if (!preview.ok) return false;
      const planned = preview.body.allocations as Array<{ receivableId: string; amount: string }>;
      return (await call('/v1/payments', json({ customerId, currency, amount, receivedOn: addDays(today(), -int(0, 30)), method: 'BANK', allocations: planned, previewToken: preview.body.previewToken }, { ...auth, ...idem() }))).ok;
    },
    allocateLater: async () => {
      const open = (await payments()).filter((p) => p.status === 'POSTED' && p.customerId !== null && p.amountMinor > p.allocatedMinor);
      if (open.length === 0) return false;
      const p = pick(open);
      const preview = await call('/v1/allocations/preview', json({ paymentId: p.id, strategy: pick(['OLDEST_FIRST', 'SETTLE_MATTERS']) }, auth));
      if (!preview.ok || preview.body.allocations.length === 0) return false;
      return (await call(`/v1/payments/${p.id}/allocations`, json({ allocations: preview.body.allocations, previewToken: preview.body.previewToken }, { ...auth, ...idem() }))).ok;
    },
    reverse: async () => {
      const posted = (await payments()).filter((p) => p.status === 'POSTED');
      if (posted.length === 0) return false;
      return (await call(`/v1/payments/${pick(posted).id}/reverse`, json({ reason: 'Bounced' }, { ...auth, ...idem() }))).ok;
    },
    capture: async () => {
      const { customerId, currency } = someProject();
      await store.payments.capture({ organizationId: org.id, customerId: chance(0.4) ? null : customerId, projectId: null, currency, amountMinor: amountIn(currency), receivedOn: addDays(today(), -int(0, 20)), method: 'CASH', notes: null, requestId: null, createdByUserId: PERSON, captureSource: null }, clock.now);
      return true;
    },
    undoCapture: async () => {
      const own = (await payments()).filter((p) => p.origin === 'CAPTURE' && p.status === 'POSTED');
      if (own.length === 0) return false;
      return (await store.payments.undoCapture(org.id, pick(own).id, PERSON, clock.now)).result === 'reversed';
    },
    credit: async () => {
      const open = (await receivables()).filter((x) => x.status === 'OPEN' && outstanding(x) > 0n);
      if (open.length === 0) return false;
      const x = pick(open);
      const amount = money(BigInt(int(1, Number(outstanding(x)))), x.currency);
      return (await call(`/v1/receivables/${x.id}/credits`, json({ amount, reason: 'Goodwill', effectiveDate: addDays(today(), int(-60, 10)) }, { ...auth, ...idem() }))).ok;
    },
    reduce: async () => {
      const fixed = (await agreements()).filter((a) => a.type === 'FIXED' && a.status === 'ACTIVE');
      if (fixed.length === 0) return false;
      const a = pick(fixed);
      return previewThenCommit(`/v1/agreements/${a.id}/reduce/preview`, `/v1/agreements/${a.id}/reduce`, { by: money(BigInt(int(1, Number(a.amountMinor))), a.currency), reasonCode: 'DISCOUNT' });
    },
    correctPayment: async () => {
      const posted = (await payments()).filter((p) => p.status === 'POSTED' && p.origin !== 'CAPTURE' && p.customerId !== null);
      if (posted.length === 0) return false;
      const p = pick(posted);
      const where = chance(0.5) ? { strategy: 'OLDEST_FIRST' } : { allocations: [] };
      return previewThenCommit(`/v1/payments/${p.id}/correct/preview`, `/v1/payments/${p.id}/correct`, { amount: money(amountIn(p.currency), p.currency), receivedOn: addDays(p.receivedOn, int(0, 10)), method: 'BANK', ...where }, { reasonCode: 'ENTERED_BY_MISTAKE' });
    },
    correctTerms: async () => {
      const correctable = (await agreements()).filter((a) => (a.type === 'FIXED' || (a.type === 'CONTINGENCY' && a.outcome === null)) && a.status === 'ACTIVE');
      if (correctable.length === 0) return false;
      const a = pick(correctable);
      const live = (await store.agreements.listInstallments(org.id, a.id)).filter((i) => i.voidedAt === null && !i.isCommission).sort((x, y) => x.position - y.position);
      if (live.length === 0) return false;
      const installments = live.map((i) => ({ label: i.label, amount: money(amountIn(a.currency), a.currency), trigger: i.triggerDate ? { type: i.triggerType, date: i.triggerDate } : { type: i.triggerType } }));
      const body = { amount: sum(installments, a.currency), pricingBasis: pick(['VAT_EXCLUSIVE', 'VAT_INCLUSIVE']), installments };
      return previewThenCommit(`/v1/agreements/${a.id}/correct/preview`, `/v1/agreements/${a.id}/correct`, body, { reasonCode: 'ENTERED_BY_MISTAKE' });
    },
    redateOwed: async () => {
      const owed = (await receivables()).filter((x) => x.origin === 'ADJUSTMENT');
      if (owed.length === 0) return false;
      const x = pick(owed);
      const to = addDays(today(), int(-40, 30));
      return (await store.receivables.redateAdjustment(org.id, x.id, PERSON, x.version, to, dueDateAfterRedate(x.dueDate, to))).kind === 'updated';
    },
    redateCapture: async () => {
      const own = (await payments()).filter((p) => p.origin === 'CAPTURE' && p.status === 'POSTED' && p.allocatedMinor === 0n);
      if (own.length === 0) return false;
      const p = pick(own);
      return (await store.payments.redateCapture(org.id, p.id, PERSON, p.version, addDays(today(), -int(0, 40)), clock.now)).kind === 'updated';
    },
    voidOwed: async () => {
      const owed = (await receivables()).filter((x) => x.origin === 'ADJUSTMENT' && x.paidMinor === 0n && x.creditedMinor === 0n);
      if (owed.length === 0) return false;
      const voided = await store.receivables.softDeleteAdjustment(org.id, pick(owed).id, clock.now);
      return voided?.deletedAt != null;
    },
  };

  const total = DRIVER_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  const choose = (): DriverOp => {
    let x = r() * total;
    for (const [name, w] of DRIVER_WEIGHTS) if ((x -= w) < 0) return name;
    return 'pay';
  };

  const done: Partial<Record<DriverOp, number>> = {};
  for (let i = 0; i < steps; i++) {
    advanceClock();
    const name = i < 2 ? 'fixed' : choose();
    if (await ops[name]()) done[name] = (done[name] ?? 0) + 1;
  }
  advanceClock();
  // Every read posts what is due first; this one leaves the store as any read at `asOf` would see it.
  await call('/v1/summaries/organization', { headers: auth });
  const organization = (await store.organizations.getById(org.id))!;
  return { seed, store, organization, asOf: today(), customers, projects, currencies, ops: done };
}
