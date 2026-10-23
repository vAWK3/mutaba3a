import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, parseAmount, validationError } from '../agreements/compose.js';
import { addDays, todayIn, type IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { isSupportedCurrency, type Currency } from '../money.js';
import type { InboxEntryKind } from '../repositories/ports.js';

/**
 * Capture-time rules for the unsorted inbox (MUT-66). Entirely pure: an
 * unsorted entry names no client, no matter and no profile, so there is
 * nothing to look up. Everything relational — and every rule that needs a
 * profile, including the future-date check — belongs to filing, and is the
 * existing `expenses/compose.ts` and `income/compose.ts` code, reused.
 */

/** An inbox amount: canonical in the currency's digits, greater than zero — the same floor an expense or an income entry has. */
export function parseInboxAmount(text: string, currency: Currency): bigint {
  const minor = parseAmount(text, currency);
  if (minor <= 0n) throw validationError('AMOUNT_INVALID', 'An amount must be greater than zero', { field: 'amount' });
  return minor;
}

/**
 * The capture date: a valid date, refused only when more than ten years old (MUT-227) or ahead (MUT-392), both leniently (below).
 *
 * Deliberately NOT rejected for being in the future, unlike `POST /v1/income`:
 * "later than today" is only answerable in some organization's timezone, and
 * an unsorted entry has no organization yet. The check happens at filing time,
 * against the chosen profile's own timezone (ADR-022's whole history is a
 * record of what guessing a timezone costs). A regression test pins this.
 *
 * MUT-227: the ten-year floor is checked here too, but leniently, so a typo
 * year is refused while the person is still looking at it. Measured from UTC's
 * yesterday, which is at or before every timezone's today: capture can never
 * refuse a date that filing (exact, in the profile's timezone) would accept.
 *
 * MUT-392 review: the ten-year ceiling the same way, from UTC's tomorrow (at or
 * after every timezone's today), so a typo year ahead is refused here too
 * instead of sitting in the inbox that no destination will file.
 */
export function inboxDate(value: string, now: Date): IsoDate {
  const date = assertIsoDate(value, 'occurredOn');
  assertNotTooOld(date, addDays(todayIn('UTC', now), -1), 'occurredOn');
  assertNotAbsurdDate(date, addDays(todayIn('UTC', now), 1), 'occurredOn');
  return date;
}

/**
 * The entry is destined for the route being called. A correct client never
 * trips this — the kind is visible on every entry it lists — so this is a
 * defensive 409, checked before any store call so a mismatch can never consume
 * the entry.
 */
/**
 * MUT-388 (ADR-166): filing copies the entry's currency into a new record, outside the request schema's enum. An
 * entry captured while a since-removed code was supported must not become a new record in it. Changing the entry's
 * currency (with its amount) first, then filing, still works.
 */
export function assertFilableCurrency(entry: { currency: string }): void {
  if (!isSupportedCurrency(entry.currency)) {
    throw validationError('UNSUPPORTED_CURRENCY', `${entry.currency} is no longer supported. Change this entry's currency, then file it`, { field: 'currency' });
  }
}

export function assertKind(entry: { kind: InboxEntryKind }, expected: InboxEntryKind): void {
  if (entry.kind !== expected) {
    throw new ApiError('CONFLICT', `This entry was captured as ${entry.kind.toLowerCase()}, and cannot be filed as the other kind`, { reason: 'ENTRY_KIND_MISMATCH' });
  }
}
