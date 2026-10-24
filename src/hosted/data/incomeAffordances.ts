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

/**
 * MUT-361: `writable` is the lapse gate for this profile (`useWriteGate().writable`); a READ_ONLY or LOCKED profile
 * offers no write at all. Every view passes it; the default is only for callers that ask what the profile allows in
 * principle (ReadOnlyNotice, whose reason the lapse banner already gives).
 */
export function incomeAffordancesFor(profile: HostedProfile, writable = true): IncomeAffordances {
  const rules = profile.income;
  const owned = profile.owned && writable;
  const kinds: IncomeKind[] =
    owned && profile.access.capture === 'read-write'
      ? (['received', 'owed'] as const).filter((kind) => rules[kind])
      : [];
  const canSettle = owned && profile.access.payments === 'read-write' && rules.owed;
  return { kinds, customer: rules.customer, canSettle };
}

/**
 * MUT-286: whether the client picker offers Add «name»; MUT-318: the matter picker too, since `projects` is
 * profile-dependent exactly like `customers` (server/src/auth/writability.ts). The same ownership gate as every other
 * portal write: the server lets a session write customers and matters on any writer-null profile (MUT-65), but a
 * writer-null firm is nobody's own (ADR-066), and Malafat writes the clients and matters of the profiles it feeds.
 * Every local profile is owned.
 */
export function canAddClient(profile: HostedProfile, writable = true): boolean {
  return writable && profile.owned && profile.writerOfRecord === null;
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
 * (the server answers 404 anywhere else), only an entry they captured through POST /v1/income — on a shared profile
 * (MUT-373) a partner's entry is theirs to re-date, as with payments — and not a voided one. A settled entry can
 * still be re-dated: the server keeps its due date and its payments.
 */
export function canRedateOwed(profile: HostedProfile, receivable: Receivable, userId: string, writable = true): boolean {
  return redateAffordancesFor(profile, writable).owed && receivable.origin === 'ADJUSTMENT' && receivable.status !== 'VOID' && receivable.capturedByUserId === userId;
}

/**
 * MUT-224: which re-date drawers a profile offers at all: what pages wire a row click to, and what a deep link may
 * open. Owned profiles only; PATCH /v1/income stands on `capture`, PATCH /v1/payments on `payments`.
 */
export function redateAffordancesFor(profile: HostedProfile, writable = true): { owed: boolean; payments: boolean } {
  return {
    owed: writable && profile.owned && profile.access.capture === 'read-write',
    payments: writable && profile.owned && profile.access.payments === 'read-write',
  };
}

/**
 * MUT-224: whether a payment's date can be changed (PATCH /v1/payments/{id}): the user's own capture (a Received
 * entry or a settle payment), still posted, on a profile they own. A Malafat-fed profile never passes `owned`, so it
 * looks exactly as before; the server would answer 403 there anyway.
 */
export function canRedatePayment(profile: HostedProfile, payment: Payment, userId: string, writable = true): boolean {
  return redateAffordancesFor(profile, writable).payments && payment.origin === 'capture' && payment.status === 'POSTED' && payment.capturedBy?.userId === userId;
}
