import { assertIsoDate, loadAgreementContext, parseAmount, retainerPreviewToken, validationError } from '../agreements/compose.js';
import { generateCharges, type PostingActor } from '../agreements/posting.js';
import { addMonths, dueDateFor } from '../dates.js';
import { ApiError } from '../errors.js';
import { formatMoney } from '../money.js';
import type { AgreementRecord, ApproveProposalInput, LedgerStore, Organization } from '../repositories/ports.js';
import { serializeAgreement, serializeCharge, serializeRetainerTerms } from '../serializers.js';
import { computeVat } from '../vat.js';
import { chargeDate, chargeMonths, validateRetainerSpec } from './schedule.js';
import { termsTimeline } from './terms.js';

/**
 * Creating a recurring retainer from a composed preview (M3 brief rev. 2 §C), shared by `POST /v1/retainers` and
 * `POST /v1/fee-proposals/{id}/approve` with a RETAINER draft (MUT-479, R2/R4): the store transaction writes the
 * agreement (and, when approving, moves the proposal to APPROVED or refuses the whole create), the creation is
 * audited, and charges whose charge date has arrived post at once.
 */

export type RetainerBody = {
  projectId: string;
  monthlyAmount: string;
  currency?: string | undefined;
  pricingBasis: 'VAT_EXCLUSIVE' | 'VAT_INCLUSIVE';
  vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined;
  startMonth: string;
  billingDay: number;
  paymentTerms: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60';
  endMonth?: string | undefined;
  agreementDate?: string | undefined;
  description?: string | undefined;
};

export type RetainerPreview = Awaited<ReturnType<typeof composeRetainerPreview>>;

export async function composeRetainerPreview(store: LedgerStore, organization: Organization, body: RetainerBody, today: string) {
  const agreementDate = body.agreementDate ?? today;
  assertIsoDate(agreementDate, 'agreementDate');
  const specError = validateRetainerSpec({ startMonth: body.startMonth, billingDay: body.billingDay, endMonth: body.endMonth });
  if (specError) throw validationError(specError.reason, `Retainer schedule is invalid: ${specError.reason}`);
  const context = await loadAgreementContext(store, organization, { projectId: body.projectId, currency: body.currency, vatTreatment: body.vatTreatment, agreementDate });
  const amountMinor = parseAmount(body.monthlyAmount, context.currency, 'monthlyAmount');
  if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'monthlyAmount must be positive', { field: 'monthlyAmount' });
  const vat = computeVat({ amountMinor, pricingBasis: body.pricingBasis, treatment: context.defaultTreatment, rateBasisPoints: context.rateBasisPoints });
  const months = chargeMonths({ startMonth: body.startMonth, billingDay: body.billingDay, endMonth: body.endMonth }, today);
  const fmt = (m: bigint) => formatMoney({ minor: m, currency: context.currency });
  const nextMonth = nextChargeMonth(body, months, today);
  return {
    context,
    agreementDate,
    amountMinor,
    vat,
    wire: {
      monthly: { amount: fmt(amountMinor), net: fmt(vat.netMinor), vat: fmt(vat.vatMinor), gross: fmt(vat.grossMinor) },
      vatRateBasisPoints: context.rateBasisPoints,
      vatTreatment: context.defaultTreatment,
      currency: context.currency,
      chargesDueNow: months.map((m) => ({ serviceMonth: m, chargeDate: chargeDate(m, body.billingDay), dueDate: dueDateFor(chargeDate(m, body.billingDay), body.paymentTerms) })),
      nextChargeDate: nextMonth ? chargeDate(nextMonth, body.billingDay) : null,
      previewToken: retainerPreviewToken(organization.id, body, context.rateBasisPoints),
    },
  };
}

export async function createRetainerFromPreview(
  store: LedgerStore,
  organization: Organization,
  actor: PostingActor,
  body: RetainerBody,
  preview: RetainerPreview,
  today: string,
  now: Date,
  options: { approveProposal?: ApproveProposalInput | null } = {},
): Promise<AgreementRecord> {
  const approveProposal = options.approveProposal ?? null;
  const created = await store.agreements.create(
    {
      organizationId: organization.id,
      projectId: preview.context.project.id,
      customerId: preview.context.customer.id,
      type: 'RECURRING',
      currency: preview.context.currency,
      pricingBasis: body.pricingBasis,
      vatTreatment: preview.context.defaultTreatment,
      vatRateBasisPoints: preview.vat.rateBasisPoints,
      amountMinor: preview.amountMinor,
      netMinor: preview.vat.netMinor,
      vatMinor: preview.vat.vatMinor,
      grossMinor: preview.vat.grossMinor,
      agreementDate: preview.agreementDate,
      description: body.description ?? null,
      paymentTerms: body.paymentTerms,
      startMonth: body.startMonth,
      billingDay: body.billingDay,
      endMonth: body.endMonth ?? null,
      installments: [],
      approveProposal,
    },
    now,
  );
  await store.audit.append({
    organizationId: organization.id,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'retainer.created',
    entityType: 'agreement',
    entityId: created.agreement.id,
    metadata: { projectId: created.agreement.projectId, monthlyGross: preview.wire.monthly.gross, startMonth: body.startMonth, ...(approveProposal ? { feeProposalId: approveProposal.id } : {}) },
    requestId: actor.requestId,
  });
  await generateCharges(store, organization, created.agreement, today, now, actor);
  return created.agreement;
}

/** The retainer, its terms versions and its charges to date (the wire of `GET /v1/retainers/{id}/charges`). */
export async function retainerChargesView(store: LedgerStore, organization: Organization, agreementId: string, today: string) {
  const agreement = await store.agreements.getById(organization.id, agreementId);
  if (!agreement) throw new ApiError('NOT_FOUND', 'No such agreement');
  const charges = await store.agreements.listCharges(organization.id, agreementId);
  const timeline = termsTimeline(agreement, await store.agreements.listVersions(organization.id, agreementId));
  const views = [];
  for (const ch of charges) views.push(serializeCharge(ch, await store.receivables.getById(organization.id, ch.receivableId), agreement.currency, today));
  return { agreement: serializeAgreement(agreement), versions: timeline.map((t) => serializeRetainerTerms(t, agreement.currency)), charges: views };
}

/** The first service month not yet chargeable today (null when ended). */
function nextChargeMonth(body: RetainerBody, chargedNow: string[], today: string): string | null {
  const last = chargedNow[chargedNow.length - 1];
  const candidate = last ? addMonths(last, 1) : body.startMonth;
  if (body.endMonth && candidate > body.endMonth) return null;
  if (!last && chargeDate(candidate, body.billingDay) <= today) return null;
  return candidate;
}
