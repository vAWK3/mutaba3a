import { ApiError } from '../errors.js';
import type { AccountClosureRecord } from '../repositories/ports.js';

/**
 * MUT-333 (ADR-188): Close my account. The rules both stores, the routes and the hourly job share.
 *
 *   POST /v1/me/closure ──► closing (30 days' grace) ──► deleteAfter passes ──► hourly job claims ──► hard delete
 *                               │                            (gone to the person:      (purgeStartedAt)
 *                               │                             sign-in 401, sessions
 *                               ▼                             expire)
 *                     DELETE /v1/me/closure  (only before deleteAfter and before the claim)
 *
 * While closing, a session reaches only CLOSING_OPEN_ENDPOINTS; everything else is 403 ACCOUNT_CLOSING (D3).
 */

export const GRACE_DAYS = 30;
const DAY_MS = 86_400_000;
export const GRACE_MS = GRACE_DAYS * DAY_MS;
/** R16: the hourly job may run up to this long after deleteAfter; the mail's date allows for it. */
export const PURGE_JOB_LAG_MS = 60 * 60 * 1000;

/** D5: requestedAt + 30 × 24 h exactly. */
export function closureDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + GRACE_MS);
}

/** D3 / R8: what a closing session may still reach. A second close is not among them. */
export const CLOSING_OPEN_ENDPOINTS: ReadonlySet<string> = new Set([
  'GET /v1/me',
  'DELETE /v1/me/closure',
  'DELETE /v1/sessions/current',
  'DELETE /v1/device-sessions/current',
]);

export function closingRefusal(closure: Pick<AccountClosureRecord, 'deleteAfter'>): ApiError {
  return new ApiError('ACCOUNT_CLOSING', 'This account is closing: you can only keep it or sign out until it is deleted', {
    deleteAfter: closure.deleteAfter.toISOString(),
  });
}

/** D5, R1: past its deadline, or claimed by the hard delete, the account no longer signs in or keeps a session. */
export function isAccountGone(closure: Pick<AccountClosureRecord, 'deleteAfter' | 'purgeStartedAt'> | null, now: Date): boolean {
  if (!closure) return false;
  return closure.purgeStartedAt !== null || closure.deleteAfter.getTime() <= now.getTime();
}

/** D19: due only when both columns agree that the grace has run out. */
export function isDueForPurge(closure: Pick<AccountClosureRecord, 'requestedAt' | 'deleteAfter'> | null, now: Date): boolean {
  if (!closure) return false;
  return closure.deleteAfter.getTime() <= now.getTime() && closure.requestedAt.getTime() <= now.getTime() - GRACE_MS;
}

/** A Stripe subscription as close reads it, live (R6). */
export interface LiveSubscription {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
}

const ENDS_AT_PERIOD_END = new Set(['active', 'trialing']);
/** R7: cancel_at_period_end wouldn't stop Stripe retrying an open invoice during grace. */
const CANCELLED_NOW = new Set(['past_due', 'unpaid']);

/** D1, R7: what close does to each subscription. One already set to end is the person's own choice: left alone. */
export function subscriptionActionsAtClose(subscriptions: readonly LiveSubscription[]): { endAtPeriodEnd: string[]; cancelNow: string[] } {
  const endAtPeriodEnd: string[] = [];
  const cancelNow: string[] = [];
  for (const sub of subscriptions) {
    if (CANCELLED_NOW.has(sub.status)) cancelNow.push(sub.id);
    else if (ENDS_AT_PERIOD_END.has(sub.status) && !sub.cancelAtPeriodEnd && sub.cancelAt === null) endAtPeriodEnd.push(sub.id);
  }
  return { endAtPeriodEnd, cancelNow };
}

/** R16: the calendar day the account is deleted on, in `timeZone` (UTC when unknown), allowing for the job's lag. */
export function deletionDayOf(deleteAfter: Date, timeZone: string): { year: number; month: number; day: number } {
  const instant = new Date(deleteAfter.getTime() + PURGE_JOB_LAG_MS);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(instant);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(instant);
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}
