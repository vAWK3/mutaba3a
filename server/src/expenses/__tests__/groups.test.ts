import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { groupCreate, groupPatch, isGroupMember, MAX_GROUP_SPAN_DAYS, seriesBounds, windowEnd } from '../groups.js';

const TODAY = '2026-10-18';
const closed = { startOn: '2026-10-03', endOn: '2026-10-07' };
const open = { startOn: '2026-10-03', endOn: null };

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApiError) return (err.details as { reason?: string } | undefined)?.reason;
    throw err;
  }
  return undefined;
}

describe('windowEnd (MUT-267 R6: a group covers at most a year, open or closed)', () => {
  it('is the end date of a closed group', () => {
    expect(windowEnd(closed)).toBe('2026-10-07');
  });

  it('is a year after the start for an open group', () => {
    expect(windowEnd(open)).toBe('2027-10-03');
  });
});

describe('isGroupMember (MUT-267 D4: in the window and not left out, or kept)', () => {
  it.each([
    ['in range, no mark', '2026-10-05', null, true],
    ['first day', '2026-10-03', null, true],
    ['last day', '2026-10-07', null, true],
    ['day before', '2026-10-02', null, false],
    ['day after', '2026-10-08', null, false],
    ['in range, left out', '2026-10-05', 'excluded', false],
    ['out of range, kept', '2026-09-12', 'included', true],
    ['in range, kept', '2026-10-05', 'included', true],
    ['out of range, left out', '2026-09-12', 'excluded', false],
  ] as const)('closed group: %s', (_label, occurredOn, mode, expected) => {
    expect(isGroupMember({ occurredOn }, closed, mode)).toBe(expected);
  });

  it('an open group collects up to a year after its start and nothing later (R6)', () => {
    expect(isGroupMember({ occurredOn: '2027-10-03' }, open, null)).toBe(true);
    expect(isGroupMember({ occurredOn: '2027-10-04' }, open, null)).toBe(false);
    expect(isGroupMember({ occurredOn: '2027-10-04' }, open, 'included')).toBe(true);
  });
});

describe('seriesBounds (MUT-267 C2: the day series never runs backwards)', () => {
  it('spans a closed group, future days included', () => {
    expect(seriesBounds({ startOn: '2026-10-15', endOn: '2026-10-25' }, TODAY)).toEqual({ from: '2026-10-15', to: '2026-10-25' });
  });

  it('runs an open group up to today', () => {
    expect(seriesBounds(open, TODAY)).toEqual({ from: '2026-10-03', to: TODAY });
  });

  it('stops an open group at its window end, however long ago it started', () => {
    expect(seriesBounds({ startOn: '2025-01-01', endOn: null }, TODAY)).toEqual({ from: '2025-01-01', to: '2026-01-01' });
  });

  it('is the start day alone for an open group that starts in the future', () => {
    expect(seriesBounds({ startOn: '2026-11-12', endOn: null }, TODAY)).toEqual({ from: '2026-11-12', to: '2026-11-12' });
  });
});

describe('groupCreate (MUT-267 range rules, 422 like every route)', () => {
  it('trims the name and keeps an open end', () => {
    expect(groupCreate({ name: '  Jordan trip ', startOn: '2026-10-03' }, TODAY)).toEqual({ name: 'Jordan trip', startOn: '2026-10-03', endOn: null, notes: null });
  });

  it('refuses a blank name', () => {
    expect(reasonOf(() => groupCreate({ name: '   ', startOn: '2026-10-03' }, TODAY))).toBe('NAME_REQUIRED');
  });

  it('refuses an end before the start', () => {
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2026-10-07', endOn: '2026-10-03' }, TODAY))).toBe('END_BEFORE_START');
  });

  it('allows a one-day group and a full 366-day span, refuses 367 days', () => {
    expect(groupCreate({ name: 'x', startOn: '2026-10-03', endOn: '2026-10-03' }, TODAY).endOn).toBe('2026-10-03');
    expect(MAX_GROUP_SPAN_DAYS).toBe(366);
    expect(groupCreate({ name: 'x', startOn: '2026-01-01', endOn: '2027-01-01' }, TODAY).endOn).toBe('2027-01-01');
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2026-01-01', endOn: '2027-01-02' }, TODAY))).toBe('GROUP_RANGE_TOO_LONG');
  });

  it('refuses dates more than ten years ahead, so the window stays in four-digit years (review: year-9999 summary 500)', () => {
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2036-10-24', endOn: '2036-10-25' }, TODAY))).toBeUndefined();
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2036-10-27' }, TODAY))).toBe('DATE_INVALID');
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '9998-12-31', endOn: '9999-12-31' }, TODAY))).toBe('DATE_INVALID');
  });

  it('refuses invalid dates and dates more than ten years back (MUT-227 floor)', () => {
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2026-02-30' }, TODAY))).toBe('DATE_INVALID');
    expect(reasonOf(() => groupCreate({ name: 'x', startOn: '2010-01-01' }, TODAY))).toBe('DATE_INVALID');
  });
});

describe('groupPatch (MUT-267 C3: the merged range is what gets checked)', () => {
  const existing = { name: 'Jordan trip', startOn: '2026-10-03', endOn: '2026-10-07', notes: null };

  it('checks an endOn-only patch against the stored start', () => {
    expect(reasonOf(() => groupPatch(existing, { endOn: '2026-10-01' }, TODAY))).toBe('END_BEFORE_START');
  });

  it('checks a startOn-only patch against the stored end, span included', () => {
    expect(reasonOf(() => groupPatch(existing, { startOn: '2025-10-01' }, TODAY))).toBe('GROUP_RANGE_TOO_LONG');
  });

  it('null clears the end (still going) and the notes', () => {
    expect(groupPatch({ ...existing, notes: 'n' }, { endOn: null, notes: null }, TODAY)).toEqual({ endOn: null, notes: null });
  });

  it('does not re-check an unchanged start that is already past the floor', () => {
    const old = { ...existing, startOn: '2016-01-01', endOn: '2016-06-01' };
    expect(groupPatch(old, { startOn: '2016-01-01', name: 'Renamed' }, TODAY)).toEqual({ name: 'Renamed' });
  });

  it('refuses a blank name and ignores a name that only differs by surrounding spaces', () => {
    expect(reasonOf(() => groupPatch(existing, { name: '   ' }, TODAY))).toBe('NAME_REQUIRED');
    expect(groupPatch(existing, { name: '  Jordan trip ' }, TODAY)).toEqual({});
    expect(groupPatch({ ...existing, notes: 'n' }, { notes: 'n', startOn: existing.startOn, endOn: existing.endOn }, TODAY)).toEqual({});
  });

  it('refuses moving a date past the floor', () => {
    expect(reasonOf(() => groupPatch(existing, { startOn: '2010-01-01', endOn: '2010-02-01' }, TODAY))).toBe('DATE_INVALID');
  });
});
