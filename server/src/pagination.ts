import { ApiError } from './errors.js';
import type { PageCursor } from './repositories/ports.js';

/**
 * Keyset pagination over (createdAt, id) — contract §1 "Pagination".
 *
 * The cursor is opaque to clients: base64url of a tiny JSON envelope. It is
 * not signed because it carries nothing a caller could not already see, and
 * every list query is organization-scoped by the key, so a borrowed cursor
 * cannot reach another organization's rows.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type { PageCursor };

export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt.getTime(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string): PageCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== 'object') throw invalidCursor();
  const { t, id } = parsed as { t?: unknown; id?: unknown };
  if (typeof t !== 'number' || !Number.isFinite(t) || typeof id !== 'string' || !UUID_RE.test(id)) throw invalidCursor();
  return { createdAt: new Date(t), id };
}

export function parseLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new ApiError('VALIDATION_FAILED', `limit must be an integer between 1 and ${MAX_LIMIT}`, { field: 'limit' });
  }
  return value;
}

/** Keyset comparison shared by the in-memory store (Postgres does it in SQL). */
export function isAfterCursor(row: PageCursor, cursor: PageCursor): boolean {
  const dt = row.createdAt.getTime() - cursor.createdAt.getTime();
  if (dt !== 0) return dt > 0;
  return row.id > cursor.id;
}

export function compareByCreatedAtThenId(a: PageCursor, b: PageCursor): number {
  const dt = a.createdAt.getTime() - b.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued', { field: 'cursor' });
}
