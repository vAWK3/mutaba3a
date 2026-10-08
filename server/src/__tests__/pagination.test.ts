import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.js';
import { decodeCursor, encodeCursor, parseLimit, type PageCursor } from '../pagination.js';

describe('cursor pagination', () => {
  const at = new Date('2026-10-08T10:00:00.123Z');
  const id = '0f5c2a1e-7b3d-4c9a-9e1f-2a3b4c5d6e7f';

  it('round-trips (createdAt, id) through an opaque string', () => {
    const cursor: PageCursor = { createdAt: at, id };
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('keeps millisecond precision, which the (createdAt, id) order depends on', () => {
    const decoded = decodeCursor(encodeCursor({ createdAt: at, id }));
    expect(decoded.createdAt.getTime()).toBe(at.getTime());
  });

  it('rejects a tampered or foreign cursor with VALIDATION_FAILED', () => {
    for (const bad of ['', 'not-base64!', Buffer.from('{"x":1}').toString('base64url'), Buffer.from('{"t":"nope","id":"x"}').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(ApiError);
      try {
        decodeCursor(bad);
      } catch (err) {
        expect((err as ApiError).code).toBe('VALIDATION_FAILED');
      }
    }
  });

  it('parses limit with a default of 50 and a hard cap of 200', () => {
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit(1)).toBe(1);
    expect(parseLimit(200)).toBe(200);
    for (const bad of [0, -1, 201, 1.5, Number.NaN]) {
      expect(() => parseLimit(bad)).toThrow(ApiError);
    }
  });
});
