import { describe, expect, it } from 'vitest';
import { historyStart, summarizeActivity, type ActivityInput } from '../activity.js';

/** MUT-175: the per-profile activity summary behind portal Reports (plan §4.2, D1, D2). */

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

type Pay = ActivityInput['payments'][number];
type Exp = ActivityInput['expenses'][number];
type Rec = ActivityInput['receivables'][number];

const pay = (receivedOn: string, amountMinor: bigint, extra: Partial<Pay> = {}): Pay => ({ id: id(), currency: 'ILS', amountMinor, receivedOn, customerId: 'c1', status: 'POSTED', ...extra });
const exp = (occurredOn: string, amountMinor: bigint, extra: Partial<Exp> = {}): Exp => ({ currency: 'ILS', amountMinor, occurredOn, categoryId: 'food', customerId: null, ...extra });
const rec = (postingDate: string, extra: Partial<Rec> = {}): Rec => ({ id: id(), customerId: 'c1', postingDate, status: 'SETTLED', ...extra });

function input(extra: Partial<ActivityInput>): ActivityInput {
  return { payments: [], expenses: [], allocations: [], receivables: [], from: '2026-10-01', to: '2026-10-31', bucket: 'day', ...extra };
}

describe('historyStart', () => {
  it('is the first day of the month eleven months before the last one', () => {
    expect(historyStart('2026-10-31')).toBe('2025-11-01');
    expect(historyStart('2026-01-07')).toBe('2025-02-01');
  });
});

describe('summarizeActivity — buckets and totals', () => {
  it('zero-fills one day bucket per day, counts POSTED payments by receivedOn and never REVERSED ones', () => {
    const out = summarizeActivity(
      input({
        from: '2026-10-05',
        to: '2026-10-11',
        payments: [pay('2026-10-06', 10000n), pay('2026-10-06', 5000n), pay('2026-10-07', 9900n, { status: 'REVERSED' }), pay('2026-10-12', 100n)],
        expenses: [exp('2026-10-05', 2500n), exp('2026-10-04', 999n)],
      }),
    );
    expect(out.buckets.map((b) => b.start)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(out.buckets[0]!.currencies).toEqual([{ currency: 'ILS', received: '0.00', spent: '25.00' }]);
    expect(out.buckets[1]!.currencies).toEqual([{ currency: 'ILS', received: '150.00', spent: '0.00' }]);
    expect(out.buckets[2]!.currencies).toEqual([{ currency: 'ILS', received: '0.00', spent: '0.00' }]);
    expect(out.currencies).toMatchObject([{ currency: 'ILS', received: '150.00', spent: '25.00' }]);
  });

  it('buckets by month across a year, each bucket starting on the 1st', () => {
    const out = summarizeActivity(input({ from: '2026-01-01', to: '2026-12-31', bucket: 'month', payments: [pay('2026-03-31', 100n), pay('2026-03-01', 200n), pay('2026-12-31', 1n)] }));
    expect(out.buckets).toHaveLength(12);
    expect(out.buckets[2]).toEqual({ start: '2026-03-01', currencies: [{ currency: 'ILS', received: '3.00', spent: '0.00' }] });
    expect(out.buckets[11]!.currencies[0]!.received).toBe('0.01');
  });

  it('keeps currencies apart, sorted, and uses each currency’s exponent (JOD has 3)', () => {
    const out = summarizeActivity(input({ payments: [pay('2026-10-02', 1234567n, { currency: 'JOD' }), pay('2026-10-02', 100n, { currency: 'USD' })] }));
    expect(out.currencies.map((c) => [c.currency, c.received])).toEqual([
      ['JOD', '1234.567'],
      ['USD', '1.00'],
    ]);
    expect(out.buckets[1]!.currencies.map((c) => c.received)).toEqual(['1234.567', '1.00']);
  });

  it('breaks spending down by category (the expense summary’s order) and received by client, largest first and no client last', () => {
    const out = summarizeActivity(
      input({
        payments: [pay('2026-10-02', 100n, { customerId: null }), pay('2026-10-03', 300n, { customerId: 'c2' }), pay('2026-10-04', 200n, { customerId: 'c1' })],
        expenses: [exp('2026-10-02', 500n, { categoryId: 'rent' }), exp('2026-10-03', 100n), exp('2026-10-04', 50n, { categoryId: null })],
      }),
    );
    const block = out.currencies[0]!;
    expect(block.byCategory).toEqual([
      { categoryId: 'rent', total: '5.00', count: 1 },
      { categoryId: 'food', total: '1.00', count: 1 },
      { categoryId: null, total: '0.50', count: 1 },
    ]);
    expect(block.byCustomer).toEqual([
      { customerId: 'c2', total: '3.00', count: 1 },
      { customerId: 'c1', total: '2.00', count: 1 },
      { customerId: null, total: '1.00', count: 1 },
    ]);
  });

  it('answers an empty range with zero-filled buckets and no currencies', () => {
    const out = summarizeActivity(input({ from: '2026-10-01', to: '2026-10-03' }));
    expect(out.buckets).toEqual([
      { start: '2026-10-01', currencies: [] },
      { start: '2026-10-02', currencies: [] },
      { start: '2026-10-03', currencies: [] },
    ]);
    expect(out.currencies).toEqual([]);
    expect(out.dataSince).toBeNull();
  });
});

describe('summarizeActivity — history and data since', () => {
  it('carries 12 months ending with the period’s last month, the current month partial, empty months empty', () => {
    const out = summarizeActivity(
      input({
        from: '2026-10-19',
        to: '2026-10-25',
        payments: [pay('2025-11-01', 100n), pay('2026-08-15', 700n, { customerId: 'c2' }), pay('2026-10-20', 50n)],
        expenses: [exp('2026-09-30', 400n, { categoryId: 'rent' }), exp('2026-10-26', 1n)],
      }),
    );
    expect(out.history.map((h) => h.month)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(out.history[0]!.currencies).toMatchObject([{ currency: 'ILS', received: '1.00', spent: '0.00' }]);
    expect(out.history[1]!.currencies).toEqual([]);
    expect(out.history[9]!.currencies[0]).toMatchObject({ received: '7.00', byCustomer: [{ customerId: 'c2', total: '7.00', count: 1 }] });
    expect(out.history[10]!.currencies[0]).toMatchObject({ spent: '4.00', byCategory: [{ categoryId: 'rent', total: '4.00', count: 1 }] });
    // the whole month, not just the period: the 26th is after the period but inside October
    expect(out.history[11]!.currencies[0]).toMatchObject({ received: '0.50', spent: '0.01' });
  });

  it('dates the data from the earliest POSTED payment or expense it read', () => {
    expect(summarizeActivity(input({ payments: [pay('2026-03-08', 1n), pay('2026-02-01', 1n, { status: 'REVERSED' })], expenses: [exp('2026-03-09', 1n)] })).dataSince).toBe('2026-03-08');
    expect(summarizeActivity(input({ expenses: [exp('2026-01-02', 1n)] })).dataSince).toBe('2026-01-02');
  });
});

describe('summarizeActivity — days to get paid (D2: median over fully settled Owed)', () => {
  function settled(postingDate: string, receivedOn: string, customerId = 'c1') {
    const r = rec(postingDate, { customerId });
    const p = pay(receivedOn, 100n, { customerId });
    return { r, p, a: { paymentId: p.id, receivableId: r.id } };
  }
  function run(items: Array<ReturnType<typeof settled>>, extra: Partial<ActivityInput> = {}) {
    return summarizeActivity(input({ receivables: items.map((i) => i.r), payments: items.map((i) => i.p), allocations: items.map((i) => i.a), ...extra }));
  }

  it('takes the median, so one very late client cannot swing it, with n', () => {
    const out = run([settled('2026-09-01', '2026-09-11'), settled('2026-09-01', '2026-09-13'), settled('2026-09-01', '2026-09-15'), settled('2026-01-01', '2026-09-20')]);
    expect(out.daysToPaid.overall).toEqual({ median: 13, n: 4 });
  });

  it('is null below 3 settled entries', () => {
    expect(run([settled('2026-09-01', '2026-09-11'), settled('2026-09-01', '2026-09-13')]).daysToPaid.overall).toBeNull();
  });

  it('counts a partly-then-fully paid entry once, from its last payment', () => {
    const r = rec('2026-09-01');
    const early = pay('2026-09-05', 50n);
    const late = pay('2026-09-21', 50n);
    const others = [settled('2026-09-01', '2026-09-21'), settled('2026-09-01', '2026-09-21')];
    const out = run(others, {
      receivables: [r, ...others.map((o) => o.r)],
      payments: [early, late, ...others.map((o) => o.p)],
      allocations: [{ paymentId: early.id, receivableId: r.id }, { paymentId: late.id, receivableId: r.id }, ...others.map((o) => o.a)],
    });
    expect(out.daysToPaid.overall).toEqual({ median: 20, n: 3 });
  });

  it('skips entries still open and payments that were reversed, and never goes below 0', () => {
    const open = settled('2026-09-01', '2026-09-03');
    open.r.status = 'OPEN';
    const reversed = settled('2026-09-01', '2026-09-30');
    reversed.p.status = 'REVERSED';
    const early = settled('2026-09-10', '2026-09-08');
    const out = run([open, reversed, early, settled('2026-09-01', '2026-09-03'), settled('2026-09-01', '2026-09-05')]);
    expect(out.daysToPaid.overall).toEqual({ median: 2, n: 3 });
  });

  it('gives a per-client median only where that client has 3 entries', () => {
    const out = run([settled('2026-09-01', '2026-09-03', 'c1'), settled('2026-09-01', '2026-09-05', 'c1'), settled('2026-09-01', '2026-09-30', 'c1'), settled('2026-09-01', '2026-09-02', 'c2')]);
    expect(out.daysToPaid.byCustomer).toEqual([{ customerId: 'c1', median: 4, n: 3 }]);
    expect(out.daysToPaid.overall).toEqual({ median: 3, n: 4 });
  });
});
