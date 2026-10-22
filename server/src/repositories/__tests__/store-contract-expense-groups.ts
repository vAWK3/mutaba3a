import { describe, expect, it } from 'vitest';
import { isGroupMember, windowEnd } from '../../expenses/groups.js';
import type { CreateExpenseInput, ExpenseCursor, ExpenseGroupFilter, ExpenseGroupOverrideMode, ExpenseGroupRecord, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-267 storage contract: expense groups and their keep/leave-out marks
 * (ADR-094). The membership filter must say exactly what `isGroupMember` says,
 * on memory and on Postgres alike — that parity is what makes the list totals,
 * the summary and the member list agree (re-review D1).
 */
export function describeLedgerStoreExpenseGroupsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, 0, ms));
  const org = (store: LedgerStore, label: string): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `g-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const expense = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
      organizationId: a.id, occurredOn: '2026-10-05', amountMinor: 1_000n, currency: 'JOD', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id, ...over,
    });
    const group = (over: Partial<{ name: string; startOn: string; endOn: string | null }> = {}) =>
      store.expenseGroups.create({ organizationId: a.id, name: 'Jordan trip', startOn: '2026-10-03', endOn: '2026-10-07', notes: null, createdByUserId: user.id, ...over }, at(1));
    return { a, b, user, expense, group };
  }

  const filterFor = (g: ExpenseGroupRecord, membership: ExpenseGroupFilter['membership'] = 'member'): ExpenseGroupFilter => ({ groupId: g.id, startOn: g.startOn, windowEnd: windowEnd(g), membership });

  async function listAll(store: LedgerStore, orgId: string, group: ExpenseGroupFilter, limit = 2): Promise<string[]> {
    const ids: string[] = [];
    let cursor: ExpenseCursor | null = null;
    do {
      const page = await store.expenses.list(orgId, { group }, { limit, cursor });
      ids.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor;
    } while (cursor);
    return ids;
  }

  describe(`${name} LedgerStore expense groups contract (MUT-267)`, () => {
    it('creates, reads, lists newest start first, updates with a version and soft-deletes a group, inside one organization', async () => {
      const store = await makeStore();
      const w = await world(store);
      const older = await w.group({ name: 'Amman', startOn: '2026-09-01', endOn: '2026-09-03' });
      const g = await w.group({ endOn: null });
      expect(g).toMatchObject({ organizationId: w.a.id, name: 'Jordan trip', startOn: '2026-10-03', endOn: null, notes: null, createdByUserId: w.user.id, version: 1, deletedAt: null });
      expect(await store.expenseGroups.getById(w.b.id, g.id)).toBeNull();
      expect((await store.expenseGroups.list(w.a.id)).map((x) => x.id)).toEqual([g.id, older.id]);
      expect(await store.expenseGroups.list(w.b.id)).toEqual([]);

      const updated = await store.expenseGroups.update(w.a.id, g.id, 1, { name: 'Jordan', endOn: '2026-10-09', notes: 'n' }, at(2));
      expect(updated).toMatchObject({ kind: 'updated', record: { name: 'Jordan', endOn: '2026-10-09', notes: 'n', version: 2 } });
      expect(await store.expenseGroups.update(w.a.id, g.id, 1, { name: 'x' }, at(3))).toMatchObject({ kind: 'stale', record: { version: 2 } });
      expect((await store.expenseGroups.update(w.a.id, g.id, 2, { endOn: null, notes: null }, at(3)))).toMatchObject({ kind: 'updated', record: { endOn: null, notes: null } });
      expect(await store.expenseGroups.update(w.b.id, g.id, 3, { name: 'x' }, at(4))).toEqual({ kind: 'not_found' });

      expect(await store.expenseGroups.softDelete(w.a.id, g.id, at(5))).toMatchObject({ changed: true });
      expect(await store.expenseGroups.softDelete(w.a.id, g.id, at(6))).toMatchObject({ changed: false });
      expect(await store.expenseGroups.getById(w.a.id, g.id)).toBeNull();
      expect(await store.expenseGroups.softDelete(w.b.id, older.id, at(6))).toBeNull();
      expect((await store.expenseGroups.list(w.a.id)).map((x) => x.id)).toEqual([older.id]);
    });

    it('caps live groups per organization under parallel creates; deleted groups free room (review: GROUP_LIMIT race)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const input = (i: number) => ({ organizationId: w.a.id, name: `g${i}`, startOn: '2026-10-03', endOn: null, notes: null, createdByUserId: w.user.id });
      for (let i = 0; i < 4; i++) await store.expenseGroups.create(input(i), at(1), 5);
      const results = await Promise.allSettled([5, 6, 7].map((i) => store.expenseGroups.create(input(i), at(2), 5)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) if (r.status === 'rejected') expect((r.reason as Error).name).toBe('InsufficientCapacity');
      const live = await store.expenseGroups.list(w.a.id);
      expect(live).toHaveLength(5);
      await store.expenseGroups.softDelete(w.a.id, live[0]!.id, at(3));
      await expect(store.expenseGroups.create(input(8), at(4), 5)).resolves.toMatchObject({ name: 'g8' });
      await expect(store.expenseGroups.create(input(9), at(4), 5)).rejects.toThrow(/insufficient capacity/);
      await expect(store.expenseGroups.create({ ...input(10), organizationId: w.b.id }, at(4), 5)).resolves.toMatchObject({ organizationId: w.b.id });
    });

    it('keeps one mark per (group, expense): last write wins, clear resets, marks are found per expense', async () => {
      const store = await makeStore();
      const w = await world(store);
      const g1 = await w.group();
      const g2 = await w.group({ name: 'Amman', startOn: '2026-10-05', endOn: '2026-10-06' });
      const e = await store.expenses.create(w.expense(), at(2));
      expect(await store.expenseGroups.setOverride(w.a.id, g1.id, e.id, 'excluded', at(3))).toMatchObject({ changed: true, record: { groupId: g1.id, expenseId: e.id, mode: 'excluded' } });
      expect(await store.expenseGroups.setOverride(w.a.id, g1.id, e.id, 'excluded', at(4))).toMatchObject({ changed: false, record: { mode: 'excluded', updatedAt: at(3) } });
      expect(await store.expenseGroups.setOverride(w.a.id, g1.id, e.id, 'included', at(4))).toMatchObject({ changed: true, record: { mode: 'included', createdAt: at(3), updatedAt: at(4) } });
      await store.expenseGroups.setOverride(w.a.id, g2.id, e.id, 'excluded', at(5));
      const marks = await store.expenseGroups.overridesForExpense(w.a.id, e.id);
      expect(marks.map((m) => [m.groupId, m.mode]).sort()).toEqual([[g1.id, 'included'], [g2.id, 'excluded']].sort());
      expect(await store.expenseGroups.overridesForExpense(w.b.id, e.id)).toEqual([]);
      expect(await store.expenseGroups.clearOverride(w.a.id, g1.id, e.id)).toBe(true);
      expect(await store.expenseGroups.clearOverride(w.a.id, g1.id, e.id)).toBe(false);
      expect(await store.expenseGroups.clearOverride(w.b.id, g2.id, e.id)).toBe(false);
      expect((await store.expenseGroups.overridesForExpense(w.a.id, e.id)).map((m) => m.groupId)).toEqual([g2.id]);
    });

    it('lists exactly the members isGroupMember names, paging without gaps or repeats, and excluded only inside the window', async () => {
      const store = await makeStore();
      const w = await world(store);
      const g = await w.group();
      const cases: Array<[string, ExpenseGroupOverrideMode | null]> = [
        ['2026-10-03', null], ['2026-10-05', null], ['2026-10-05', null], ['2026-10-07', null],
        ['2026-10-02', null], ['2026-10-08', null],
        ['2026-10-04', 'excluded'], ['2026-09-12', 'included'], ['2026-10-06', 'included'], ['2026-09-20', 'excluded'],
      ];
      const made: Array<{ id: string; occurredOn: string; mode: ExpenseGroupOverrideMode | null }> = [];
      for (const [i, [occurredOn, mode]] of cases.entries()) {
        const e = await store.expenses.create(w.expense({ occurredOn }), at(10 + i));
        if (mode) await store.expenseGroups.setOverride(w.a.id, g.id, e.id, mode, at(30 + i));
        made.push({ id: e.id, occurredOn, mode });
      }
      const other = await w.group({ name: 'Other' });
      await store.expenseGroups.setOverride(w.a.id, other.id, made[0]!.id, 'excluded', at(50));
      await store.expenses.create(w.expense({ organizationId: w.b.id }), at(51));

      const expected = made.filter((e) => isGroupMember(e, g, e.mode)).map((e) => e.id).sort();
      const members = await listAll(store, w.a.id, filterFor(g));
      expect(new Set(members).size).toBe(members.length);
      expect([...members].sort()).toEqual(expected);

      const excluded = await listAll(store, w.a.id, filterFor(g, 'excluded'));
      expect(excluded).toEqual([made[6]!.id]);
    });

    it('combines the group filter with other filters and with an inclusive (anchor) cursor', async () => {
      const store = await makeStore();
      const w = await world(store);
      const g = await w.group();
      const jod = await store.expenses.create(w.expense({ occurredOn: '2026-10-05' }), at(2));
      const usd = await store.expenses.create(w.expense({ occurredOn: '2026-10-04', currency: 'USD' }), at(3));
      await store.expenses.create(w.expense({ occurredOn: '2026-11-01' }), at(4));
      expect((await store.expenses.list(w.a.id, { group: filterFor(g), currency: 'USD' }, { limit: 10, cursor: null })).items.map((e) => e.id)).toEqual([usd.id]);
      const anchored = await store.expenses.list(w.a.id, { group: filterFor(g) }, { limit: 10, cursor: { occurredOn: jod.occurredOn, id: jod.id, inclusive: true } });
      expect(anchored.items.map((e) => e.id)).toEqual([jod.id, usd.id]);
    });

    it('an open group collects a year from its start and no later, unless kept (R6)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const g = await w.group({ startOn: '2025-10-03', endOn: null });
      const last = await store.expenses.create(w.expense({ occurredOn: '2026-10-03' }), at(2));
      const late = await store.expenses.create(w.expense({ occurredOn: '2026-10-04' }), at(3));
      const kept = await store.expenses.create(w.expense({ occurredOn: '2026-12-01' }), at(4));
      await store.expenseGroups.setOverride(w.a.id, g.id, kept.id, 'included', at(5));
      const members = await listAll(store, w.a.id, filterFor(g), 10);
      expect(members.sort()).toEqual([last.id, kept.id].sort());
      expect(members).not.toContain(late.id);
    });

    it('sums members per currency; an expense in two overlapping groups counts in both; deleted expenses leave every group', async () => {
      const store = await makeStore();
      const w = await world(store);
      const g1 = await w.group();
      const g2 = await w.group({ name: 'Amman', startOn: '2026-10-05', endOn: '2026-10-06' });
      await store.expenses.create(w.expense({ amountMinor: 1_500n }), at(2));
      await store.expenses.create(w.expense({ occurredOn: '2026-10-03', amountMinor: 500n }), at(3));
      await store.expenses.create(w.expense({ currency: 'USD', amountMinor: 4_000n, occurredOn: '2026-10-06' }), at(4));
      const gone = await store.expenses.create(w.expense({ amountMinor: 99_000n }), at(5));
      await store.expenses.softDelete(w.a.id, gone.id, at(6), 'unlink');

      expect(await store.expenses.totalsByCurrency(w.a.id, { group: filterFor(g1) })).toEqual([
        { currency: 'JOD', totalMinor: 2_000n, count: 2 },
        { currency: 'USD', totalMinor: 4_000n, count: 1 },
      ]);
      expect(await store.expenses.totalsByCurrency(w.a.id, { group: filterFor(g2) })).toEqual([
        { currency: 'JOD', totalMinor: 1_500n, count: 1 },
        { currency: 'USD', totalMinor: 4_000n, count: 1 },
      ]);
      expect(await store.expenses.totalsByCurrency(w.b.id, { group: filterFor(g1) })).toEqual([]);

      await store.expenseGroups.softDelete(w.a.id, g2.id, at(7));
      expect((await store.expenses.list(w.a.id, {}, { limit: 10, cursor: null })).items).toHaveLength(3);
    });
  });
}
