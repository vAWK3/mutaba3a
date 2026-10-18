import type { Page, PageCursor } from '../repositories/ports.js';

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
  const ranked = branches.flat().sort((a, b) => compareNewestFirst(keyOf(a), keyOf(b)));
  const items = ranked.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor = ranked.length > limit && last !== undefined ? { createdAt: keyOf(last).createdAt, id: keyOf(last).id } : null;
  return { items, nextCursor };
}
