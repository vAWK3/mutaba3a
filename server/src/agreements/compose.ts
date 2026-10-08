import { addDays, compareIsoDates, dueDateFor, isIsoDate, todayIn, type IsoDate, type PaymentTerms } from '../dates.js';
import { ApiError } from '../errors.js';
import { parseMoney, MoneyParseError, type Currency } from '../money.js';
import { previewToken } from '../preview-token.js';
import type { AgreementRecord, CustomerRecord, InstallmentRecord, LedgerStore, Organization, ProjectRecord } from '../repositories/ports.js';
import { itemStatus, type ItemStatus } from './status.js';
import { splitInstallments, type InstallmentSpec, type ScheduleError, type ScheduledInstallment } from './schedule.js';
import type { PricingBasis, VatTreatment } from '../vat.js';

/**
 * Composition for agreement previews and creates (brief §2.3): resolves the
 * project, customer, currency, VAT treatment default chain and the rate in
 * force, runs the pure schedule, and mints the preview token over everything
 * the outcome depended on (body + rate).
 */

export interface AgreementContext {
  project: ProjectRecord;
  customer: CustomerRecord;
  currency: Currency;
  defaultTreatment: VatTreatment;
  rateBasisPoints: number;
}

export function validationError(reason: string, message: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError('VALIDATION_FAILED', message, { reason, ...extra });
}

export function assertIsoDate(value: string, field: string): IsoDate {
  if (!isIsoDate(value)) throw validationError('DATE_INVALID', `${field} must be a valid YYYY-MM-DD date`, { field });
  return value;
}

export function parseAmount(text: string, currency: Currency, field = 'amount'): bigint {
  try {
    return parseMoney(text, currency).minor;
  } catch (err) {
    if (err instanceof MoneyParseError) throw validationError('AMOUNT_INVALID', err.message, { field });
    throw err;
  }
}

/** Treatment default chain: explicit → project → customer → STANDARD_RATED (brief rev. 2 §A). */
export function resolveTreatment(explicit: VatTreatment | undefined, project: ProjectRecord, customer: CustomerRecord): VatTreatment {
  return explicit ?? project.vatTreatment ?? customer.vatTreatment ?? 'STANDARD_RATED';
}

export async function loadAgreementContext(
  store: LedgerStore,
  organization: Organization,
  input: { projectId: string; currency?: string | undefined; vatTreatment?: VatTreatment | undefined; agreementDate: IsoDate },
): Promise<AgreementContext> {
  const project = await store.projects.getById(organization.id, input.projectId);
  if (!project) throw validationError('PROJECT_NOT_FOUND', 'projectId does not name a project of this organization', { field: 'projectId' });
  if (project.status === 'ARCHIVED') throw validationError('PROJECT_ARCHIVED', 'The project is archived', { field: 'projectId' });
  const customer = await store.customers.getById(organization.id, project.customerId);
  if (!customer) throw validationError('CUSTOMER_NOT_FOUND', 'The project has no customer', { field: 'projectId' });
  if (customer.status === 'ARCHIVED') throw validationError('CUSTOMER_ARCHIVED', 'The customer is archived', { field: 'projectId' });
  if (input.currency && input.currency !== project.currency) {
    throw validationError('CURRENCY_MISMATCH', `The project is in ${project.currency}`, { field: 'currency', projectCurrency: project.currency });
  }
  const defaultTreatment = resolveTreatment(input.vatTreatment, project, customer);
  const rateBasisPoints = await resolveRate(store, organization.id, input.agreementDate, defaultTreatment);
  return { project, customer, currency: project.currency as Currency, defaultTreatment, rateBasisPoints };
}

/**
 * The standard rate in force on `date`. Required when any item in the
 * agreement is STANDARD_RATED; `needed` lets callers skip the lookup when the
 * default treatment is not standard and no installment overrides to standard.
 */
export async function resolveRate(store: LedgerStore, organizationId: string, date: IsoDate, defaultTreatment: VatTreatment, overrides: readonly (VatTreatment | undefined)[] = []): Promise<number> {
  const needsRate = defaultTreatment === 'STANDARD_RATED' || overrides.includes('STANDARD_RATED');
  const rate = await store.vatRates.effectiveOn(organizationId, date);
  if (!rate) {
    if (!needsRate) return 0;
    throw validationError('VAT_RATE_MISSING', `No VAT rate is in force on ${date}; set one with PUT /v1/settings/vat`, { date });
  }
  return rate.rateBasisPoints;
}

export function scheduleOrThrow(input: Parameters<typeof splitInstallments>[0]): { items: ScheduledInstallment[]; totals: { amountMinor: bigint; netMinor: bigint; vatMinor: bigint; grossMinor: bigint } } {
  const result = splitInstallments(input);
  if (result.ok) return result;
  throw scheduleErrorToApi(result.error);
}

export function scheduleErrorToApi(error: ScheduleError): ApiError {
  const { reason, ...rest } = error;
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) extra[k] = typeof v === 'bigint' ? v.toString() : v;
  return validationError(reason, `Installments are invalid: ${reason}`, extra);
}

/** Specs from the wire into the pure schedule's shape (amounts parsed in the project currency). */
export function toInstallmentSpecs(
  raw: ReadonlyArray<{ label: string; amount?: string | undefined; percentBasisPoints?: number | undefined; vatTreatment?: VatTreatment | undefined; trigger: { type: 'IMMEDIATE' | 'DATE' | 'MANUAL'; date?: string | undefined }; paymentTerms?: PaymentTerms | undefined; dueDate?: string | undefined }>,
  currency: Currency,
): InstallmentSpec[] {
  return raw.map((r, i) => {
    if (r.trigger.type === 'DATE' && !r.trigger.date) throw validationError('TRIGGER_DATE_REQUIRED', `installments[${i}].trigger.date is required for a DATE trigger`, { position: i + 1 });
    if (r.trigger.date) assertIsoDate(r.trigger.date, `installments[${i}].trigger.date`);
    if (r.dueDate) assertIsoDate(r.dueDate, `installments[${i}].dueDate`);
    return {
      label: r.label,
      amount: r.amount === undefined ? undefined : parseAmount(r.amount, currency, `installments[${i}].amount`),
      percentBasisPoints: r.percentBasisPoints,
      vatTreatment: r.vatTreatment,
      trigger: { type: r.trigger.type, date: r.trigger.date },
      paymentTerms: r.paymentTerms,
      dueDate: r.dueDate,
    };
  });
}

export function agreementPreviewToken(organizationId: string, body: unknown, rateBasisPoints: number): string {
  return previewToken([organizationId, 'agreement', body, rateBasisPoints]);
}

export function retainerPreviewToken(organizationId: string, body: unknown, rateBasisPoints: number): string {
  return previewToken([organizationId, 'retainer', body, rateBasisPoints]);
}

/** Posting date an installment gets: IMMEDIATE → agreement date (or today if later); DATE → its date; MANUAL → today. */
export function postingDateFor(installment: Pick<InstallmentRecord, 'triggerType' | 'triggerDate'>, agreementDate: IsoDate, today: IsoDate): IsoDate {
  switch (installment.triggerType) {
    case 'IMMEDIATE':
      return compareIsoDates(agreementDate, today) > 0 ? agreementDate : today;
    case 'DATE':
      return installment.triggerDate ?? today;
    case 'MANUAL':
      return today;
  }
}

export function installmentDueDate(installment: Pick<InstallmentRecord, 'dueDateOverride' | 'paymentTerms'>, agreement: Pick<AgreementRecord, 'paymentTerms'>, postingDate: IsoDate): IsoDate {
  return installment.dueDateOverride ?? dueDateFor(postingDate, installment.paymentTerms ?? agreement.paymentTerms);
}

export function todayFor(organization: Organization, now: Date): IsoDate {
  return todayIn(organization.timezone, now);
}

/** View fields for an installment: the due date it has or would get, and its status. */
export function installmentView(installment: InstallmentRecord, agreement: AgreementRecord, today: IsoDate, paidMinor = 0n): { dueDate: IsoDate; status: ItemStatus } {
  const posted = installment.receivableId !== null;
  const postingDate = installment.postingDate ?? postingDateFor(installment, agreement.agreementDate, today);
  const dueDate = installmentDueDate(installment, agreement, postingDate);
  return { dueDate, status: itemStatus({ voided: installment.voidedAt !== null, posted, dueDate, grossMinor: installment.grossMinor, paidMinor, today }) };
}

export const DAYS_IN_FUTURE_LIMIT = 3660;

export function assertNotAbsurdDate(date: IsoDate, today: IsoDate, field: string): void {
  if (compareIsoDates(date, addDays(today, DAYS_IN_FUTURE_LIMIT)) > 0) throw validationError('DATE_INVALID', `${field} is more than ten years ahead`, { field });
}

export type { PricingBasis };
