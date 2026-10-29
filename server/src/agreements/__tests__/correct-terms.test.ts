import { describe, expect, it } from 'vitest';
import type { PaymentTerms } from '../../dates.js';
import { computeVat, type PricingBasis, type VatTreatment } from '../../vat.js';
import { planCorrection, type CorrectionInput, type CorrectionTerms, type LiveAllocation, type MovedPayment, type OldLine, type OldReceivable } from '../correct-terms.js';
import { splitInstallments, type InstallmentSpec, type ScheduledInstallment, type TriggerType } from '../schedule.js';

/**
 * MUT-444: the pure planner behind correcting an agreement's terms after posting. Minor units are agorot; 1800 bp = 18 %.
 * Today is 2026-10-29; the agreement is dated 2026-10-01.
 */
const RATE = 1800;
const TODAY = '2026-10-29';

type Trigger = { type: TriggerType; date?: string };
type Spec = { label?: string; amount: bigint; trigger: Trigger; vatTreatment?: VatTreatment; paymentTerms?: PaymentTerms; dueDate?: string };

function terms(over: Partial<CorrectionTerms> = {}): CorrectionTerms {
  return { amountMinor: 100_000n, pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'STANDARD_RATED', paymentTerms: 'EOM', vatRateBasisPoints: RATE, ...over };
}

function schedule(t: CorrectionTerms, specs: Spec[]): ScheduledInstallment[] {
  const input: InstallmentSpec[] = specs.map((s, i) => ({ label: s.label ?? `L${i + 1}`, amount: s.amount, vatTreatment: s.vatTreatment, trigger: s.trigger, paymentTerms: s.paymentTerms, dueDate: s.dueDate }));
  const result = splitInstallments({ amountMinor: specs.reduce((a, s) => a + s.amount, 0n), pricingBasis: t.pricingBasis, defaultTreatment: t.vatTreatment, rateBasisPoints: t.vatRateBasisPoints, installments: input });
  if (!result.ok) throw new Error(result.error.reason);
  return result.items;
}

let ids = 0;
const id = (p: string) => `${p}-${String(++ids).padStart(4, '0')}`;

/** An old live line, posted when `posted` is given (with prior credits, if any, at the receivable's own rate). */
function line(t: CorrectionTerms, position: number, amount: bigint, trigger: Trigger, posted?: { postingDate: string; dueDate?: string; paid?: bigint; prior?: bigint; number?: string }, over: Partial<OldLine> = {}): OldLine {
  const treatment = over.vatTreatment ?? t.vatTreatment;
  const vat = computeVat({ amountMinor: amount, pricingBasis: t.pricingBasis, treatment, rateBasisPoints: t.vatRateBasisPoints });
  const prior = posted?.prior ?? 0n;
  const priorNet = prior === 0n ? 0n : (vat.vatMinor === 0n ? prior : computeVat({ amountMinor: prior, pricingBasis: 'VAT_INCLUSIVE', treatment, rateBasisPoints: t.vatRateBasisPoints }).netMinor);
  const receivable: OldReceivable | null = posted
    ? { id: id('rec'), version: 3, number: posted.number ?? `CHG-2026-${String(position).padStart(4, '0')}`, postingDate: posted.postingDate, dueDate: posted.dueDate ?? '2026-10-31', grossMinor: vat.grossMinor, netMinor: vat.netMinor, vatMinor: vat.vatMinor, paidMinor: posted.paid ?? 0n, creditedMinor: prior, priorCredit: { amountMinor: prior, netMinor: priorNet, vatMinor: prior - priorNet } }
    : null;
  return { id: id('inst'), version: 2, position, label: `L${position}`, amountMinor: amount, netMinor: vat.netMinor, vatMinor: vat.vatMinor, grossMinor: vat.grossMinor, vatTreatment: treatment, triggerType: trigger.type, triggerDate: trigger.date ?? null, paymentTerms: null, dueDateOverride: null, receivable, ...over };
}

function pay(receivedOn: string, createdAtMs = 0, allocatedMinor = 0n): MovedPayment {
  return { id: id('pay'), number: `PAY-2026-${String(ids).padStart(4, '0')}`, receivedOn, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, 0, createdAtMs)), allocatedMinor };
}

const alloc = (p: MovedPayment, r: OldReceivable, amountMinor: bigint): LiveAllocation => ({ id: id('alloc'), paymentId: p.id, receivableId: r.id, amountMinor });

function input(over: Partial<CorrectionInput> & Pick<CorrectionInput, 'old' | 'scheduled'>): CorrectionInput {
  return { agreementDate: '2026-10-01', before: terms(), after: terms(), allocations: [], payments: [], nextPosition: 3, today: TODAY, ...over };
}

function ok(result: ReturnType<typeof planCorrection>) {
  if (!result.ok) throw new Error(`expected a plan, got ${result.reason}`);
  return result;
}

const sum = (xs: readonly bigint[]) => xs.reduce((a, x) => a + x, 0n);

describe('planCorrection: AC1 shape', () => {
  it('one posted VAT-inclusive line made exclusive: credited in full on its own date, reposted with the new gross on that date', () => {
    const before = terms({ amountMinor: 100_000n });
    const after = terms({ amountMinor: 100_000n, pricingBasis: 'VAT_EXCLUSIVE' });
    const old = [line(before, 1, 100_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    const plan = ok(planCorrection(input({ before, after, old, scheduled: schedule(after, [{ amount: 100_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.credits).toEqual([{ receivableId: old[0]!.receivable!.id, amountMinor: 100_000n, netMinor: 84_746n, vatMinor: 15_254n, effectiveDate: '2026-10-01', priorCreditedMinor: 0n }]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ position: 3, post: { postingDate: '2026-10-01', dueDate: '2026-10-31' }, scheduled: { netMinor: 100_000n, vatMinor: 18_000n, grossMinor: 118_000n } });
    expect(plan.voids).toEqual([{ id: old[0]!.id, expectedVersion: 2, receivableId: old[0]!.receivable!.id }]);
    expect(plan.figures).toMatchObject({ effectiveBeforeMinor: 100_000n, effectiveAfterMinor: 118_000n, balanceChangeMinor: 18_000n, outstandingBeforeMinor: 100_000n, outstandingAfterMinor: 118_000n });
  });

  it('50/50 with the second line unposted: the first reposts, the second is replaced and not billed', () => {
    const before = terms();
    const after = terms({ pricingBasis: 'VAT_EXCLUSIVE' });
    const old = [line(before, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' }), line(before, 2, 50_000n, { type: 'MANUAL' })];
    const plan = ok(planCorrection(input({ before, after, old, scheduled: schedule(after, [{ amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 50_000n, trigger: { type: 'MANUAL' } }]) })));
    expect(plan.lines.map((l) => [l.position, l.old?.id ?? null, l.post?.postingDate ?? null, l.scheduled.grossMinor])).toEqual([
      [3, old[0]!.id, '2026-10-01', 59_000n],
      [4, old[1]!.id, null, 59_000n],
    ]);
    expect(plan.voids.map((v) => v.id)).toEqual([old[0]!.id, old[1]!.id]);
    expect(plan.credits).toHaveLength(1);
    expect(plan.figures).toMatchObject({ effectiveBeforeMinor: 100_000n, effectiveAfterMinor: 118_000n, balanceChangeMinor: 9_000n });
  });
});

describe('planCorrection: VAT treatment', () => {
  it('STANDARD → EXEMPT keeps the gross on a VAT-inclusive fee and the balance does not move; and back', () => {
    const standard = terms({ amountMinor: 10_000n });
    const exempt = terms({ amountMinor: 10_000n, vatTreatment: 'EXEMPT' });
    const old = [line(standard, 1, 10_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    const toExempt = ok(planCorrection(input({ before: standard, after: exempt, old, scheduled: schedule(exempt, [{ amount: 10_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(toExempt.lines[0]!.scheduled).toMatchObject({ netMinor: 10_000n, vatMinor: 0n, grossMinor: 10_000n, vatTreatment: 'EXEMPT' });
    expect(toExempt.credits[0]).toMatchObject({ amountMinor: 10_000n, netMinor: 8_475n, vatMinor: 1_525n });
    expect(toExempt.figures.balanceChangeMinor).toBe(0n);

    const back = [line(exempt, 1, 10_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    const toStandard = ok(planCorrection(input({ before: exempt, after: standard, old: back, scheduled: schedule(standard, [{ amount: 10_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(toStandard.lines[0]!.scheduled).toMatchObject({ netMinor: 8_475n, vatMinor: 1_525n, grossMinor: 10_000n });
    expect(toStandard.credits[0]).toMatchObject({ amountMinor: 10_000n, netMinor: 10_000n, vatMinor: 0n });
  });

  it('a line-level override is a change; the schedule carries its own treatment', () => {
    const t = terms();
    const old = [line(t, 1, 100_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    const plan = ok(planCorrection(input({ before: t, after: t, old, scheduled: schedule(t, [{ amount: 100_000n, trigger: { type: 'IMMEDIATE' }, vatTreatment: 'ZERO_RATED' }]) })));
    expect(plan.lines[0]!.scheduled).toMatchObject({ vatTreatment: 'ZERO_RATED', vatMinor: 0n, grossMinor: 100_000n });
  });
});

describe('planCorrection: D2, posted lines keep their count and triggers', () => {
  const t = terms();
  const old = () => [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' }), line(t, 2, 50_000n, { type: 'DATE', date: '2026-10-15' }, { postingDate: '2026-10-15' }), line(t, 3, 0n + 20_000n, { type: 'MANUAL' })];

  it('a posted line whose trigger changed is POSTED_INSTALLMENT_CHANGED TRIGGER at its position', () => {
    const result = planCorrection(input({ old: old(), scheduled: schedule(t, [{ amount: 50_000n, trigger: { type: 'MANUAL' } }, { amount: 50_000n, trigger: { type: 'DATE', date: '2026-10-15' } }, { amount: 20_000n, trigger: { type: 'MANUAL' } }]) }));
    expect(result).toEqual({ ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: 1, change: 'TRIGGER' });
  });

  it('a DATE trigger on another date is a change', () => {
    const result = planCorrection(input({ old: old(), scheduled: schedule(t, [{ amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 50_000n, trigger: { type: 'DATE', date: '2026-10-16' } }, { amount: 20_000n, trigger: { type: 'MANUAL' } }]) }));
    expect(result).toEqual({ ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: 2, change: 'TRIGGER' });
  });

  it('fewer lines than the posted ones is REMOVED at the first missing posted position', () => {
    const result = planCorrection(input({ old: old(), scheduled: schedule(t, [{ amount: 120_000n, trigger: { type: 'IMMEDIATE' } }]) }));
    expect(result).toEqual({ ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: 2, change: 'REMOVED' });
  });

  it('an unposted line may change its trigger, and extra lines are allowed', () => {
    const plan = ok(planCorrection(input({ old: old(), scheduled: schedule(t, [{ amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 50_000n, trigger: { type: 'DATE', date: '2026-10-15' } }, { amount: 10_000n, trigger: { type: 'DATE', date: '2026-12-01' } }, { amount: 10_000n, trigger: { type: 'MANUAL' } }]) })));
    expect(plan.lines.map((l) => [l.position, l.old?.position ?? null, l.post?.postingDate ?? null])).toEqual([
      [3, 1, '2026-10-01'],
      [4, 2, '2026-10-15'],
      [5, 3, null],
      [6, null, null],
    ]);
  });

  it('an unposted line turned IMMEDIATE posts today; one turned to a past DATE posts on its date', () => {
    const plan = ok(planCorrection(input({ old: old(), scheduled: schedule(t, [{ amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 50_000n, trigger: { type: 'DATE', date: '2026-10-15' } }, { amount: 10_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 10_000n, trigger: { type: 'DATE', date: '2026-10-20' } }]) })));
    expect(plan.lines[2]!.post).toEqual({ postingDate: TODAY, dueDate: '2026-10-31' });
    expect(plan.lines[3]!.post).toEqual({ postingDate: '2026-10-20', dueDate: '2026-10-31' });
  });
});

describe('planCorrection: contingency upfront', () => {
  it('0 → X posts the new IMMEDIATE upfront today; X → 0 credits the posted upfront and posts nothing', () => {
    const t = terms({ amountMinor: 0n });
    const up = terms({ amountMinor: 20_000n });
    const fromZero = ok(planCorrection(input({ before: t, after: up, old: [], scheduled: schedule(up, [{ amount: 20_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(fromZero.lines[0]!.post).toEqual({ postingDate: TODAY, dueDate: '2026-10-31' });
    expect(fromZero.figures.balanceChangeMinor).toBe(20_000n);

    const old = [line(up, 1, 20_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    // With no upfront there are no lines at all, so the posted one is REMOVED (D2): an upfront once billed can't be dropped here.
    expect(planCorrection(input({ before: up, after: t, old, scheduled: [] }))).toEqual({ ok: false, reason: 'POSTED_INSTALLMENT_CHANGED', position: 1, change: 'REMOVED' });
    const unposted = [line(up, 1, 20_000n, { type: 'MANUAL' })];
    const toZero = ok(planCorrection(input({ before: up, after: t, old: unposted, scheduled: [] })));
    expect(toZero).toMatchObject({ lines: [], credits: [], voids: [{ id: unposted[0]!.id }] });
  });
});

describe('planCorrection: D3, credits already on an old charge are absorbed', () => {
  it('credits the remainder with exact net and VAT complements, and a fully credited receivable gets no row', () => {
    const t = terms();
    const partly = line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01', prior: 11_800n });
    const fully = line(t, 2, 50_000n, { type: 'DATE', date: '2026-10-10' }, { postingDate: '2026-10-10', prior: 50_000n });
    const after = terms({ amountMinor: 120_000n });
    const plan = ok(planCorrection(input({ old: [partly, fully], after, scheduled: schedule(after, [{ amount: 60_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 60_000n, trigger: { type: 'DATE', date: '2026-10-10' } }]) })));
    const r = partly.receivable!;
    expect(plan.credits).toEqual([{ receivableId: r.id, amountMinor: 50_000n - 11_800n, netMinor: r.netMinor - r.priorCredit.netMinor, vatMinor: r.vatMinor - r.priorCredit.vatMinor, effectiveDate: '2026-10-01', priorCreditedMinor: 11_800n }]);
    expect(plan.figures.priorCreditedMinor).toBe(61_800n);
    // Δ balance = new posted gross − (old gross − prior credits).
    expect(plan.figures.balanceChangeMinor).toBe(120_000n - (100_000n - 61_800n));
    expect(plan.figures.effectiveBeforeMinor).toBe(100_000n - 61_800n);
  });
});

describe('planCorrection: payments move oldest first (AC2)', () => {
  it('two payments on two old charges land oldest first on the new charges', () => {
    const t = terms();
    const old = [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01', paid: 30_000n }), line(t, 2, 50_000n, { type: 'DATE', date: '2026-10-10' }, { postingDate: '2026-10-10', dueDate: '2026-11-30', paid: 20_000n })];
    const later = pay('2026-10-20');
    const earlier = pay('2026-10-05');
    const allocations = [alloc(later, old[1]!.receivable!, 20_000n), alloc(earlier, old[0]!.receivable!, 30_000n)];
    const after = terms({ amountMinor: 40_000n });
    const plan = ok(planCorrection(input({ old, after, allocations, payments: [later, earlier], scheduled: schedule(after, [{ amount: 20_000n, trigger: { type: 'IMMEDIATE' } }, { amount: 20_000n, trigger: { type: 'DATE', date: '2026-10-10' } }]) })));
    expect(plan.moves.map((m) => [m.paymentId, m.releasedMinor, m.placed.map((p) => [p.line, p.amountMinor]), m.unallocatedMinor])).toEqual([
      [earlier.id, 30_000n, [[0, 20_000n], [1, 10_000n]], 0n],
      [later.id, 20_000n, [[1, 10_000n]], 10_000n],
    ]);
    expect(plan.releases.map((x) => x.amountMinor).sort()).toEqual([20_000n, 30_000n]);
  });

  it('one payment splits across two new charges; a lower fee leaves money unallocated', () => {
    const t = terms();
    const old = [line(t, 1, 100_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01', paid: 100_000n })];
    const p = pay('2026-10-05');
    const after = terms({ amountMinor: 60_000n });
    const plan = ok(planCorrection(input({ old, after, allocations: [alloc(p, old[0]!.receivable!, 100_000n)], payments: [p], scheduled: schedule(after, [{ amount: 60_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.moves).toEqual([expect.objectContaining({ paymentId: p.id, releasedMinor: 100_000n, placed: [{ paymentId: p.id, line: 0, amountMinor: 60_000n }], unallocatedMinor: 40_000n })]);
    expect(plan.figures).toMatchObject({ outstandingBeforeMinor: 0n, outstandingAfterMinor: 0n, unallocatedDeltaMinor: 40_000n, balanceChangeMinor: -40_000n });
  });

  it('a payment split between this agreement and another: only the part on this agreement moves (R16)', () => {
    const t = terms();
    const old = [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01', paid: 10_000n })];
    const p = pay('2026-10-05', 0, 30_000n);
    // The planner only ever sees allocations on this agreement's old receivables: the other 20,000 stays where it is.
    const plan = ok(planCorrection(input({ old, after: terms({ amountMinor: 50_000n, pricingBasis: 'VAT_EXCLUSIVE' }), allocations: [alloc(p, old[0]!.receivable!, 10_000n)], payments: [p], scheduled: schedule(terms({ pricingBasis: 'VAT_EXCLUSIVE' }), [{ amount: 50_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.moves).toEqual([expect.objectContaining({ releasedMinor: 10_000n, placed: [expect.objectContaining({ amountMinor: 10_000n })], unallocatedMinor: 0n })]);
  });

  it('a payment with no row on an old receivable is not moved', () => {
    const t = terms();
    const old = [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' })];
    const stranger = pay('2026-10-05');
    const plan = ok(planCorrection(input({ old, after: terms({ amountMinor: 60_000n }), payments: [stranger], scheduled: schedule(t, [{ amount: 60_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.moves).toEqual([]);
  });

  it('same receivedOn: the earlier created moves first', () => {
    const t = terms();
    const old = [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01', paid: 50_000n })];
    const second = pay('2026-10-05', 2);
    const first = pay('2026-10-05', 1);
    const after = terms({ amountMinor: 30_000n });
    const plan = ok(planCorrection(input({ old, after, allocations: [alloc(second, old[0]!.receivable!, 25_000n), alloc(first, old[0]!.receivable!, 25_000n)], payments: [second, first], scheduled: schedule(after, [{ amount: 30_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.moves.map((m) => [m.paymentId, m.unallocatedMinor])).toEqual([[first.id, 0n], [second.id, 20_000n]]);
  });
});

describe('planCorrection: due dates and no-ops', () => {
  it('due dates follow the posting date and the corrected terms (aging is kept)', () => {
    const t = terms();
    const old = [line(t, 1, 100_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-09-10' })];
    const after = terms({ paymentTerms: 'EOM_30' });
    const plan = ok(planCorrection(input({ old, after, scheduled: schedule(after, [{ amount: 100_000n, trigger: { type: 'IMMEDIATE' } }]) })));
    expect(plan.lines[0]!.post).toEqual({ postingDate: '2026-09-10', dueDate: '2026-10-30' });
    const override = ok(planCorrection(input({ old, scheduled: schedule(t, [{ amount: 100_000n, trigger: { type: 'IMMEDIATE' }, dueDate: '2026-12-01' }]) })));
    expect(override.lines[0]!.post).toEqual({ postingDate: '2026-09-10', dueDate: '2026-12-01' });
  });

  it('the same terms are NOTHING_TO_CORRECT; a label change is a correction', () => {
    const t = terms();
    const old = [line(t, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' }), line(t, 2, 50_000n, { type: 'MANUAL' })];
    const same = schedule(t, [{ label: 'L1', amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { label: 'L2', amount: 50_000n, trigger: { type: 'MANUAL' } }]);
    expect(planCorrection(input({ old, scheduled: same }))).toEqual({ ok: false, reason: 'NOTHING_TO_CORRECT' });
    const relabelled = schedule(t, [{ label: 'On signing', amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { label: 'L2', amount: 50_000n, trigger: { type: 'MANUAL' } }]);
    expect(planCorrection(input({ old, scheduled: relabelled })).ok).toBe(true);
    expect(planCorrection(input({ old, after: terms({ paymentTerms: 'EOM_15' }), scheduled: same })).ok).toBe(true);
  });

  it('P2 (review): a different frozen rate is a correction, even with every other figure the same', () => {
    const zero = terms({ vatRateBasisPoints: 0 });
    const old = [line(zero, 1, 50_000n, { type: 'IMMEDIATE' }, { postingDate: '2026-10-01' }), line(zero, 2, 50_000n, { type: 'MANUAL' })];
    const same = schedule(zero, [{ label: 'L1', amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { label: 'L2', amount: 50_000n, trigger: { type: 'MANUAL' } }]);
    expect(planCorrection(input({ before: zero, after: zero, old, scheduled: same }))).toEqual({ ok: false, reason: 'NOTHING_TO_CORRECT' });
    const rated = terms();
    const resolved = schedule(rated, [{ label: 'L1', amount: 50_000n, trigger: { type: 'IMMEDIATE' } }, { label: 'L2', amount: 50_000n, trigger: { type: 'MANUAL' } }]);
    expect(planCorrection(input({ before: zero, after: rated, old, scheduled: resolved })).ok).toBe(true);
  });
});

/** A seeded PRNG (mulberry32), so a failing case is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('planCorrection: invariants over a seeded sweep', () => {
  it('holds every invariant on 2,000 random corrections', () => {
    const random = rng(444);
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
    const bases: PricingBasis[] = ['VAT_INCLUSIVE', 'VAT_EXCLUSIVE'];
    const treatments: VatTreatment[] = ['STANDARD_RATED', 'EXEMPT', 'ZERO_RATED'];
    let checked = 0;
    for (let c = 0; c < 2000; c += 1) {
      const before = terms({ pricingBasis: pick(bases), vatTreatment: pick(treatments) });
      const count = int(1, 5);
      const old: OldLine[] = [];
      for (let k = 1; k <= count; k += 1) {
        const posted = random() < 0.6;
        const amount = BigInt(int(1, 200_000));
        const trigger: Trigger = posted ? pick<Trigger>([{ type: 'IMMEDIATE' }, { type: 'DATE', date: `2026-10-${String(int(1, 28)).padStart(2, '0')}` }, { type: 'MANUAL' }]) : pick<Trigger>([{ type: 'MANUAL' }, { type: 'DATE', date: '2027-01-01' }]);
        const shell = line(before, k, amount, trigger);
        const gross = shell.grossMinor;
        const prior = random() < 0.3 ? BigInt(int(0, Number(gross))) : 0n;
        const paid = random() < 0.6 ? BigInt(int(0, Number(gross - prior))) : 0n;
        old.push(posted ? line(before, k, amount, trigger, { postingDate: trigger.date ?? `2026-0${int(1, 9)}-${String(int(10, 28))}`, paid, prior }) : shell);
      }
      const payments: MovedPayment[] = [];
      const allocations: LiveAllocation[] = [];
      for (const o of old) {
        let left = o.receivable?.paidMinor ?? 0n;
        while (left > 0n) {
          const p = payments.length > 0 && random() < 0.4 ? pick(payments) : pay(`2026-10-${String(int(1, 28)).padStart(2, '0')}`, int(0, 999));
          if (!payments.includes(p)) payments.push(p);
          const part = left > 1n && random() < 0.5 ? left / 2n : left;
          allocations.push(alloc(p, o.receivable!, part));
          left -= part;
        }
      }
      const after = terms({ pricingBasis: pick(bases), vatTreatment: pick(treatments) });
      const specs: Spec[] = old.map((o) => ({ amount: BigInt(int(1, 200_000)), trigger: o.receivable ? { type: o.triggerType, ...(o.triggerDate ? { date: o.triggerDate } : {}) } : pick<Trigger>([{ type: 'MANUAL' }, { type: 'IMMEDIATE' }]) }));
      for (let extra = int(0, 2); extra > 0; extra -= 1) specs.push({ amount: BigInt(int(1, 50_000)), trigger: { type: 'MANUAL' } });
      const result = planCorrection(input({ before, after, old, allocations, payments, scheduled: schedule(after, specs) }));
      if (!result.ok) {
        expect(result.reason).toBe('NOTHING_TO_CORRECT');
        continue;
      }
      checked += 1;
      const plan = result;
      // Per payment: Σ placed + unallocated = Σ released.
      for (const m of plan.moves) expect(sum(m.placed.map((x) => x.amountMinor)) + m.unallocatedMinor).toBe(m.releasedMinor);
      expect(sum(plan.moves.map((m) => m.releasedMinor))).toBe(sum(allocations.map((a) => a.amountMinor)));
      // Per new receivable: placed ≤ gross, and only posted lines are paid.
      plan.lines.forEach((l, i) => {
        const placed = sum(plan.moves.flatMap((m) => m.placed.filter((x) => x.line === i).map((x) => x.amountMinor)));
        expect(placed <= l.scheduled.grossMinor).toBe(true);
        if (!l.post) expect(placed).toBe(0n);
      });
      // Each old receivable ends with paid 0 and credited equal to its gross, net and VAT.
      for (const o of old.filter((x) => x.receivable)) {
        const r = o.receivable!;
        const credit = plan.credits.find((x) => x.receivableId === r.id);
        expect(r.priorCredit.amountMinor + (credit?.amountMinor ?? 0n)).toBe(r.grossMinor);
        expect(r.priorCredit.netMinor + (credit?.netMinor ?? 0n)).toBe(r.netMinor);
        expect(r.priorCredit.vatMinor + (credit?.vatMinor ?? 0n)).toBe(r.vatMinor);
        expect(r.paidMinor - sum(plan.releases.filter((x) => x.receivableId === r.id).map((x) => x.amountMinor))).toBe(0n);
      }
      // Δ balance = Δ(posted gross − prior credits) = Δ outstanding − Δ unallocated.
      const postedOld = old.filter((x) => x.receivable).map((x) => x.receivable!);
      const postedNew = plan.lines.filter((l) => l.post).map((l) => l.scheduled.grossMinor);
      expect(plan.figures.balanceChangeMinor).toBe(sum(postedNew) - sum(postedOld.map((r) => r.grossMinor - r.priorCredit.amountMinor)));
      expect(plan.figures.balanceChangeMinor).toBe(plan.figures.outstandingAfterMinor - plan.figures.outstandingBeforeMinor - plan.figures.unallocatedDeltaMinor);
      // Every posted old line reposts on its own posting date.
      plan.lines.forEach((l) => {
        if (l.old?.receivable) expect(l.post?.postingDate).toBe(l.old.receivable.postingDate);
      });
    }
    expect(checked).toBeGreaterThan(1900);
  });
});
