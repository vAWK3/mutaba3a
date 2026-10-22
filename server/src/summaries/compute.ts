import type { ContingencyOutcome, UpfrontTreatment } from '../agreements/contingency.js';
import type { IsoDate } from '../dates.js';
import type { AgreementRecord, InstallmentRecord, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';

/**
 * Summaries (M6 brief §2–§3): every figure Malafat's banner, client list and
 * tiles show, computed here from receivables and payments so the client never
 * adds anything up. Pure BigInt arithmetic; day buckets are exact
 * (overdue / due today / not yet due in the organization timezone), so
 * `outstanding = overdue + dueToday + notYetDue` always holds.
 */
export interface Buckets {
  outstanding: bigint;
  overdue: bigint;
  dueToday: bigint;
  notYetDue: bigint;
}

export type CustomerStatus = 'SETTLED' | 'OVERDUE' | 'OUTSTANDING' | 'UP_TO_DATE';
export type FixedProjectStatus = 'PENDING' | 'OUTSTANDING' | 'PARTIALLY_PAID' | 'OVERDUE' | 'PAID_IN_FULL';
export type RetainerProjectStatus = 'UP_TO_DATE' | 'OUTSTANDING' | 'OVERDUE' | 'CANCELLED' | 'SETTLED';
export type ProjectStatus = FixedProjectStatus | RetainerProjectStatus | 'NONE';
export type ProjectKind = 'FIXED' | 'RETAINER' | 'NONE';

export const CUSTOMER_STATUSES = ['SETTLED', 'OVERDUE', 'OUTSTANDING', 'UP_TO_DATE'] as const;
export const PROJECT_STATUSES = ['NONE', 'PENDING', 'OUTSTANDING', 'PARTIALLY_PAID', 'OVERDUE', 'PAID_IN_FULL', 'UP_TO_DATE', 'CANCELLED', 'SETTLED'] as const;

export function outstandingOf(r: Pick<ReceivableRecord, 'grossMinor' | 'paidMinor' | 'creditedMinor'>): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

export function emptyBuckets(): Buckets {
  return { outstanding: 0n, overdue: 0n, dueToday: 0n, notYetDue: 0n };
}

/**
 * MUT-392 (ADR-169, eng review D2): an Owed (origin ADJUSTMENT) counts from its own date. Until that day it is work not
 * yet done: not owed, not overdue, not posted. Computed on read, so it joins every figure on its own date with no job.
 * Every other origin counts as it always has, whatever its postingDate: an IMMEDIATE installment on an agreement Malafat
 * dated ahead posts with that future postingDate (agreements/compose.ts postingDateFor) and has always counted at once.
 */
export function countsOn(r: Pick<ReceivableRecord, 'origin' | 'postingDate'>, today: IsoDate): boolean {
  return r.origin !== 'ADJUSTMENT' || r.postingDate <= today;
}

/** Day buckets over OPEN receivables (settled ones carry nothing) that count today (`countsOn`). */
export function bucketize(receivables: readonly ReceivableRecord[], today: IsoDate): Buckets {
  const b = emptyBuckets();
  for (const r of receivables) {
    if (r.status !== 'OPEN' || !countsOn(r, today)) continue;
    const o = outstandingOf(r);
    if (o <= 0n) continue;
    b.outstanding += o;
    if (r.dueDate < today) b.overdue += o;
    else if (r.dueDate === today) b.dueToday += o;
    else b.notYetDue += o;
  }
  return b;
}

export function addBuckets(a: Buckets, b: Buckets): Buckets {
  return { outstanding: a.outstanding + b.outstanding, overdue: a.overdue + b.overdue, dueToday: a.dueToday + b.dueToday, notYetDue: a.notYetDue + b.notYetDue };
}

/** Funds received and not yet applied, POSTED payments only (a reversed payment counts for nothing). */
export function unallocatedOf(payments: readonly PaymentRecord[]): { amount: bigint; count: number } {
  let amount = 0n;
  let count = 0;
  for (const p of payments) {
    if (p.status !== 'POSTED') continue;
    const u = p.amountMinor - p.allocatedMinor;
    if (u > 0n) {
      amount += u;
      count += 1;
    }
  }
  return { amount, count };
}

/** The latest received-on date among POSTED payments, or null. */
export function lastPaymentOn(payments: readonly PaymentRecord[]): IsoDate | null {
  let last: IsoDate | null = null;
  for (const p of payments) if (p.status === 'POSTED' && (last === null || p.receivedOn > last)) last = p.receivedOn;
  return last;
}

export function customerStatus(b: Buckets): CustomerStatus {
  if (b.outstanding <= 0n) return 'SETTLED';
  if (b.overdue > 0n) return 'OVERDUE';
  if (b.dueToday > 0n) return 'OUTSTANDING';
  return 'UP_TO_DATE';
}

/** MUT-100: the project's ACTIVE contingency agreement, as the summary shows it. */
export interface ProjectContingency {
  agreementId: string;
  commissionRateBasisPoints: number;
  upfrontTreatment: UpfrontTreatment;
  outcome: 'AWAITING' | ContingencyOutcome;
  awardedMinor: bigint | null;
}

export interface ProjectFigures {
  kind: ProjectKind;
  /** Fixed: the active agreement's gross total (or the latest one's when all are cancelled). */
  agreedMinor: bigint | null;
  /** Retainer: the monthly gross of the terms in force (caller supplies; null otherwise). */
  monthlyMinor: bigint | null;
  postedMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  buckets: Buckets;
  pending: { count: number; amountMinor: bigint };
  status: ProjectStatus;
  contingency: ProjectContingency | null;
}

/** Fixed-like for `kind` and `agreed` (MUT-100 D6): a contingency agreement's total is its upfront, plus the commission once billed. */
const isFixedLike = (a: Pick<AgreementRecord, 'type'>) => a.type === 'FIXED' || a.type === 'CONTINGENCY';

export function projectFigures(input: { agreements: readonly AgreementRecord[]; installments: readonly InstallmentRecord[]; receivables: readonly ReceivableRecord[]; monthlyMinor?: bigint | null; today: IsoDate }): ProjectFigures {
  // The filter here is for posted / paid / credited; bucketize applies the same rule itself for its other callers.
  const counted = input.receivables.filter((r) => countsOn(r, input.today));
  const buckets = bucketize(counted, input.today);
  let postedMinor = 0n;
  let paidMinor = 0n;
  let creditedMinor = 0n;
  for (const r of counted) {
    postedMinor += r.grossMinor;
    paidMinor += r.paidMinor;
    creditedMinor += r.creditedMinor;
  }
  const pendingItems = input.installments.filter((i) => i.receivableId === null && i.voidedAt === null);
  const pending = { count: pendingItems.length, amountMinor: pendingItems.reduce((s, i) => s + i.grossMinor, 0n) };
  const retainer = input.agreements.find((a) => a.type === 'RECURRING' && a.status === 'ACTIVE') ?? input.agreements.find((a) => a.type === 'RECURRING') ?? null;
  const fixed = input.agreements.find((a) => isFixedLike(a) && a.status === 'ACTIVE') ?? input.agreements.find(isFixedLike) ?? null;
  const contingency = contingencyOf(input.agreements);
  if (!retainer && !fixed) return { kind: 'NONE', agreedMinor: null, monthlyMinor: null, postedMinor, paidMinor, creditedMinor, buckets, pending, status: 'NONE', contingency };
  if (retainer && !fixed) {
    return { kind: 'RETAINER', agreedMinor: null, monthlyMinor: input.monthlyMinor ?? retainer.grossMinor, postedMinor, paidMinor, creditedMinor, buckets, pending, status: retainerStatus(retainer, buckets), contingency };
  }
  const agreedMinor = input.agreements.filter((a) => isFixedLike(a) && a.status === 'ACTIVE').reduce((s, a) => s + a.grossMinor, 0n) || fixed!.grossMinor;
  const awaitingOutcome = input.agreements.some((a) => a.type === 'CONTINGENCY' && a.status === 'ACTIVE' && a.outcome === null);
  return { kind: 'FIXED', agreedMinor, monthlyMinor: retainer ? (input.monthlyMinor ?? retainer.grossMinor) : null, postedMinor, paidMinor, creditedMinor, buckets, pending, status: fixedStatus(buckets, paidMinor, pending.count, postedMinor, awaitingOutcome), contingency };
}

/** A paid upfront is not "paid in full" while the commission is still to come (MUT-100). */
export function fixedStatus(b: Buckets, paidMinor: bigint, pendingCount: number, postedMinor: bigint, awaitingOutcome = false): FixedProjectStatus {
  if (b.overdue > 0n) return 'OVERDUE';
  if (b.outstanding > 0n) return paidMinor > 0n ? 'PARTIALLY_PAID' : 'OUTSTANDING';
  if (pendingCount > 0 || postedMinor === 0n || awaitingOutcome) return 'PENDING';
  return 'PAID_IN_FULL';
}

/** The latest ACTIVE contingency agreement (agreements arrive oldest first); `agreed` still sums them all. */
function contingencyOf(agreements: readonly AgreementRecord[]): ProjectContingency | null {
  const a = agreements.filter((x) => x.type === 'CONTINGENCY' && x.status === 'ACTIVE').at(-1);
  if (!a || a.commissionRateBasisPoints === null || a.upfrontTreatment === null) return null;
  return { agreementId: a.id, commissionRateBasisPoints: a.commissionRateBasisPoints, upfrontTreatment: a.upfrontTreatment, outcome: a.outcome ?? 'AWAITING', awardedMinor: a.awardedAmountMinor };
}

export function retainerStatus(agreement: Pick<AgreementRecord, 'status'>, b: Buckets): RetainerProjectStatus {
  if (agreement.status === 'CANCELLED') return b.outstanding > 0n ? 'CANCELLED' : 'SETTLED';
  if (b.overdue > 0n) return 'OVERDUE';
  if (b.dueToday > 0n) return 'OUTSTANDING';
  return 'UP_TO_DATE';
}

/** Group by a key while keeping first-seen order. */
export function groupBy<T, K extends string>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
