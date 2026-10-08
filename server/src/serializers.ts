import { maskApiKey } from './auth/api-key.js';
import type { IsoDate } from './dates.js';
import { formatMoney, type Currency } from './money.js';
import { itemStatus, type ItemStatus } from './agreements/status.js';
import type {
  AgreementRecord,
  ApiKeyRecord,
  AuditEventRecord,
  CustomerRecord,
  ExternalReferenceRecord,
  InstallmentRecord,
  IntegrationRecord,
  Organization,
  ProjectRecord,
  ReceivableRecord,
  RetainerChargeRecord,
  SupplementRecord,
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
    createdAt: o.createdAt.toISOString(),
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

export function serializeAuditEvent(e: AuditEventRecord) {
  return {
    id: e.id,
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    ...(e.metadata ? { metadata: e.metadata } : {}),
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
        ? { startMonth: a.startMonth, billingDay: a.billingDay, endMonth: a.endMonth, cancelEffectiveMonth: a.cancelEffectiveMonth, finalMonth: a.finalMonth }
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
  return itemStatus({ voided: false, posted: true, dueDate: r.dueDate, grossMinor: r.grossMinor, paidMinor: r.paidMinor, today });
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
    outstanding: amt(r.grossMinor - r.paidMinor, r.currency),
    vatTreatment: r.vatTreatment,
    vatRateBasisPoints: r.vatRateBasisPoints,
    dueDate: r.dueDate,
    postingDate: r.postingDate,
    postedAt: r.postedAt.toISOString(),
    status: receivableStatus(r, today),
    version: r.version,
  };
}

export function serializeCharge(c: RetainerChargeRecord, receivable: ReceivableRecord | null, currency: string, today: IsoDate) {
  return {
    id: c.id,
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
