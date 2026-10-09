import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { eligibleFor, outstandingOf, resultingBalances, suggestAllocations, validateAllocations, type AllocatableReceivable } from '../allocate.js';

const TODAY = '2026-10-08';
let n = 0;
function rec(over: Partial<AllocatableReceivable> & { gross: bigint; due?: string; project?: string }): AllocatableReceivable {
  n += 1;
  return {
    id: over.id ?? `r${String(n).padStart(2, '0')}`,
    customerId: over.customerId ?? 'c1',
    projectId: over.project ?? over.projectId ?? 'p1',
    currency: over.currency ?? 'ILS',
    dueDate: over.due ?? over.dueDate ?? '2026-10-31',
    postingDate: over.postingDate ?? '2026-10-01',
    grossMinor: over.gross,
    paidMinor: over.paidMinor ?? 0n,
    creditedMinor: over.creditedMinor ?? 0n,
    status: over.status ?? 'OPEN',
  };
}

describe('outstanding and eligibility', () => {
  it('outstanding honours paid and credited', () => {
    expect(outstandingOf(rec({ gross: 100000n, paidMinor: 30000n, creditedMinor: 20000n }))).toBe(50000n);
  });

  it('eligible = same customer and currency, OPEN, outstanding > 0, oldest due first', () => {
    const a = rec({ gross: 100n, due: '2026-11-30' });
    const b = rec({ gross: 100n, due: '2026-10-15' });
    const settled = rec({ gross: 100n, paidMinor: 100n, status: 'SETTLED' });
    const fullyCredited = rec({ gross: 100n, creditedMinor: 100n });
    const other = rec({ gross: 100n, customerId: 'c2' });
    const usd = rec({ gross: 100n, currency: 'USD' });
    expect(eligibleFor([a, b, settled, fullyCredited, other, usd], 'c1', 'ILS').map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

describe('validateAllocations', () => {
  const r1 = rec({ gross: 295000n, due: '2026-10-01' });
  const r2 = rec({ gross: 236000n, due: '2026-11-30' });
  const base = { customerId: 'c1', currency: 'ILS', amountMinor: 1000000n, receivables: [r1, r2] };

  it('accepts a valid set and reports the remainder as unallocated', () => {
    const result = validateAllocations({ ...base, allocations: [{ receivableId: r1.id, amountMinor: 295000n }, { receivableId: r2.id, amountMinor: 100000n }] });
    expect(result).toEqual({ ok: true, value: { allocations: [{ receivableId: r1.id, amountMinor: 295000n }, { receivableId: r2.id, amountMinor: 100000n }], allocatedMinor: 395000n, unallocatedMinor: 605000n } });
  });

  it('an empty set leaves everything unallocated', () => {
    expect(validateAllocations({ ...base, allocations: [] })).toMatchObject({ ok: true, value: { allocatedMinor: 0n, unallocatedMinor: 1000000n } });
  });

  it.each([
    ['ALLOCATION_EXCEEDS_PAYMENT', { amountMinor: 300000n, allocations: [{ receivableId: r1.id, amountMinor: 295000n }, { receivableId: r2.id, amountMinor: 10000n }] }, { excessMinor: 5000n }],
    ['ALLOCATION_EXCEEDS_OUTSTANDING', { allocations: [{ receivableId: r1.id, amountMinor: 295001n }] }, { receivableId: r1.id, outstandingMinor: 295000n, excessMinor: 1n }],
    ['ALLOCATION_DUPLICATE', { allocations: [{ receivableId: r1.id, amountMinor: 1n }, { receivableId: r1.id, amountMinor: 1n }] }, { receivableId: r1.id }],
    ['RECEIVABLE_NOT_FOUND', { allocations: [{ receivableId: 'nope', amountMinor: 1n }] }, { receivableId: 'nope' }],
    ['AMOUNT_INVALID', { allocations: [{ receivableId: r1.id, amountMinor: 0n }] }, {}],
    ['AMOUNT_INVALID', { amountMinor: 0n, allocations: [] }, {}],
  ] as const)('%s', (reason, over, details) => {
    const result = validateAllocations({ ...base, ...over });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ reason, ...details });
  });

  it('refuses a settled receivable, another customer and another currency', () => {
    const settled = rec({ gross: 100n, paidMinor: 100n, status: 'SETTLED' });
    const other = rec({ gross: 100n, customerId: 'c2' });
    const usd = rec({ gross: 100n, currency: 'USD' });
    const check = (r: AllocatableReceivable) => {
      const result = validateAllocations({ ...base, receivables: [r], allocations: [{ receivableId: r.id, amountMinor: 1n }] });
      return result.ok ? 'ok' : result.error.reason;
    };
    expect(check(settled)).toBe('RECEIVABLE_NOT_OPEN');
    expect(check(other)).toBe('RECEIVABLE_CUSTOMER_MISMATCH');
    expect(check(usd)).toBe('CURRENCY_MISMATCH');
  });

  it('a credited receivable has less room', () => {
    const credited = rec({ gross: 100000n, paidMinor: 30000n, creditedMinor: 20000n });
    expect(validateAllocations({ ...base, receivables: [credited], allocations: [{ receivableId: credited.id, amountMinor: 50000n }] }).ok).toBe(true);
    expect(validateAllocations({ ...base, receivables: [credited], allocations: [{ receivableId: credited.id, amountMinor: 50001n }] })).toMatchObject({ ok: false, error: { reason: 'ALLOCATION_EXCEEDS_OUTSTANDING' } });
  });
});

describe('suggestAllocations', () => {
  const old = rec({ gross: 300000n, due: '2026-09-30', postingDate: '2026-09-01', project: 'pA' });
  const mid = rec({ gross: 200000n, due: '2026-10-31', postingDate: '2026-10-01', project: 'pB' });
  const newer = rec({ gross: 300000n, due: '2026-11-30', postingDate: '2026-11-01', project: 'pB' });

  it('OLDEST_FIRST fills by due date and stops exactly at the amount', () => {
    expect(suggestAllocations('OLDEST_FIRST', 350000n, [newer, mid, old])).toEqual([
      { receivableId: old.id, amountMinor: 300000n },
      { receivableId: mid.id, amountMinor: 50000n },
    ]);
  });

  it('OLDEST_FIRST breaks a due-date tie by posting date, then id; more money than owed leaves the rest unallocated', () => {
    const a = rec({ id: 'b', gross: 100n, due: '2026-10-31', postingDate: '2026-10-02' });
    const b = rec({ id: 'a', gross: 100n, due: '2026-10-31', postingDate: '2026-10-01' });
    const c = rec({ id: 'c', gross: 100n, due: '2026-10-31', postingDate: '2026-10-01' });
    expect(suggestAllocations('OLDEST_FIRST', 1000n, [a, b, c]).map((x) => x.receivableId)).toEqual(['a', 'c', 'b']);
    expect(suggestAllocations('OLDEST_FIRST', 1000n, [a, b, c]).reduce((s, x) => s + x.amountMinor, 0n)).toBe(300n);
  });

  it('SETTLE_MATTERS settles whole projects that fit, smallest first, then oldest-first for the rest', () => {
    // pA owes 3000.00, pB owes 5000.00
    expect(suggestAllocations('SETTLE_MATTERS', 600000n, [old, mid, newer])).toEqual([
      { receivableId: old.id, amountMinor: 300000n },
      { receivableId: mid.id, amountMinor: 200000n },
      { receivableId: newer.id, amountMinor: 100000n },
    ]);
    expect(suggestAllocations('SETTLE_MATTERS', 800000n, [old, mid, newer]).map((x) => x.amountMinor)).toEqual([300000n, 200000n, 300000n]);
    // nothing fits whole → oldest-first
    expect(suggestAllocations('SETTLE_MATTERS', 200000n, [old, mid, newer])).toEqual([{ receivableId: old.id, amountMinor: 200000n }]);
  });

  it('SETTLE_MATTERS prefers the project with the oldest due date when totals tie', () => {
    const x = rec({ gross: 1000n, due: '2026-10-31', project: 'pX' });
    const y = rec({ gross: 1000n, due: '2026-09-30', project: 'pY' });
    expect(suggestAllocations('SETTLE_MATTERS', 1000n, [x, y])).toEqual([{ receivableId: y.id, amountMinor: 1000n }]);
  });

  it('an empty eligible set suggests nothing', () => {
    expect(suggestAllocations('OLDEST_FIRST', 100n, [])).toEqual([]);
    expect(suggestAllocations('SETTLE_MATTERS', 100n, [])).toEqual([]);
  });
});

describe('resultingBalances', () => {
  it('reports per receivable, project and customer before → after with statuses for today', () => {
    const overdue = rec({ gross: 295000n, due: '2026-10-01', project: 'pA' });
    const due = rec({ gross: 236000n, due: '2026-11-30', project: 'pB' });
    const untouched = rec({ gross: 100000n, due: '2026-12-31', project: 'pB' });
    const balances = resultingBalances([{ receivableId: overdue.id, amountMinor: 295000n }, { receivableId: due.id, amountMinor: 100000n }], [overdue, due, untouched], TODAY);
    expect(balances.receivables).toEqual([
      { receivableId: overdue.id, projectId: 'pA', outstandingBefore: 295000n, outstandingAfter: 0n, statusBefore: 'OVERDUE', statusAfter: 'PAID' },
      { receivableId: due.id, projectId: 'pB', outstandingBefore: 236000n, outstandingAfter: 136000n, statusBefore: 'DUE', statusAfter: 'PARTIALLY_PAID' },
    ]);
    expect(balances.projects).toEqual([
      { projectId: 'pA', before: { outstandingMinor: 295000n, overdueMinor: 295000n }, after: { outstandingMinor: 0n, overdueMinor: 0n } },
      { projectId: 'pB', before: { outstandingMinor: 336000n, overdueMinor: 0n }, after: { outstandingMinor: 236000n, overdueMinor: 0n } },
    ]);
    expect(balances.customer).toEqual({ before: { outstandingMinor: 631000n, overdueMinor: 295000n }, after: { outstandingMinor: 236000n, overdueMinor: 0n } });
  });

  it('a partial allocation on an overdue receivable stays OVERDUE', () => {
    const overdue = rec({ gross: 1000n, due: '2026-10-01' });
    const balances = resultingBalances([{ receivableId: overdue.id, amountMinor: 1n }], [overdue], TODAY);
    expect(balances.receivables[0]).toMatchObject({ statusAfter: 'OVERDUE', outstandingAfter: 999n });
  });
});

describe('no number ever holds an amount', () => {
  it('allocate.ts and credit.ts never call Number() on minor units', () => {
    for (const file of ['allocate.ts', 'credit.ts']) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/Number\(.*Minor/);
      expect(src).not.toMatch(/parseFloat|parseInt/);
    }
  });
});
