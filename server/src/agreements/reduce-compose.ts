import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import type { CreditReasonCode } from '../payments/credit.js';
import type { AgreementRecord, InstallmentRecord, LedgerStore, ReceivableRecord, ReduceAgreementInput } from '../repositories/ports.js';
import { parseAmount, validationError } from './compose.js';
import { planReduction, type ReductionPlan } from './reduce.js';

/**
 * MUT-480: what the reduce preview and commit share. Reads the agreement's ledger as it stands (after lazy posting, R1),
 * resolves `by` or `to` against the effective total (D5), plans, and names the figures the preview token covers (E2:
 * the amount and the ledger, never the reason).
 */
export interface ReduceAmount {
  by?: string | undefined;
  to?: string | undefined;
}

export interface ComposedReduction {
  plan: Extract<ReductionPlan, { ok: true }>;
  requestedMinor: bigint;
  installments: InstallmentRecord[];
  posted: ReceivableRecord[];
  effective: { beforeMinor: bigint; afterMinor: bigint };
  outstanding: { beforeMinor: bigint; afterMinor: bigint };
  tokenParts: unknown[];
}

/** O2: the fee as it stands, = live installments' gross − what was credited on their receivables. Null for a retainer. */
export function effectiveTotalsOf(agreement: AgreementRecord, installments: readonly InstallmentRecord[], creditedByReceivable: ReadonlyMap<string, { creditedMinor: bigint }>): { creditedMinor: bigint; effectiveMinor: bigint } | null {
  if (agreement.type === 'RECURRING') return null;
  const live = installments.filter((i) => !i.voidedAt);
  const grossMinor = live.reduce((a, i) => a + i.grossMinor, 0n);
  const creditedMinor = live.reduce((a, i) => a + (i.receivableId ? (creditedByReceivable.get(i.receivableId)?.creditedMinor ?? 0n) : 0n), 0n);
  return { creditedMinor, effectiveMinor: grossMinor - creditedMinor };
}

/** FIXED and ACTIVE, else the refusal (D1). */
export function assertReducible(agreement: AgreementRecord): void {
  if (agreement.type !== 'FIXED') throw validationError('NOT_FIXED', agreement.type === 'CONTINGENCY' ? 'Lowering the fee applies to fixed-fee agreements; reduce a contingency upfront with a credit' : 'Lowering the fee applies to fixed-fee agreements; credit a retainer month instead');
  if (agreement.status === 'CANCELLED') throw new ApiError('CONFLICT', 'The agreement is cancelled', { reason: 'AGREEMENT_CANCELLED' });
}

export async function composeReduction(store: LedgerStore, organizationId: string, agreement: AgreementRecord, amount: ReduceAmount): Promise<ComposedReduction> {
  assertReducible(agreement);
  const currency = agreement.currency as Currency;
  const money = (minor: bigint) => formatMoney({ minor, currency });
  const installments = await store.agreements.listInstallments(organizationId, agreement.id);
  const live = installments.filter((i) => !i.voidedAt);
  const posted = await store.receivables.getByIds(organizationId, live.map((i) => i.receivableId).filter((id): id is string => id !== null));
  const effective = effectiveTotalsOf(agreement, installments, new Map(posted.map((r) => [r.id, r])))!.effectiveMinor;
  const requestedMinor = resolveBy(amount, currency, effective);

  const positionOf = new Map(live.filter((i) => i.receivableId).map((i) => [i.receivableId!, i.position]));
  const open = posted.filter((r) => r.status === 'OPEN' && outstandingOf(r) > 0n);
  const plan = planReduction({
    byGrossMinor: requestedMinor,
    pricingBasis: agreement.pricingBasis,
    rateBasisPoints: agreement.vatRateBasisPoints,
    unbilled: live.filter((i) => !i.receivableId),
    openReceivables: open.map((r) => ({ id: r.id, postingDate: r.postingDate, position: positionOf.get(r.id) ?? 0, outstandingMinor: outstandingOf(r), vatTreatment: r.vatTreatment, rateBasisPoints: r.vatRateBasisPoints })),
    hasPosted: posted.length > 0,
  });
  if (!plan.ok) {
    if (plan.reason === 'REDUCTION_EXCEEDS_OPEN') throw validationError(plan.reason, 'The reduction is more than is still unbilled and outstanding; money already paid is not refunded here', { unbilled: money(plan.unbilledMinor), outstanding: money(plan.outstandingMinor), maximum: money(plan.maximumMinor) });
    if (plan.reason === 'USE_CANCEL') throw validationError(plan.reason, 'Nothing is billed yet and this lowers the whole fee; cancel the agreement instead');
    throw validationError(plan.reason, 'This changes nothing: the amount is too small to lower any installment', { field: amount.by !== undefined ? 'by' : 'to' });
  }

  const creditedMinor = plan.credits.reduce((a, c) => a + c.amountMinor, 0n);
  const outstandingBefore = open.reduce((a, r) => a + outstandingOf(r), 0n);
  const tokenParts = [
    organizationId,
    'agreement-reduce',
    agreement.id,
    agreement.version,
    { by: amount.by ?? null, to: amount.to ?? null },
    [...installments].sort(byId).map((i) => [i.id, i.version, i.receivableId, i.voidedAt?.toISOString() ?? null]),
    [...posted].sort(byId).map((r) => [r.id, r.version]),
  ];
  return {
    plan,
    requestedMinor,
    installments,
    posted,
    effective: { beforeMinor: effective, afterMinor: effective - plan.appliedMinor },
    outstanding: { beforeMinor: outstandingBefore, afterMinor: outstandingBefore - creditedMinor },
    tokenParts,
  };
}

/** Exactly one of `by` (positive) or `to` (below the effective total); anything else is AMOUNT_INVALID. */
function resolveBy(amount: ReduceAmount, currency: Currency, effectiveMinor: bigint): bigint {
  if ((amount.by === undefined) === (amount.to === undefined)) throw validationError('AMOUNT_INVALID', 'Give exactly one of by or to');
  const by = amount.by !== undefined ? parseAmount(amount.by, currency, 'by') : effectiveMinor - parseAmount(amount.to!, currency, 'to');
  if (by <= 0n) throw validationError('AMOUNT_INVALID', amount.by !== undefined ? 'by must be positive' : 'to must be below the fee as it stands', { field: amount.by !== undefined ? 'by' : 'to' });
  return by;
}

/** The store write for a composed reduction (D4/O3: the supplement row in the pricing basis plus the gross figures). */
export function reductionWrite(c: ComposedReduction, agreement: AgreementRecord, reason: { reasonCode: CreditReasonCode; note: string | null }, today: string, requestId: string | null): ReduceAgreementInput {
  const byId = new Map(c.installments.map((i) => [i.id, i]));
  const voided = new Set(c.plan.voids);
  const changed = new Map(c.plan.changes.map((x) => [x.id, x]));
  const totals = { amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n };
  for (const i of c.installments) {
    if (i.voidedAt || voided.has(i.id)) continue;
    const src = changed.get(i.id) ?? i;
    totals.amountMinor += src.amountMinor;
    totals.netMinor += src.netMinor;
    totals.vatMinor += src.vatMinor;
    totals.grossMinor += src.grossMinor;
  }
  const creditedMinor = c.plan.credits.reduce((a, x) => a + x.amountMinor, 0n);
  return {
    expectedVersion: agreement.version,
    installmentUpdates: c.plan.changes.map((x) => ({ ...x, expectedVersion: byId.get(x.id)!.version })),
    voids: c.plan.voids.map((id) => ({ id, expectedVersion: byId.get(id)!.version })),
    receivables: c.posted.map((r) => ({ id: r.id, version: r.version })),
    credits: c.plan.credits,
    credit: { reason: reason.note ?? reason.reasonCode, reasonCode: reason.reasonCode, effectiveDate: today, requestId },
    supplement: { amountMinor: totals.amountMinor - agreement.amountMinor, description: reason.note, effectiveDate: today, distribution: 'REDUCTION', requestId, reasonCode: reason.reasonCode, appliedGrossMinor: c.plan.appliedMinor, creditedMinor },
    totals,
  };
}

/** The preview's wire shape (also the figures the audit event records). */
export function reductionView(c: ComposedReduction, currency: Currency, previewToken: string) {
  const money = (minor: bigint) => formatMoney({ minor, currency });
  const byId = new Map(c.installments.map((i) => [i.id, i]));
  const numberOf = new Map(c.posted.map((r) => [r.id, r.number]));
  const figures = (x: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint; grossMinor: bigint }) => ({ amount: money(x.amountMinor), net: money(x.netMinor), vat: money(x.vatMinor), gross: money(x.grossMinor) });
  const touched = [...c.plan.voids.map((id) => ({ id, after: null })), ...c.plan.changes.map((x) => ({ id: x.id, after: figures(x) }))];
  return {
    installments: touched.map(({ id, after }) => ({ id, position: byId.get(id)!.position, label: byId.get(id)!.label, before: figures(byId.get(id)!), after })).sort((a, b) => b.position - a.position),
    credits: c.plan.credits.map((x) => ({ receivableId: x.receivableId, receivableNumber: numberOf.get(x.receivableId)!, amount: money(x.amountMinor), net: money(x.netMinor), vat: money(x.vatMinor) })),
    requested: money(c.requestedMinor),
    applied: money(c.plan.appliedMinor),
    roundedBy: money(c.plan.roundedByMinor),
    outstanding: { before: money(c.outstanding.beforeMinor), after: money(c.outstanding.afterMinor) },
    effectiveTotal: { before: money(c.effective.beforeMinor), after: money(c.effective.afterMinor) },
    previewToken,
  };
}

function outstandingOf(r: ReceivableRecord): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
