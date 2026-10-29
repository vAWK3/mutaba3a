import { describe, expect, it } from 'vitest';
import { CAPTURE_UNDO_REASON, type AllocationRecord, type CreditRecord, type PaymentRecord, type ReceivableRecord } from '../../repositories/ports.js';
import { buildStatement, decodeStatementCursor, encodeStatementCursor } from '../build.js';
import { isStatementCharge, isStatementPayment, LINE_RANK, ledgerEntries, reversalDateOf, reversalInstantOf } from '../lines.js';

/**
 * MUT-483 (eng review R10): the one line classifier the statement and the period totals both read, and the line
 * identity a statement cursor relies on: ids, atMs, ranks and the cursor's encoding are pinned here, so a change to
 * any of them is a deliberate one.
 */
const ORG = '00000000-0000-4000-8000-000000000001';
const CUST = '00000000-0000-4000-8000-000000000002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const view = { asOf: '2026-10-27', timezone: 'Asia/Jerusalem' };

function receivable(o: Partial<ReceivableRecord> = {}): ReceivableRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    organizationId: ORG,
    customerId: CUST,
    projectId: P1,
    agreementId: null,
    origin: 'INSTALLMENT',
    originId: null,
    currency: 'ILS',
    netMinor: 10_000n,
    vatMinor: 0n,
    grossMinor: 10_000n,
    vatTreatment: 'EXEMPT',
    vatRateBasisPoints: 0,
    paidMinor: 0n,
    creditedMinor: 0n,
    dueDate: '2026-10-31',
    postingDate: '2026-10-01',
    postedAt: new Date('2026-10-01T08:00:00Z'),
    status: 'OPEN',
    title: null,
    createdByUserId: null,
    deletedAt: null,
    number: 'CHG-2026-0001',
    version: 1,
    createdAt: new Date('2026-10-01T08:00:00Z'),
    ...o,
  };
}

function payment(o: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    organizationId: ORG,
    customerId: CUST,
    projectId: null,
    number: 'PAY-2026-0001',
    currency: 'ILS',
    amountMinor: 4_000n,
    allocatedMinor: 0n,
    receivedOn: '2026-10-05',
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
    createdAt: new Date('2026-10-05T09:00:00Z'),
    updatedAt: new Date('2026-10-05T09:00:00Z'),
    ...o,
  } as PaymentRecord;
}

const credit = (o: Partial<CreditRecord> = {}): CreditRecord => ({ id: '00000000-0000-4000-8000-0000000000d1', organizationId: ORG, receivableId: '00000000-0000-4000-8000-0000000000b1', amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, reason: 'Goodwill', reasonCode: null, effectiveDate: '2026-10-03', requestId: null, createdAt: new Date('2026-10-03T07:00:00Z'), ...o });

describe('isStatementCharge (ADR-217 §3)', () => {
  it('counts a live charge, never a deleted one', () => {
    expect(isStatementCharge(receivable(), view.asOf)).toBe(true);
    expect(isStatementCharge(receivable({ deletedAt: new Date('2026-10-02T00:00:00Z') }), view.asOf)).toBe(false);
  });

  it('an Owed dated ahead counts from its day, or at once when money lands on it (countsOn)', () => {
    const ahead = receivable({ origin: 'ADJUSTMENT', postingDate: '2026-11-01' });
    expect(isStatementCharge(ahead, view.asOf)).toBe(false);
    expect(isStatementCharge(ahead, '2026-11-01')).toBe(true);
    expect(isStatementCharge({ ...ahead, paidMinor: 1n }, view.asOf)).toBe(true);
    expect(isStatementCharge({ ...ahead, creditedMinor: 1n }, view.asOf)).toBe(true);
    // Any other origin dated ahead (an IMMEDIATE line on an agreement dated ahead) counts at once.
    expect(isStatementCharge(receivable({ postingDate: '2026-11-01' }), view.asOf)).toBe(true);
  });
});

describe('isStatementPayment (ADR-217 D2)', () => {
  it('POSTED, or REVERSED by anything but the person\'s own undo', () => {
    expect(isStatementPayment(payment())).toBe(true);
    expect(isStatementPayment(payment({ status: 'REVERSED', reversalReason: 'Bounced' }))).toBe(true);
    expect(isStatementPayment(payment({ status: 'REVERSED', reversalReason: null }))).toBe(true);
    expect(isStatementPayment(payment({ status: 'REVERSED', reversalReason: CAPTURE_UNDO_REASON }))).toBe(false);
  });
});

describe('a reversal\'s instant and day (ADR-217 D6)', () => {
  it('reads reversedAt, else updatedAt', () => {
    const reversedAt = new Date('2026-10-20T10:00:00Z');
    const updatedAt = new Date('2026-10-21T10:00:00Z');
    expect(reversalInstantOf({ reversedAt, updatedAt })).toBe(reversedAt);
    expect(reversalInstantOf({ reversedAt: null, updatedAt })).toBe(updatedAt);
  });

  it('dates it by the calendar day of that instant in the organization timezone', () => {
    const lateEvening = { reversedAt: new Date('2026-10-27T22:30:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z') };
    expect(reversalDateOf(lateEvening, 'Asia/Jerusalem')).toBe('2026-10-28');
    expect(reversalDateOf(lateEvening, 'UTC')).toBe('2026-10-27');
    expect(reversalDateOf({ reversedAt: null, updatedAt: new Date('2026-10-27T22:30:00Z') }, 'Asia/Jerusalem')).toBe('2026-10-28');
  });
});

describe('ledgerEntries: ids, dates, atMs and ranks (R10)', () => {
  it('a charge, its credit, a payment and its reversal', () => {
    const r = receivable();
    const c = credit();
    const p = payment({ status: 'REVERSED', reversalReason: 'Bounced', reversedAt: new Date('2026-10-27T22:30:00Z'), updatedAt: new Date('2026-10-27T22:30:00Z') });
    const entries = ledgerEntries({ receivables: [r], credits: [c], payments: [p] }, view);
    expect(entries.map((e) => ({ id: e.id, kind: e.kind, date: e.date, atMs: e.atMs, rank: e.rank, currency: e.currency, customerId: e.customerId, debit: e.debitMinor, credit: e.creditMinor }))).toEqual([
      { id: r.id, kind: 'CHARGE', date: '2026-10-01', atMs: r.createdAt.getTime(), rank: 0, currency: 'ILS', customerId: CUST, debit: 10_000n, credit: 0n },
      { id: c.id, kind: 'CREDIT', date: '2026-10-03', atMs: c.createdAt.getTime(), rank: 1, currency: 'ILS', customerId: CUST, debit: 0n, credit: 1_000n },
      { id: p.id, kind: 'PAYMENT', date: '2026-10-05', atMs: p.createdAt.getTime(), rank: 2, currency: 'ILS', customerId: CUST, debit: 0n, credit: 4_000n },
      { id: `${p.id}:reversal`, kind: 'PAYMENT_REVERSAL', date: '2026-10-28', atMs: Date.parse('2026-10-27T22:30:00Z'), rank: 3, currency: 'ILS', customerId: CUST, debit: 4_000n, credit: 0n },
    ]);
    expect(LINE_RANK).toEqual({ CHARGE: 0, CREDIT: 1, PAYMENT: 2, PAYMENT_REVERSAL: 3 });
    // Each entry carries the row it came from, so the statement decorates it without a lookup.
    expect(entries[0]!.source).toBe(r);
    expect(entries[1]!.kind === 'CREDIT' && entries[1]!.receivable).toBe(r);
  });

  it('drops a credit on a charge that is not a line, a capture the person undid, and a deleted charge', () => {
    const ahead = receivable({ id: '00000000-0000-4000-8000-0000000000b2', origin: 'ADJUSTMENT', postingDate: '2026-12-01' });
    const deleted = receivable({ id: '00000000-0000-4000-8000-0000000000b3', origin: 'ADJUSTMENT', deletedAt: new Date('2026-10-02T00:00:00Z') });
    const undone = payment({ status: 'REVERSED', reversalReason: CAPTURE_UNDO_REASON, reversedAt: new Date('2026-10-06T00:00:00Z'), origin: 'CAPTURE' });
    const orphan = credit({ receivableId: '00000000-0000-4000-8000-0000000000ff' });
    expect(ledgerEntries({ receivables: [ahead, deleted], credits: [orphan], payments: [undone] }, view)).toEqual([]);
  });

  it('a payment with no client is a line with a null customer (MUT-483 D4)', () => {
    const [entry] = ledgerEntries({ receivables: [], credits: [], payments: [payment({ customerId: null })] }, view);
    expect(entry).toMatchObject({ kind: 'PAYMENT', customerId: null, creditMinor: 4_000n });
  });
});

describe('statement line identity (R10)', () => {
  it('a project statement\'s reversal line is the allocation\'s id with :reversal', () => {
    const r = receivable({ paidMinor: 0n });
    const p = payment({ status: 'REVERSED', reversalReason: 'Bounced', reversedAt: new Date('2026-10-10T08:00:00Z'), allocatedMinor: 0n });
    const a: AllocationRecord = { id: '00000000-0000-4000-8000-0000000000e1', organizationId: ORG, paymentId: p.id, receivableId: r.id, amountMinor: 3_000n, createdAt: p.createdAt };
    const sources = { receivables: [r], credits: [], payments: [p], allocations: [a], installments: [], charges: [] };
    const all = { limit: 50, cursor: null };
    const onProject = buildStatement(sources, { ...view, from: null, to: null, projectId: P1 }, all).lines;
    expect(onProject.filter((l) => l.paymentId === p.id).map((l) => [l.kind, l.id, l.creditMinor, l.debitMinor])).toEqual([
      ['PAYMENT', a.id, 3_000n, 0n],
      ['PAYMENT_REVERSAL', `${a.id}:reversal`, 0n, 3_000n],
    ]);
    const whole = buildStatement(sources, { ...view, from: null, to: null, projectId: null }, all).lines;
    expect(whole.filter((l) => l.paymentId === p.id).map((l) => [l.kind, l.id])).toEqual([
      ['PAYMENT', p.id],
      ['PAYMENT_REVERSAL', `${p.id}:reversal`],
    ]);
  });

  it('the cursor encodes (date, atMs, rank, id) as base64url JSON, and decodes back', () => {
    const cursor = { date: '2026-10-28', atMs: 1_793_140_200_000, rank: 3, id: '00000000-0000-4000-8000-0000000000c1:reversal' };
    const literal = 'eyJkIjoiMjAyNi0xMC0yOCIsInQiOjE3OTMxNDAyMDAwMDAsInIiOjMsImlkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMGMxOnJldmVyc2FsIn0';
    expect(encodeStatementCursor(cursor)).toBe(literal);
    expect(decodeStatementCursor(literal)).toEqual(cursor);
  });
});
