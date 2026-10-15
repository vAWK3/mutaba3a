import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { addDays, todayIn } from '../../dates.js';
import { assertKind, inboxDate, parseInboxAmount } from '../compose.js';
import { decodeInboxCursor, encodeInboxCursor } from '../cursor.js';

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return `${err.code}:${(err.details as { reason?: string; field?: string } | undefined)?.reason ?? (err.details as { field?: string } | undefined)?.field ?? ''}`;
  }
  throw new Error('expected a refusal');
};

describe('inbox capture amounts (MUT-66)', () => {
  it('takes a positive amount in the currency’s own digits', () => {
    expect(parseInboxAmount('12.34', 'ILS')).toBe(1234n);
    expect(parseInboxAmount('0.01', 'USD')).toBe(1n);
  });

  it('refuses zero and negative amounts, with the existing reason', () => {
    expect(reasonOf(() => parseInboxAmount('0', 'ILS'))).toBe('VALIDATION_FAILED:AMOUNT_INVALID');
    expect(reasonOf(() => parseInboxAmount('-5.00', 'ILS'))).toBe('VALIDATION_FAILED:AMOUNT_INVALID');
  });
});

describe('inbox capture dates (MUT-66)', () => {
  const now = new Date('2026-10-12T09:00:00Z');

  it('takes a well-formed date', () => {
    expect(inboxDate('2026-10-05', now)).toBe('2026-10-05');
  });

  it('refuses a malformed one, with the existing reason', () => {
    expect(reasonOf(() => inboxDate('05/10/2026', now))).toBe('VALIDATION_FAILED:DATE_INVALID');
    expect(reasonOf(() => inboxDate('2026-13-01', now))).toBe('VALIDATION_FAILED:DATE_INVALID');
  });

  /**
   * A regression guard, not an oversight: capture has no organization, so it
   * has no timezone to answer "later than today" in. Filing applies the real
   * check. If someone "fixes" this by reflex, this test says why not.
   */
  it('accepts a future date at capture — the profile’s timezone decides that, at filing time', () => {
    expect(inboxDate('2099-01-01', now)).toBe('2099-01-01');
  });

  it('MUT-227: refuses a date more than ten years before UTC yesterday, naming the past bound', () => {
    expect(inboxDate('2016-10-03', now)).toBe('2016-10-03');
    expect(reasonOf(() => inboxDate('2016-10-02', now))).toBe('VALIDATION_FAILED:DATE_INVALID');
    expect(reasonOf(() => inboxDate('0001-01-01', now))).toBe('VALIDATION_FAILED:DATE_INVALID');
  });

  /** The lenient floor is never stricter than filing's exact one, in the earliest and the latest timezone on Earth. */
  it.each(['2026-10-12T00:30:00Z', '2026-10-12T11:59:00Z', '2026-10-12T12:30:00Z', '2026-10-12T23:30:00Z'])('MUT-227: at %s capture accepts every date any profile would file', (instant) => {
    const at = new Date(instant);
    for (const timezone of ['Etc/GMT+12', 'Pacific/Kiritimati', 'UTC', 'Asia/Jerusalem']) {
      const exactFloor = addDays(todayIn(timezone, at), -3660);
      expect(inboxDate(exactFloor, at)).toBe(exactFloor);
    }
  });
});

describe('filing the right kind (MUT-66)', () => {
  it('passes an entry through to its own route', () => {
    expect(() => assertKind({ kind: 'INCOME' }, 'INCOME')).not.toThrow();
    expect(() => assertKind({ kind: 'EXPENSE' }, 'EXPENSE')).not.toThrow();
  });

  it('refuses each entry at the other route with 409 ENTRY_KIND_MISMATCH', () => {
    expect(reasonOf(() => assertKind({ kind: 'INCOME' }, 'EXPENSE'))).toBe('CONFLICT:ENTRY_KIND_MISMATCH');
    expect(reasonOf(() => assertKind({ kind: 'EXPENSE' }, 'INCOME'))).toBe('CONFLICT:ENTRY_KIND_MISMATCH');
  });
});

describe('inbox cursors (MUT-66)', () => {
  const cursor = { createdAt: new Date('2026-10-12T08:30:00.123Z'), id: '2e4a85c0-baa0-438c-b9dd-beddf892e9ed' };

  it('round-trips, millisecond included', () => {
    expect(decodeInboxCursor(encodeInboxCursor(cursor))).toEqual(cursor);
  });

  it('refuses rubbish, a cursor from another collection, and a bad instant', () => {
    const expenseShaped = Buffer.from(JSON.stringify({ d: '2026-10-05', id: cursor.id }), 'utf8').toString('base64url');
    const badDate = Buffer.from(JSON.stringify({ c: 'not-a-date', id: cursor.id }), 'utf8').toString('base64url');
    const badId = Buffer.from(JSON.stringify({ c: cursor.createdAt.toISOString(), id: 'nope' }), 'utf8').toString('base64url');
    for (const bad of ['!!!', expenseShaped, badDate, badId]) {
      expect(reasonOf(() => decodeInboxCursor(bad)), bad).toBe('VALIDATION_FAILED:cursor');
    }
  });
});
