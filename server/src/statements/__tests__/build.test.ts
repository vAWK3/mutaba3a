import { describe, expect, it } from 'vitest';
import { CAPTURE_UNDO_REASON, type AllocationRecord, type CreditRecord, type InstallmentRecord, type PaymentRecord, type ReceivableRecord, type RetainerChargeRecord } from '../../repositories/ports.js';
import { buildStatement, decodeStatementCursor, encodeStatementCursor, type StatementSources, type StatementView } from '../build.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const CUST = '00000000-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const AGR = '00000000-0000-4000-8000-0000000000b1';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const at = (iso: string) => new Date(`${iso}T09:00:00Z`);

function receivable(o: Partial<ReceivableRecord> & { gross: bigint; postingDate: string }): ReceivableRecord {
  const { gross, ...rest } = o;
  return {
    id: uuid(),
    organizationId: ORG,
    customerId: CUST,
    projectId: P1,
    agreementId: null,
    origin: 'ADJUSTMENT',
    originId: null,
    currency: 'ILS',
    netMinor: gross,
    vatMinor: 0n,
    grossMinor: gross,
    vatTreatment: 'EXEMPT',
    vatRateBasisPoints: 0,
    paidMinor: 0n,
    creditedMinor: 0n,
    dueDate: o.postingDate,
    postedAt: at(o.postingDate),
    status: 'OPEN',
    title: 'Work',
    createdByUserId: null,
    deletedAt: null,
    version: 1,
    createdAt: at(o.postingDate),
    number: `CHG-${o.postingDate.slice(0, 4)}-${String(n).padStart(4, '0')}`,
    ...rest,
  };
}

function credit(r: ReceivableRecord, amount: bigint, effectiveDate: string, reason = 'Discount'): CreditRecord {
  r.creditedMinor += amount;
  return { id: uuid(), organizationId: ORG, receivableId: r.id, amountMinor: amount, netMinor: amount, vatMinor: 0n, reason, reasonCode: null, effectiveDate, requestId: null, createdAt: at(effectiveDate) };
}

function payment(amount: bigint, receivedOn: string, o: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: uuid(),
    organizationId: ORG,
    customerId: CUST,
    projectId: null,
    number: `PAY-${receivedOn.slice(0, 4)}-${String(n).padStart(4, '0')}`,
    currency: 'ILS',
    amountMinor: amount,
    allocatedMinor: 0n,
    receivedOn,
    method: 'BANK',
    reference: null,
    receiptNumber: null,
    notes: null,
    status: 'POSTED',
    reversedAt: null,
    reversalReason: null,
    reversalReasonCode: null,
    replacesPaymentId: null,
    requestId: null,
    createdByUserId: null,
    origin: 'INTEGRATION',
    captureSource: null,
    version: 1,
    createdAt: at(receivedOn),
    updatedAt: at(receivedOn),
    ...o,
  } as PaymentRecord;
}

function allocate(p: PaymentRecord, r: ReceivableRecord, amount: bigint): AllocationRecord {
  p.allocatedMinor += amount;
  if (p.status === 'POSTED') r.paidMinor += amount;
  return { id: uuid(), organizationId: ORG, paymentId: p.id, receivableId: r.id, amountMinor: amount, createdAt: p.createdAt };
}

function reverse(p: PaymentRecord, allocations: AllocationRecord[], receivables: ReceivableRecord[], on: string, reason = 'Bounced'): void {
  p.status = 'REVERSED';
  p.reversedAt = new Date(`${on}T12:00:00Z`);
  p.reversalReason = reason;
  for (const a of allocations.filter((x) => x.paymentId === p.id)) receivables.find((r) => r.id === a.receivableId)!.paidMinor -= a.amountMinor;
  p.allocatedMinor = 0n;
}

type Sources = { -readonly [K in keyof StatementSources]: Array<StatementSources[K][number]> };
const empty = (): Sources => ({ receivables: [], credits: [], payments: [], allocations: [], installments: [], charges: [] });
const view = (o: Partial<StatementView> = {}): StatementView => ({ asOf: '2026-10-27', timezone: 'Asia/Jerusalem', from: null, to: null, projectId: null, ...o });
const all = { limit: 500, cursor: null };

/** Every line's running balance follows from the one before, starting at the opening balance. */
function expectRunning(page: ReturnType<typeof buildStatement>, opening: bigint): void {
  let running = opening;
  for (const line of page.lines) {
    running += line.debitMinor - line.creditMinor;
    expect(line.runningMinor).toBe(running);
  }
}

function ledger(): Sources {
  const s = empty();
  const r1 = receivable({ gross: 100_000n, postingDate: '2026-01-10', dueDate: '2026-01-31' });
  const r2 = receivable({ gross: 50_000n, postingDate: '2026-03-01', dueDate: '2026-03-31', projectId: P2 });
  const r3 = receivable({ gross: 20_000n, postingDate: '2026-09-01', dueDate: '2026-12-31' });
  s.receivables.push(r1, r2, r3);
  s.credits.push(credit(r1, 10_000n, '2026-02-01'));
  const pay1 = payment(70_000n, '2026-02-15');
  s.payments.push(pay1);
  s.allocations.push(allocate(pay1, r1, 40_000n), allocate(pay1, r2, 30_000n));
  const pay2 = payment(5_000n, '2026-04-01'); // unallocated
  s.payments.push(pay2);
  return s;
}

describe('buildStatement', () => {
  it('runs the balance oldest first across charges, credits and payments', () => {
    const page = buildStatement(ledger(), view(), all);
    expect(page.lines.map((l) => l.kind)).toEqual(['CHARGE', 'CREDIT', 'PAYMENT', 'CHARGE', 'PAYMENT', 'CHARGE']);
    expect(page.openingMinor).toBe(0n);
    expect(page.totals).toEqual({ debitMinor: 170_000n, creditMinor: 85_000n });
    expect(page.closingMinor).toBe(85_000n);
    expectRunning(page, 0n);
  });

  it('the closing balance equals outstanding minus unallocated', () => {
    const s = ledger();
    const outstanding = s.receivables.reduce((sum, r) => sum + r.grossMinor - r.paidMinor - r.creditedMinor, 0n);
    const unallocated = s.payments.filter((p) => p.status === 'POSTED').reduce((sum, p) => sum + p.amountMinor - p.allocatedMinor, 0n);
    expect(buildStatement(s, view(), all).closingMinor).toBe(outstanding - unallocated);
  });

  it.each([
    ['2026-02-01', null],
    ['2026-02-16', '2026-08-31'],
    [null, '2026-02-15'],
    ['2026-09-02', null],
  ])('from %s to %s: opening + debits − credits = closing', (from, to) => {
    const page = buildStatement(ledger(), view({ from, to }), all);
    expect(page.openingMinor + page.totals.debitMinor - page.totals.creditMinor).toBe(page.closingMinor);
    expectRunning(page, page.openingMinor);
    for (const l of page.lines) {
      if (from) expect(l.date >= from).toBe(true);
      if (to) expect(l.date <= to).toBe(true);
    }
  });

  it('folds lines before from into the opening balance', () => {
    const page = buildStatement(ledger(), view({ from: '2026-03-01' }), all);
    expect(page.openingMinor).toBe(100_000n - 10_000n - 70_000n);
    expect(page.lines[0]!.date).toBe('2026-03-01');
  });

  it('a reversed payment shows its payment and its reversal, netting to zero', () => {
    const s = ledger();
    const before = buildStatement(s, view(), all).closingMinor;
    const p = s.payments[0]!;
    reverse(p, s.allocations, s.receivables, '2026-05-02');
    const page = buildStatement(s, view(), all);
    const own = page.lines.filter((l) => l.paymentId === p.id);
    expect(own.map((l) => [l.kind, l.date])).toEqual([['PAYMENT', '2026-02-15'], ['PAYMENT_REVERSAL', '2026-05-02']]);
    expect(own[0]!.creditMinor).toBe(own[1]!.debitMinor);
    expect(page.closingMinor).toBe(before + p.amountMinor);
    expectRunning(page, 0n);
  });

  it('leaves out a capture the person undid (D2)', () => {
    const s = ledger();
    const undone = payment(9_000n, '2026-06-01', { status: 'REVERSED', reversedAt: at('2026-06-01'), reversalReason: CAPTURE_UNDO_REASON, origin: 'CAPTURE' });
    s.payments.push(undone);
    expect(buildStatement(s, view(), all).lines.some((l) => l.paymentId === undone.id)).toBe(false);
  });

  it('a payment split across two projects shows only what was allocated there', () => {
    const s = ledger();
    const p = s.payments[0]!;
    const p1 = buildStatement(s, view({ projectId: P1 }), all);
    const p2 = buildStatement(s, view({ projectId: P2 }), all);
    expect(p1.lines.filter((l) => l.paymentId === p.id).map((l) => l.creditMinor)).toEqual([40_000n]);
    expect(p2.lines.filter((l) => l.paymentId === p.id).map((l) => l.creditMinor)).toEqual([30_000n]);
    expect(buildStatement(s, view(), all).lines.filter((l) => l.paymentId === p.id).map((l) => l.creditMinor)).toEqual([70_000n]);
    // Unallocated money only on the whole-customer statement.
    expect(p1.lines.some((l) => l.paymentId === s.payments[1]!.id)).toBe(false);
    // Each project's closing balance is its own outstanding.
    const own = (pid: string) => s.receivables.filter((r) => r.projectId === pid).reduce((sum, r) => sum + r.grossMinor - r.paidMinor - r.creditedMinor, 0n);
    expect(p1.closingMinor).toBe(own(P1));
    expect(p2.closingMinor).toBe(own(P2));
  });

  it('a correction shows the full credit, then the reposted charge, and moves the balance by the difference', () => {
    const s = empty();
    const old = receivable({ gross: 118_000n, postingDate: '2026-05-01' });
    s.receivables.push(old);
    const before = buildStatement(s, view(), all).closingMinor;
    s.credits.push(credit(old, 118_000n, '2026-10-20', 'Corrected terms'));
    s.receivables.push(receivable({ gross: 100_000n, postingDate: '2026-05-01', createdAt: at('2026-10-20'), postedAt: at('2026-10-20') }));
    const page = buildStatement(s, view(), all);
    expect(page.lines.map((l) => l.kind)).toEqual(['CHARGE', 'CHARGE', 'CREDIT']);
    expect(page.closingMinor - before).toBe(100_000n - 118_000n);
  });

  it('an Owed dated ahead appears on its day only (countsOn)', () => {
    const s = empty();
    s.receivables.push(receivable({ gross: 1_000n, postingDate: '2026-11-15' }));
    expect(buildStatement(s, view(), all).lines).toHaveLength(0);
    expect(buildStatement(s, view({ asOf: '2026-11-15' }), all).lines).toHaveLength(1);
  });

  it('charges carry their origin, status and days overdue against asOf', () => {
    const s = empty();
    const inst = (position: number, o: Partial<InstallmentRecord> = {}) => ({ id: uuid(), organizationId: ORG, agreementId: AGR, position, label: `I${position}`, amountMinor: 1n, netMinor: 1n, vatMinor: 0n, grossMinor: 1n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, isCommission: false, version: 1, ...o }) as InstallmentRecord;
    const i1 = inst(1);
    const i2 = inst(2);
    const commission = inst(3, { isCommission: true });
    const charge: RetainerChargeRecord = { id: uuid(), organizationId: ORG, agreementId: AGR, version: 1, serviceMonth: '2026-09', chargeDate: '2026-09-01', amountMinor: 1n, netMinor: 1n, vatMinor: 0n, grossMinor: 1n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, postedAt: at('2026-09-01'), receivableId: 'x', createdAt: at('2026-09-01') };
    s.installments.push(i1, i2, commission);
    s.charges.push(charge);
    const overdue = receivable({ gross: 5_000n, postingDate: '2026-10-01', dueDate: '2026-10-17', origin: 'INSTALLMENT', originId: i2.id, agreementId: AGR });
    const partPaid = receivable({ gross: 5_000n, postingDate: '2026-10-02', dueDate: '2026-10-20', paidMinor: 2_000n, origin: 'RETAINER_CHARGE', originId: charge.id, agreementId: AGR });
    const fee = receivable({ gross: 5_000n, postingDate: '2026-10-03', dueDate: '2026-11-30', origin: 'INSTALLMENT', originId: commission.id, agreementId: AGR });
    s.receivables.push(overdue, partPaid, fee);
    const [a, b, c] = buildStatement(s, view(), all).lines;
    expect(a!.origin).toEqual({ type: 'INSTALLMENT', agreementId: AGR, position: 2, of: 2 });
    expect(a!.daysOverdue).toBe(10);
    expect(a!.status).toBe('OVERDUE');
    expect(b!.origin).toEqual({ type: 'RETAINER_CHARGE', agreementId: AGR, serviceMonth: '2026-09' });
    expect(b!.outstandingMinor).toBe(3_000n);
    expect(b!.daysOverdue).toBe(7);
    expect(c!.origin).toEqual({ type: 'CONTINGENCY_FEE', agreementId: AGR });
    expect(c!.daysOverdue).toBeNull();
  });

  it('orders equal dates the same way on every call, a payment before its own reversal', () => {
    const s = empty();
    for (let i = 0; i < 6; i++) s.receivables.push(receivable({ gross: 100n, postingDate: '2026-10-01', createdAt: at('2026-10-01') }));
    const p = payment(300n, '2026-10-01');
    s.payments.push(p);
    reverse(p, s.allocations, s.receivables, '2026-10-01');
    const first = buildStatement(s, view(), all).lines.map((l) => l.id);
    const shuffled = { ...s, receivables: [...s.receivables].reverse() };
    expect(buildStatement(shuffled, view(), all).lines.map((l) => l.id)).toEqual(first);
    const kinds = buildStatement(s, view(), all).lines.map((l) => l.kind);
    expect(kinds.indexOf('PAYMENT')).toBeLessThan(kinds.indexOf('PAYMENT_REVERSAL'));
  });

  it('pages 1,000 lines: the balance carries across, and every page has the same opening and totals', () => {
    const s = empty();
    for (let i = 0; i < 1_000; i++) {
      const day = `2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
      if (i % 3 === 0) s.payments.push(payment(BigInt(100 + i), day));
      else s.receivables.push(receivable({ gross: BigInt(1_000 + i), postingDate: day }));
    }
    const whole = buildStatement(s, view({ from: '2026-02-01' }), { limit: 10_000, cursor: null });
    expect(whole.nextCursor).toBeNull();
    const seen: string[] = [];
    let cursor = null;
    let pages = 0;
    do {
      const page = buildStatement(s, view({ from: '2026-02-01' }), { limit: 200, cursor });
      expect(page.openingMinor).toBe(whole.openingMinor);
      expect(page.totals).toEqual(whole.totals);
      expect(page.closingMinor).toBe(whole.closingMinor);
      for (const l of page.lines) seen.push(`${l.id}:${l.runningMinor}`);
      cursor = page.nextCursor ? decodeStatementCursor(encodeStatementCursor(page.nextCursor)) : null;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(whole.lines.map((l) => `${l.id}:${l.runningMinor}`));
  });

  it('refuses a cursor that is not its own', () => {
    expect(() => decodeStatementCursor('nope')).toThrow();
    expect(() => decodeStatementCursor(Buffer.from(JSON.stringify({ d: 1 })).toString('base64url'))).toThrow();
  });
});

/**
 * MUT-444 (ADR-226): a terms correction voids every line, credits each posted charge on its own posting date and
 * reposts it there, created a millisecond after the credit (D5 B); the voided generation keeps its own "N of M" (R3);
 * a released allocation row is history only (D1).
 */
describe('buildStatement after terms corrections (MUT-444)', () => {
  const inst = (position: number, o: Partial<InstallmentRecord> = {}) => ({ id: uuid(), organizationId: ORG, agreementId: AGR, position, label: `I${position}`, amountMinor: 1n, netMinor: 1n, vatMinor: 0n, grossMinor: 1n, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: null, dueDateOverride: null, postedAt: null, postingDate: null, receivableId: null, voidedAt: null, isCommission: false, version: 1, ...o }) as InstallmentRecord;
  const charge = (line: InstallmentRecord, gross: bigint, postingDate: string, createdAt: Date) => {
    const r = receivable({ gross, postingDate, dueDate: '2026-10-31', origin: 'INSTALLMENT', originId: line.id, agreementId: AGR, createdAt });
    line.receivableId = r.id;
    return r;
  };
  const first = new Date('2026-10-20T08:00:00Z');
  const second = new Date('2026-10-25T08:00:00Z');

  /** Two posted lines through two corrections: generations g0 (voided at `first`), g1 (voided at `second`), g2 live. */
  function twice() {
    const s = empty();
    const g = [0, 1, 2].map((k) => [inst(1 + 2 * k, { voidedAt: k === 0 ? first : k === 1 ? second : null }), inst(2 + 2 * k, { voidedAt: k === 0 ? first : k === 1 ? second : null })]);
    s.installments.push(...g.flat());
    const at0 = at('2026-10-01');
    const rows = g.map((pair, k) => pair.map((line, j) => charge(line, 1_000n * BigInt(k + 1), j === 0 ? '2026-10-01' : '2026-10-05', k === 0 ? at0 : new Date((k === 1 ? first : second).getTime() + 1))));
    s.receivables.push(...rows.flat());
    // Each correction credits the generation it voided, dated each charge's own posting date, created at the instant.
    for (const [k, when] of [[0, first], [1, second]] as const) {
      for (const r of rows[k]!) {
        const c = credit(r, r.grossMinor, r.postingDate, 'ENTERED_BY_MISTAKE');
        c.createdAt = when;
        s.credits.push(c);
      }
    }
    return { s, rows };
  }

  it('each voided generation reads its own "N of M"; the live lines read theirs (R3)', () => {
    const { s, rows } = twice();
    const lines = buildStatement(s, view(), all).lines.filter((l) => l.kind === 'CHARGE');
    const originOf = (id: string) => lines.find((l) => l.receivableId === id)!.origin;
    for (const generation of rows) {
      expect(originOf(generation[0]!.id)).toEqual({ type: 'INSTALLMENT', agreementId: AGR, position: 1, of: 2 });
      expect(originOf(generation[1]!.id)).toEqual({ type: 'INSTALLMENT', agreementId: AGR, position: 2, of: 2 });
    }
  });

  it('D5 B: on the shared date the old charge, its credit, then the repost; every period nets to the corrected figure', () => {
    const { s, rows } = twice();
    const page = buildStatement(s, view(), all);
    const onFirst = page.lines.filter((l) => l.date === '2026-10-01').map((l) => [l.kind, l.receivableId]);
    expect(onFirst).toEqual([
      ['CHARGE', rows[0]![0]!.id],
      ['CREDIT', rows[0]![0]!.id],
      ['CHARGE', rows[1]![0]!.id],
      ['CREDIT', rows[1]![0]!.id],
      ['CHARGE', rows[2]![0]!.id],
    ]);
    // October 1 – 4 holds only the first line, at its corrected figure.
    expect(buildStatement(s, view({ to: '2026-10-04' }), all).closingMinor).toBe(3_000n);
    expect(page.closingMinor).toBe(6_000n);
    expectRunning(page, 0n);
  });

  it('a released allocation row adds no line and no matter, on either statement (D1)', () => {
    const s = empty();
    const old = receivable({ gross: 1_000n, postingDate: '2026-10-01' });
    const repost = receivable({ gross: 1_000n, postingDate: '2026-10-01', projectId: P2 });
    s.receivables.push(old, repost);
    const p = payment(1_000n, '2026-10-05');
    s.payments.push(p);
    const released = { ...allocate(p, old, 1_000n), releasedAt: new Date('2026-10-20T08:00:00Z') };
    old.paidMinor = 0n;
    s.credits.push(credit(old, 1_000n, '2026-10-01'));
    p.allocatedMinor = 0n;
    s.allocations.push(released, allocate(p, repost, 1_000n));
    const whole = buildStatement(s, view(), all).lines.filter((l) => l.kind === 'PAYMENT');
    expect(whole).toHaveLength(1);
    expect(whole[0]!.projectId).toBe(P2);
    expect(buildStatement(s, view({ projectId: P1 }), all).lines.filter((l) => l.kind === 'PAYMENT')).toEqual([]);
    expect(buildStatement(s, view({ projectId: P2 }), all).lines.filter((l) => l.kind === 'PAYMENT').map((l) => l.allocatedMinor)).toEqual([1_000n]);
  });
});

/** MUT-483 (eng review R1): the edges the line classifier's extraction must keep. */
describe('buildStatement line edges (MUT-483)', () => {
  it('a reversal at 22:30 UTC is dated the next day in Asia/Jerusalem', () => {
    const s = empty();
    const p = payment(1_000n, '2026-10-20');
    s.payments.push(p);
    reverse(p, s.allocations, s.receivables, '2026-10-27');
    p.reversedAt = new Date('2026-10-27T22:30:00Z');
    const reversal = buildStatement(s, view(), all).lines.find((l) => l.kind === 'PAYMENT_REVERSAL')!;
    expect(reversal.date).toBe('2026-10-28');
    expect(buildStatement(s, view({ timezone: 'UTC' }), all).lines.find((l) => l.kind === 'PAYMENT_REVERSAL')!.date).toBe('2026-10-27');
  });

  it('a REVERSED payment with no reversedAt is dated by its updatedAt', () => {
    const s = empty();
    const p = payment(1_000n, '2026-10-01', { status: 'REVERSED', reversalReason: 'Bounced', reversedAt: null, updatedAt: new Date('2026-10-12T07:00:00Z') });
    s.payments.push(p);
    const reversal = buildStatement(s, view(), all).lines.find((l) => l.kind === 'PAYMENT_REVERSAL')!;
    expect(reversal).toMatchObject({ date: '2026-10-12', id: `${p.id}:reversal` });
  });

  it('on a project statement a reversal line is the allocation\'s id with :reversal', () => {
    const s = ledger();
    const p = s.payments[0]!;
    reverse(p, s.allocations, s.receivables, '2026-05-02');
    const own = s.allocations.filter((a) => a.paymentId === p.id);
    const p1 = buildStatement(s, view({ projectId: P1 }), all).lines.filter((l) => l.kind === 'PAYMENT_REVERSAL');
    expect(p1.map((l) => l.id)).toEqual([`${own.find((a) => s.receivables.find((r) => r.id === a.receivableId)!.projectId === P1)!.id}:reversal`]);
  });

  it('a soft-deleted receivable is never a line, nor its credits', () => {
    const s = empty();
    const gone = receivable({ gross: 1_000n, postingDate: '2026-10-01', deletedAt: new Date('2026-10-02T00:00:00Z') });
    s.receivables.push(gone);
    expect(buildStatement(s, view(), all).lines).toEqual([]);
    expect(buildStatement(s, view({ projectId: P1 }), all).lines).toEqual([]);
  });
});
