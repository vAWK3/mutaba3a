import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { encodeCursor } from '../../pagination.js';
import { decodeExpenseCursor, encodeExpenseCursor } from '../cursor.js';

const ID = '3f1c2b9e-8d4a-4f6b-9c1e-2a7d5e8f0b13';

describe('expense cursor (newest first by occurredOn, id)', () => {
  it('round-trips', () => {
    expect(decodeExpenseCursor(encodeExpenseCursor({ occurredOn: '2026-10-05', id: ID }))).toEqual({ occurredOn: '2026-10-05', id: ID });
  });

  it.each([
    ['garbage', 'not-a-cursor'],
    ['a list cursor from another collection', encodeCursor({ createdAt: new Date(), id: ID })],
    ['a bad date', Buffer.from(JSON.stringify({ d: '2026-13-40', id: ID })).toString('base64url')],
    ['a bad id', Buffer.from(JSON.stringify({ d: '2026-10-05', id: 'x' })).toString('base64url')],
  ])('refuses %s with 422 on the cursor field', (_label, raw) => {
    try {
      decodeExpenseCursor(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('VALIDATION_FAILED');
      expect((err as ApiError).details).toEqual({ field: 'cursor' });
    }
  });
});
