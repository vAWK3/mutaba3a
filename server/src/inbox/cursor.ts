import { ApiError } from '../errors.js';
import type { InboxEntryCursor } from '../repositories/ports.js';

/**
 * Keyset cursor for the inbox, newest first by (createdAt, id) — the same
 * opaque base64url envelope as `pagination.ts` and `expenses/cursor.ts`, with
 * its own key names so a cursor issued by another collection is refused rather
 * than misread.
 *
 * The inbox orders by capture instant, not by `occurredOn`: an entry is a
 * running list of what you just logged, so a backdated capture belongs at the
 * top where you put it, not buried among last month's.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeInboxCursor(cursor: InboxEntryCursor): string {
  return Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeInboxCursor(encoded: string): InboxEntryCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const { c, id } = (parsed && typeof parsed === 'object' ? parsed : {}) as { c?: unknown; id?: unknown };
  if (typeof c !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) throw invalidCursor();
  const createdAt = new Date(c);
  if (Number.isNaN(createdAt.getTime())) throw invalidCursor();
  return { createdAt, id };
}

function invalidCursor(): ApiError {
  return new ApiError('VALIDATION_FAILED', 'cursor is not a cursor this API issued', { field: 'cursor' });
}
