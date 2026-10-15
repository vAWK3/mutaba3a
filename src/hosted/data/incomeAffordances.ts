import type { HostedProfile, Payment, Receivable, Schemas } from '../api/client';

/**
 * What income writes the portal offers on a profile (MUT-133, D-gate). One
 * function, read by every view: none of them branch on `owned` themselves.
 *
 * Only a profile the signed-in user owns gets write affordances — their
 * personal one, or one they created (MUT-182, either type). The published
 * `income` rules alone are not enough: a Malafat-fed profile also has
 * `received: true` since MUT-61, and the ticket keeps it read-only; a
 * writer-null firm is nobody's own either (ADR-066). Within an owned profile
 * the rules then shape the form. Add stands on the `capture` row
 * (POST /v1/income needs `capture:write`); settling stands on `payments`
 * (`payments:write`), and only Owed creates something to settle.
 */

export type IncomeKind = Schemas['IncomeKind'];

export interface IncomeAffordances {
  /** The kinds the Add drawer offers; empty means no Add button. */
  kinds: IncomeKind[];
  /** Whether Received may name no client ('optional') or needs one ('linked-required'). */
  customer: Schemas['IncomeCaptureRules']['customer'];
  /** Whether rows offer Record payment. */
  canSettle: boolean;
}

const CLOSED_STATUSES: ReadonlySet<Receivable['status']> = new Set(['PAID', 'VOID']);

export function incomeAffordancesFor(profile: HostedProfile): IncomeAffordances {
  const rules = profile.income;
  const owned = profile.owned;
  const kinds: IncomeKind[] =
    owned && profile.access.capture === 'read-write'
      ? (['received', 'owed'] as const).filter((kind) => rules[kind])
      : [];
  const canSettle = owned && profile.access.payments === 'read-write' && rules.owed;
  return { kinds, customer: rules.customer, canSettle };
}

/**
 * A row the settle route accepts: captured through POST /v1/income (origin
 * ADJUSTMENT; anything Malafat posted answers 404) and still open.
 */
export function isSettleable(receivable: Receivable): boolean {
  return receivable.origin === 'ADJUSTMENT' && !CLOSED_STATUSES.has(receivable.status);
}

/**
 * MUT-224: whether an Owed entry's date can be changed (PATCH /v1/income/{id}). Only on a profile the user owns
 * (the server answers 404 anywhere else), only an entry captured through POST /v1/income, and not a voided one.
 * A settled entry can still be re-dated: the server keeps its due date and its payments.
 */
export function canRedateOwed(profile: HostedProfile, receivable: Receivable): boolean {
  return redateAffordancesFor(profile).owed && receivable.origin === 'ADJUSTMENT' && receivable.status !== 'VOID';
}

/**
 * MUT-224: which re-date drawers a profile offers at all: what pages wire a row click to, and what a deep link may
 * open. Owned profiles only; PATCH /v1/income stands on `capture`, PATCH /v1/payments on `payments`.
 */
export function redateAffordancesFor(profile: HostedProfile): { owed: boolean; payments: boolean } {
  return {
    owed: profile.owned && profile.access.capture === 'read-write',
    payments: profile.owned && profile.access.payments === 'read-write',
  };
}

/**
 * MUT-224: whether a payment's date can be changed (PATCH /v1/payments/{id}): the user's own capture (a Received
 * entry or a settle payment), still posted, on a profile they own. A Malafat-fed profile never passes `owned`, so it
 * looks exactly as before; the server would answer 403 there anyway.
 */
export function canRedatePayment(profile: HostedProfile, payment: Payment, userId: string): boolean {
  return redateAffordancesFor(profile).payments && payment.origin === 'capture' && payment.status === 'POSTED' && payment.capturedBy?.userId === userId;
}
