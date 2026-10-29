import type { IsoDate, PaymentTerms } from '../dates.js';
import { suggestAllocations, type AllocatableReceivable } from '../payments/allocate.js';
import type { PricingBasis, VatTreatment } from '../vat.js';
import { installmentDueDate, postingDateFor } from './compose.js';
import type { ScheduledInstallment, TriggerType } from './schedule.js';

/**
 * Correcting a fixed or contingency agreement's terms after posting (MUT-444, ADR-226). Pure: given the agreement's
 * live lines as they stand (with each posted line's receivable, its earlier credits and the live allocations on it)
 * and the corrected schedule at the frozen rate, plans one write:
 *
 *   every live line voided ─► every posted charge credited for its remainder, dated its own posting date (D3, D5)
 *   new lines at the next positions ─► a line matched to a posted one reposts on that line's date; any other follows
 *                                      its trigger, as a new agreement's would (D2)
 *   payments on the old charges ─► released, then placed oldest first on the new charges; the rest stays unallocated
 *
 * Posted lines keep their count and their triggers (D2): old line k that posted needs a new line k with the same
 * trigger, or the answer is POSTED_INSTALLMENT_CHANGED. Lines are matched by order, k-th to k-th.
 */

export interface CorrectionTerms {
  amountMinor: bigint;
  pricingBasis: PricingBasis;
  vatTreatment: VatTreatment;
  paymentTerms: PaymentTerms;
  vatRateBasisPoints: number;
}

export interface OldReceivable {
  id: string;
  version: number;
  number: string;
  postingDate: IsoDate;
  dueDate: IsoDate;
  grossMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  /** The credit rows already on it, summed: the correction credits exactly the complement (D3). */
  priorCredit: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint };
}

export interface OldLine {
  id: string;
  version: number;
  position: number;
  label: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
  vatTreatment: VatTreatment;
  triggerType: TriggerType;
  triggerDate: IsoDate | null;
  paymentTerms: PaymentTerms | null;
  dueDateOverride: IsoDate | null;
  receivable: OldReceivable | null;
}

/** A live allocation row of a POSTED payment on one of the old receivables. */
export interface LiveAllocation {
  id: string;
  paymentId: string;
  receivableId: string;
  amountMinor: bigint;
}

export interface MovedPayment {
  id: string;
  number: string;
  receivedOn: IsoDate;
  createdAt: Date;
  allocatedMinor: bigint;
}

export interface CorrectionInput {
  agreementDate: IsoDate;
  /** The agreement's terms as they stand, and the corrected ones (defaults filled in). */
  before: CorrectionTerms;
  after: CorrectionTerms;
  /** The corrected schedule, from `splitInstallments` at the frozen rate. */
  scheduled: readonly ScheduledInstallment[];
  /** The live, non-commission lines, any order. */
  old: readonly OldLine[];
  allocations: readonly LiveAllocation[];
  /** At least every payment `allocations` names. */
  payments: readonly MovedPayment[];
  /** The first position the new lines take: one past every line the agreement ever had. */
  nextPosition: number;
  today: IsoDate;
}

export interface PlannedLine {
  position: number;
  scheduled: ScheduledInstallment;
  /** The old line it replaces (the k-th), if any. */
  old: OldLine | null;
  /** Null: it waits for its trigger (MANUAL, a future DATE). */
  post: { postingDate: IsoDate; dueDate: IsoDate } | null;
  /** The due date it has, or would get if posted today. */
  dueDate: IsoDate;
}

export interface PlannedCorrectionCredit {
  receivableId: string;
  amountMinor: bigint;
  netMinor: bigint;
  vatMinor: bigint;
  effectiveDate: IsoDate;
  priorCreditedMinor: bigint;
}

export interface PlannedRelease {
  allocationId: string;
  paymentId: string;
  receivableId: string;
  amountMinor: bigint;
}

export interface PlannedPlacement {
  paymentId: string;
  /** Index into `lines`. */
  line: number;
  amountMinor: bigint;
}

export interface PlannedMove {
  paymentId: string;
  releasedMinor: bigint;
  released: PlannedRelease[];
  placed: PlannedPlacement[];
  unallocatedMinor: bigint;
}

export interface CorrectionFigures {
  /** Live lines' gross − credits on their receivables (MUT-480 O2), before and after. */
  effectiveBeforeMinor: bigint;
  effectiveAfterMinor: bigint;
  /** This agreement's charges' outstanding. */
  outstandingBeforeMinor: bigint;
  outstandingAfterMinor: bigint;
  /** What the moved payments no longer have allocated. */
  unallocatedDeltaMinor: bigint;
  /** AC1: new posted gross − (old posted gross − credits already on it) = Δ outstanding − Δ unallocated. */
  balanceChangeMinor: bigint;
  priorCreditedMinor: bigint;
}

export type CorrectionPlan =
  | { ok: true; lines: PlannedLine[]; voids: Array<{ id: string; expectedVersion: number; receivableId: string | null }>; credits: PlannedCorrectionCredit[]; releases: PlannedRelease[]; moves: PlannedMove[]; figures: CorrectionFigures }
  | { ok: false; reason: 'NOTHING_TO_CORRECT' }
  | { ok: false; reason: 'POSTED_INSTALLMENT_CHANGED'; position: number; change: 'TRIGGER' | 'REMOVED' };

export function planCorrection(input: CorrectionInput): CorrectionPlan {
  const old = [...input.old].sort((a, b) => a.position - b.position);
  const shape = checkShape(old, input.scheduled);
  if (shape) return shape;
  if (unchanged(input, old)) return { ok: false, reason: 'NOTHING_TO_CORRECT' };

  const lines = planLines(input, old);
  const posted = old.filter((o) => o.receivable).map((o) => o.receivable!);
  const credits = posted.flatMap((r): PlannedCorrectionCredit[] => {
    const amountMinor = r.grossMinor - r.priorCredit.amountMinor;
    return amountMinor > 0n ? [{ receivableId: r.id, amountMinor, netMinor: r.netMinor - r.priorCredit.netMinor, vatMinor: r.vatMinor - r.priorCredit.vatMinor, effectiveDate: r.postingDate, priorCreditedMinor: r.priorCredit.amountMinor }] : [];
  });
  const moves = placePayments(input, lines, new Set(posted.map((r) => r.id)));
  const releases = moves.flatMap((m) => m.released);
  const placedOn = (i: number) => sum(moves.flatMap((m) => m.placed.filter((p) => p.line === i).map((p) => p.amountMinor)));

  const postedNewGross = sum(lines.filter((l) => l.post).map((l) => l.scheduled.grossMinor));
  const priorCreditedMinor = sum(posted.map((r) => r.priorCredit.amountMinor));
  const figures: CorrectionFigures = {
    effectiveBeforeMinor: sum(old.map((o) => o.grossMinor)) - sum(posted.map((r) => r.creditedMinor)),
    effectiveAfterMinor: sum(lines.map((l) => l.scheduled.grossMinor)),
    outstandingBeforeMinor: sum(posted.map((r) => r.grossMinor - r.paidMinor - r.creditedMinor)),
    outstandingAfterMinor: sum(lines.map((l, i) => (l.post ? l.scheduled.grossMinor - placedOn(i) : 0n))),
    unallocatedDeltaMinor: sum(moves.map((m) => m.unallocatedMinor)),
    balanceChangeMinor: postedNewGross - (sum(posted.map((r) => r.grossMinor)) - priorCreditedMinor),
    priorCreditedMinor,
  };
  return { ok: true, lines, voids: old.map((o) => ({ id: o.id, expectedVersion: o.version, receivableId: o.receivable?.id ?? null })), credits, releases, moves, figures };
}

/** D2: every posted old line k keeps a new line k with the same trigger (type, and for DATE the date). */
function checkShape(old: readonly OldLine[], scheduled: readonly ScheduledInstallment[]): Extract<CorrectionPlan, { reason: 'POSTED_INSTALLMENT_CHANGED' }> | null {
  for (const [k, o] of old.entries()) {
    if (!o.receivable) continue;
    const next = scheduled[k];
    if (!next) return { ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: k + 1, change: 'REMOVED' };
    if (!sameTrigger(o, next)) return { ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: k + 1, change: 'TRIGGER' };
  }
  return null;
}

export function sameTrigger(o: Pick<OldLine, 'triggerType' | 'triggerDate'>, s: Pick<ScheduledInstallment, 'trigger'>): boolean {
  return o.triggerType === s.trigger.type && (o.triggerType !== 'DATE' || o.triggerDate === (s.trigger.date ?? null));
}

/** Settled 5: the agreement's amount, basis, treatment and terms, and each live line's figures and terms, in order. */
function unchanged(input: CorrectionInput, old: readonly OldLine[]): boolean {
  const { before: b, after: a } = input;
  if (b.amountMinor !== a.amountMinor || b.pricingBasis !== a.pricingBasis || b.vatTreatment !== a.vatTreatment || b.paymentTerms !== a.paymentTerms) return false;
  if (old.length !== input.scheduled.length) return false;
  return old.every((o, k) => {
    const s = input.scheduled[k]!;
    return o.label === s.label && o.amountMinor === s.amountMinor && o.vatTreatment === s.vatTreatment && sameTrigger(o, s) && o.paymentTerms === (s.paymentTerms ?? null) && o.dueDateOverride === (s.dueDate ?? null);
  });
}

/** D2: a line matched to a posted one reposts on its posting date; any other follows its trigger as at create. */
function planLines(input: CorrectionInput, old: readonly OldLine[]): PlannedLine[] {
  const agreement = { paymentTerms: input.after.paymentTerms };
  return input.scheduled.map((s, k) => {
    const replaced = old[k] ?? null;
    const asRecord = { triggerType: s.trigger.type, triggerDate: s.trigger.date ?? null, dueDateOverride: s.dueDate ?? null, paymentTerms: s.paymentTerms ?? null };
    const wouldPost = postingDateFor(asRecord, input.agreementDate, input.today);
    const postingDate = replaced?.receivable ? replaced.receivable.postingDate : postsNow(s, input.today) ? wouldPost : null;
    const dueDate = installmentDueDate(asRecord, agreement, postingDate ?? wouldPost);
    return { position: input.nextPosition + k, scheduled: s, old: replaced, post: postingDate ? { postingDate, dueDate } : null, dueDate };
  });
}

/** As a new agreement's line: IMMEDIATE at once, a DATE on or before today through the lazy path; MANUAL waits. */
function postsNow(s: ScheduledInstallment, today: IsoDate): boolean {
  if (s.trigger.type === 'IMMEDIATE') return true;
  return s.trigger.type === 'DATE' && s.trigger.date !== undefined && s.trigger.date <= today;
}

/** AC2: payments oldest first (receivedOn, createdAt, id), each placed OLDEST_FIRST over the new posted charges. */
function placePayments(input: CorrectionInput, lines: readonly PlannedLine[], oldIds: ReadonlySet<string>): PlannedMove[] {
  const releasedBy = new Map<string, PlannedRelease[]>();
  for (const a of input.allocations) {
    if (!oldIds.has(a.receivableId)) continue;
    releasedBy.set(a.paymentId, [...(releasedBy.get(a.paymentId) ?? []), { allocationId: a.id, paymentId: a.paymentId, receivableId: a.receivableId, amountMinor: a.amountMinor }]);
  }
  const order = input.payments.filter((p) => releasedBy.has(p.id)).sort((a, b) => (a.receivedOn !== b.receivedOn ? (a.receivedOn < b.receivedOn ? -1 : 1) : a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  const charges: AllocatableReceivable[] = lines.flatMap((l, i) => (l.post ? [{ id: keyOf(i), customerId: '', projectId: '', currency: '', dueDate: l.post.dueDate, postingDate: l.post.postingDate, grossMinor: l.scheduled.grossMinor, paidMinor: 0n, creditedMinor: 0n, status: 'OPEN' as const }] : []));
  return order.map((p) => {
    const released = releasedBy.get(p.id)!;
    const releasedMinor = sum(released.map((r) => r.amountMinor));
    const placed = suggestAllocations('OLDEST_FIRST', releasedMinor, charges.filter((c) => c.grossMinor - c.paidMinor > 0n)).map((s) => {
      const charge = charges.find((c) => c.id === s.receivableId)!;
      charge.paidMinor += s.amountMinor;
      return { paymentId: p.id, line: indexOf(s.receivableId), amountMinor: s.amountMinor };
    });
    return { paymentId: p.id, releasedMinor, released, placed, unallocatedMinor: releasedMinor - sum(placed.map((x) => x.amountMinor)) };
  });
}

/** `pos:NN` keys make the id tie-break follow the schedule's order. */
function keyOf(index: number): string {
  return `pos:${String(index).padStart(3, '0')}`;
}

function indexOf(key: string): number {
  return Number(key.slice(4));
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, v) => a + v, 0n);
}
