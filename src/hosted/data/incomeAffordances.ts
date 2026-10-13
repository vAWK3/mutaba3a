import type { HostedProfile, Receivable, Schemas } from '../api/client';

/**
 * What income writes the portal offers on a profile (MUT-133, D-gate). One
 * function, read by every view: none of them branch on `isPersonalDefault`
 * themselves.
 *
 * Only the signed-in user's own personal profile gets write affordances. The
 * published `income` rules alone are not enough: a Malafat-fed profile also
 * has `received: true` since MUT-61, and the ticket keeps it read-only; a
 * writer-null firm is not "personal" either (ADR-066). Within a personal
 * profile the rules then shape the form. Add stands on the `capture` row
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
  const personal = profile.isPersonalDefault;
  const kinds: IncomeKind[] =
    personal && profile.access.capture === 'read-write'
      ? (['received', 'owed'] as const).filter((kind) => rules[kind])
      : [];
  const canSettle = personal && profile.access.payments === 'read-write' && rules.owed;
  return { kinds, customer: rules.customer, canSettle };
}

/**
 * A row the settle route accepts: captured through POST /v1/income (origin
 * ADJUSTMENT; anything Malafat posted answers 404) and still open.
 */
export function isSettleable(receivable: Receivable): boolean {
  return receivable.origin === 'ADJUSTMENT' && !CLOSED_STATUSES.has(receivable.status);
}
