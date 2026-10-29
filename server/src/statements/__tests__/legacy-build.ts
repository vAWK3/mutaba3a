import type { ItemStatus } from '../../agreements/status.js';
import { daysBetween, todayIn, type IsoDate } from '../../dates.js';
import { CAPTURE_UNDO_REASON, type AllocationRecord, type CreditRecord, type PaymentRecord, type ReceivableRecord } from '../../repositories/ports.js';
import { receivableStatus } from '../../serializers.js';
import { countsOn, outstandingOf } from '../../summaries/compute.js';
import type { ChargeOrigin, StatementCursor, StatementLine, StatementLineKind, StatementPage, StatementSources, StatementView } from '../build.js';

/**
 * MUT-483 (eng review R1): a frozen copy of `statements/build.ts` as it stood before `statements/lines.ts` was
 * extracted (commit a80d998a), the line rule, the order and the paging verbatim; only `buildStatement` is renamed
 * `legacyBuildStatement` and the imports point one level up. `legacy-equivalence.test.ts` asserts the extracted builder
 * returns exactly what this one does, and `period.test.ts` checks the period totals against it, so neither the
 * extraction nor the period figures are ever proven against themselves.
 *
 * Delete this copy only when ADR-217's line rule changes on purpose.
 */

interface LineBase {
  id: string;
  kind: StatementLineKind;
  date: IsoDate;
  projectId: string | null;
  number: string | null;
  debitMinor: bigint;
  creditMinor: bigint;
  receivableId: string | null;
  paymentId: string | null;
  /** CHARGE, and the credited receivable on a CREDIT. */
  receivable: ReceivableRecord | null;
  origin: ChargeOrigin | null;
  outstandingMinor: bigint | null;
  status: ItemStatus | null;
  daysOverdue: number | null;
  /** CREDIT only. */
  credit: CreditRecord | null;
  /** PAYMENT and PAYMENT_REVERSAL. */
  payment: PaymentRecord | null;
  /** PAYMENT on the whole-customer statement: what is still to apply; null on a project statement. */
  unallocatedMinor: bigint | null;
  /** PAYMENT on a project statement: the allocation shown; null on the whole-customer one. */
  allocatedMinor: bigint | null;
}

interface SortedLine extends LineBase {
  atMs: number;
  rank: number;
}


const RANK: Record<StatementLineKind, number> = { CHARGE: 0, CREDIT: 1, PAYMENT: 2, PAYMENT_REVERSAL: 3 };

export function legacyBuildStatement(sources: StatementSources, view: StatementView, page: { limit: number; cursor: StatementCursor | null }): StatementPage {
  const lines = ledgerLines(sources, view).sort(compareLines);
  let openingMinor = 0n;
  const inPeriod: SortedLine[] = [];
  for (const line of lines) {
    if (view.from !== null && line.date < view.from) openingMinor += line.debitMinor - line.creditMinor;
    else if (view.to === null || line.date <= view.to) inPeriod.push(line);
  }
  const totals = { debitMinor: 0n, creditMinor: 0n };
  let running = openingMinor;
  const withBalance = inPeriod.map((key) => {
    totals.debitMinor += key.debitMinor;
    totals.creditMinor += key.creditMinor;
    running += key.debitMinor - key.creditMinor;
    const line: StatementLine = { ...key, runningMinor: running };
    return { line, key };
  });
  const start = page.cursor ? withBalance.findIndex((x) => compareLines(x.key, page.cursor!) > 0) : 0;
  const from = start < 0 ? withBalance.length : start;
  const slice = withBalance.slice(from, from + page.limit);
  const last = slice.at(-1)?.key;
  const more = from + page.limit < withBalance.length;
  return {
    openingMinor,
    totals,
    closingMinor: openingMinor + totals.debitMinor - totals.creditMinor,
    lines: slice.map((x) => x.line),
    nextCursor: more && last ? { date: last.date, atMs: last.atMs, rank: last.rank, id: last.id } : null,
  };
}

function ledgerLines(sources: StatementSources, view: StatementView): SortedLine[] {
  // MUT-444 (D1): a row a terms correction released is history; only live rows say where a payment went.
  const s = { ...sources, allocations: sources.allocations.filter((a) => !a.releasedAt) };
  const counted = s.receivables.filter((r) => r.deletedAt === null && countsOn(r, view.asOf) && (view.projectId === null || r.projectId === view.projectId));
  const byId = new Map(counted.map((r) => [r.id, r]));
  const lines: SortedLine[] = counted.map((r) => chargeLine(r, s, view.asOf));
  for (const c of s.credits) {
    const r = byId.get(c.receivableId);
    if (r) lines.push(line({ id: c.id, kind: 'CREDIT', date: c.effectiveDate, atMs: c.createdAt.getTime(), projectId: r.projectId, creditMinor: c.amountMinor, receivableId: r.id, receivable: r, credit: c, number: null }));
  }
  const shown = s.payments.filter((p) => p.status === 'POSTED' || (p.status === 'REVERSED' && p.reversalReason !== CAPTURE_UNDO_REASON));
  if (view.projectId === null) {
    const projectOf = new Map(s.receivables.map((r) => [r.id, r.projectId]));
    const allocationsOf = new Map<string, AllocationRecord[]>();
    for (const a of s.allocations) allocationsOf.set(a.paymentId, [...(allocationsOf.get(a.paymentId) ?? []), a]);
    for (const p of shown) lines.push(...wholePaymentLines(p, allocationsOf.get(p.id) ?? [], projectOf, view.timezone));
  } else {
    const paymentsById = new Map(shown.map((p) => [p.id, p]));
    for (const a of s.allocations) {
      const p = paymentsById.get(a.paymentId);
      if (p && byId.has(a.receivableId)) lines.push(...allocationLines(p, a, view.projectId, view.timezone));
    }
  }
  return lines;
}

function chargeLine(r: ReceivableRecord, s: StatementSources, asOf: IsoDate): SortedLine {
  const status = receivableStatus(r, asOf);
  return line({
    id: r.id,
    kind: 'CHARGE',
    date: r.postingDate,
    atMs: r.createdAt.getTime(),
    projectId: r.projectId,
    number: r.number,
    debitMinor: r.grossMinor,
    receivableId: r.id,
    receivable: r,
    origin: originOf(r, s),
    outstandingMinor: outstandingOf(r),
    status,
    daysOverdue: status === 'OVERDUE' ? daysBetween(r.dueDate, asOf) : null,
  });
}

function originOf(r: ReceivableRecord, s: StatementSources): ChargeOrigin {
  if (r.origin === 'RETAINER_CHARGE') {
    const charge = s.charges.find((c) => c.id === r.originId);
    return { type: 'RETAINER_CHARGE', agreementId: r.agreementId ?? '', serviceMonth: charge?.serviceMonth ?? r.postingDate.slice(0, 7) };
  }
  if (r.origin === 'INSTALLMENT') {
    const installment = s.installments.find((i) => i.id === r.originId);
    if (installment?.isCommission) return { type: 'CONTINGENCY_FEE', agreementId: installment.agreementId };
    // "N of M" counts the agreement's live, non-commission lines in position order, so a gap left by an edit never shows.
    // MUT-444 (R3): a charge a terms correction replaced counts within its own generation: the lines voided with it.
    const voidedAt = installment?.voidedAt?.getTime() ?? null;
    const generation = s.installments.filter((i) => i.agreementId === r.agreementId && !i.isCommission && (i.voidedAt?.getTime() ?? null) === voidedAt).sort((a, b) => a.position - b.position);
    return { type: 'INSTALLMENT', agreementId: r.agreementId ?? '', position: generation.findIndex((i) => i.id === r.originId) + 1, of: generation.length };
  }
  return { type: 'ADJUSTMENT', title: r.title };
}

/** On the whole-customer statement a payment is one line for its full amount; its matter is shown only when all of it went to one. */
function wholePaymentLines(p: PaymentRecord, own: readonly AllocationRecord[], projectOf: ReadonlyMap<string, string | null>, timezone: string): SortedLine[] {
  const projects = new Set(own.map((a) => projectOf.get(a.receivableId) ?? null));
  const allocatedEver = own.reduce((sum, a) => sum + a.amountMinor, 0n);
  const projectId = projects.size === 1 && allocatedEver === p.amountMinor ? [...projects][0]! : null;
  const posted = line({ id: p.id, kind: 'PAYMENT', date: p.receivedOn, atMs: p.createdAt.getTime(), projectId, number: p.number, creditMinor: p.amountMinor, paymentId: p.id, payment: p, unallocatedMinor: p.status === 'POSTED' ? p.amountMinor - p.allocatedMinor : 0n });
  return p.status === 'REVERSED' ? [posted, reversalLine(p, `${p.id}:reversal`, projectId, p.amountMinor, timezone)] : [posted];
}

/** On a project statement a payment is its allocations there, dated by the payment's received date (D8). */
function allocationLines(p: PaymentRecord, a: AllocationRecord, projectId: string, timezone: string): SortedLine[] {
  const posted = line({ id: a.id, kind: 'PAYMENT', date: p.receivedOn, atMs: p.createdAt.getTime(), projectId, number: p.number, creditMinor: a.amountMinor, paymentId: p.id, payment: p, allocatedMinor: a.amountMinor });
  return p.status === 'REVERSED' ? [posted, reversalLine(p, `${a.id}:reversal`, projectId, a.amountMinor, timezone)] : [posted];
}

function reversalLine(p: PaymentRecord, id: string, projectId: string | null, amountMinor: bigint, timezone: string): SortedLine {
  const reversedAt = p.reversedAt ?? p.updatedAt;
  return line({ id, kind: 'PAYMENT_REVERSAL', date: todayIn(timezone, reversedAt), atMs: reversedAt.getTime(), projectId, number: p.number, debitMinor: amountMinor, paymentId: p.id, payment: p });
}

function line(o: Partial<SortedLine> & Pick<SortedLine, 'id' | 'kind' | 'date' | 'atMs' | 'projectId' | 'number'>): SortedLine {
  return {
    debitMinor: 0n,
    creditMinor: 0n,
    receivableId: null,
    paymentId: null,
    receivable: null,
    origin: null,
    outstandingMinor: null,
    status: null,
    daysOverdue: null,
    credit: null,
    payment: null,
    unallocatedMinor: null,
    allocatedMinor: null,
    rank: RANK[o.kind],
    ...o,
  };
}

/** (date, created, kind rank, id): stable on every call (D6). */
function compareLines(a: StatementCursor, b: StatementCursor): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.atMs !== b.atMs) return a.atMs - b.atMs;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
