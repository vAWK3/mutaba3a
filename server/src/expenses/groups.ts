import { assertIsoDate, assertNotAbsurdDate, assertNotTooOld, validationError } from '../agreements/compose.js';
import { addDays, compareIsoDates, type IsoDate } from '../dates.js';
import type { ExpenseGroupFilter, ExpenseGroupOverrideMode } from '../repositories/ports.js';

/**
 * Expense groups (MUT-267, ADR-094): a named date range on one profile whose
 * members are worked out when read, never stored. An expense belongs when it
 * is dated inside the group's window and not left out, or when it was kept
 * from outside it. Every store and route reads membership through these rules.
 */

/** A group covers at most this many calendar days, start and end included (eng review R2). */
export const MAX_GROUP_SPAN_DAYS = 366;

export const GROUP_NAME_MAX = 120;

/** Live groups a profile may hold: bounds the list's per-group aggregates (pre-landing review). */
export const MAX_GROUPS_PER_PROFILE = 200;

export interface GroupRange {
  startOn: IsoDate;
  endOn: IsoDate | null;
}

/** The last day a group collects: its end, or a year after its start when it is still going (R6). */
export function windowEnd(group: GroupRange): IsoDate {
  return group.endOn ?? addDays(group.startOn, MAX_GROUP_SPAN_DAYS - 1);
}

function inWindow(date: IsoDate, group: GroupRange): boolean {
  return compareIsoDates(date, group.startOn) >= 0 && compareIsoDates(date, windowEnd(group)) <= 0;
}

/** Kept wins; left out loses; otherwise the date decides (D4, D3 permissive marks). */
export function isGroupMember(expense: { occurredOn: IsoDate }, group: GroupRange, mode: ExpenseGroupOverrideMode | null): boolean {
  if (mode === 'included') return true;
  if (mode === 'excluded') return false;
  return inWindow(expense.occurredOn, group);
}

/** The ledger filter for a group: its members, or its left-out expenses dated inside its window (22A). */
export function groupFilter(group: GroupRange & { id: string }, membership: ExpenseGroupFilter['membership'] = 'member'): ExpenseGroupFilter {
  return { groupId: group.id, startOn: group.startOn, windowEnd: windowEnd(group), membership };
}

/**
 * The days the summary zero-fills (C2): a closed group's whole range; an open
 * group's start up to today, never past its window end and never before its start.
 */
export function seriesBounds(group: GroupRange, today: IsoDate): { from: IsoDate; to: IsoDate } {
  if (group.endOn) return { from: group.startOn, to: group.endOn };
  const end = windowEnd(group);
  const upTo = compareIsoDates(today, end) < 0 ? today : end;
  return { from: group.startOn, to: compareIsoDates(upTo, group.startOn) < 0 ? group.startOn : upTo };
}

export interface GroupFields {
  name: string;
  startOn: IsoDate;
  endOn: IsoDate | null;
  notes: string | null;
}

interface GroupBody {
  name?: string | undefined;
  startOn?: string | undefined;
  endOn?: string | null | undefined;
  notes?: string | null | undefined;
}

export function groupCreate(body: GroupBody & { name: string; startOn: string }, today: IsoDate): GroupFields {
  const startOn = groupDate(body.startOn, today, 'startOn');
  const endOn = body.endOn ? groupDate(body.endOn, today, 'endOn') : null;
  assertRange({ startOn, endOn });
  return { name: groupName(body.name), startOn, endOn, notes: body.notes ?? null };
}

/**
 * The fields a PATCH sets. The merged range is checked (C3), and a resent,
 * unchanged date skips the floor so an old group stays editable (as expensePatch does).
 */
export function groupPatch(existing: GroupFields, body: GroupBody, today: IsoDate): Partial<GroupFields> {
  const patch: Partial<GroupFields> = {};
  if (body.name !== undefined && body.name.trim() !== existing.name) patch.name = groupName(body.name);
  if (body.startOn !== undefined && body.startOn !== existing.startOn) patch.startOn = groupDate(body.startOn, today, 'startOn');
  if (body.endOn !== undefined && body.endOn !== existing.endOn) patch.endOn = body.endOn === null ? null : groupDate(body.endOn, today, 'endOn');
  if (body.notes !== undefined && body.notes !== existing.notes) patch.notes = body.notes;
  if (patch.startOn !== undefined || patch.endOn !== undefined) {
    assertRange({ startOn: patch.startOn ?? existing.startOn, endOn: patch.endOn !== undefined ? patch.endOn : existing.endOn });
  }
  return patch;
}

function groupName(raw: string): string {
  const name = raw.trim();
  if (!name) throw validationError('NAME_REQUIRED', 'A group needs a name', { field: 'name' });
  return name;
}

function groupDate(value: string, today: IsoDate, field: 'startOn' | 'endOn'): IsoDate {
  const date = assertIsoDate(value, field);
  assertNotTooOld(date, today, field);
  // Ten years ahead at most, like every bounded money date: keeps the window (start + 365) a four-digit-year date.
  assertNotAbsurdDate(date, today, field);
  return date;
}

function assertRange(range: GroupRange): void {
  if (!range.endOn) return;
  if (compareIsoDates(range.endOn, range.startOn) < 0) throw validationError('END_BEFORE_START', '`endOn` is before `startOn`', { field: 'endOn' });
  if (compareIsoDates(range.endOn, windowEnd({ startOn: range.startOn, endOn: null })) > 0) {
    throw validationError('GROUP_RANGE_TOO_LONG', `A group covers at most ${MAX_GROUP_SPAN_DAYS} days`, { field: 'endOn', maxDays: MAX_GROUP_SPAN_DAYS });
  }
}
