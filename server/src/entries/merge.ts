import type { IsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import { decodeCursor, encodeCursor } from '../pagination.js';
import type { EntryRow, FeedOrder, MoneyDateCursor, Page, PageCursor } from '../repositories/ports.js';

/**
 * MUT-270: the entries feed's ordering, newest first by (createdAt, id) descending — the reverse of
 * `pagination.ts`, whose lists run oldest first. Both stores use these, so the memory store and Postgres
 * page identically.
 */

/** Strictly after the cursor in newest-first order: an older instant, or the same instant with a smaller id. */
export function isBeforeCursor(row: PageCursor, cursor: PageCursor): boolean {
  const dt = row.createdAt.getTime() - cursor.createdAt.getTime();
  if (dt !== 0) return dt < 0;
  return row.id < cursor.id;
}

/** Sort comparator: newest first, then id descending. */
export function compareNewestFirst(a: PageCursor, b: PageCursor): number {
  const dt = b.createdAt.getTime() - a.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * One page out of several branches (one per organization and kind), each fetched newest first with up to
 * `limit + 1` rows past the cursor. Taking the top `limit` of their union is exact: no row outside a branch's
 * first `limit + 1` can rank inside the page.
 */
export function mergeNewestFirst<T>(branches: readonly (readonly T[])[], limit: number, keyOf: (row: T) => PageCursor): Page<T> {
  return mergeTop(branches, limit, (a, b) => compareNewestFirst(keyOf(a), keyOf(b)), (last) => ({ createdAt: keyOf(last).createdAt, id: keyOf(last).id }));
}

// ── MUT-390: the money-date order ──────────────────────────────────────────
//
//   per org × kind, newest money day first ──▶ mergeByMoneyDate ──▶ page + { occurredOn, createdAt, id }
//
// Money dates are validated YYYY-MM-DD strings, so comparing them as strings is comparing the days.

/** Each kind's own money date: expense and conversion `occurredOn`, payment `receivedOn`, Owed `postingDate`. */
export function moneyDateOf(row: EntryRow): IsoDate {
  switch (row.kind) {
    case 'expense':
    case 'conversion':
      return row.record.occurredOn;
    case 'payment':
      return row.record.receivedOn;
    case 'receivable':
      return row.record.postingDate;
  }
}

/** A feed row's key in the money-date order; both stores page and merge by it. */
export function moneyDateKeyOf(row: EntryRow): MoneyDateCursor {
  return { occurredOn: moneyDateOf(row), createdAt: row.record.createdAt, id: row.record.id };
}

/** Sort comparator: newest money day first, then newest logged, then id descending. */
export function compareMoneyDateNewestFirst(a: MoneyDateCursor, b: MoneyDateCursor): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  return compareNewestFirst(a, b);
}

/** Strictly after the cursor in the money-date order: an earlier day, or the same day and before it in logged order. */
export function isBeforeMoneyDateCursor(row: MoneyDateCursor, cursor: MoneyDateCursor): boolean {
  if (row.occurredOn !== cursor.occurredOn) return row.occurredOn < cursor.occurredOn;
  return isBeforeCursor(row, cursor);
}

/** `mergeNewestFirst` for the money-date order: exact for the same reason, since the order is total. */
export function mergeByMoneyDate<T>(branches: readonly (readonly T[])[], limit: number, keyOf: (row: T) => MoneyDateCursor): { items: T[]; nextCursor: MoneyDateCursor | null } {
  return mergeTop(branches, limit, (a, b) => compareMoneyDateNewestFirst(keyOf(a), keyOf(b)), (last) => {
    const { occurredOn, createdAt, id } = keyOf(last);
    return { occurredOn, createdAt, id };
  });
}

/** The page's cursor for the money-date order. The route decodes cursors per order, so a logged-order one here is a bug. */
export function moneyDateCursorOf(cursor: PageCursor | MoneyDateCursor | null): MoneyDateCursor | null {
  if (cursor && !('occurredOn' in cursor)) throw new Error('A createdAt cursor cannot page the occurredOn order');
  return cursor;
}

/** The page's cursor for the default order: a money-date one would page by its createdAt alone, a silently wrong page. */
export function createdAtCursorOf(cursor: PageCursor | MoneyDateCursor | null): PageCursor | null {
  if (cursor && 'occurredOn' in cursor) throw new Error('An occurredOn cursor cannot page the createdAt order');
  return cursor;
}

function mergeTop<T, C>(branches: readonly (readonly T[])[], limit: number, compare: (a: T, b: T) => number, cursorOf: (last: T) => C): { items: T[]; nextCursor: C | null } {
  const ranked = branches.flat().sort(compare);
  const items = ranked.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: ranked.length > limit && last !== undefined ? cursorOf(last) : null };
}

/**
 * The feed's opaque cursor. The `createdAt` order keeps `pagination.ts`'s `{t, id}` byte for byte, so a cursor an
 * older client holds stays valid; the `occurredOn` order adds `k: 'o'` and the day. A cursor only pages the order
 * that issued it: one from the other order answers 422 rather than a wrong page.
 */
export function encodeFeedCursor(cursor: PageCursor | MoneyDateCursor): string {
  if (!('occurredOn' in cursor)) return encodeCursor(cursor);
  return Buffer.from(JSON.stringify({ k: 'o', o: cursor.occurredOn, t: cursor.createdAt.getTime(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeFeedCursor(encoded: string, order: 'createdAt'): PageCursor;
export function decodeFeedCursor(encoded: string, order: 'occurredOn'): MoneyDateCursor;
export function decodeFeedCursor(encoded: string, order: FeedOrder): PageCursor | MoneyDateCursor;
export function decodeFeedCursor(encoded: string, order: FeedOrder): PageCursor | MoneyDateCursor {
  const parsed = parseCursorJson(encoded);
  const isMoneyDate = !!parsed && typeof parsed === 'object' && 'k' in parsed;
  if (order === 'createdAt') {
    if (isMoneyDate) throw invalidFeedCursor();
    // pagination.ts answers anything else, so a request without the new params gets today's error, byte for byte.
    return decodeCursor(encoded);
  }
  if (!isMoneyDate) throw invalidFeedCursor();
  const { k, o, t, id } = parsed as { k?: unknown; o?: unknown; t?: unknown; id?: unknown };
  if (k !== 'o' || typeof o !== 'string' || !ISO_DATE_RE.test(o) || typeof t !== 'number' || typeof id !== 'string' || !UUID_RE.test(id)) throw invalidFeedCursor();
  const createdAt = new Date(t);
  // A finite number past ±8.64e15 ms is no date; Prisma would reject it as a 500.
  if (Number.isNaN(createdAt.getTime())) throw invalidFeedCursor();
  return { occurredOn: o, createdAt, id };
}

function parseCursorJson(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidFeedCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued for this order', { field: 'cursor' });
}
