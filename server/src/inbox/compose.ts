import { assertIsoDate, parseAmount, validationError } from '../agreements/compose.js';
import type { IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import type { Currency } from '../money.js';
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
 * The capture date, validated as a date and nothing more.
 *
 * Deliberately NOT rejected for being in the future, unlike `POST /v1/income`:
 * "later than today" is only answerable in some organization's timezone, and
 * an unsorted entry has no organization yet. The check happens at filing time,
 * against the chosen profile's own timezone (ADR-022's whole history is a
 * record of what guessing a timezone costs). A regression test pins this.
 */
export function inboxDate(value: string): IsoDate {
  return assertIsoDate(value, 'occurredOn');
}

/**
 * The entry is destined for the route being called. A correct client never
 * trips this — the kind is visible on every entry it lists — so this is a
 * defensive 409, checked before any store call so a mismatch can never consume
 * the entry.
 */
export function assertKind(entry: { kind: InboxEntryKind }, expected: InboxEntryKind): void {
  if (entry.kind !== expected) {
    throw new ApiError('CONFLICT', `This entry was captured as ${entry.kind.toLowerCase()}, and cannot be filed as the other kind`, { reason: 'ENTRY_KIND_MISMATCH' });
  }
}
