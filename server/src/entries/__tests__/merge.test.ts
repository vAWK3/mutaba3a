import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { encodeCursor } from '../../pagination.js';
import type { EntryRow, MoneyDateCursor } from '../../repositories/ports.js';
import { createdAtCursorOf, decodeFeedCursor, encodeFeedCursor, isBeforeCursor, isBeforeMoneyDateCursor, mergeByMoneyDate, mergeNewestFirst, moneyDateCursorOf, moneyDateOf } from '../merge.js';
import { decodeCursor } from '../../pagination.js';

/** MUT-270: one newest-first page out of per-organization, per-kind branches, each already newest first. */
type Row = { id: string; createdAt: Date };
const at = (iso: string) => new Date(`2026-10-18T${iso}Z`);
const row = (id: string, iso: string): Row => ({ id, createdAt: at(iso) });
const key = (r: Row) => r;

// UUID-shaped ids whose order is obvious: …01 < …02 < …
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('mergeNewestFirst', () => {
  it('interleaves branches newest first, breaking equal instants by id descending', () => {
    const expenses = [row(id(5), '10:00:03'), row(id(1), '10:00:00')];
    const payments = [row(id(4), '10:00:02'), row(id(2), '10:00:02')];
    const conversions = [row(id(3), '10:00:01')];

    const page = mergeNewestFirst([expenses, payments, [], conversions], 10, key);

    expect(page.items.map((r) => r.id)).toEqual([id(5), id(4), id(2), id(3), id(1)]);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a cursor at the last row only when more rows exist than the limit', () => {
    const a = [row(id(6), '10:00:06'), row(id(4), '10:00:04'), row(id(2), '10:00:02')];
    const b = [row(id(5), '10:00:05'), row(id(3), '10:00:03')];

    const page = mergeNewestFirst([a, b], 3, key);

    expect(page.items.map((r) => r.id)).toEqual([id(6), id(5), id(4)]);
    expect(page.nextCursor).toEqual({ createdAt: at('10:00:04'), id: id(4) });
  });

  it('has no cursor when the rows exactly fill the page', () => {
    const page = mergeNewestFirst([[row(id(2), '10:00:02')], [row(id(1), '10:00:01')]], 2, key);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('handles no branches and empty branches', () => {
    expect(mergeNewestFirst([], 20, key)).toEqual({ items: [], nextCursor: null });
    expect(mergeNewestFirst([[], []], 20, key)).toEqual({ items: [], nextCursor: null });
  });
});

describe('isBeforeCursor', () => {
  const cursor = { createdAt: at('10:00:05'), id: id(5) };

  it('is true for an older instant, or the same instant with a smaller id', () => {
    expect(isBeforeCursor(row(id(9), '10:00:04'), cursor)).toBe(true);
    expect(isBeforeCursor(row(id(4), '10:00:05'), cursor)).toBe(true);
  });

  it('is false for the cursor row itself and anything newer', () => {
    expect(isBeforeCursor(row(id(5), '10:00:05'), cursor)).toBe(false);
    expect(isBeforeCursor(row(id(6), '10:00:05'), cursor)).toBe(false);
    expect(isBeforeCursor(row(id(1), '10:00:06'), cursor)).toBe(false);
  });
});

/** MUT-390: the money-date order, newest money day first, then newest logged, then id descending. */
type MoneyRow = MoneyDateCursor;
const money = (id: string, occurredOn: string, iso: string): MoneyRow => ({ id, occurredOn, createdAt: at(iso) });

describe('mergeByMoneyDate', () => {
  it('orders by money day, then by when it was logged, then by id, all descending', () => {
    const expenses = [money(id(1), '2026-10-20', '10:00:00'), money(id(2), '2026-10-14', '10:00:09')];
    const payments = [money(id(4), '2026-10-20', '10:00:05'), money(id(3), '2026-10-20', '10:00:05')];
    const conversions = [money(id(5), '2026-10-25', '09:00:00')]; // a future-dated row sorts above today's

    const page = mergeByMoneyDate([expenses, payments, conversions], 10, (r) => r);

    expect(page.items.map((r) => r.id)).toEqual([id(5), id(4), id(3), id(1), id(2)]);
    expect(page.nextCursor).toBeNull();
  });

  it('puts the money date in the cursor', () => {
    const page = mergeByMoneyDate([[money(id(3), '2026-10-20', '10:00:03'), money(id(2), '2026-10-19', '10:00:02')], [money(id(1), '2026-10-18', '10:00:01')]], 2, (r) => r);

    expect(page.items.map((r) => r.id)).toEqual([id(3), id(2)]);
    expect(page.nextCursor).toEqual({ occurredOn: '2026-10-19', createdAt: at('10:00:02'), id: id(2) });
  });
});

describe('isBeforeMoneyDateCursor', () => {
  const cursor: MoneyDateCursor = { occurredOn: '2026-10-20', createdAt: at('10:00:05'), id: id(5) };

  it('is true for an earlier day, the same day logged earlier, or the same day and instant with a smaller id', () => {
    expect(isBeforeMoneyDateCursor(money(id(9), '2026-10-19', '23:00:00'), cursor)).toBe(true);
    expect(isBeforeMoneyDateCursor(money(id(9), '2026-10-20', '10:00:04'), cursor)).toBe(true);
    expect(isBeforeMoneyDateCursor(money(id(4), '2026-10-20', '10:00:05'), cursor)).toBe(true);
  });

  it('is false for the cursor row, a later day, or the same day logged later', () => {
    expect(isBeforeMoneyDateCursor(money(id(5), '2026-10-20', '10:00:05'), cursor)).toBe(false);
    expect(isBeforeMoneyDateCursor(money(id(1), '2026-10-21', '01:00:00'), cursor)).toBe(false);
    expect(isBeforeMoneyDateCursor(money(id(1), '2026-10-20', '10:00:06'), cursor)).toBe(false);
  });
});

describe('moneyDateOf', () => {
  it("reads each kind's own money date", () => {
    const rows = [
      { kind: 'expense', record: { occurredOn: '2026-10-01' } },
      { kind: 'payment', record: { receivedOn: '2026-10-02' } },
      { kind: 'receivable', record: { postingDate: '2026-10-03', dueDate: '2026-10-31' } },
      { kind: 'conversion', record: { occurredOn: '2026-10-04' } },
    ] as unknown as EntryRow[];

    expect(rows.map(moneyDateOf)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });
});

describe('feed cursors', () => {
  const logged = { createdAt: at('10:00:05'), id: id(5) };
  const byMoney: MoneyDateCursor = { occurredOn: '2026-10-20', ...logged };
  const raw = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const rejects = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'cursor' } });
      return;
    }
    throw new Error('expected a 422');
  };

  it('round-trips each order, and keeps the logged-order cursor exactly as before', () => {
    expect(encodeFeedCursor(logged)).toBe(encodeCursor(logged));
    expect(decodeFeedCursor(encodeFeedCursor(logged), 'createdAt')).toEqual(logged);
    expect(decodeFeedCursor(encodeFeedCursor(byMoney), 'occurredOn')).toEqual(byMoney);
  });

  it('rejects a cursor from the other order, both ways', () => {
    rejects(() => decodeFeedCursor(encodeFeedCursor(logged), 'occurredOn'));
    rejects(() => decodeFeedCursor(encodeFeedCursor(byMoney), 'createdAt'));
  });

  it('keeps the default order\'s error for a cursor that is not one, byte for byte', () => {
    for (const garbage of ['%%%', raw({ t: 'x', id: id(5) }), raw(null)]) {
      let before: unknown;
      try {
        decodeCursor(garbage);
      } catch (err) {
        before = err;
      }
      let after: unknown;
      try {
        decodeFeedCursor(garbage, 'createdAt');
      } catch (err) {
        after = err;
      }
      expect(after).toEqual(before);
      expect((after as ApiError).message).toBe((before as ApiError).message);
    }
  });

  it('rejects a money-date cursor whose instant is not a date', () => {
    rejects(() => decodeFeedCursor(raw({ k: 'o', o: '2026-10-20', t: 1e16, id: id(5) }), 'occurredOn'));
  });

  it('rejects a malformed money-date cursor', () => {
    rejects(() => decodeFeedCursor(raw({ k: 'o', o: '2026-10', t: 1, id: id(5) }), 'occurredOn'));
    rejects(() => decodeFeedCursor(raw({ k: 'o', o: '2026-10-20', t: 'x', id: id(5) }), 'occurredOn'));
    rejects(() => decodeFeedCursor(raw({ k: 'o', o: '2026-10-20', t: 1, id: 'nope' }), 'occurredOn'));
    rejects(() => decodeFeedCursor('%%%', 'occurredOn'));
    rejects(() => decodeFeedCursor('%%%', 'createdAt'));
  });
});

describe('cursor guards in the stores', () => {
  const logged = { createdAt: at('10:00:05'), id: id(5) };
  const byMoney: MoneyDateCursor = { occurredOn: '2026-10-20', ...logged };

  it('lets each order take only its own cursor', () => {
    expect(moneyDateCursorOf(byMoney)).toBe(byMoney);
    expect(moneyDateCursorOf(null)).toBeNull();
    expect(() => moneyDateCursorOf(logged)).toThrow();
    expect(createdAtCursorOf(logged)).toBe(logged);
    expect(createdAtCursorOf(null)).toBeNull();
    expect(() => createdAtCursorOf(byMoney)).toThrow();
  });
});
