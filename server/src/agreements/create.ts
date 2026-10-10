import { formatMoney } from '../money.js';
import type { AgreementRecord, ApproveProposalInput, CreateInstallmentInput, InstallmentRecord, LedgerStore, Organization } from '../repositories/ports.js';
import { serializeAgreement, serializeInstallment, serializeSupplement } from '../serializers.js';
import {
  agreementPreviewToken,
  assertIsoDate,
  assertNotAbsurdDate,
  installmentDueDate,
  installmentView,
  loadAgreementContext,
  parseAmount,
  postingDateFor,
  resolveRate,
  scheduleOrThrow,
  toInstallmentSpecs,
  validationError,
} from './compose.js';
import { postDueItems, type PostingActor } from './posting.js';

/**
 * Creating a fixed-fee agreement from a composed preview (M3 brief §2.3),
 * shared by `POST /v1/agreements` and `POST /v1/fee-proposals/{id}/approve`
 * (M8 brief §6, D14): the store transaction writes the agreement and its
 * installments (and, when approving, moves the proposal to APPROVED or
 * refuses the whole create), the creation is audited, IMMEDIATE installments
 * are posted at once and the lazy path runs for anything else already due.
 */

export type Preview = Awaited<ReturnType<typeof composePreview>>;

export interface CreateAgreementOptions {
  /** M8: the PROPOSED proposal this agreement approves, in the same transaction. */
  approveProposal?: ApproveProposalInput | null;
}

export async function createAgreementFromPreview(
  store: LedgerStore,
  organization: Organization,
  actor: PostingActor,
  body: PreviewBody,
  preview: Preview,
  today: string,
  now: Date,
  options: CreateAgreementOptions = {},
): Promise<{ agreement: AgreementRecord; installments: InstallmentRecord[] }> {
  const installments: CreateInstallmentInput[] = preview.scheduled.map((i) => ({
    position: i.position,
    label: i.label,
    amountMinor: i.amountMinor,
    netMinor: i.netMinor,
    vatMinor: i.vatMinor,
    grossMinor: i.grossMinor,
    vatTreatment: i.vatTreatment,
    rateBasisPoints: i.rateBasisPoints,
    triggerType: i.trigger.type,
    triggerDate: i.trigger.date ?? null,
    paymentTerms: i.paymentTerms ?? null,
    dueDateOverride: i.dueDate ?? null,
  }));
  const approveProposal = options.approveProposal ?? null;
  const created = await store.agreements.create(
    {
      organizationId: organization.id,
      projectId: preview.context.project.id,
      customerId: preview.context.customer.id,
      type: 'FIXED',
      currency: preview.context.currency,
      pricingBasis: body.pricingBasis,
      vatTreatment: preview.context.defaultTreatment,
      vatRateBasisPoints: preview.vatRateBasisPoints,
      amountMinor: preview.totals.amountMinor,
      netMinor: preview.totals.netMinor,
      vatMinor: preview.totals.vatMinor,
      grossMinor: preview.totals.grossMinor,
      agreementDate: body.agreementDate,
      description: body.description ?? null,
      paymentTerms: body.paymentTerms,
      startMonth: null,
      billingDay: null,
      endMonth: null,
      installments,
      approveProposal,
    },
    now,
  );
  const audit = (action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) =>
    store.audit.append({ organizationId: organization.id, actorType: actor.actorType, actorId: actor.actorId, action, entityType, entityId, metadata, requestId: actor.requestId });
  await audit('agreement.created', 'agreement', created.agreement.id, {
    projectId: created.agreement.projectId,
    gross: formatMoney({ minor: created.agreement.grossMinor, currency: preview.context.currency }),
    installments: installments.length,
    ...(approveProposal ? { feeProposalId: approveProposal.id } : {}),
  });

  // IMMEDIATE installments post now; DATE ones whose date has arrived post through the same lazy path (which, since D16, also heals an IMMEDIATE one a crash left here).
  for (const i of created.installments) {
    if (i.triggerType !== 'IMMEDIATE') continue;
    const postingDate = postingDateFor(i, created.agreement.agreementDate, today);
    const posted = await store.agreements.postInstallment(organization.id, i.id, { postingDate, dueDate: installmentDueDate(i, created.agreement, postingDate), at: now });
    if (posted?.created) await audit('installment.posted', 'installment', i.id, { agreementId: created.agreement.id, receivableId: posted.receivable.id, trigger: 'IMMEDIATE' });
  }
  await postDueItems(store, organization, today, now, actor);
  const fresh = await store.agreements.getById(organization.id, created.agreement.id);
  return { agreement: fresh ?? created.agreement, installments: created.installments };
}

export async function agreementDetail(store: LedgerStore, organization: Organization, agreement: AgreementRecord, today: string) {
  const [installments, supplements] = await Promise.all([store.agreements.listInstallments(organization.id, agreement.id), store.agreements.listSupplements(organization.id, agreement.id)]);
  const paidByReceivable = await paidMap(store, organization.id, installments);
  return {
    agreement: serializeAgreement(agreement),
    installments: installments.map((i) => serializeInstallment({ installment: i, currency: agreement.currency, ...installmentView(i, agreement, today, paidByReceivable.get(i.receivableId ?? '')) })),
    supplements: supplements.map((s) => serializeSupplement(s, agreement.currency)),
  };
}

export async function paidMap(store: LedgerStore, organizationId: string, installments: InstallmentRecord[]): Promise<Map<string, { paidMinor: bigint; creditedMinor: bigint }>> {
  const map = new Map<string, { paidMinor: bigint; creditedMinor: bigint }>();
  const receivables = await store.receivables.getByIds(organizationId, installments.map((i) => i.receivableId).filter((id): id is string => id !== null));
  for (const r of receivables) map.set(r.id, { paidMinor: r.paidMinor, creditedMinor: r.creditedMinor });
  return map;
}


export type PreviewBody = {
  projectId: string;
  amount: string;
  currency?: string | undefined;
  pricingBasis: 'VAT_EXCLUSIVE' | 'VAT_INCLUSIVE';
  vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined;
  agreementDate: string;
  description?: string | undefined;
  paymentTerms: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60';
  installments: ReadonlyArray<{ label: string; amount?: string | undefined; percentBasisPoints?: number | undefined; vatTreatment?: 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined; trigger: { type: 'IMMEDIATE' | 'DATE' | 'MANUAL'; date?: string | undefined }; paymentTerms?: 'IMMEDIATE' | 'EOM' | 'EOM_15' | 'EOM_30' | 'EOM_45' | 'EOM_60' | undefined; dueDate?: string | undefined }>;
};

export async function composePreview(store: LedgerStore, organization: Organization, body: PreviewBody, today: string) {
  assertIsoDate(body.agreementDate, 'agreementDate');
  assertNotAbsurdDate(body.agreementDate, today, 'agreementDate');
  const context = await loadAgreementContext(store, organization, { projectId: body.projectId, currency: body.currency, vatTreatment: body.vatTreatment, agreementDate: body.agreementDate });
  const rateBasisPoints = await resolveRate(store, organization.id, body.agreementDate, context.defaultTreatment, body.installments.map((i) => i.vatTreatment));
  const amountMinor = parseAmount(body.amount, context.currency);
  if (amountMinor <= 0n) throw validationError('AMOUNT_INVALID', 'amount must be positive', { field: 'amount' });
  const specs = toInstallmentSpecs(body.installments, context.currency);
  const { items, totals } = scheduleOrThrow({ amountMinor, pricingBasis: body.pricingBasis, defaultTreatment: context.defaultTreatment, rateBasisPoints, installments: specs });
  const draft = { paymentTerms: body.paymentTerms, agreementDate: body.agreementDate };
  const installments = items.map((i) => {
    const asRecord = { triggerType: i.trigger.type, triggerDate: i.trigger.date ?? null, dueDateOverride: i.dueDate ?? null, paymentTerms: i.paymentTerms ?? null };
    const postingDate = postingDateFor(asRecord, body.agreementDate, today);
    const dueDate = installmentDueDate(asRecord, draft, postingDate);
    return {
      position: i.position,
      label: i.label,
      amount: formatMoney({ minor: i.amountMinor, currency: context.currency }),
      net: formatMoney({ minor: i.netMinor, currency: context.currency }),
      vat: formatMoney({ minor: i.vatMinor, currency: context.currency }),
      gross: formatMoney({ minor: i.grossMinor, currency: context.currency }),
      vatTreatment: i.vatTreatment,
      rateBasisPoints: i.rateBasisPoints,
      trigger: { type: i.trigger.type, ...(i.trigger.date ? { date: i.trigger.date } : {}) },
      paymentTerms: i.paymentTerms ?? null,
      dueDate,
      status: 'PENDING' as const,
    };
  });
  const fmt = (minor: bigint) => formatMoney({ minor, currency: context.currency });
  return {
    context,
    scheduled: items,
    totals,
    vatRateBasisPoints: rateBasisPoints,
    wire: {
      totals: { amount: fmt(totals.amountMinor), net: fmt(totals.netMinor), vat: fmt(totals.vatMinor), gross: fmt(totals.grossMinor) },
      vatRateBasisPoints: rateBasisPoints,
      vatTreatment: context.defaultTreatment,
      currency: context.currency,
      installments,
      previewToken: agreementPreviewToken(organization.id, body, rateBasisPoints),
    },
  };
}
