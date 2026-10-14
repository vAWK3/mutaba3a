import { maskApiKey } from './auth/api-key.js';
import { sessionAccessFor, WRITABILITY_MATRIX, type ProfileWriter } from './auth/writability.js';
import { incomeCaptureRulesFor } from './income/compose.js';
import { profileOwnerOf, profileTypeOf } from './personal-profile.js';
import type { IsoDate } from './dates.js';
import { formatMoney, type Currency } from './money.js';
import { itemStatus, type ItemStatus } from './agreements/status.js';
import type { RetainerTerms } from './retainers/terms.js';
import type { CaptureSource } from './schemas.js';
import { allocationStateOf } from './payments/allocation-state.js';
import type {
  ConversionRecord,
  ExpenseCategoryRecord,
  ExpenseReceiptRecord,
  ExpenseRecord,
  InboxEntryRecord,
  FeeProposalRecord,
  AttachmentRecord,
  AgreementRecord,
  AllocationRecord,
  ApiKeyRecord,
  CreditRecord,
  IdempotencyRecord,
  PaymentRecord,
  AuditEventRecord,
  CustomerRecord,
  ExternalReferenceRecord,
  InstallmentRecord,
  IntegrationRecord,
  MembershipRecord,
  Organization,
  ProjectRecord,
  ReceivableRecord,
  RetainerChargeRecord,
  SupplementRecord,
  UserRecord,
  VatRateRecord,
} from './repositories/ports.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function serializeOrganization(o: Organization) {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    defaultCurrency: o.defaultCurrency as 'ILS' | 'USD' | 'EUR',
    timezone: o.timezone,
    personalOwnerUserId: o.personalOwnerUserId,
    ownerUserId: o.ownerUserId,
    profileType: o.profileType,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * One hosted profile as GET /v1/me lists it, and as POST and PATCH
 * /v1/profiles return it (MUT-182, eng review D1: one builder, so the three
 * can never drift). `writerOfRecord` is MALAFAT when a CONNECTED Malafat
 * integration feeds the organization; an owned profile never has one.
 */
export function hostedProfileFor(organization: Organization, writerOfRecord: ProfileWriter, userId: string) {
  return {
    id: organization.id,
    name: organization.name,
    source: 'hosted' as const,
    defaultCurrency: organization.defaultCurrency as 'ILS' | 'USD' | 'EUR',
    timezone: organization.timezone,
    writerOfRecord,
    // MUT-65: per-organization, not a constant — three rows' access depend on whether a Malafat writer of record feeds this profile (not on isPersonalDefault).
    access: Object.fromEntries(WRITABILITY_MATRIX.map((row) => [row.domain, sessionAccessFor(row.domain, writerOfRecord)])),
    // MUT-61: the same rules POST /v1/income enforces, so the app reads them instead of inferring them.
    income: incomeCaptureRulesFor(writerOfRecord),
    // MUT-120: explicit, from the row already loaded; another user's personal profile is never this user's default.
    isPersonalDefault: organization.personalOwnerUserId === userId,
    // MUT-182: the caller's own (theirs to rename and retype), its type, and the If-Match for doing so.
    // profileOwnerOf / profileTypeOf: an unstamped MUT-120 profile the old revision wrote is still the caller's, PERSONAL (qa-reconcile D1).
    owned: profileOwnerOf(organization) === userId,
    type: profileTypeOf(organization),
    version: organization.version,
  };
}

export function serializeApiKey(k: ApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    environment: k.environment,
    masked: maskApiKey(k.environment, k.prefix, k.keyHash),
    scopes: k.scopes,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: iso(k.lastUsedAt),
    expiresAt: iso(k.expiresAt),
    revokedAt: iso(k.revokedAt),
  };
}

export function serializeIntegration(i: IntegrationRecord) {
  return {
    id: i.id,
    provider: i.provider,
    externalTenantId: i.externalTenantId,
    displayName: i.displayName,
    status: i.status,
    connectedAt: i.connectedAt.toISOString(),
    disconnectedAt: iso(i.disconnectedAt),
  };
}

/** Never includes the password hash. */
export function serializeUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    locale: u.locale,
    status: u.status,
    passwordChangedAt: u.passwordChangedAt.toISOString(),
    lastSignInAt: iso(u.lastSignInAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export function serializeMembership(m: MembershipRecord) {
  return { organizationId: m.organizationId, createdAt: m.createdAt.toISOString() };
}

export function serializeAuditEvent(e: AuditEventRecord) {
  return {
    id: e.id,
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    // Widened at the wire: the schema's z.unknown() record, compared with the recursive JsonValue, exhausts the route type checker.
    ...(e.metadata ? { metadata: e.metadata as Record<string, unknown> } : {}),
    requestId: e.requestId,
    createdAt: e.createdAt.toISOString(),
  };
}

function serializeReference(r: ExternalReferenceRecord | null | undefined) {
  return r ? { provider: r.provider, externalId: r.externalId } : null;
}

export function serializeCustomer(c: CustomerRecord, reference?: ExternalReferenceRecord | null) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    vatTreatment: c.vatTreatment,
    status: c.status,
    archivedAt: iso(c.archivedAt),
    externalReference: serializeReference(reference),
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function serializeProject(p: ProjectRecord, reference?: ExternalReferenceRecord | null) {
  return {
    id: p.id,
    customerId: p.customerId,
    name: p.name,
    currency: p.currency as 'ILS' | 'USD' | 'EUR',
    vatTreatment: p.vatTreatment,
    status: p.status,
    archivedAt: iso(p.archivedAt),
    externalReference: serializeReference(reference),
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ---- Milestone 3 ----------------------------------------------------------

const amt = (minor: bigint, currency: string) => formatMoney({ minor, currency: currency as Currency });

export function serializeVatRate(r: VatRateRecord) {
  return { id: r.id, rateBasisPoints: r.rateBasisPoints, effectiveFrom: r.effectiveFrom, createdAt: r.createdAt.toISOString() };
}

export function serializeAgreement(a: AgreementRecord) {
  return {
    id: a.id,
    projectId: a.projectId,
    customerId: a.customerId,
    type: a.type,
    status: a.status,
    currency: a.currency as Currency,
    pricingBasis: a.pricingBasis,
    vatTreatment: a.vatTreatment,
    vatRateBasisPoints: a.vatRateBasisPoints,
    amount: amt(a.amountMinor, a.currency),
    net: amt(a.netMinor, a.currency),
    vat: amt(a.vatMinor, a.currency),
    gross: amt(a.grossMinor, a.currency),
    agreementDate: a.agreementDate,
    description: a.description,
    paymentTerms: a.paymentTerms,
    retainer:
      a.type === 'RECURRING' && a.startMonth && a.billingDay
        ? { startMonth: a.startMonth, billingDay: a.billingDay, endMonth: a.endMonth, cancelEffectiveMonth: a.cancelEffectiveMonth, cancelEffectiveDate: a.cancelEffectiveDate, finalMonth: a.finalMonth }
        : null,
    contingency:
      a.type === 'CONTINGENCY' && a.commissionRateBasisPoints !== null && a.upfrontTreatment !== null
        ? {
            commissionRateBasisPoints: a.commissionRateBasisPoints,
            upfrontTreatment: a.upfrontTreatment,
            outcome: a.outcome ?? ('AWAITING' as const),
            outcomeDate: a.outcomeDate,
            awarded: a.awardedAmountMinor === null ? null : amt(a.awardedAmountMinor, a.currency),
            note: a.outcomeNote,
            outcomeRecordedAt: iso(a.outcomeRecordedAt),
          }
        : null,
    cancelledAt: iso(a.cancelledAt),
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export interface InstallmentView {
  installment: InstallmentRecord;
  currency: string;
  /** Due date (posted) or the date it would get if posted today. */
  dueDate: IsoDate;
  status: ItemStatus;
}

export function serializeInstallment(v: InstallmentView) {
  const i = v.installment;
  return {
    id: i.id,
    position: i.position,
    label: i.label,
    amount: amt(i.amountMinor, v.currency),
    net: amt(i.netMinor, v.currency),
    vat: amt(i.vatMinor, v.currency),
    gross: amt(i.grossMinor, v.currency),
    vatTreatment: i.vatTreatment,
    rateBasisPoints: i.rateBasisPoints,
    trigger: { type: i.triggerType, ...(i.triggerDate ? { date: i.triggerDate } : {}) },
    paymentTerms: i.paymentTerms,
    dueDate: v.dueDate,
    status: v.status,
    postedAt: iso(i.postedAt),
    receivableId: i.receivableId,
    isCommission: i.isCommission,
    version: i.version,
  };
}

export function serializeSupplement(s: SupplementRecord, currency: string) {
  return {
    id: s.id,
    amount: amt(s.amountMinor, currency),
    description: s.description,
    effectiveDate: s.effectiveDate,
    distribution: s.distribution,
    resultingAmount: amt(s.resultingAmountMinor, currency),
    createdAt: s.createdAt.toISOString(),
  };
}

export function receivableStatus(r: ReceivableRecord, today: IsoDate): ItemStatus {
  return itemStatus({ voided: false, posted: true, dueDate: r.dueDate, grossMinor: r.grossMinor, paidMinor: r.paidMinor, creditedMinor: r.creditedMinor, today });
}

export function serializeReceivable(r: ReceivableRecord, today: IsoDate) {
  return {
    id: r.id,
    customerId: r.customerId,
    projectId: r.projectId,
    agreementId: r.agreementId,
    origin: r.origin,
    originId: r.originId,
    currency: r.currency as Currency,
    net: amt(r.netMinor, r.currency),
    vat: amt(r.vatMinor, r.currency),
    gross: amt(r.grossMinor, r.currency),
    paid: amt(r.paidMinor, r.currency),
    credited: amt(r.creditedMinor, r.currency),
    outstanding: amt(r.grossMinor - r.paidMinor - r.creditedMinor, r.currency),
    vatTreatment: r.vatTreatment,
    vatRateBasisPoints: r.vatRateBasisPoints,
    dueDate: r.dueDate,
    postingDate: r.postingDate,
    postedAt: r.postedAt.toISOString(),
    status: receivableStatus(r, today),
    title: r.title,
    version: r.version,
  };
}

export function serializeCharge(c: RetainerChargeRecord, receivable: ReceivableRecord | null, currency: string, today: IsoDate) {
  return {
    id: c.id,
    version: c.version,
    serviceMonth: c.serviceMonth,
    chargeDate: c.chargeDate,
    amount: amt(c.amountMinor, currency),
    net: amt(c.netMinor, currency),
    vat: amt(c.vatMinor, currency),
    gross: amt(c.grossMinor, currency),
    vatTreatment: c.vatTreatment,
    rateBasisPoints: c.rateBasisPoints,
    receivableId: c.receivableId,
    status: receivable ? receivableStatus(receivable, today) : ('DUE' as ItemStatus),
    dueDate: receivable?.dueDate ?? c.chargeDate,
    postedAt: c.postedAt.toISOString(),
  };
}

// ---- Milestone 4 ------------------------------------------------------------

/** What is still owed on a receivable; what statuses and allocations are checked against. */
export function outstandingMinor(r: Pick<ReceivableRecord, 'grossMinor' | 'paidMinor' | 'creditedMinor'>): bigint {
  return r.grossMinor - r.paidMinor - r.creditedMinor;
}

export function serializeAllocation(a: AllocationRecord, receivable: ReceivableRecord | null, currency: string, today: IsoDate) {
  return {
    id: a.id,
    receivableId: a.receivableId,
    projectId: receivable?.projectId ?? '',
    origin: receivable?.origin ?? ('INSTALLMENT' as const),
    amount: amt(a.amountMinor, currency),
    receivableOutstanding: receivable ? amt(outstandingMinor(receivable), currency) : amt(0n, currency),
    receivableStatus: receivable ? receivableStatus(receivable, today) : ('DUE' as ItemStatus),
    createdAt: a.createdAt.toISOString(),
  };
}

/** MUT-61: the person behind a captured payment, as Malafat shows them. */
export interface CapturedBy {
  userId: string;
  displayName: string;
}

export function serializePayment(p: PaymentRecord, allocations: Array<ReturnType<typeof serializeAllocation>>, replacedByPaymentId: string | null, capturedBy: CapturedBy | null) {
  return {
    id: p.id,
    number: p.number,
    customerId: p.customerId,
    projectId: p.projectId,
    origin: p.origin === 'CAPTURE' ? ('capture' as const) : ('integration' as const),
    captureSource: p.captureSource as CaptureSource | null,
    capturedBy,
    currency: p.currency as Currency,
    amount: amt(p.amountMinor, p.currency),
    allocated: amt(p.allocatedMinor, p.currency),
    unallocated: amt(p.status === 'REVERSED' ? 0n : p.amountMinor - p.allocatedMinor, p.currency),
    allocationState: allocationStateOf(p),
    receivedOn: p.receivedOn,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    status: p.status,
    reversedAt: iso(p.reversedAt),
    reversalReason: p.reversalReason,
    replacesPaymentId: p.replacesPaymentId,
    replacedByPaymentId,
    allocations,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeCredit(c: CreditRecord, currency: string) {
  return { id: c.id, receivableId: c.receivableId, amount: amt(c.amountMinor, currency), net: amt(c.netMinor, currency), vat: amt(c.vatMinor, currency), reason: c.reason, effectiveDate: c.effectiveDate, createdAt: c.createdAt.toISOString() };
}

export function serializeOperation(r: IdempotencyRecord) {
  return {
    key: r.key,
    operation: r.operation,
    status: r.status === 'COMPLETED' ? ('COMPLETED' as const) : ('PENDING' as const),
    responseStatus: r.responseStatus,
    response: r.responseBody ?? null,
    createdAt: r.createdAt.toISOString(),
    completedAt: iso(r.completedAt),
  };
}

// ---- Milestone 5 ------------------------------------------------------------

/** A retainer's terms as in force from a month (version 1 = the agreement's own terms). */
export function serializeRetainerTerms(t: RetainerTerms, currency: string) {
  return {
    version: t.version,
    effectiveMonth: t.effectiveMonth,
    monthlyAmount: amt(t.monthlyAmountMinor, currency),
    net: amt(t.netMinor, currency),
    vat: amt(t.vatMinor, currency),
    gross: amt(t.grossMinor, currency),
    pricingBasis: t.pricingBasis,
    vatTreatment: t.vatTreatment,
    rateBasisPoints: t.rateBasisPoints,
    billingDay: t.billingDay,
    paymentTerms: t.paymentTerms,
    endMonth: t.endMonth,
    reason: t.reason,
  };
}

// ---- Milestone 6 ------------------------------------------------------------

export function serializeAttachment(a: AttachmentRecord) {
  return {
    id: a.id,
    kind: a.kind,
    filename: a.filename,
    mimeType: a.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png',
    sizeBytes: a.sizeBytes,
    status: a.status,
    customerId: a.customerId,
    projectId: a.projectId,
    paymentId: a.paymentId,
    invoiceNumber: a.invoiceNumber,
    invoiceDate: a.invoiceDate,
    uploadedByKeyId: a.uploadedByKeyId,
    createdAt: a.createdAt.toISOString(),
    completedAt: iso(a.completedAt),
  };
}

/** MUT-107: null for a FIXED proposal; the proposed terms for a contingency one. */
function proposalContingency(p: FeeProposalRecord) {
  return p.commissionRateBasisPoints === null ? null : { commissionRateBasisPoints: p.commissionRateBasisPoints, upfrontTreatment: p.upfrontTreatment! };
}

/** M7: minor units → canonical decimals in the proposal's currency. */
export function serializeFeeProposal(p: FeeProposalRecord) {
  return {
    id: p.id,
    projectId: p.projectId,
    customerId: p.customerId,
    currency: p.currency as Currency,
    status: p.status,
    pricingBasis: p.pricingBasis,
    proposedAmount: amt(p.proposedAmountMinor, p.currency),
    proposedOn: p.proposedOn,
    note: p.note,
    clientApprovedOn: p.clientApprovedOn,
    clientApprovalNote: p.clientApprovalNote,
    agreedAmount: p.agreedAmountMinor === null ? null : amt(p.agreedAmountMinor, p.currency),
    withdrawnAt: iso(p.withdrawnAt),
    withdrawnReason: p.withdrawnReason,
    agreementId: p.agreementId,
    contingency: proposalContingency(p),
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeFeeProposalSummary(p: FeeProposalRecord | null) {
  if (!p) return null;
  return { id: p.id, status: p.status, pricingBasis: p.pricingBasis, proposedAmount: amt(p.proposedAmountMinor, p.currency), agreedAmount: p.agreedAmountMinor === null ? null : amt(p.agreedAmountMinor, p.currency), proposedOn: p.proposedOn, agreementId: p.agreementId, contingency: proposalContingency(p) };
}

/** MUT-161: both legs formatted in their own currency — never converted. */
export function serializeConversion(c: ConversionRecord) {
  return {
    id: c.id,
    occurredOn: c.occurredOn,
    amount: formatMoney({ minor: c.amountMinor, currency: c.currency as Currency }),
    currency: c.currency as Currency,
    toAmount: formatMoney({ minor: c.toAmountMinor, currency: c.toCurrency as Currency }),
    toCurrency: c.toCurrency as Currency,
    notes: c.notes,
    createdByUserId: c.createdByUserId,
    createdAt: c.createdAt.toISOString(),
  };
}

/** MUT-42: the original amount, formatted in its own currency — never converted. */
export function serializeExpense(e: ExpenseRecord) {
  return {
    id: e.id,
    occurredOn: e.occurredOn,
    amount: formatMoney({ minor: e.amountMinor, currency: e.currency as Currency }),
    currency: e.currency as Currency,
    title: e.title,
    vendor: e.vendor,
    categoryId: e.categoryId,
    customerId: e.customerId,
    projectId: e.projectId,
    notes: e.notes,
    createdByUserId: e.createdByUserId,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export function serializeExpenseReceipt(r: ExpenseReceiptRecord) {
  return {
    id: r.id,
    expenseId: r.expenseId,
    filename: r.filename,
    mimeType: r.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png',
    sizeBytes: r.sizeBytes,
    status: r.status,
    uploadedByUserId: r.uploadedByUserId,
    createdAt: r.createdAt.toISOString(),
    completedAt: iso(r.completedAt),
  };
}

export function serializeExpenseCategory(c: ExpenseCategoryRecord) {
  return { id: c.id, name: c.name, color: c.color, archived: c.archivedAt !== null, version: c.version, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

// ---- MUT-65: personal profile income capture --------------------------------

/** POST /v1/income's response envelope: one shape for Received (a Payment) or Owed (a Receivable). */
export function serializeIncomeEntry(entry: { kind: 'received'; payment: PaymentRecord } | { kind: 'owed'; receivable: ReceivableRecord }) {
  if (entry.kind === 'received') {
    const p = entry.payment;
    return {
      id: p.id,
      kind: 'received' as const,
      amount: amt(p.amountMinor, p.currency),
      currency: p.currency as Currency,
      occurredOn: p.receivedOn,
      customerId: p.customerId,
      projectId: p.projectId,
      title: null,
      notes: p.notes,
      dueDate: null,
      // Always true at creation: a fresh Received payment carries no allocations yet.
      status: 'unallocated' as const,
    };
  }
  const r = entry.receivable;
  return {
    id: r.id,
    kind: 'owed' as const,
    amount: amt(r.grossMinor, r.currency),
    currency: r.currency as Currency,
    occurredOn: r.postingDate,
    customerId: r.customerId,
    projectId: r.projectId,
    title: r.title,
    notes: null,
    dueDate: r.dueDate,
    status: r.status === 'SETTLED' ? ('settled' as const) : ('open' as const),
  };
}

// ---- MUT-66: the unsorted inbox ---------------------------------------------

export function serializeInboxEntry(e: InboxEntryRecord) {
  return {
    id: e.id,
    kind: e.kind.toLowerCase() as 'income' | 'expense',
    amount: amt(e.amountMinor, e.currency),
    currency: e.currency as Currency,
    occurredOn: e.occurredOn,
    note: e.note,
    captureSource: e.captureSource as CaptureSource | null,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
