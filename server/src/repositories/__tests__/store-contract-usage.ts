import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { UsageKind, UsagePlan } from '../../usage/kinds.js';
import type { LedgerStore, RouteUsageDelta, UsageEventInput } from '../ports.js';

/**
 * MUT-735 storage contract (ADR-281): the usage ledger and its counters. An event is written once per (kind,
 * entityKey) and moves its meter once; with a cap the counter stops at it and nothing is written; the reports read
 * counters and events in grouped queries; route aggregates add up; prune keeps what retention keeps. Run against the
 * memory store and Postgres. Each test owns a month far in the past, so shared databases never mix them.
 */
export function describeLedgerStoreUsageContract(name: string, makeStore: () => Promise<LedgerStore>, options: { concurrent?: boolean } = {}): void {
  const months = new Set<string>();
  /** A month no other test (or earlier run on a kept database) is likely to use: years 2100–2999; the prune test owns the 1800s. */
  const ownMonth = () => {
    for (;;) {
      const m = `${2100 + Math.floor(Math.random() * 900)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`;
      if (!months.has(m)) {
        months.add(m);
        return m;
      }
    }
  };
  const subject = () => `user:${randomUUID()}`;
  const event = (over: Partial<UsageEventInput> & { month: string; subjectKey: string }): UsageEventInput => ({
    occurredAt: new Date(`${over.month}-15T10:00:00Z`),
    actorUserId: null,
    organizationId: null,
    kind: 'DOCUMENT_ISSUED',
    detail: 'TAX_INVOICE',
    plan: 'solo',
    door: 'PORTAL',
    entityKey: randomUUID(),
    ...over,
  });
  const record = (store: LedgerStore, month: string, subjectKey: string, n: number, over: Partial<UsageEventInput> = {}) =>
    Promise.all(Array.from({ length: n }, () => store.usage.record(event({ month, subjectKey, ...over }), null)));
  const countOf = async (store: LedgerStore, subjectKey: string, month: string, meter: 'DOCUMENTS' | 'SCANS' = 'DOCUMENTS') =>
    (await store.usage.countersFor(subjectKey, [month])).find((c) => c.meter === meter)!.count;

  describe(`${name} LedgerStore usage contract (MUT-735)`, () => {
    it('records an event and moves its meter; the same (kind, entityKey) again writes and counts nothing', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const payer = subject();
      const first = event({ month, subjectKey: payer, entityKey: randomUUID() });
      expect(await store.usage.record(first, null)).toEqual({ kind: 'recorded', count: 1 });
      expect(await store.usage.record({ ...first, occurredAt: new Date(`${month}-16T10:00:00Z`) }, null)).toEqual({ kind: 'duplicate' });
      expect(await countOf(store, payer, month)).toBe(1);
      expect((await store.usage.rollup(month)).find((r) => r.kind === 'DOCUMENT_ISSUED')?.events).toBe(1);
    });

    it('a kind with no meter is recorded and counts nothing', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const payer = subject();
      expect(await store.usage.record(event({ month, subjectKey: payer, kind: 'EXTERNAL_INVOICE_READ', detail: null }), null)).toEqual({ kind: 'recorded', count: null });
      expect(await store.usage.countersFor(payer, [month])).toEqual([
        { subjectKey: payer, month, meter: 'DOCUMENTS', count: 0, plan: 'none' },
        { subjectKey: payer, month, meter: 'SCANS', count: 0, plan: 'none' },
      ]);
    });

    it('with a cap the meter moves only under it; at the cap nothing is written; no cap always counts', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const payer = subject();
      expect(await store.usage.record(event({ month, subjectKey: payer }), 2)).toEqual({ kind: 'recorded', count: 1 });
      expect(await store.usage.record(event({ month, subjectKey: payer }), 2)).toEqual({ kind: 'recorded', count: 2 });
      const refused = randomUUID();
      expect(await store.usage.record(event({ month, subjectKey: payer, entityKey: refused }), 2)).toEqual({ kind: 'cap_reached', used: 2, cap: 2 });
      // Nothing was written for the refused one: recording it later (after an upgrade) counts it.
      expect(await store.usage.record(event({ month, subjectKey: payer, entityKey: refused }), null)).toEqual({ kind: 'recorded', count: 3 });
      expect((await store.usage.rollup(month)).reduce((n, r) => n + r.events, 0)).toBe(3);
    });

    it('a cap of 0 admits nothing, not even the first', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const payer = subject();
      expect(await store.usage.record(event({ month, subjectKey: payer, kind: 'SCAN', detail: 'LIBRARY' }), 0)).toEqual({ kind: 'cap_reached', used: 0, cap: 0 });
      expect(await countOf(store, payer, month, 'SCANS')).toBe(0);
    });

    if (options.concurrent) {
      it('two records racing at cap − 1: exactly one counts, the counter stops at the cap (5 rounds)', async () => {
        const store = await makeStore();
        for (let round = 0; round < 5; round += 1) {
          const month = ownMonth();
          const payer = subject();
          await record(store, month, payer, 2);
          const results = await Promise.allSettled([store.usage.record(event({ month, subjectKey: payer }), 3), store.usage.record(event({ month, subjectKey: payer }), 3)]);
          const kinds = results.map((r) => (r.status === 'fulfilled' ? r.value.kind : 'rejected')).sort();
          expect(kinds).toEqual(['cap_reached', 'recorded']);
          expect(await countOf(store, payer, month)).toBe(3);
        }
      });
    }

    it('countersFor answers every asked month, zeros where nothing was counted', async () => {
      const store = await makeStore();
      const [a, b] = [ownMonth(), ownMonth()];
      const payer = subject();
      await record(store, a, payer, 2, { plan: 'business' });
      const counters = await store.usage.countersFor(payer, [a, b]);
      expect(counters.map((c) => [c.month, c.meter, c.count, c.plan])).toEqual([
        [a, 'DOCUMENTS', 2, 'business'],
        [a, 'SCANS', 0, 'none'],
        [b, 'DOCUMENTS', 0, 'none'],
        [b, 'SCANS', 0, 'none'],
      ]);
    });

    it('rollup groups the month by plan and kind, with distinct payers', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const [p1, p2] = [subject(), subject()];
      await record(store, month, p1, 2, { plan: 'solo' });
      await record(store, month, p2, 1, { plan: 'solo' });
      await record(store, month, p2, 1, { plan: 'solo', kind: 'SCAN', detail: 'EXPENSE' });
      await record(store, month, p1, 1, { plan: 'business', kind: 'SCAN', detail: 'LIBRARY' });
      const rows = await store.usage.rollup(month);
      expect(rows).toEqual([
        { plan: 'business', kind: 'SCAN', events: 1, subjects: 1 },
        { plan: 'solo', kind: 'DOCUMENT_ISSUED', events: 3, subjects: 2 },
        { plan: 'solo', kind: 'SCAN', events: 1, subjects: 1 },
      ]);
    });

    it('people: near (≥80% and under), capped (at the cap), over (past it), by plan, keyset-paged by payer', async () => {
      const store = await makeStore();
      const month = ownMonth();
      // Solo caps DOCUMENTS at 50, SCANS at 100.
      const keys = ['user:a', 'user:b', 'user:c', 'user:d', 'user:e'].map((k) => `${k}-${randomUUID()}`);
      const [near, capped, over, low, scansNear] = keys as [string, string, string, string, string];
      const seed = async (payer: string, n: number, plan: UsagePlan, kind: UsageKind = 'DOCUMENT_ISSUED') => {
        for (let i = 0; i < n; i += 1) await store.usage.record(event({ month, subjectKey: payer, plan, kind, detail: kind === 'SCAN' ? 'LIBRARY' : 'TAX_INVOICE' }), null);
      };
      await seed(near, 41, 'solo');
      await seed(capped, 50, 'solo');
      await seed(over, 51, 'solo');
      await seed(low, 10, 'solo');
      await seed(scansNear, 85, 'solo', 'SCAN');
      const subjects = async (filter?: 'near' | 'capped' | 'over') => (await store.usage.people({ month, ...(filter ? { filter } : {}), limit: 50, after: null })).items.map((i) => i.subjectKey);
      expect(await subjects('near')).toEqual([near, scansNear].sort());
      expect(await subjects('capped')).toEqual([capped]);
      expect(await subjects('over')).toEqual([over]);
      expect(await subjects()).toEqual([...keys].sort());
      expect((await store.usage.people({ month, plan: 'business', limit: 50, after: null })).items).toEqual([]);

      const first = await store.usage.people({ month, limit: 2, after: null });
      const second = await store.usage.people({ month, limit: 2, after: first.nextAfter });
      const third = await store.usage.people({ month, limit: 2, after: second.nextAfter });
      expect([...first.items, ...second.items, ...third.items].map((i) => i.subjectKey)).toEqual([...keys].sort());
      expect(third.nextAfter).toBeNull();
      const [one] = (await store.usage.people({ month, filter: 'near', limit: 1, after: null })).items;
      expect(one?.counters.map((c) => c.meter)).toEqual(one?.subjectKey === near ? ['DOCUMENTS'] : ['SCANS']);

      expect((await store.usage.standing(month)).find((s) => s.plan === 'solo')).toEqual({ plan: 'solo', payers: 5, near: 2, capped: 1, over: 1 });
    });

    it('MUT-757: firstEventsOf gives each payer’s first event per kind, for many payers at once', async () => {
      const store = await makeStore();
      const [early, late] = [ownMonth(), ownMonth()].sort() as [string, string];
      const [a, b, quiet] = [subject(), subject(), subject()];
      await record(store, late, a, 1, { kind: 'SCAN', detail: 'LIBRARY' });
      await record(store, early, a, 1, { kind: 'SCAN', detail: 'EXPENSE' });
      await record(store, late, a, 2);
      await record(store, early, b, 1, { kind: 'MAIL_SENT', detail: null });
      const rows = await store.usage.firstEventsOf([a, b, quiet], ['SCAN', 'DOCUMENT_ISSUED']);
      expect(rows.sort((x, y) => `${x.subjectKey}${x.kind}`.localeCompare(`${y.subjectKey}${y.kind}`))).toEqual(
        [
          { subjectKey: a, kind: 'DOCUMENT_ISSUED', firstAt: new Date(`${late}-15T10:00:00Z`) },
          { subjectKey: a, kind: 'SCAN', firstAt: new Date(`${early}-15T10:00:00Z`) },
        ].sort((x, y) => `${x.subjectKey}${x.kind}`.localeCompare(`${y.subjectKey}${y.kind}`)),
      );
      expect(await store.usage.firstEventsOf([], ['SCAN'])).toEqual([]);
    });

    it('byProfile counts a payer’s events per profile, month and kind', async () => {
      const store = await makeStore();
      const [a, b] = [ownMonth(), ownMonth()];
      const payer = subject();
      const [o1, o2] = [randomUUID(), randomUUID()];
      await record(store, a, payer, 2, { organizationId: o1 });
      await record(store, a, payer, 1, { organizationId: o2, kind: 'SCAN', detail: 'LIBRARY' });
      await record(store, b, payer, 1, { organizationId: o1 });
      const rows = await store.usage.byProfile(payer, [a]);
      expect(rows.sort((x, y) => x.kind.localeCompare(y.kind))).toEqual([
        { organizationId: o1, month: a, kind: 'DOCUMENT_ISSUED', events: 2 },
        { organizationId: o2, month: a, kind: 'SCAN', events: 1 },
      ]);
    });

    it('route aggregates add up: counts, duration sums and every bucket', async () => {
      const store = await makeStore();
      const routeKey = `GET /v1/contract-${randomUUID()}`;
      const delta = (count: number, bucket: number): RouteUsageDelta => {
        const buckets = Array.from({ length: 12 }, () => 0);
        buckets[bucket] = count;
        return { day: '2999-01-02', routeKey, plan: 'solo', statusClass: '2xx', count, durationMsSum: count * 3, buckets };
      };
      await store.usage.addRouteUsage([delta(2, 0), { ...delta(1, 11), statusClass: '5xx' }]);
      await store.usage.addRouteUsage([delta(3, 4), { ...delta(1, 0), plan: 'business' }]);
      await store.usage.addRouteUsage([]);
      const totals = (await store.usage.routeTotals('2999-01-01', '2999-01-31')).filter((t) => t.routeKey === routeKey).sort((x, y) => x.statusClass.localeCompare(y.statusClass));
      expect(totals.map((t) => [t.statusClass, t.count, t.durationMsSum, t.buckets[0], t.buckets[4], t.buckets[11]])).toEqual([
        ['2xx', 6, 18, 3, 3, 0],
        ['5xx', 1, 3, 0, 0, 1],
      ]);
      expect((await store.usage.routeTotals('2999-01-03', '2999-01-31')).filter((t) => t.routeKey === routeKey)).toEqual([]);
    });

    it('prune deletes only what retention no longer keeps', async () => {
      const store = await makeStore();
      const payer = subject();
      const old = event({ month: '1801-01', subjectKey: payer, occurredAt: new Date('1801-01-10T00:00:00Z') });
      const kept = event({ month: '1849-12', subjectKey: payer, occurredAt: new Date('1849-12-31T00:00:00Z') });
      await store.usage.record(old, null);
      await store.usage.record(kept, null);
      const buckets = Array.from({ length: 12 }, () => 0);
      const routeKey = `GET /v1/prune-${randomUUID()}`;
      await store.usage.addRouteUsage([
        { day: '1801-01-01', routeKey, plan: 'solo', statusClass: '2xx', count: 1, durationMsSum: 1, buckets },
        { day: '1850-01-01', routeKey, plan: 'solo', statusClass: '2xx', count: 1, durationMsSum: 1, buckets },
      ]);
      const removed = await store.usage.prune({ eventsMonth: '1849-12', countersMonth: '1849-12', routesDay: '1850-01-01' });
      expect(removed.events).toBeGreaterThanOrEqual(1);
      expect(removed.counters).toBeGreaterThanOrEqual(1);
      expect(removed.routes).toBeGreaterThanOrEqual(1);
      expect(await store.usage.byProfile(payer, ['1801-01', '1849-12'])).toEqual([{ organizationId: null, month: '1849-12', kind: 'DOCUMENT_ISSUED', events: 1 }]);
      expect(await countOf(store, payer, '1801-01')).toBe(0);
      expect(await countOf(store, payer, '1849-12')).toBe(1);
      expect((await store.usage.routeTotals('1800-01-01', '1851-01-01')).filter((t) => t.routeKey === routeKey).map((t) => t.count)).toEqual([1]);
    });

    it('purgeSubject (account closure) deletes the payer’s events and counters, nobody else’s', async () => {
      const store = await makeStore();
      const month = ownMonth();
      const [gone, stays] = [subject(), subject()];
      await record(store, month, gone, 2);
      await record(store, month, stays, 1);
      expect(await store.usage.purgeSubject(gone)).toEqual({ events: 2, counters: 1 });
      expect(await countOf(store, gone, month)).toBe(0);
      expect(await countOf(store, stays, month)).toBe(1);
    });
  });
}
