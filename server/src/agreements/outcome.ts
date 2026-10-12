import { compareIsoDates, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { formatMoney, type Currency } from '../money.js';
import { previewToken } from '../preview-token.js';
import type { AgreementRecord, CreateInstallmentInput, CreditRecord, InstallmentRecord, JsonObject, LedgerStore, Organization, ReceivableRecord } from '../repositories/ports.js';
import { computeVat } from '../vat.js';
import { assertIsoDate, assertNotAbsurdDate, installmentDueDate, parseAmount, resolveRate, validationError } from './compose.js';
import { COMMISSION_RATE_RULE, commissionMinor, isCommissionRate, planOutcome, upfrontCountedMinor, type ContingencyOutcome, type OutcomePlan, type UpfrontTreatment } from './contingency.js';

/**
 * Composition for a contingency outcome (MUT-100 plan §4): validates the
 * request against the agreement, computes the bill from the pure plan, builds
 * the commission installment, and mints the preview token over everything the
 * bill depends on — the body, the agreement version, the VAT rate on the
 * outcome date, the counted upfront, the commission and the billable amount,
 * and, for a correction, the replaced receivable's version (eng review D4).
 * A credit or payment that changes any of them makes the commit PREVIEW_STALE,
 * so what posts is always what was previewed.
 */
export type OutcomeMode = 'RECORD' | 'CORRECT';

export interface OutcomeBody {
  outcome: ContingencyOutcome;
  awardedAmount?: string | undefined;
  outcomeDate: string;
  note?: string | undefined;
  commissionLabel?: string | undefined;
  dueDate?: string | undefined;
  commissionRateBasisPoints?: number | undefined;
  upfrontTreatment?: UpfrontTreatment | undefined;
  correctionReason?: string | undefined;
}

export type ComposedOutcome = Awaited<ReturnType<typeof composeOutcome>>;

const conflict = (reason: string, message: string, extra: Record<string, unknown> = {}) => new ApiError('CONFLICT', message, { reason, ...extra });

/** A contingency agreement that is still ACTIVE; anything else is refused before any figure is computed. */
export function assertActiveContingency(agreement: AgreementRecord): { rate: number; treatment: UpfrontTreatment } {
  if (agreement.type !== 'CONTINGENCY' || agreement.commissionRateBasisPoints === null || agreement.upfrontTreatment === null) {
    throw validationError('NOT_CONTINGENCY', 'Only a contingency agreement has contingency terms and an outcome');
  }
  if (agreement.status === 'CANCELLED') throw conflict('AGREEMENT_CANCELLED', 'The agreement is cancelled');
  return { rate: agreement.commissionRateBasisPoints, treatment: agreement.upfrontTreatment };
}

export async function composeOutcome(store: LedgerStore, organization: Organization, agreement: AgreementRecord, body: OutcomeBody, mode: OutcomeMode, today: IsoDate) {
  const current = assertActiveContingency(agreement);
  if (mode === 'RECORD' && agreement.outcome !== null) throw conflict('OUTCOME_ALREADY_RECORDED', 'An outcome is already recorded; correct it with POST /v1/agreements/{agreementId}/outcome/correct');
  if (mode === 'CORRECT' && agreement.outcome === null) throw conflict('OUTCOME_NOT_RECORDED', 'No outcome is recorded yet; record one with POST /v1/agreements/{agreementId}/outcome');
  if (mode === 'RECORD' && (body.commissionRateBasisPoints !== undefined || body.upfrontTreatment !== undefined)) {
    throw conflict('OUTCOME_NOT_RECORDED', 'Before an outcome, terms change with PATCH /v1/agreements/{agreementId}/contingency; only a correction carries new terms');
  }
  const rate = body.commissionRateBasisPoints ?? current.rate;
  const treatment = body.upfrontTreatment ?? current.treatment;
  if (!isCommissionRate(rate)) throw validationError('COMMISSION_RATE_INVALID', COMMISSION_RATE_RULE, { field: 'commissionRateBasisPoints' });

  const outcomeDate = assertIsoDate(body.outcomeDate, 'outcomeDate');
  if (compareIsoDates(outcomeDate, agreement.agreementDate) < 0 || compareIsoDates(outcomeDate, today) > 0) {
    throw validationError('OUTCOME_DATE_INVALID', `outcomeDate must fall between the agreement date (${agreement.agreementDate}) and today (${today})`, { field: 'outcomeDate' });
  }
  const awardedMinor = awardOf(body, agreement.currency as Currency);
  if (body.dueDate !== undefined) assertNotAbsurdDate(assertIsoDate(body.dueDate, 'dueDate'), today, 'dueDate');

  const installments = await store.agreements.listInstallments(organization.id, agreement.id);
  const live = installments.filter((i) => i.voidedAt === null);
  // One read per posted upfront line (≤ 59), issued together rather than one round trip after another.
  const upfrontReceivableIds = live.filter((i) => !i.isCommission && i.receivableId !== null).map((i) => i.receivableId as string);
  const credits = new Map<string, CreditRecord[]>(await Promise.all(upfrontReceivableIds.map(async (id) => [id, await store.receivables.listCredits(organization.id, id)] as const)));
  const counted = upfrontCountedMinor({ installments: live, creditsByReceivableId: credits, pricingBasis: agreement.pricingBasis });
  const plan = planOutcome({ outcome: body.outcome, treatment, awardedMinor, rateBasisPoints: rate, upfrontCountedMinor: counted });

  const replaced = mode === 'CORRECT' ? (live.find((i) => i.isCommission) ?? null) : null;
  const replacedReceivable = replaced?.receivableId ? await store.receivables.getById(organization.id, replaced.receivableId) : null;
  assertUnsettled(replacedReceivable, agreement.currency as Currency);

  const line = plan.billableMinor > 0n ? await commissionLine(store, organization, agreement, { plan, outcomeDate, label: body.commissionLabel ?? '', dueDate: body.dueDate ?? null, nextPosition: Math.max(0, ...installments.map((i) => i.position)) + 1 }) : null;
  const totals = totalsAfter(live, replaced, line);
  const vatRateBasisPoints = line?.rateBasisPoints ?? 0;
  const postingDate = line ? outcomeDate : null;
  const dueDate = line ? installmentDueDate(line, agreement, outcomeDate) : null;
  const tokenParts = [organization.id, 'outcome', agreement.id, agreement.version, mode, body, vatRateBasisPoints, counted, plan.commissionMinor, plan.billableMinor, replacedReceivable ? [replacedReceivable.id, replacedReceivable.version] : (replaced?.id ?? null)];
  const token = previewToken(tokenParts);

  const fmt = (minor: bigint) => formatMoney({ minor, currency: agreement.currency as Currency });
  const outcomeFigures = { outcome: body.outcome, awardedMinor, outcomeDate, rate, treatment, counted, plan, line, vatRateBasisPoints };
  return {
    mode,
    ...outcomeFigures,
    note: body.note ?? null,
    totals,
    postingDate,
    dueDate,
    replaced,
    /** Verify a commit's token against these (verifyPreviewToken, constant time). */
    tokenParts,
    wire: {
      mode,
      outcome: body.outcome,
      awarded: awardedMinor === null ? null : fmt(awardedMinor),
      outcomeDate,
      commissionRateBasisPoints: rate,
      upfrontTreatment: treatment,
      commission: fmt(plan.commissionMinor),
      upfrontCounted: fmt(counted),
      appliedUpfront: fmt(plan.appliedUpfrontMinor),
      billable: billableWire(line, fmt),
      vatRateBasisPoints,
      postingDate,
      dueDate,
      replaces: replaced ? { installmentId: replaced.id, receivableId: replaced.receivableId, gross: fmt(replaced.grossMinor) } : null,
      previewToken: token,
    },
  };
}

/** AWARDED needs a positive award and a label for the commission line; NO_RECOVERY carries no award. */
function awardOf(body: OutcomeBody, currency: Currency): bigint | null {
  if (body.outcome === 'NO_RECOVERY') {
    if (body.awardedAmount !== undefined) throw validationError('AMOUNT_INVALID', 'A NO_RECOVERY outcome carries no awardedAmount', { field: 'awardedAmount' });
    return null;
  }
  if (body.awardedAmount === undefined) throw validationError('AMOUNT_INVALID', 'awardedAmount is required for an AWARDED outcome', { field: 'awardedAmount' });
  const awardedMinor = parseAmount(body.awardedAmount, currency, 'awardedAmount');
  if (awardedMinor <= 0n) throw validationError('AMOUNT_INVALID', 'awardedAmount must be positive', { field: 'awardedAmount' });
  if (!body.commissionLabel) throw validationError('COMMISSION_LABEL_REQUIRED', 'commissionLabel (the commission line’s label) is required for an AWARDED outcome', { field: 'commissionLabel' });
  return awardedMinor;
}

/** A correction replaces the commission only while it is unpaid and uncredited (plan D2); otherwise the fix is a credit. */
function assertUnsettled(receivable: ReceivableRecord | null, currency: Currency): void {
  if (!receivable || (receivable.paidMinor === 0n && receivable.creditedMinor === 0n)) return;
  throw outcomeHasPayments(receivable.id, { paid: formatMoney({ minor: receivable.paidMinor, currency }), credited: formatMoney({ minor: receivable.creditedMinor, currency }) });
}

export function outcomeHasPayments(receivableId: string, extra: Record<string, unknown> = {}): ApiError {
  return conflict('OUTCOME_HAS_PAYMENTS', 'The commission has payments or credits; adjust it with a credit instead of a correction', { receivableId, ...extra });
}

/** The commission installment: DATE-triggered on the outcome date, VAT at the rate in force on it (ADR-059, M3 Decision 4 override). */
async function commissionLine(store: LedgerStore, organization: Organization, agreement: AgreementRecord, input: { plan: OutcomePlan; outcomeDate: IsoDate; label: string; dueDate: IsoDate | null; nextPosition: number }): Promise<CreateInstallmentInput> {
  const rateOnOutcome = await resolveRate(store, organization.id, input.outcomeDate, agreement.vatTreatment);
  const vat = computeVat({ amountMinor: input.plan.billableMinor, pricingBasis: agreement.pricingBasis, treatment: agreement.vatTreatment, rateBasisPoints: rateOnOutcome });
  return {
    position: input.nextPosition,
    label: input.label,
    amountMinor: input.plan.billableMinor,
    netMinor: vat.netMinor,
    vatMinor: vat.vatMinor,
    grossMinor: vat.grossMinor,
    vatTreatment: agreement.vatTreatment,
    rateBasisPoints: vat.rateBasisPoints,
    triggerType: 'DATE',
    triggerDate: input.outcomeDate,
    paymentTerms: null,
    dueDateOverride: input.dueDate,
    isCommission: true,
  };
}

function totalsAfter(live: readonly InstallmentRecord[], replaced: InstallmentRecord | null, line: CreateInstallmentInput | null) {
  const totals = { amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n };
  for (const i of [...live.filter((x) => x.id !== replaced?.id), ...(line ? [line] : [])]) {
    totals.amountMinor += i.amountMinor;
    totals.netMinor += i.netMinor;
    totals.vatMinor += i.vatMinor;
    totals.grossMinor += i.grossMinor;
  }
  return totals;
}

type Billed = Pick<CreateInstallmentInput, 'amountMinor' | 'netMinor' | 'vatMinor' | 'grossMinor'>;

function billableWire(line: Billed | null, fmt: (minor: bigint) => string) {
  return { amount: fmt(line?.amountMinor ?? 0n), net: fmt(line?.netMinor ?? 0n), vat: fmt(line?.vatMinor ?? 0n), gross: fmt(line?.grossMinor ?? 0n) };
}

/**
 * The figures behind a bill, for the outcome audit events (CEO C2): enough to
 * answer a dispute from one row, because the counted upfront can move later
 * when credits land. Money as decimal strings, rates as integers (R9).
 */
export function outcomeAuditFigures(c: ComposedOutcome, currency: Currency, ids: { installmentId: string | null; receivableId: string | null }): JsonObject {
  const fmt = (minor: bigint) => formatMoney({ minor, currency });
  return {
    outcome: c.outcome,
    awarded: c.awardedMinor === null ? null : fmt(c.awardedMinor),
    outcomeDate: c.outcomeDate,
    rateBasisPoints: c.rate,
    upfrontTreatment: c.treatment,
    commission: fmt(c.plan.commissionMinor),
    upfrontCounted: fmt(c.counted),
    appliedUpfront: fmt(c.plan.appliedUpfrontMinor),
    billable: billableWire(c.line, fmt),
    vatRateBasisPoints: c.vatRateBasisPoints,
    ...ids,
  };
}

/** What a correction replaces, from the stored outcome and the replaced line (the old counted upfront lives in the earlier event). */
export function priorOutcomeFigures(agreement: AgreementRecord, replaced: InstallmentRecord | null): JsonObject {
  const fmt = (minor: bigint) => formatMoney({ minor, currency: agreement.currency as Currency });
  const rate = agreement.commissionRateBasisPoints ?? 0;
  return {
    outcome: agreement.outcome,
    awarded: agreement.awardedAmountMinor === null ? null : fmt(agreement.awardedAmountMinor),
    outcomeDate: agreement.outcomeDate,
    rateBasisPoints: rate,
    upfrontTreatment: agreement.upfrontTreatment,
    commission: fmt(agreement.awardedAmountMinor === null ? 0n : commissionMinor(agreement.awardedAmountMinor, rate)),
    billable: billableWire(replaced, fmt),
  };
}
