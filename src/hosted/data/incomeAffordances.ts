import type { HostedProfile, Payment, Receivable, Schemas } from '../api/client';
import { isZeroDecimal } from '../format/DecimalAmount';

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
/** MUT-392: an Owed dated ahead reads PENDING until its day, and the server refuses to settle it before then. */
const UNSETTLEABLE_STATUSES: ReadonlySet<Receivable['status']> = new Set([...CLOSED_STATUSES, 'PENDING']);

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
 * MUT-286: whether the client picker offers Add «name»; MUT-318: the matter picker too, since `projects` is
 * profile-dependent exactly like `customers` (server/src/auth/writability.ts). The same ownership gate as every other
 * portal write: the server lets a session write customers and matters on any writer-null profile (MUT-65), but a
 * writer-null firm is nobody's own (ADR-066), and Malafat writes the clients and matters of the profiles it feeds.
 * Every local profile is owned.
 */
export function canAddClient(profile: HostedProfile): boolean {
  return profile.owned && profile.writerOfRecord === null;
}

/**
 * A row the settle route accepts: captured through POST /v1/income (origin
 * ADJUSTMENT; anything Malafat posted answers 404), still open and not dated
 * ahead (PENDING, MUT-392).
 */
export function isSettleable(receivable: Receivable): boolean {
  return receivable.origin === 'ADJUSTMENT' && !UNSETTLEABLE_STATUSES.has(receivable.status);
}

/**
 * MUT-392 review: whether an Owed entry may be re-dated after today. Once money is applied to it (paid or credited),
 * the server pins it to today or earlier (409 MONEY_APPLIED), so the date picker stops at today.
 */
export function owedMayMoveAhead(receivable: Pick<Receivable, 'paid' | 'credited'>): boolean {
  return isZeroDecimal(receivable.paid) && isZeroDecimal(receivable.credited);
}

/**
 * MUT-224: whether an Owed entry's date can be changed (PATCH /v1/income/{id}). Only on a profile the user owns
 * (the server answers 404 anywhere else), only an entry they captured through POST /v1/income — on a shared profile
 * (MUT-373) a partner's entry is theirs to re-date, as with payments — and not a voided one. A settled entry can
 * still be re-dated: the server keeps its due date and its payments.
 */
export function canRedateOwed(profile: HostedProfile, receivable: Receivable, userId: string): boolean {
  return redateAffordancesFor(profile).owed && receivable.origin === 'ADJUSTMENT' && receivable.status !== 'VOID' && receivable.capturedByUserId === userId;
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
