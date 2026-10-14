import { describe, expect, it } from 'vitest';
import type { CreateConversionInput, LedgerStore, Organization } from '../ports.js';

/** MUT-161 storage contract: conversions on hosted profiles. MUT-194 (ADR-075): optimistic update and soft delete, like expenses. */
export function describeLedgerStoreConversionsContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 11, 10, 0, 0, ms));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const conversion = (over: Partial<CreateConversionInput> = {}): CreateConversionInput => ({
      organizationId: a.id,
      occurredOn: '2026-10-05',
      amountMinor: 10_000n,
      currency: 'USD',
      toAmountMinor: 36_500n,
      toCurrency: 'ILS',
      notes: null,
      createdByUserId: user.id,
      ...over,
    });
    return { a, b, user, conversion };
  }

  describe(`${name} LedgerStore conversions contract (MUT-161)`, () => {
    it('creates and reads a conversion with every field, inside one organization only', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.conversions.create(w.conversion({ notes: 'Transferred to ILS account', amountMinor: 9_007_199_254_740_993n }), at(1));
      expect(created).toMatchObject({
        organizationId: w.a.id,
        occurredOn: '2026-10-05',
        amountMinor: 9_007_199_254_740_993n,
        currency: 'USD',
        toAmountMinor: 36_500n,
        toCurrency: 'ILS',
        notes: 'Transferred to ILS account',
        createdByUserId: w.user.id,
        createdAt: at(1),
      });
      expect(await store.conversions.getById(w.a.id, created.id)).toEqual(created);
      expect(await store.conversions.getById(w.b.id, created.id)).toBeNull();
    });

    it('lists newest first by (occurredOn, id), paginated without gaps or repeats, with every filter', async () => {
      const store = await makeStore();
      const w = await world(store);
      const dates = ['2026-10-01', '2026-10-03', '2026-10-03', '2026-10-03', '2026-10-07', '2026-09-30'];
      const made = [];
      for (const [i, d] of dates.entries()) made.push(await store.conversions.create(w.conversion({ occurredOn: d, ...(i === 2 ? { currency: 'EUR', toCurrency: 'JOD' } : {}) }), at(i)));
      await store.conversions.create(w.conversion({ organizationId: w.b.id }), at(9));

      const seen: string[] = [];
      let cursor = null;
      do {
        const page = await store.conversions.list(w.a.id, {}, { limit: 2, cursor });
        seen.push(...page.items.map((x) => x.id));
        cursor = page.nextCursor;
      } while (cursor);
      const expected = [...made].sort((x, y) => (x.occurredOn === y.occurredOn ? (x.id < y.id ? 1 : -1) : x.occurredOn < y.occurredOn ? 1 : -1)).map((x) => x.id);
      expect(seen).toEqual(expected);

      const ids = async (filter: Parameters<LedgerStore['conversions']['list']>[1]) => (await store.conversions.list(w.a.id, filter, { limit: 50, cursor: null })).items.map((x) => x.id).sort();
      expect(await ids({ from: '2026-10-03', to: '2026-10-03' })).toEqual([made[1]!.id, made[2]!.id, made[3]!.id].sort());
      expect(await ids({ from: '2026-10-04' })).toEqual([made[4]!.id]);
      expect(await ids({ to: '2026-09-30' })).toEqual([made[5]!.id]);
      // currency matches either leg.
      expect(await ids({ currency: 'EUR' })).toEqual([made[2]!.id]);
      expect(await ids({ currency: 'JOD' })).toEqual([made[2]!.id]);
      expect(await ids({ currency: 'USD' })).toEqual([made[0]!.id, made[1]!.id, made[3]!.id, made[4]!.id, made[5]!.id].sort());
    });

    it('an inclusive cursor starts the page at that conversion, including it, and continues exclusively (MUT-91 anchor)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const dates = ['2026-10-07', '2026-10-03', '2026-10-03', '2026-10-03', '2026-10-01'];
      const made = [];
      for (const [i, d] of dates.entries()) made.push(await store.conversions.create(w.conversion({ occurredOn: d }), at(i)));
      const order = [...made].sort((x, y) => (x.occurredOn === y.occurredOn ? (x.id < y.id ? 1 : -1) : x.occurredOn < y.occurredOn ? 1 : -1));
      // A same-day tie: the anchor sits in the middle of the three 2026-10-03 rows.
      const target = order[2]!;

      const page = await store.conversions.list(w.a.id, {}, { limit: 2, cursor: { occurredOn: target.occurredOn, id: target.id, inclusive: true } });
      expect(page.items.map((x) => x.id)).toEqual([order[2]!.id, order[3]!.id]);
      expect(page.nextCursor).toEqual({ occurredOn: order[3]!.occurredOn, id: order[3]!.id });

      const rest = await store.conversions.list(w.a.id, {}, { limit: 50, cursor: page.nextCursor });
      expect(rest.items.map((x) => x.id)).toEqual([order[4]!.id]);

      // Filters still apply: the anchor's own day only.
      const sameDay = await store.conversions.list(w.a.id, { from: '2026-10-03', to: '2026-10-03' }, { limit: 50, cursor: { occurredOn: target.occurredOn, id: target.id, inclusive: true } });
      expect(sameDay.items.map((x) => x.id)).toEqual([order[2]!.id, order[3]!.id]);
    });
    it('MUT-194: a new conversion starts at version 1, updatedAt = createdAt, not deleted', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.conversions.create(w.conversion(), at(1));
      expect(created).toMatchObject({ version: 1, createdAt: at(1), updatedAt: at(1), deletedAt: null });
    });

    it('MUT-194: update applies at the expected version, bumps it and stamps updatedAt; a stale version returns the current record', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.conversions.create(w.conversion({ notes: 'first' }), at(1));
      const updated = await store.conversions.update(w.a.id, created.id, 1, { amountMinor: 12_000n, currency: 'EUR', toAmountMinor: 12_345n, toCurrency: 'JOD', occurredOn: '2026-10-04', notes: null }, at(2));
      expect(updated.kind).toBe('updated');
      if (updated.kind !== 'updated') return;
      expect(updated.record).toMatchObject({ id: created.id, version: 2, updatedAt: at(2), createdAt: at(1), amountMinor: 12_000n, currency: 'EUR', toAmountMinor: 12_345n, toCurrency: 'JOD', occurredOn: '2026-10-04', notes: null });
      expect(await store.conversions.getById(w.a.id, created.id)).toEqual(updated.record);

      // An absent key leaves the field unchanged.
      const notesOnly = await store.conversions.update(w.a.id, created.id, 2, { notes: 'again' }, at(3));
      expect(notesOnly.kind === 'updated' && notesOnly.record).toMatchObject({ version: 3, amountMinor: 12_000n, currency: 'EUR', notes: 'again' });

      const stale = await store.conversions.update(w.a.id, created.id, 1, { notes: 'late' }, at(4));
      expect(stale.kind).toBe('stale');
      expect(stale.kind === 'stale' && stale.record).toMatchObject({ version: 3, notes: 'again' });
    });

    it('MUT-194: update is not_found for an unknown id, another organization, or a deleted row', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.conversions.create(w.conversion(), at(1));
      expect(await store.conversions.update(w.a.id, '00000000-0000-4000-8000-0000000000ab', 1, { notes: 'x' }, at(2))).toEqual({ kind: 'not_found' });
      expect(await store.conversions.update(w.b.id, created.id, 1, { notes: 'x' }, at(2))).toEqual({ kind: 'not_found' });
      await store.conversions.softDelete(w.a.id, created.id, at(3));
      expect(await store.conversions.update(w.a.id, created.id, 1, { notes: 'x' }, at(4))).toEqual({ kind: 'not_found' });
    });

    it('MUT-194: softDelete is changed once, then unchanged, null for an unknown id; deleted rows leave get and list', async () => {
      const store = await makeStore();
      const w = await world(store);
      const kept = await store.conversions.create(w.conversion({ occurredOn: '2026-10-01' }), at(1));
      const gone = await store.conversions.create(w.conversion({ occurredOn: '2026-10-02' }), at(2));
      const first = await store.conversions.softDelete(w.a.id, gone.id, at(3));
      expect(first?.changed).toBe(true);
      expect(first?.record).toMatchObject({ id: gone.id, deletedAt: at(3) });
      const again = await store.conversions.softDelete(w.a.id, gone.id, at(4));
      expect(again?.changed).toBe(false);
      expect(again?.record.deletedAt).toEqual(at(3));
      expect(await store.conversions.softDelete(w.a.id, '00000000-0000-4000-8000-0000000000ac', at(5))).toBeNull();
      expect(await store.conversions.softDelete(w.b.id, kept.id, at(5))).toBeNull();

      expect(await store.conversions.getById(w.a.id, gone.id)).toBeNull();
      const listed = await store.conversions.list(w.a.id, {}, { limit: 50, cursor: null });
      expect(listed.items.map((x) => x.id)).toEqual([kept.id]);
    });
  });
}
