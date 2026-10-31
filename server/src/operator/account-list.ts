import { ApiError } from '../errors.js';
import type { OperatorAccountCursor } from '../repositories/ports.js';

/**
 * MUT-527: the operator console's list of every account. Newest sign-in first, never signed in last, then newest
 * created, then id descending, so the order is total and a cursor (the last row's key) continues it exactly. The
 * memory store sorts with `compareForOperatorList`; Postgres does the same in SQL.
 *
 * The cursor is opaque to the portal (base64url of `{ s, t, id }`) and unsigned: it carries nothing the operator can't
 * see, and only an operator reaches the route.
 */
export const OPERATOR_LIST_DEFAULT_LIMIT = 50;
export const OPERATOR_LIST_MAX_LIMIT = 100;

type Keyed = OperatorAccountCursor;

/** Negative when `a` comes first. */
export function compareForOperatorList(a: Keyed, b: Keyed): number {
  if (a.lastSignInAt === null || b.lastSignInAt === null) {
    if (a.lastSignInAt !== b.lastSignInAt) return a.lastSignInAt === null ? 1 : -1;
  } else {
    const signIn = b.lastSignInAt.getTime() - a.lastSignInAt.getTime();
    if (signIn !== 0) return signIn;
  }
  const created = b.createdAt.getTime() - a.createdAt.getTime();
  if (created !== 0) return created;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Whether `row` comes after the cursor's row in the list's order. */
export function isAfterOperatorCursor(row: Keyed, cursor: OperatorAccountCursor): boolean {
  return compareForOperatorList(row, cursor) > 0;
}

/** Case-insensitive "contains" on the email or the display name; a blank query matches everyone. */
export function matchesOperatorQuery(user: { email: string; displayName: string }, q: string | null): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return user.email.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle);
}

/** A trimmed query, or null when there is nothing to match. */
export function operatorQueryOf(q: string | undefined): string | null {
  const trimmed = q?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function encodeOperatorCursor(cursor: OperatorAccountCursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.lastSignInAt?.getTime() ?? null, t: cursor.createdAt.getTime(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeOperatorCursor(encoded: string): OperatorAccountCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== 'object') throw invalidCursor();
  const { s, t, id } = parsed as { s?: unknown; t?: unknown; id?: unknown };
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw invalidCursor();
  const createdAt = dateOf(t);
  const lastSignInAt = s === null ? null : dateOf(s);
  return { lastSignInAt, createdAt, id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateOf(value: unknown): Date {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidCursor();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidCursor();
  return date;
}

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued', { field: 'cursor' });
}
