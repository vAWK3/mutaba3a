import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, todayFor, validationError, type DateBound } from '../agreements/compose.js';
import type { ProfileWriter } from '../auth/writability.js';
import { compareIsoDates, dueDateFor, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { ownsProfile } from '../personal-profile.js';
import type { LedgerStore, MembershipRole, Organization, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';
import type { VatTreatment } from '../vat.js';

/**
 * Income capture rules shared by routes/income.ts and routes/receivables.ts's
 * settle route (MUT-65 brief §4). Pure except for the lookups that check a
 * link belongs to the profile — mirrors expenses/compose.ts's shape.
 */

export type IncomeKind = 'received' | 'owed';

export interface IncomeLinks {
  customerId: string | null;
  projectId: string | null;
}

/** Which client a capture may name: any (or none), or only one Malafat knows. */
export type CaptureCustomerRule = 'optional' | 'linked-required';

/** What a person may capture on a profile — published per profile by GET /v1/me, enforced by POST /v1/income. */
export interface IncomeCaptureRules {
  received: boolean;
  owed: boolean;
  /** For Received; Owed always needs a client wherever it is allowed. */
  customer: CaptureCustomerRule;
}

/**
 * MUT-61. On a Malafat-fed profile a person may record money they were handed
 * (Received) against a client Malafat knows, and Malafat allocates it; what is
 * owed comes from Malafat's fee agreements, so Owed is not theirs to write. A
 * personal profile keeps MUT-65's rules. The one source for the route and
 * /v1/me, so the app never has to hardcode either.
 */
export function incomeCaptureRulesFor(writer: ProfileWriter): IncomeCaptureRules {
  return writer === 'MALAFAT' ? { received: true, owed: false, customer: 'linked-required' } : { received: true, owed: true, customer: 'optional' };
}

/**
 * A client and matter link inside the profile (expenses/compose.ts's
 * resolveLinks rule verbatim: a project alone brings its customer; both must
 * agree; archived ones may be linked), plus: Owed requires a customer,
 * explicit or resolved from a project (MUT-65), and under `linked-required`
 * (MUT-61) Received does too — one Malafat has an ExternalReference for, so
 * Malafat can find and allocate the payment — in the matter's currency, when a
 * matter is named (`currency` is only checked under `linked-required`).
 */
export async function resolveIncomeLinks(store: LedgerStore, organizationId: string, kind: IncomeKind, requested: IncomeLinks, currency: string, rules: IncomeCaptureRules): Promise<IncomeLinks> {
  const resolved = await resolveLinks(store, organizationId, requested);
  if (kind === 'owed' && !resolved.customerId) {
    throw validationError('CUSTOMER_REQUIRED_FOR_OWED', 'Owed requires a client', { field: 'customerId' });
  }
  if (kind === 'received' && rules.customer === 'linked-required') {
    if (!resolved.customerId) throw validationError('CUSTOMER_REQUIRED', 'A client is required on this profile', { field: 'customerId' });
    const references = await store.externalReferences.findByEntities(organizationId, 'CUSTOMER', [resolved.customerId]);
    if (!references.some((r) => r.provider === 'MALAFAT')) throw validationError('CUSTOMER_NOT_LINKED', 'This client is not linked to Malafat', { field: 'customerId' });
    // Malafat allocates only within a payment's currency, and a matter's receivables are in its currency: a capture in
    // another currency could never be allocated to them. (A client-only capture is not checked — a client has no one
    // currency — and a matter's currency can still change until it has an agreement; both accepted in the review.)
    const project = resolved.projectId ? await store.projects.getById(organizationId, resolved.projectId) : null;
    if (project && project.currency !== currency) throw validationError('CURRENCY_MISMATCH', `This matter is in ${project.currency}`, { field: 'currency', projectCurrency: project.currency });
  }
  return resolved;
}

async function resolveLinks(store: LedgerStore, organizationId: string, requested: IncomeLinks): Promise<IncomeLinks> {
  if (requested.projectId) {
    const project = await store.projects.getById(organizationId, requested.projectId);
    if (!project) throw validationError('PROJECT_NOT_FOUND', 'No such project in this profile', { field: 'projectId' });
    if (requested.customerId && requested.customerId !== project.customerId) {
      throw validationError('PROJECT_CUSTOMER_MISMATCH', 'The project belongs to another client', { field: 'customerId' });
    }
    return { customerId: project.customerId, projectId: project.id };
  }
  if (requested.customerId) {
    const customer = await store.customers.getById(organizationId, requested.customerId);
    if (!customer) throw validationError('CUSTOMER_NOT_FOUND', 'No such client in this profile', { field: 'customerId' });
    return { customerId: customer.id, projectId: null };
  }
  return { customerId: null, projectId: null };
}

/** Owed's due date: the explicit one, or EOM_15 of occurredOn (ticket owner's resolved decision) — the existing dueDateFor helper, not a reimplementation. */
export function dueDateForOwed(occurredOn: IsoDate, explicit: IsoDate | undefined): IsoDate {
  return explicit ?? dueDateFor(occurredOn, 'EOM_15');
}

/**
 * MUT-392 (D3): the due date an Owed gets when it is re-dated. MUT-223 keeps the stored one, unless the new date has
 * passed it (only possible since an Owed may move forward): then the default for the new date, so an entry is never
 * due before its own date. `undefined` = keep it.
 */
export function dueDateAfterRedate(dueDate: IsoDate, occurredOn: IsoDate): IsoDate | undefined {
  return compareIsoDates(dueDate, occurredOn) < 0 ? dueDateForOwed(occurredOn, undefined) : undefined;
}

/**
 * MUT-392 review: an explicit Owed due date on create or file-as-income. Never before the entry's own date (an entry
 * hidden until its day must not read overdue on it, the rule D3 keeps for re-dates) and not more than ten years
 * ahead. Absent → EOM_15 of occurredOn.
 */
export function owedDueDate(raw: string | undefined, occurredOn: IsoDate, today: IsoDate): IsoDate {
  if (!raw) return dueDateForOwed(occurredOn, undefined);
  const dueDate = assertIsoDate(raw, 'dueDate');
  if (compareIsoDates(dueDate, occurredOn) < 0) throw validationError('DATE_INVALID', 'dueDate may not be before occurredOn', { field: 'dueDate' });
  assertNotAbsurdDate(dueDate, today, 'dueDate');
  return dueDate;
}

/**
 * MUT-392 review: money already applied to an Owed (paid, credited or settled) pins it to today or earlier. Dated
 * ahead, the entry and the payment applied to it would drop out of every paid total until the new date. Decided on
 * the read the versioned write is conditional on, and a settle bumps the version, so a settle in between is a 409.
 */
export function assertOwedMayMoveTo(r: Pick<ReceivableRecord, 'paidMinor' | 'creditedMinor' | 'status'>, occurredOn: IsoDate, today: IsoDate): void {
  if (compareIsoDates(occurredOn, today) <= 0) return;
  if (r.paidMinor > 0n || r.creditedMinor > 0n || r.status !== 'OPEN') {
    throw new ApiError('CONFLICT', 'Money has been applied to this entry, so it cannot be dated after today', { reason: 'MONEY_APPLIED' });
  }
}

export interface OwedVatFields {
  vatTreatment: VatTreatment;
  vatRateBasisPoints: number;
  netMinor: bigint;
  vatMinor: bigint;
  grossMinor: bigint;
}

/**
 * A captured "Owed" is always OUT_OF_SCOPE VAT at a zero rate (deliberate
 * simplification, brief §4.1) — regardless of any VatRate configured on the
 * organization. A future, VAT-aware capture is an explicit follow-up, not
 * this ticket; this function exists so that never happens by accident.
 */
export function owedVatFields(amountMinor: bigint): OwedVatFields {
  return { vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, netMinor: amountMinor, vatMinor: 0n, grossMinor: amountMinor };
}

/**
 * ADR-038's rule — a payment date is never later than today; backdating is
 * accepted — ported to the server (MUT-65 addendum to ADR-038; see
 * DECISIONS.md). Since MUT-392 (ADR-169) it binds money that has moved
 * (Received, settle, conversions); an Owed may be dated ahead, see
 * `incomeMoneyDate`. Distinct from `assertNotAbsurdDate` (agreements/compose.ts),
 * which only rejects a date more than ten years ahead: `POST /v1/payments`'s
 * `receivedOn` applies that ten-year ceiling and MUT-227's floor, but no
 * same-day cutoff, so this is a stricter check for the income-like dates
 * (`occurredOn`, settle's `paidAt`), not a verbatim reuse of an existing one.
 */
export function assertNotFuture(date: IsoDate, today: IsoDate, field: string): void {
  if (compareIsoDates(date, today) > 0) throw validationError('DATE_INVALID', `${field} cannot be later than today`, { field, bound: 'future' satisfies DateBound });
}

/**
 * MUT-227: a money date that has already happened — a valid date, not later than today, not more than ten years
 * back. One call for every income-like date (create, settle, re-date, conversions, filing) so the three checks
 * cannot drift apart again.
 */
export function pastMoneyDate(raw: string, today: IsoDate, field: string): IsoDate {
  const date = assertIsoDate(raw, field);
  assertNotFuture(date, today, field);
  assertNotTooOld(date, today, field);
  return date;
}

/**
 * MUT-392 (ADR-169): an income date by kind. Received money has moved, so it keeps `pastMoneyDate`; an Owed is work
 * you may log before it is dated, so it may be up to ten years ahead (the ceiling payments and agreements already
 * use) and not more than ten years back.
 */
export function incomeMoneyDate(raw: string, kind: IncomeKind, today: IsoDate, field: string): IsoDate {
  if (kind === 'received') return pastMoneyDate(raw, today, field);
  const date = assertIsoDate(raw, field);
  assertNotAbsurdDate(date, today, field);
  assertNotTooOld(date, today, field);
  return date;
}

/**
 * MUT-223: a date may be changed only on a profile the person owns (personal or self-service, MUT-182, or co-owned,
 * MUT-373). A Malafat-fed or firm profile is never theirs: Malafat owns allocations there, and a moved date would
 * change its books.
 */
export function isOwnProfile(organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId' | 'profileType'>, userId: string, role: MembershipRole | null): boolean {
  return ownsProfile(organization, userId, role);
}

/** MUT-223: a payment a person may re-date — their own capture (settle's included), still POSTED. */
export function isOwnCapture(payment: Pick<PaymentRecord, 'origin' | 'createdByUserId' | 'status'>, userId: string): boolean {
  return payment.origin === 'CAPTURE' && payment.createdByUserId === userId && payment.status === 'POSTED';
}

/** MUT-223: the new date of a re-date — the same rules as create for that kind (MUT-227's floor, MUT-392's Owed ceiling), in the organization's timezone. */
export function redateTo(raw: string, kind: IncomeKind, organization: Organization, now: Date, field: string): IsoDate {
  return incomeMoneyDate(raw, kind, todayFor(organization, now), field);
}
