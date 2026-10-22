import { ApiError } from '../errors.js';
import type { ReceiptCursor } from '../repositories/ports.js';

/**
 * Keyset cursor for the receipts library (MUT-255), newest upload first by
 * (createdAt, id) — the same opaque base64url envelope as the expense cursor,
 * with an instant, so a cursor from another collection is refused, not misread.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeReceiptCursor(cursor: ReceiptCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeReceiptCursor(encoded: string): ReceiptCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const { t, id } = (parsed && typeof parsed === 'object' ? parsed : {}) as { t?: unknown; id?: unknown };
  const createdAt = typeof t === 'string' ? new Date(t) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime()) || typeof id !== 'string' || !UUID_RE.test(id)) throw invalidCursor();
  return { createdAt, id };
}

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued', { field: 'cursor' });
}
