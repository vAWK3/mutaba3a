import { randomUUID } from 'node:crypto';
import type { IsoDate, PaymentTerms } from '../dates.js';
import { formatMoney, type Currency } from '../money.js';
import type { CreditReasonCode } from '../payments/credit.js';
import type { AgreementRecord, CorrectAgreementInput, CreditRecord, InstallmentRecord, LedgerStore, Organization, ReceivableRecord } from '../repositories/ports.js';
import { bucketize, unallocatedOf } from '../summaries/compute.js';
import type { PricingBasis, VatTreatment } from '../vat.js';
import { installmentView, loadAgreementParties, parseAmount, resolveRate, validationError } from './compose.js';
import { composeSchedule, type PreviewBody } from './create.js';
import { planCorrection, type CorrectionPlan, type CorrectionTerms, type LiveAllocation, type MovedPayment, type OldLine } from './correct-terms.js';
import { outcomeAlreadyRecorded } from './outcome.js';
import { agreementCancelled } from './reduce-compose.js';

/**
 * MUT-444 (ADR-226): what the terms-correction preview and commit share. Checks the agreement and its parties (R9),
 * resolves the body's defaults (the agreement's own treatment and payment terms) and the frozen rate, composes the
 * corrected schedule with `composeSchedule`, reads the ledger the plan stands on (lines, old charges, their credits, the
 * live allocations on them) and plans. The token covers the resolved terms, the rate, the day and that ledger (R8).
 */

/** The wire body: the full new terms. Anything else (the date, the description, the parties, the currency) is refused by the strict schema. */
export interface CorrectTermsBody {
  amount: string;
  pricingBasis: PricingBasis;
  vatTreatment?: VatTreatment | undefined;
  paymentTerms?: PaymentTerms | undefined;
  installments: PreviewBody['installments'];
}

export interface ComposedTermsCorrection {
  plan: Extract<CorrectionPlan, { ok: true }>;
  before: CorrectionTerms;
  after: CorrectionTerms;
  totals: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint; grossMinor: bigint };
  /** Every line the agreement has, voided ones included. */
  installments: InstallmentRecord[];
  old: OldLine[];
  oldReceivables: ReceivableRecord[];
  payments: Map<string, MovedPayment>;
  tokenParts: unknown[];
}

/** Settled 3: FIXED, or CONTINGENCY before its outcome, and ACTIVE. */
export function assertCorrectable(agreement: AgreementRecord): void {
  if (agreement.type === 'RECURRING') throw validationError('NOT_FIXED', 'Correcting terms applies to fixed-fee and contingency agreements; change a retainer with POST /v1/retainers/{id}/change');
  if (agreement.status === 'CANCELLED') throw agreementCancelled();
  if (agreement.outcome !== null) throw outcomeAlreadyRecorded();
}

export async function composeCorrection(store: LedgerStore, organization: Organization, agreement: AgreementRecord, body: CorrectTermsBody, today: IsoDate): Promise<ComposedTermsCorrection> {
  assertCorrectable(agreement);
  await loadAgreementParties(store, organization, agreement.projectId);
  const currency = agreement.currency as Currency;
  const contingency = agreement.type === 'CONTINGENCY';
  const amountMinor = parseAmount(body.amount, currency);
  if (contingency ? amountMinor < 0n : amountMinor <= 0n) throw validationError('AMOUNT_INVALID', contingency ? 'the upfront (amount) must not be negative' : 'amount must be positive', { field: 'amount' });
  const vatTreatment = body.vatTreatment ?? agreement.vatTreatment;
  const paymentTerms = body.paymentTerms ?? agreement.paymentTerms;
  const rateBasisPoints = await frozenRate(store, organization, agreement, vatTreatment, body.installments.map((i) => i.vatTreatment));
  const { items, totals } = composeSchedule({ currency, amountMinor, pricingBasis: body.pricingBasis, defaultTreatment: vatTreatment, rateBasisPoints, installments: body.installments, contingency, agreementDate: agreement.agreementDate, paymentTerms, today });

  // Versions before credits and allocations (as the outcome correction reads): whatever lands in between moves a version the write re-checks.
  const installments = await store.agreements.listInstallments(organization.id, agreement.id);
  const live = installments.filter((i) => i.voidedAt === null && !i.isCommission);
  const oldReceivables = await store.receivables.getByIds(organization.id, live.map((i) => i.receivableId).filter((id): id is string => id !== null));
  const credits = new Map<string, CreditRecord[]>(await Promise.all(oldReceivables.map(async (r) => [r.id, await store.receivables.listCredits(organization.id, r.id)] as const)));
  const rows = await store.payments.listLiveAllocationsOn(organization.id, oldReceivables.map((r) => r.id));
  const payments = new Map<string, MovedPayment>(rows.map(({ payment: p }) => [p.id, { id: p.id, number: p.number, receivedOn: p.receivedOn, createdAt: p.createdAt, allocatedMinor: p.allocatedMinor }]));
  const allocations: LiveAllocation[] = rows.map(({ allocation: a }) => ({ id: a.id, paymentId: a.paymentId, receivableId: a.receivableId, amountMinor: a.amountMinor }));

  const receivableOf = new Map(oldReceivables.map((r) => [r.id, r]));
  const old: OldLine[] = live.map((i) => {
    const r = i.receivableId ? receivableOf.get(i.receivableId) : undefined;
    const prior = credits.get(r?.id ?? '') ?? [];
    return {
      ...i,
      receivable: r ? { ...r, priorCredit: { amountMinor: sum(prior.map((c) => c.amountMinor)), netMinor: sum(prior.map((c) => c.netMinor)), vatMinor: sum(prior.map((c) => c.vatMinor)) } } : null,
    };
  });
  const before: CorrectionTerms = { amountMinor: agreement.amountMinor, pricingBasis: agreement.pricingBasis, vatTreatment: agreement.vatTreatment, paymentTerms: agreement.paymentTerms, vatRateBasisPoints: agreement.vatRateBasisPoints };
  const after: CorrectionTerms = { amountMinor, pricingBasis: body.pricingBasis, vatTreatment, paymentTerms, vatRateBasisPoints: rateBasisPoints };
  const plan = planCorrection({ agreementDate: agreement.agreementDate, before, after, scheduled: items, old, allocations, payments: [...payments.values()], nextPosition: Math.max(0, ...installments.map((i) => i.position)) + 1, today });
  if (!plan.ok) {
    if (plan.reason === 'NOTHING_TO_CORRECT') throw validationError(plan.reason, 'This correction changes nothing on the agreement');
    throw validationError(plan.reason, plan.change === 'REMOVED' ? `Line ${plan.position} has been billed and can't be removed; keep it and change its figures` : `Line ${plan.position} has been billed; its trigger can't change (a trigger fix is not available yet)`, { position: plan.position, change: plan.change });
  }

  const tokenParts = [
    organization.id,
    'agreement-correct',
    agreement.id,
    agreement.version,
    today,
    { amount: amountMinor, pricingBasis: body.pricingBasis, vatTreatment, paymentTerms, installments: items },
    rateBasisPoints,
    [...installments].sort(byId).map((i) => [i.id, i.version, i.receivableId, i.voidedAt?.toISOString() ?? null]),
    [...oldReceivables].sort(byId).map((r) => [r.id, r.version]),
    [...new Map(rows.map(({ payment: p }) => [p.id, p])).values()].sort(byId).map((p) => [p.id, p.receivedOn, p.status, p.allocatedMinor]),
  ];
  return { plan, before, after, totals, installments, old, oldReceivables, payments, tokenParts };
}

/**
 * Settled 2 (R9): the agreement's frozen rate. The one exception: it froze 0 (no rate existed at creation) and a
 * corrected line is STANDARD_RATED, so the rate in force on the agreement date is resolved, or 422 VAT_RATE_MISSING.
 */
async function frozenRate(store: LedgerStore, organization: Organization, agreement: AgreementRecord, treatment: VatTreatment, overrides: ReadonlyArray<VatTreatment | undefined>): Promise<number> {
  const needed = treatment === 'STANDARD_RATED' || overrides.includes('STANDARD_RATED');
  if (agreement.vatRateBasisPoints !== 0 || !needed) return agreement.vatRateBasisPoints;
  return resolveRate(store, organization.id, agreement.agreementDate, treatment, overrides);
}

/** The store write for a composed correction (D6, R12: the CORRECTION row's fields). */
export function correctionWrite(c: ComposedTermsCorrection, agreement: AgreementRecord, reason: { reasonCode: CreditReasonCode; note: string | null }, today: IsoDate, requestId: string | null): CorrectAgreementInput {
  const ids = c.plan.lines.map(() => randomUUID());
  const credited = sum(c.plan.credits.map((x) => x.amountMinor));
  return {
    expectedVersion: agreement.version,
    terms: { ...c.totals, pricingBasis: c.after.pricingBasis, vatTreatment: c.after.vatTreatment, paymentTerms: c.after.paymentTerms, vatRateBasisPoints: c.after.vatRateBasisPoints },
    voids: c.plan.voids,
    receivables: c.oldReceivables.map((r) => ({ id: r.id, version: r.version })),
    payments: c.plan.moves.map((m) => ({ id: m.paymentId, allocatedMinor: c.payments.get(m.paymentId)!.allocatedMinor })),
    releases: c.plan.releases,
    credits: c.plan.credits.map(({ receivableId, amountMinor, netMinor, vatMinor, effectiveDate }) => ({ receivableId, amountMinor, netMinor, vatMinor, effectiveDate })),
    credit: { reason: reason.note ?? reason.reasonCode, reasonCode: reason.reasonCode, requestId },
    newInstallments: c.plan.lines.map((l, k) => ({
      id: ids[k]!,
      position: l.position,
      label: l.scheduled.label,
      amountMinor: l.scheduled.amountMinor,
      netMinor: l.scheduled.netMinor,
      vatMinor: l.scheduled.vatMinor,
      grossMinor: l.scheduled.grossMinor,
      vatTreatment: l.scheduled.vatTreatment,
      rateBasisPoints: l.scheduled.rateBasisPoints,
      triggerType: l.scheduled.trigger.type,
      triggerDate: l.scheduled.trigger.date ?? null,
      paymentTerms: l.scheduled.paymentTerms ?? null,
      dueDateOverride: l.scheduled.dueDate ?? null,
      post: l.post,
    })),
    placements: c.plan.moves.flatMap((m) => m.placed.map((p) => ({ paymentId: p.paymentId, installmentId: ids[p.line]!, amountMinor: p.amountMinor }))),
    supplement: {
      // R12: the change in the pricing basis, or 0 when the basis changed (the two figures aren't comparable).
      amountMinor: c.before.pricingBasis === c.after.pricingBasis ? c.after.amountMinor - c.before.amountMinor : 0n,
      description: reason.note,
      effectiveDate: today,
      distribution: 'CORRECTION',
      requestId,
      reasonCode: reason.reasonCode,
      // R12: REDUCTION's sign: positive when the fee went down, negative when it went up.
      appliedGrossMinor: c.plan.figures.effectiveBeforeMinor - c.plan.figures.effectiveAfterMinor,
      creditedMinor: credited,
    },
  };
}

export interface CustomerFigures {
  outstandingMinor: bigint;
  unallocatedMinor: bigint;
}

/** The customer summary's own figures in one currency (`bucketize`, `unallocatedOf`), so AC1's balance is the statement's. */
export async function customerFigures(store: LedgerStore, organizationId: string, customerId: string, currency: string, today: IsoDate): Promise<CustomerFigures> {
  const receivables: ReceivableRecord[] = [];
  for (let cursor = null as Parameters<LedgerStore['receivables']['list']>[2]['cursor']; ; ) {
    const page = await store.receivables.list(organizationId, { customerId, currency }, { limit: 200, cursor });
    receivables.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const payments = [];
  for (let cursor = null as Parameters<LedgerStore['payments']['list']>[2]['cursor']; ; ) {
    const page = await store.payments.list(organizationId, { customerId, status: 'POSTED' }, { limit: 200, cursor });
    payments.push(...page.items.filter((p) => p.currency === currency));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { outstandingMinor: bucketize(receivables, today).outstanding, unallocatedMinor: unallocatedOf(payments).amount };
}

/** The preview's wire shape (also what the audit event's before/after are built from). */
export function correctionView(c: ComposedTermsCorrection, agreement: AgreementRecord, customer: CustomerFigures, today: IsoDate, previewToken: string) {
  const currency = agreement.currency as Currency;
  const money = (minor: bigint) => formatMoney({ minor, currency });
  const f = c.plan.figures;
  const numberOf = new Map(c.oldReceivables.map((r) => [r.id, r.number]));
  const receivableOf = new Map(c.oldReceivables.map((r) => [r.id, r]));
  const record = new Map(c.installments.map((i) => [i.id, i]));
  const trigger = (type: string, date: string | null | undefined) => ({ type, ...(date ? { date } : {}) });
  const termsOf = (t: CorrectionTerms, totals: { netMinor: bigint; vatMinor: bigint; grossMinor: bigint }) => ({ amount: money(t.amountMinor), net: money(totals.netMinor), vat: money(totals.vatMinor), gross: money(totals.grossMinor), pricingBasis: t.pricingBasis, vatTreatment: t.vatTreatment, paymentTerms: t.paymentTerms, vatRateBasisPoints: t.vatRateBasisPoints });
  const count = Math.max(c.old.length, c.plan.lines.length);
  const outstandingDelta = f.outstandingAfterMinor - f.outstandingBeforeMinor;
  return {
    terms: { before: termsOf(c.before, agreement), after: termsOf(c.after, c.totals) },
    installments: Array.from({ length: count }, (_, k) => {
      const o = [...c.old].sort((a, b) => a.position - b.position)[k];
      const l = c.plan.lines[k];
      const r = o?.receivable ? receivableOf.get(o.receivable.id) : undefined;
      const view = o ? installmentView(record.get(o.id)!, agreement, today, r ? { paidMinor: r.paidMinor, creditedMinor: r.creditedMinor } : undefined) : null;
      return {
        before: o ? { id: o.id, position: o.position, label: o.label, amount: money(o.amountMinor), net: money(o.netMinor), vat: money(o.vatMinor), gross: money(o.grossMinor), trigger: trigger(o.triggerType, o.triggerDate), dueDate: view!.dueDate, status: view!.status, receivableId: o.receivable?.id ?? null, receivableNumber: o.receivable?.number ?? null, postingDate: o.receivable?.postingDate ?? null } : null,
        after: l ? { label: l.scheduled.label, amount: money(l.scheduled.amountMinor), net: money(l.scheduled.netMinor), vat: money(l.scheduled.vatMinor), gross: money(l.scheduled.grossMinor), vatTreatment: l.scheduled.vatTreatment, trigger: trigger(l.scheduled.trigger.type, l.scheduled.trigger.date), dueDate: l.dueDate, postingDate: l.post?.postingDate ?? null } : null,
      };
    }),
    credits: c.plan.credits.map((x) => ({ receivableId: x.receivableId, receivableNumber: numberOf.get(x.receivableId)!, effectiveDate: x.effectiveDate, amount: money(x.amountMinor), net: money(x.netMinor), vat: money(x.vatMinor), priorCredited: money(x.priorCreditedMinor) })),
    allocations: c.plan.moves.map((m) => ({
      paymentId: m.paymentId,
      paymentNumber: c.payments.get(m.paymentId)!.number,
      receivedOn: c.payments.get(m.paymentId)!.receivedOn,
      released: m.released.map((x) => ({ receivableId: x.receivableId, receivableNumber: numberOf.get(x.receivableId)!, amount: money(x.amountMinor) })),
      placed: m.placed.map((p) => ({ position: c.plan.lines[p.line]!.position, amount: money(p.amountMinor) })),
      unallocated: money(m.unallocatedMinor),
    })),
    agreement: { effectiveTotal: { before: money(f.effectiveBeforeMinor), after: money(f.effectiveAfterMinor) }, outstanding: { before: money(f.outstandingBeforeMinor), after: money(f.outstandingAfterMinor) } },
    customer: {
      outstanding: { before: money(customer.outstandingMinor), after: money(customer.outstandingMinor + outstandingDelta) },
      unallocated: { before: money(customer.unallocatedMinor), after: money(customer.unallocatedMinor + f.unallocatedDeltaMinor) },
      balance: { before: money(customer.outstandingMinor - customer.unallocatedMinor), after: money(customer.outstandingMinor - customer.unallocatedMinor + f.balanceChangeMinor) },
    },
    balanceChange: money(f.balanceChangeMinor),
    priorCredited: money(f.priorCreditedMinor),
    previewToken,
  };
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((a, v) => a + v, 0n);
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
