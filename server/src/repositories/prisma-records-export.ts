import type { PrismaClient } from '@prisma/client';
import { RECEIVABLE_NUMBER_PREFIX, receivableCounterKey } from '../payments/numbering.js';
import type {
  AgreementRecord,
  VendorRecord,
  VendorNameRecord,
  AllocationRecord,
  ConversionRecord,
  CreditRecord,
  CustomerRecord,
  ExpenseCategoryRecord,
  ExpenseGroupOverrideRecord,
  ExpenseGroupRecord,
  ExpenseReceiptRecord,
  ExpenseRecord,
  ExportPage,
  ExternalReferenceRecord,
  FeeProposalRecord,
  InboxEntryRecord,
  InstallmentRecord,
  PaymentRecord,
  ProfileExportField,
  ProfileExportRecords,
  ProjectRecord,
  ReceiptReadState,
  ReceivableRecord,
  RecordsExportRepository,
  RetainerChargeRecord,
  RetainerVersionRecord,
  SupplementRecord,
  VatRateRecord,
} from './ports.js';

/**
 * MUT-325: the Prisma half of `RecordsExportRepository`. Each read selects
 * exactly the record's fields: a column the record doesn't have (a search
 * key, a backfill flag) must not reach a device's store, and a field the
 * record has but the select forgot must not go missing. `Columns<R>` makes
 * both a type error.
 */

type Columns<R> = { [K in keyof R]-?: true };

const cols = <R>() => <S extends Columns<R>>(select: S & Record<Exclude<keyof S, keyof R>, never>) => select;

const CUSTOMER = cols<CustomerRecord>()({ id: true, organizationId: true, name: true, email: true, phone: true, notes: true, status: true, vatTreatment: true, archivedAt: true, version: true, createdAt: true, updatedAt: true });
const PROJECT = cols<ProjectRecord>()({ id: true, organizationId: true, customerId: true, name: true, currency: true, status: true, vatTreatment: true, archivedAt: true, version: true, createdAt: true, updatedAt: true });
const EXTERNAL_REFERENCE = cols<ExternalReferenceRecord>()({ id: true, organizationId: true, provider: true, entityType: true, entityId: true, externalId: true, createdAt: true });
const VAT_RATE = cols<VatRateRecord>()({ id: true, organizationId: true, rateBasisPoints: true, effectiveFrom: true, createdAt: true });
const AGREEMENT = cols<AgreementRecord>()({
  id: true, organizationId: true, projectId: true, customerId: true, type: true, status: true, currency: true, pricingBasis: true, vatTreatment: true,
  vatRateBasisPoints: true, amountMinor: true, netMinor: true, vatMinor: true, grossMinor: true, agreementDate: true, description: true, paymentTerms: true,
  startMonth: true, billingDay: true, endMonth: true, finalMonth: true, cancelEffectiveMonth: true, cancelEffectiveDate: true, cancelledAt: true,
  commissionRateBasisPoints: true, upfrontTreatment: true, outcome: true, outcomeDate: true, outcomeNote: true, outcomeRecordedAt: true, awardedAmountMinor: true,
  version: true, createdAt: true, updatedAt: true,
});
const INSTALLMENT = cols<InstallmentRecord>()({
  id: true, organizationId: true, agreementId: true, position: true, label: true, amountMinor: true, netMinor: true, vatMinor: true, grossMinor: true,
  vatTreatment: true, rateBasisPoints: true, triggerType: true, triggerDate: true, paymentTerms: true, dueDateOverride: true, isCommission: true,
  postingDate: true, postedAt: true, receivableId: true, voidedAt: true, version: true,
});
const RETAINER_CHARGE = cols<RetainerChargeRecord>()({
  id: true, organizationId: true, agreementId: true, serviceMonth: true, chargeDate: true, amountMinor: true, netMinor: true, vatMinor: true, grossMinor: true,
  vatTreatment: true, rateBasisPoints: true, receivableId: true, postedAt: true, version: true, createdAt: true,
});
const RECEIVABLE = cols<ReceivableRecord>()({
  id: true, organizationId: true, customerId: true, projectId: true, agreementId: true, origin: true, originId: true, currency: true, netMinor: true,
  vatMinor: true, grossMinor: true, paidMinor: true, creditedMinor: true, vatTreatment: true, vatRateBasisPoints: true, title: true, dueDate: true,
  postingDate: true, postedAt: true, status: true, createdByUserId: true, deletedAt: true, number: true, version: true, createdAt: true,
});
const SUPPLEMENT = cols<SupplementRecord>()({ id: true, organizationId: true, agreementId: true, amountMinor: true, resultingAmountMinor: true, distribution: true, effectiveDate: true, description: true, reasonCode: true, appliedGrossMinor: true, creditedMinor: true, requestId: true, createdAt: true });
const RETAINER_VERSION = cols<RetainerVersionRecord>()({
  id: true, organizationId: true, agreementId: true, version: true, effectiveMonth: true, endMonth: true, monthlyAmountMinor: true, netMinor: true, vatMinor: true,
  grossMinor: true, pricingBasis: true, vatTreatment: true, rateBasisPoints: true, billingDay: true, paymentTerms: true, reason: true, requestId: true, createdAt: true,
});
const PAYMENT = cols<PaymentRecord>()({
  id: true, organizationId: true, customerId: true, projectId: true, number: true, currency: true, amountMinor: true, allocatedMinor: true, receivedOn: true,
  method: true, reference: true, receiptNumber: true, notes: true, origin: true, status: true, replacesPaymentId: true, reversedAt: true, reversalReason: true, captureSource: true,
  createdByUserId: true, requestId: true, version: true, createdAt: true, updatedAt: true,
});
const ALLOCATION = cols<AllocationRecord>()({ id: true, organizationId: true, paymentId: true, receivableId: true, amountMinor: true, createdAt: true });
const CREDIT = cols<CreditRecord>()({ id: true, organizationId: true, receivableId: true, amountMinor: true, netMinor: true, vatMinor: true, effectiveDate: true, reason: true, reasonCode: true, requestId: true, createdAt: true });
const FEE_PROPOSAL = cols<FeeProposalRecord>()({
  id: true, organizationId: true, projectId: true, customerId: true, currency: true, status: true, pricingBasis: true, proposedAmountMinor: true, agreedAmountMinor: true,
  proposedOn: true, note: true, clientApprovedOn: true, clientApprovalNote: true, commissionRateBasisPoints: true, upfrontTreatment: true, agreementId: true,
  withdrawnAt: true, withdrawnReason: true, requestId: true, version: true, createdAt: true, updatedAt: true,
});
// MUT-436 (ADR-201): captureSource stays on the server; the local records format (MUT-325) is unchanged.
const EXPENSE = cols<Omit<ExpenseRecord, 'captureSource'>>()({
  id: true, organizationId: true, amountMinor: true, currency: true, occurredOn: true, title: true, vendor: true, notes: true, categoryId: true, customerId: true,
  projectId: true, createdByUserId: true, deletedAt: true, version: true, createdAt: true, updatedAt: true,
  // MUT-254
  vendorId: true,
});
const EXPENSE_CATEGORY = cols<ExpenseCategoryRecord>()({ id: true, organizationId: true, name: true, color: true, archivedAt: true, version: true, createdAt: true, updatedAt: true });
// MUT-441: the server's reading state and capture hint stay on the server too; the local records format is unchanged.
const EXPENSE_RECEIPT = cols<Omit<ExpenseReceiptRecord, keyof ReceiptReadState>>()({
  id: true, organizationId: true, expenseId: true, filename: true, mimeType: true, sizeBytes: true, status: true, storageKey: true, uploadedByUserId: true,
  requestId: true, createdAt: true, completedAt: true, deletedAt: true,
  // MUT-255: the receipts library — To-review receipts (no expense) export too, with what was read and approved.
  filingStatus: true, receivedOn: true, suggested: true, approved: true, approvedAt: true, approvedByUserId: true, version: true,
});
const CONVERSION = cols<ConversionRecord>()({
  id: true, organizationId: true, amountMinor: true, currency: true, toAmountMinor: true, toCurrency: true, occurredOn: true, notes: true, createdByUserId: true,
  deletedAt: true, version: true, createdAt: true, updatedAt: true,
});
const EXPENSE_GROUP = cols<ExpenseGroupRecord>()({ id: true, organizationId: true, name: true, startOn: true, endOn: true, notes: true, createdByUserId: true, deletedAt: true, version: true, createdAt: true, updatedAt: true });
const GROUP_MARK = cols<ExpenseGroupOverrideRecord>()({ groupId: true, expenseId: true, organizationId: true, mode: true, createdAt: true, updatedAt: true });
// MUT-254: vendors and every name of theirs (registrationKey is an index column, derived from registrationNo).
const VENDOR = cols<VendorRecord>()({
  id: true, organizationId: true, canonicalName: true, registrationNo: true, phone: true, email: true, lastCategoryId: true, lastUsedAt: true, version: true,
  createdAt: true, updatedAt: true,
});
const VENDOR_NAME = cols<VendorNameRecord>()({ id: true, organizationId: true, vendorId: true, name: true, nameKey: true, createdAt: true });
const INBOX_ENTRY = cols<InboxEntryRecord>()({ id: true, userId: true, kind: true, amountMinor: true, currency: true, occurredOn: true, note: true, captureSource: true, version: true, createdAt: true, updatedAt: true });

/** Every export read's Prisma model and the columns it selects, for the test that holds them to the schema. */
export const EXPORT_COLUMNS: ReadonlyArray<{ model: string; select: Record<string, true> }> = [
  { model: 'Customer', select: CUSTOMER }, { model: 'Project', select: PROJECT }, { model: 'ExternalReference', select: EXTERNAL_REFERENCE },
  { model: 'VatRate', select: VAT_RATE }, { model: 'Agreement', select: AGREEMENT }, { model: 'Installment', select: INSTALLMENT },
  { model: 'RetainerCharge', select: RETAINER_CHARGE }, { model: 'Receivable', select: RECEIVABLE }, { model: 'AgreementSupplement', select: SUPPLEMENT },
  { model: 'RetainerVersion', select: RETAINER_VERSION }, { model: 'Payment', select: PAYMENT }, { model: 'PaymentAllocation', select: ALLOCATION },
  { model: 'ReceivableCredit', select: CREDIT }, { model: 'FeeProposal', select: FEE_PROPOSAL }, { model: 'Expense', select: EXPENSE },
  { model: 'ExpenseCategory', select: EXPENSE_CATEGORY }, { model: 'ExpenseReceipt', select: EXPENSE_RECEIPT }, { model: 'Conversion', select: CONVERSION },
  { model: 'ExpenseGroup', select: EXPENSE_GROUP }, { model: 'ExpenseGroupOverride', select: GROUP_MARK }, { model: 'InboxEntry', select: INBOX_ENTRY },
  { model: 'Vendor', select: VENDOR }, { model: 'VendorName', select: VENDOR_NAME },
];

/** The rows one Prisma delegate returns for `findMany`: what every id-keyed export read needs from it. */
interface IdKeyedDelegate {
  findMany(args: { where: Record<string, unknown>; select: Record<string, true>; orderBy: { id: 'asc' }; take: number }): Promise<Array<{ id: string }>>;
}

function idKeyed(prisma: PrismaClient): { [F in Exclude<ProfileExportField, 'counters' | 'groupMarks'>]: { delegate: IdKeyedDelegate; select: Record<string, true> } } {
  const d = (delegate: unknown) => delegate as IdKeyedDelegate;
  return {
    custs: { delegate: d(prisma.customer), select: CUSTOMER },
    projs: { delegate: d(prisma.project), select: PROJECT },
    refs: { delegate: d(prisma.externalReference), select: EXTERNAL_REFERENCE },
    rates: { delegate: d(prisma.vatRate), select: VAT_RATE },
    agrs: { delegate: d(prisma.agreement), select: AGREEMENT },
    insts: { delegate: d(prisma.installment), select: INSTALLMENT },
    charges: { delegate: d(prisma.retainerCharge), select: RETAINER_CHARGE },
    recs: { delegate: d(prisma.receivable), select: RECEIVABLE },
    supps: { delegate: d(prisma.agreementSupplement), select: SUPPLEMENT },
    versions: { delegate: d(prisma.retainerVersion), select: RETAINER_VERSION },
    pays: { delegate: d(prisma.payment), select: PAYMENT },
    allocs: { delegate: d(prisma.paymentAllocation), select: ALLOCATION },
    credits: { delegate: d(prisma.receivableCredit), select: CREDIT },
    props: { delegate: d(prisma.feeProposal), select: FEE_PROPOSAL },
    exps: { delegate: d(prisma.expense), select: EXPENSE },
    expCats: { delegate: d(prisma.expenseCategory), select: EXPENSE_CATEGORY },
    expReceipts: { delegate: d(prisma.expenseReceipt), select: EXPENSE_RECEIPT },
    convs: { delegate: d(prisma.conversion), select: CONVERSION },
    expGroups: { delegate: d(prisma.expenseGroup), select: EXPENSE_GROUP },
    vendors: { delegate: d(prisma.vendor), select: VENDOR },
    vendorNames: { delegate: d(prisma.vendorName), select: VENDOR_NAME },
  };
}

function pageOf<T>(rows: Array<[string, T]>, limit: number): ExportPage<T> {
  const entries = rows.slice(0, limit);
  return { entries, nextKey: rows.length > limit ? (entries[entries.length - 1]?.[0] ?? null) : null };
}

/** `prisma` is read lazily: the store's constructor parameter isn't assigned yet when its fields initialise. */
export function prismaRecordsExport(client: () => PrismaClient): RecordsExportRepository {
  async function idPage<T>(delegate: IdKeyedDelegate, select: Record<string, true>, where: Record<string, unknown>, afterKey: string | null, limit: number): Promise<ExportPage<T>> {
    const rows = await delegate.findMany({ where: { ...where, ...(afterKey ? { id: { gt: afterKey } } : {}) }, select, orderBy: { id: 'asc' }, take: limit + 1 });
    return pageOf(rows.map((row) => [row.id, row as T]), limit);
  }

  /** Payment counters (`${org}:${year}`), then receivable counters (`${org}:CHG:${year}`, MUT-478): the memory store's keys. */
  async function counterPage(organizationId: string, afterKey: string | null, limit: number): Promise<ExportPage<number>> {
    const rest = afterKey ? afterKey.slice(organizationId.length + 1) : null;
    const receivablePrefix = `${RECEIVABLE_NUMBER_PREFIX}:`;
    const receivableRows = async (afterYear: number | null, take: number): Promise<Array<[string, number]>> =>
      (await client().receivableCounter.findMany({ where: { organizationId, ...(afterYear !== null ? { year: { gt: afterYear } } : {}) }, orderBy: { year: 'asc' }, take })).map((row) => [receivableCounterKey(organizationId, row.year), row.next]);
    if (rest?.startsWith(receivablePrefix)) return pageOf(await receivableRows(Number(rest.slice(receivablePrefix.length)), limit + 1), limit);
    const afterYear = rest !== null ? Number(rest) : null;
    const payments = (await client().paymentCounter.findMany({ where: { organizationId, ...(afterYear !== null ? { year: { gt: afterYear } } : {}) }, orderBy: { year: 'asc' }, take: limit + 1 })).map((row): [string, number] => [`${organizationId}:${row.year}`, row.next]);
    if (payments.length > limit) return pageOf(payments, limit);
    return pageOf([...payments, ...(await receivableRows(null, limit - payments.length + 1))], limit);
  }

  async function groupMarkPage(organizationId: string, afterKey: string | null, limit: number): Promise<ExportPage<ExpenseGroupOverrideRecord>> {
    const [groupId, expenseId] = afterKey ? afterKey.split(':') : [];
    const after = groupId && expenseId ? { OR: [{ groupId: { gt: groupId } }, { groupId, expenseId: { gt: expenseId } }] } : {};
    const rows = await client().expenseGroupOverride.findMany({ where: { organizationId, ...after }, select: GROUP_MARK, orderBy: [{ groupId: 'asc' }, { expenseId: 'asc' }], take: limit + 1 });
    return pageOf(rows.map((row): [string, ExpenseGroupOverrideRecord] => [`${row.groupId}:${row.expenseId}`, row as ExpenseGroupOverrideRecord]), limit);
  }

  return {
    profilePage: async <F extends ProfileExportField>(organizationId: string, field: F, afterKey: string | null, limit: number): Promise<ExportPage<ProfileExportRecords[F]>> => {
      if (field === 'counters') return (await counterPage(organizationId, afterKey, limit)) as ExportPage<ProfileExportRecords[F]>;
      if (field === 'groupMarks') return (await groupMarkPage(organizationId, afterKey, limit)) as ExportPage<ProfileExportRecords[F]>;
      const { delegate, select } = idKeyed(client())[field as Exclude<ProfileExportField, 'counters' | 'groupMarks'>];
      return idPage(delegate, select, { organizationId }, afterKey, limit);
    },
    inboxPage: (userId, afterKey, limit) => idPage(client().inboxEntry as unknown as IdKeyedDelegate, INBOX_ENTRY, { userId }, afterKey, limit),
    findExportableReceipt: async (organizationId, id) => {
      const row = await client().expenseReceipt.findFirst({ where: { id, organizationId, status: 'READY', deletedAt: null }, select: { storageKey: true, mimeType: true, sizeBytes: true } });
      return row && row.storageKey ? row : null;
    },
  };
}
