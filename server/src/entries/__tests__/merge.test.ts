import { describe, expect, it } from 'vitest';
import { isBeforeCursor, mergeNewestFirst } from '../merge.js';

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
