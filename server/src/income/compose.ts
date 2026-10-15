import { assertIsoDate, todayFor, validationError } from '../agreements/compose.js';
import type { ProfileWriter } from '../auth/writability.js';
import { compareIsoDates, dueDateFor, type IsoDate } from '../dates.js';
import { profileOwnerOf } from '../personal-profile.js';
import type { LedgerStore, Organization, PaymentRecord } from '../repositories/ports.js';
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
 * DECISIONS.md). Distinct from `assertNotAbsurdDate` (agreements/compose.ts),
 * which only rejects a date more than ten years ahead: `POST /v1/payments`'s
 * `receivedOn` today applies only that ten-year ceiling, not a same-day cutoff,
 * so this is a new, stricter check for the two fields this ticket adds
 * (`occurredOn`, settle's `paidAt`), not a verbatim reuse of an existing one.
 */
export function assertNotFuture(date: IsoDate, today: IsoDate, field: string): void {
  if (compareIsoDates(date, today) > 0) throw validationError('DATE_INVALID', `${field} cannot be later than today`, { field });
}

/**
 * MUT-223: a date may be changed only on a profile the person owns (personal or self-service, MUT-182). A
 * Malafat-fed or firm profile is never theirs: Malafat owns allocations there, and a moved date would change its books.
 */
export function isOwnProfile(organization: Pick<Organization, 'ownerUserId' | 'personalOwnerUserId'>, userId: string): boolean {
  return profileOwnerOf(organization) === userId;
}

/** MUT-223: a payment a person may re-date — their own capture (settle's included), still POSTED. */
export function isOwnCapture(payment: Pick<PaymentRecord, 'origin' | 'createdByUserId' | 'status'>, userId: string): boolean {
  return payment.origin === 'CAPTURE' && payment.createdByUserId === userId && payment.status === 'POSTED';
}

/** MUT-223: the new date of a re-date — the same validity and no-future rule as create, in the organization's timezone. */
export function redateTo(raw: string, organization: Organization, now: Date, field: string): IsoDate {
  const date = assertIsoDate(raw, field);
  assertNotFuture(date, todayFor(organization, now), field);
  return date;
}
