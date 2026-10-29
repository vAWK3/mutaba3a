import { describe, expect, it } from 'vitest';
import { addDays, endOfMonth, todayIn, type IsoDate } from '../../dates.js';
import { CAPTURE_UNDO_REASON, type LedgerCreditRow, type LedgerPaymentRow, type LedgerReceivableRow } from '../../repositories/ports.js';
import { listAll } from '../../routes/summaries.js';
import { bucketize, unallocatedOf } from '../../summaries/compute.js';
import { ledgerEntries, type LedgerEntry } from '../lines.js';
import { summarizePeriod, type PeriodTotals } from '../period.js';
import { driveLedger, rng, type DrivenLedger } from './ledger-driver.js';
import { legacyBuildStatement } from './legacy-build.js';

/**
 * MUT-483 (ADR-227): a period's figures are the statement's lines summed across the organization. One row per event of
 * the plan's §3.3 table, then properties over 500 organizations built from real writes (R2): AC2 against balances
 * computed straight from the lines (R1), AC1 against the frozen statement builder summed over customers plus the
 * clientless payments, continuity, and the anchor to the organization summary.
 */
const CUST = '00000000-0000-4000-8000-000000000002';
const VIEW = { asOf: '2026-10-29', timezone: 'Asia/Jerusalem' };
const OCT = { from: '2026-10-01', to: '2026-10-31' };
const SEP = { from: '2026-09-01', to: '2026-09-30' };
const NOV = { from: '2026-11-01', to: '2026-11-30' };
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (date: IsoDate) => new Date(`${date}T09:00:00Z`);

type Rows = { receivables: LedgerReceivableRow[]; credits: LedgerCreditRow[]; payments: LedgerPaymentRow[] };
const rows = (o: Partial<Rows> = {}): Rows => ({ receivables: [], credits: [], payments: [], ...o });
const charge = (gross: bigint, postingDate: IsoDate, o: Partial<LedgerReceivableRow> = {}): LedgerReceivableRow => ({ id: uuid(), customerId: CUST, currency: 'ILS', origin: 'INSTALLMENT', postingDate, grossMinor: gross, paidMinor: 0n, creditedMinor: 0n, deletedAt: null, createdAt: at(postingDate), ...o });
const credit = (r: LedgerReceivableRow, amount: bigint, effectiveDate: IsoDate): LedgerCreditRow => {
  r.creditedMinor += amount;
  return { id: uuid(), receivableId: r.id, amountMinor: amount, effectiveDate, createdAt: at(effectiveDate) };
};
const pay = (amount: bigint, receivedOn: IsoDate, o: Partial<LedgerPaymentRow> = {}): LedgerPaymentRow => ({ id: uuid(), customerId: CUST, currency: 'ILS', amountMinor: amount, receivedOn, status: 'POSTED', reversalReason: null, reversedAt: null, updatedAt: at(receivedOn), createdAt: at(receivedOn), ...o });
const reverse = (p: LedgerPaymentRow, instant: string, reason = 'Bounced'): LedgerPaymentRow => Object.assign(p, { status: 'REVERSED' as const, reversalReason: reason, reversedAt: new Date(instant), updatedAt: new Date(instant) });

/** The one ILS block for `period`, as the route asks for it with ?currency=ILS. */
const block = (r: Rows, period: { from: IsoDate; to: IsoDate }, view = VIEW) => summarizePeriod(ledgerEntries(r, view), period, 'ILS')[0]!;
const zero = { openingMinor: 0n, billedMinor: 0n, creditedMinor: 0n, paymentsMinor: 0n, reversalsMinor: 0n, closingMinor: 0n };
const figures = (t: PeriodTotals) => ({ opening: t.openingMinor, billed: t.billedMinor, credited: t.creditedMinor, payments: t.paymentsMinor, reversals: t.reversalsMinor, closing: t.closingMinor });
const identityHolds = (t: PeriodTotals) => t.closingMinor - t.openingMinor === t.billedMinor - (t.paymentsMinor - t.reversalsMinor) - t.creditedMinor;

describe('summarizePeriod: the §3.3 events', () => {
  it('an unallocated payment counts in its own period; allocating it later moves nothing', () => {
    const r = charge(10_000n, '2026-09-10');
    const p = pay(4_000n, '2026-10-05');
    const before = block(rows({ receivables: [r], payments: [p] }), OCT);
    expect(figures(before)).toEqual({ opening: 10_000n, billed: 0n, credited: 0n, payments: 4_000n, reversals: 0n, closing: 6_000n });
    // An allocation is not a line: the rows it changes (paid, allocated) are not what a line reads.
    r.paidMinor = 4_000n;
    expect(block(rows({ receivables: [r], payments: [{ ...p }] }), OCT)).toEqual(before);
  });

  it('a reversal nets to zero in one period, and across periods is +P where received and −P where reversed', () => {
    const same = pay(3_000n, '2026-10-05');
    reverse(same, '2026-10-20T10:00:00Z');
    expect(figures(block(rows({ payments: [same] }), OCT))).toMatchObject({ payments: 3_000n, reversals: 3_000n, closing: 0n });

    const across = pay(3_000n, '2026-09-25');
    reverse(across, '2026-10-02T10:00:00Z');
    expect(figures(block(rows({ payments: [across] }), SEP))).toMatchObject({ payments: 3_000n, reversals: 0n, closing: -3_000n });
    expect(figures(block(rows({ payments: [across] }), OCT))).toMatchObject({ opening: -3_000n, payments: 0n, reversals: 3_000n, closing: 0n });
  });

  it('a capture the person undid counts nowhere, retroactively', () => {
    const p = pay(2_000n, '2026-09-10');
    reverse(p, '2026-10-02T10:00:00Z', CAPTURE_UNDO_REASON);
    expect(block(rows({ payments: [p] }), SEP)).toEqual({ currency: 'ILS', ...zero });
    expect(block(rows({ payments: [p] }), OCT)).toEqual({ currency: 'ILS', ...zero });
  });

  it('a redated capture leaves one period and joins another', () => {
    const p = pay(2_000n, '2026-10-10');
    expect(block(rows({ payments: [p] }), OCT).paymentsMinor).toBe(2_000n);
    p.receivedOn = '2026-09-28';
    expect(block(rows({ payments: [p] }), OCT).paymentsMinor).toBe(0n);
    expect(block(rows({ payments: [p] }), SEP).paymentsMinor).toBe(2_000n);
  });

  it('a MUT-443 correction: the original in its period, its reversal on the correction day, the replacement on its own date', () => {
    const original = pay(5_000n, '2026-09-20');
    reverse(original, '2026-10-12T08:00:00Z', 'Corrected');
    const replacement = pay(6_000n, '2026-09-22');
    const r = rows({ payments: [original, replacement] });
    // The replacement is dated in September, so that closed month changes.
    expect(figures(block(r, SEP))).toMatchObject({ payments: 11_000n, reversals: 0n, closing: -11_000n });
    expect(figures(block(r, OCT))).toMatchObject({ opening: -11_000n, payments: 0n, reversals: 5_000n, closing: -6_000n });
  });

  it('a MUT-444 correction bills the replaced charge, credits its remainder and bills the repost, all on the posting date', () => {
    const old = charge(10_000n, '2026-09-05');
    const prior = credit(old, 1_000n, '2026-09-15');
    const correction = credit(old, 9_000n, '2026-09-05');
    const repost = charge(11_800n, '2026-09-05', { createdAt: new Date('2026-10-20T08:00:00.001Z') });
    const t = block(rows({ receivables: [old, repost], credits: [prior, correction] }), SEP);
    expect(figures(t)).toEqual({ opening: 0n, billed: 21_800n, credited: 10_000n, payments: 0n, reversals: 0n, closing: 11_800n });
    expect(block(rows({ receivables: [old, repost], credits: [prior, correction] }), OCT)).toMatchObject({ openingMinor: 11_800n, billedMinor: 0n });
  });

  it('a MUT-100 outcome correction credits the old commission today and bills the new one on the outcome date', () => {
    const old = charge(20_000n, '2026-09-12', { origin: 'INSTALLMENT' });
    const voided = credit(old, 20_000n, '2026-10-20');
    const replacement = charge(24_000n, '2026-09-12');
    const r = rows({ receivables: [old, replacement], credits: [voided] });
    expect(figures(block(r, SEP))).toMatchObject({ billed: 44_000n, credited: 0n, closing: 44_000n });
    expect(figures(block(r, OCT))).toMatchObject({ opening: 44_000n, credited: 20_000n, billed: 0n, closing: 24_000n });
  });

  it('a MUT-480 reduction and a key credit count by effectiveDate, a past one in its past period; billed is untouched', () => {
    const r = charge(10_000n, '2026-08-01');
    const reduced = credit(r, 2_000n, '2026-10-20');
    const backdated = credit(r, 500n, '2026-09-03');
    const all = rows({ receivables: [r], credits: [reduced, backdated] });
    expect(figures(block(all, OCT))).toMatchObject({ billed: 0n, credited: 2_000n });
    expect(figures(block(all, SEP))).toMatchObject({ billed: 0n, credited: 500n, opening: 10_000n, closing: 9_500n });
  });

  it('a credit dated before its charge counts where dated; the identity still holds', () => {
    const r = charge(10_000n, '2026-10-10');
    const early = credit(r, 1_000n, '2026-09-20');
    const all = rows({ receivables: [r], credits: [early] });
    expect(figures(block(all, SEP))).toMatchObject({ credited: 1_000n, closing: -1_000n });
    expect(identityHolds(block(all, SEP)) && identityHolds(block(all, OCT))).toBe(true);
  });

  it('an Owed counts from its day; a redate moves it; an undo removes it', () => {
    const owed = charge(3_000n, '2026-10-10', { origin: 'ADJUSTMENT' });
    expect(block(rows({ receivables: [owed] }), OCT).billedMinor).toBe(3_000n);
    owed.postingDate = '2026-09-28';
    expect(block(rows({ receivables: [owed] }), OCT).billedMinor).toBe(0n);
    expect(block(rows({ receivables: [owed] }), SEP).billedMinor).toBe(3_000n);
    owed.deletedAt = new Date('2026-10-29T08:00:00Z');
    expect(block(rows({ receivables: [owed] }), SEP)).toEqual({ currency: 'ILS', ...zero });
  });

  it('a dated-ahead Owed with nothing on it is no line until its day; a future period\'s billed grows as days pass', () => {
    const ahead = charge(3_000n, '2026-11-15', { origin: 'ADJUSTMENT' });
    expect(block(rows({ receivables: [ahead] }), NOV).billedMinor).toBe(0n);
    expect(block(rows({ receivables: [ahead] }), NOV, { ...VIEW, asOf: '2026-11-15' }).billedMinor).toBe(3_000n);
  });

  it('a dated-ahead Owed paid early: received where paid, billed on its own day; the balance dips', () => {
    const ahead = charge(3_000n, '2026-11-15', { origin: 'ADJUSTMENT', paidMinor: 3_000n });
    const p = pay(3_000n, '2026-10-20');
    const r = rows({ receivables: [ahead], payments: [p] });
    expect(figures(block(r, OCT))).toMatchObject({ billed: 0n, payments: 3_000n, closing: -3_000n });
    expect(figures(block(r, NOV))).toMatchObject({ opening: -3_000n, billed: 3_000n, closing: 0n });
  });

  it('an IMMEDIATE line dated ahead counts at once, in its future period\'s billed; in closing only once to reaches its date', () => {
    const ahead = charge(5_000n, '2026-11-03');
    expect(block(rows({ receivables: [ahead] }), OCT).closingMinor).toBe(0n);
    expect(block(rows({ receivables: [ahead] }), NOV)).toMatchObject({ billedMinor: 5_000n, closingMinor: 5_000n });
  });

  it('DATE installments and retainer charges are lines on their own dates, wherever the read falls', () => {
    const dated = charge(4_000n, '2026-09-30');
    const retainer = charge(2_000n, '2026-10-01', { origin: 'RETAINER_CHARGE' });
    const r = rows({ receivables: [dated, retainer] });
    expect(block(r, SEP).billedMinor).toBe(4_000n);
    expect(block(r, OCT).billedMinor).toBe(2_000n);
  });

  it('a timezone change re-dates a reversal near midnight, so it can move periods', () => {
    const p = pay(1_000n, '2026-10-15');
    reverse(p, '2026-10-31T22:30:00Z');
    expect(block(rows({ payments: [p] }), OCT, { ...VIEW, timezone: 'UTC' }).reversalsMinor).toBe(1_000n);
    expect(block(rows({ payments: [p] }), OCT, { ...VIEW, timezone: 'Asia/Jerusalem' }).reversalsMinor).toBe(0n);
    expect(block(rows({ payments: [p] }), NOV, { ...VIEW, timezone: 'Asia/Jerusalem' }).reversalsMinor).toBe(1_000n);
  });

  it('a payment with no client counts (D4)', () => {
    expect(block(rows({ payments: [pay(700n, '2026-10-08', { customerId: null })] }), OCT).paymentsMinor).toBe(700n);
  });
});

describe('summarizePeriod: currency blocks (S4)', () => {
  it('each currency is its own block, never summed (ADR-004), sorted by code', () => {
    const r = rows({ receivables: [charge(1_000n, '2026-10-02'), charge(2_000n, '2026-10-03', { currency: 'USD' }), charge(3_000n, '2026-10-04', { currency: 'EUR' })] });
    expect(summarizePeriod(ledgerEntries(r, VIEW), OCT, null).map((t) => [t.currency, t.billedMinor])).toEqual([['EUR', 3_000n], ['ILS', 1_000n], ['USD', 2_000n]]);
  });

  it('with ?currency= one block, all zeros when nothing exists (R12)', () => {
    expect(summarizePeriod([], OCT, 'JOD')).toEqual([{ currency: 'JOD', ...zero }]);
    expect(summarizePeriod(ledgerEntries(rows({ receivables: [charge(1_000n, '2026-10-02')] }), VIEW), OCT, 'USD')).toEqual([{ currency: 'USD', ...zero }]);
  });

  it('without it, a block per currency with a line in the period or a balance at either end; none for one settled long ago', () => {
    const settled = charge(1_000n, '2026-01-10', { currency: 'USD' });
    const paid = pay(1_000n, '2026-02-01', { currency: 'USD' });
    const owing = charge(2_000n, '2026-05-01', { currency: 'EUR' });
    const netZero = pay(500n, '2026-10-10', { currency: 'JOD' });
    reverse(netZero, '2026-10-11T08:00:00Z');
    const later = charge(9_000n, '2026-12-01', { currency: 'GBP' });
    const t = summarizePeriod(ledgerEntries(rows({ receivables: [settled, owing, later], payments: [paid, netZero] }), VIEW), OCT, null);
    expect(t.map((x) => [x.currency, x.openingMinor, x.closingMinor])).toEqual([['EUR', 2_000n, 2_000n], ['JOD', 0n, 0n]]);
  });
});

// ---- Properties over driven organizations (R1, R2) -------------------------------------------------------------

const SEEDS = 500;

/** A random period in or around the data: a whole month, part of one, or several, within the 13-month cap. */
function randomPeriod(r: () => number, asOf: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = addDays(asOf, Math.floor(r() * 330) - 300);
  const span = r() < 0.4 ? Number(endOfMonth(from).slice(8)) - Number(from.slice(8)) : Math.floor(r() * 200);
  return { from, to: addDays(from, span) };
}

/** The legacy statement's lines in [from, to] for every customer, split by kind, plus its opening and closing. */
async function fromStatements(d: DrivenLedger, currency: string, period: { from: IsoDate; to: IsoDate }) {
  const t = { openingMinor: 0n, billedMinor: 0n, creditedMinor: 0n, paymentsMinor: 0n, reversalsMinor: 0n, closingMinor: 0n };
  for (const customerId of d.customers) {
    const sources = await d.store.receivables.statementSources(d.organization.id, customerId, currency);
    const page = legacyBuildStatement(sources, { asOf: d.asOf, timezone: d.organization.timezone, from: period.from, to: period.to, projectId: null }, { limit: 1_000_000, cursor: null });
    t.openingMinor += page.openingMinor;
    t.closingMinor += page.closingMinor;
    for (const l of page.lines) {
      if (l.kind === 'CHARGE') t.billedMinor += l.debitMinor;
      if (l.kind === 'CREDIT') t.creditedMinor += l.creditMinor;
      if (l.kind === 'PAYMENT') t.paymentsMinor += l.creditMinor;
      if (l.kind === 'PAYMENT_REVERSAL') t.reversalsMinor += l.debitMinor;
    }
  }
  // D4: payments with no client are on no statement; their lines, dated by the statement's own rules, written out here.
  const payments = await listAll((cursor) => d.store.payments.list(d.organization.id, {}, { limit: 200, cursor }));
  for (const p of payments.filter((x) => x.customerId === null && x.currency === currency)) {
    if (p.status === 'REVERSED' && p.reversalReason === CAPTURE_UNDO_REASON) continue;
    const reversedOn = p.status === 'REVERSED' ? todayIn(d.organization.timezone, p.reversedAt ?? p.updatedAt) : null;
    if (p.receivedOn < period.from) t.openingMinor -= p.amountMinor;
    else if (p.receivedOn <= period.to) t.paymentsMinor += p.amountMinor;
    if (reversedOn !== null && reversedOn < period.from) t.openingMinor += p.amountMinor;
    else if (reversedOn !== null && reversedOn <= period.to) t.reversalsMinor += p.amountMinor;
    t.closingMinor += (p.receivedOn <= period.to ? -p.amountMinor : 0n) + (reversedOn !== null && reversedOn <= period.to ? p.amountMinor : 0n);
  }
  return { currency, ...t };
}

/** Σ (debit − credit) over the lines dated on or before `day`, straight from the lines (never opening + flows). */
const balanceOn = (entries: readonly LedgerEntry[], currency: string, day: IsoDate) => entries.filter((e) => e.currency === currency && e.date <= day).reduce((s, e) => s + e.debitMinor - e.creditMinor, 0n);

describe(`summarizePeriod over ${SEEDS} driven organizations`, () => {
  it('AC1, AC2, continuity and the anchor to the organization summary', async () => {
    let blocks = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const d = await driveLedger(seed);
      const r = rng(seed * 104729 + 3);
      const view = { asOf: d.asOf, timezone: d.organization.timezone };
      const entries = ledgerEntries(await d.store.receivables.periodSources(d.organization.id, null), view);
      const period = randomPeriod(r, d.asOf);
      const all = summarizePeriod(entries, period, null);
      for (const currency of d.currencies) {
        const label = `seed ${seed} ${currency} ${period.from}..${period.to}`;
        const [t] = summarizePeriod(entries, period, currency);
        blocks++;

        // AC2, computed independently: opening and closing straight from the lines, then the identity.
        expect(t!.openingMinor, label).toBe(balanceOn(entries, currency, addDays(period.from, -1)));
        expect(t!.closingMinor, label).toBe(balanceOn(entries, currency, period.to));
        expect(identityHolds(t!), label).toBe(true);

        // AC1: the frozen statement builder, summed over customers, plus the clientless payment lines.
        expect(t, label).toEqual(await fromStatements(d, currency, period));

        // The unfiltered call carries the same block, or none when there is nothing to show.
        const unfiltered = all.find((x) => x.currency === currency);
        if (unfiltered) expect(unfiltered, label).toEqual(t);
        else expect([t!.openingMinor, t!.closingMinor, t!.billedMinor, t!.creditedMinor, t!.paymentsMinor, t!.reversalsMinor], label).toEqual([0n, 0n, 0n, 0n, 0n, 0n]);

        // Continuity: the day before's closing is this opening, and two adjacent ranges add up to their union.
        const split = addDays(period.from, Math.floor(r() * 40));
        const [before] = summarizePeriod(entries, { from: addDays(period.from, -45), to: addDays(period.from, -1) }, currency);
        expect(before!.closingMinor, label).toBe(t!.openingMinor);
        const [first] = summarizePeriod(entries, { from: period.from, to: split }, currency);
        const [second] = summarizePeriod(entries, { from: addDays(split, 1), to: addDays(split, 30) }, currency);
        const [union] = summarizePeriod(entries, { from: period.from, to: addDays(split, 30) }, currency);
        expect(union, label).toEqual({ currency, openingMinor: first!.openingMinor, billedMinor: first!.billedMinor + second!.billedMinor, creditedMinor: first!.creditedMinor + second!.creditedMinor, paymentsMinor: first!.paymentsMinor + second!.paymentsMinor, reversalsMinor: first!.reversalsMinor + second!.reversalsMinor, closingMinor: second!.closingMinor });

        // The anchor: with `to` on or after the last line, closing = the organization summary's outstanding − unallocated.
        const last = entries.reduce((m, e) => (e.date > m ? e.date : m), d.asOf);
        const [whole] = summarizePeriod(entries, { from: '2000-01-01', to: last }, currency);
        const open = await listAll((cursor) => d.store.receivables.list(d.organization.id, { status: 'OPEN', currency }, { limit: 200, cursor }));
        const posted = (await listAll((cursor) => d.store.payments.list(d.organization.id, { status: 'POSTED' }, { limit: 200, cursor }))).filter((p) => p.currency === currency);
        expect(whole!.closingMinor, label).toBe(bucketize(open, d.asOf).outstanding - unallocatedOf(posted).amount);
      }
    }
    expect(blocks).toBeGreaterThan(SEEDS);
  }, 300_000);
});
