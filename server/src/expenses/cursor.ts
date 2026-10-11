import { isIsoDate } from '../dates.js';
import { ApiError } from '../errors.js';
import type { ExpenseCursor } from '../repositories/ports.js';

/**
 * Keyset cursor for the expense ledger, newest first by (occurredOn, id) —
 * the same opaque base64url envelope as `pagination.ts`, with a date instead
 * of an instant, so a cursor from another collection is refused, not misread.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeExpenseCursor(cursor: ExpenseCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.occurredOn, id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeExpenseCursor(encoded: string): ExpenseCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const { d, id } = (parsed && typeof parsed === 'object' ? parsed : {}) as { d?: unknown; id?: unknown };
  if (typeof d !== 'string' || !isIsoDate(d) || typeof id !== 'string' || !UUID_RE.test(id)) throw invalidCursor();
  return { occurredOn: d, id };
}

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued', { field: 'cursor' });
}
