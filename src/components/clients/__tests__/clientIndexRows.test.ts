import { describe, it, expect } from 'vitest';
import {
  toClientIndexRow,
  compareClientRows,
  owedRank,
  toOwedBucketRows,
  toBusinessBucketRows,
  orderClientIndex,
  CLIENT_SORT_FIELDS,
  type ClientIndexRow,
} from '../clientIndexRows';
import type { ClientOwedIndexRow, OwedBucket } from '../../../types';

const summary = (overrides: Partial<ClientOwedIndexRow> = {}): ClientOwedIndexRow => ({
  id: 'c-1',
  name: 'Acme',
  activeProjectCount: 0,
  paidIncomeMinor: 0,
  unpaidIncomeMinor: 0,
  owed: [],
  profileIds: [],
  ...overrides,
});

const rates = { USD: 3, EUR: 4 };
const row = (overrides: Partial<ClientOwedIndexRow> = {}, withRates = rates) =>
  toClientIndexRow(summary(overrides), withRates);
const order = (rows: ClientIndexRow[], ...args: Parameters<typeof compareClientRows>) =>
  [...rows].sort(compareClientRows(...args)).map((r) => r.name);

describe('toClientIndexRow', () => {
  it('marks a client owing nothing as settled', () => {
    expect(row().isSettled).toBe(true);
    expect(row({ owed: [{ currency: 'USD', owedMinor: 100, overdueMinor: 0 }] }).isSettled).toBe(false);
  });

  it('lists only the currencies with an overdue amount, in owed order', () => {
    const r = row({
      owed: [
        { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
        { currency: 'ILS', owedMinor: 500, overdueMinor: 200 },
      ],
      oldestOverdueDays: 12,
    });

    expect(r.overdue).toEqual([{ currency: 'ILS', amountMinor: 200 }]);
    expect(r.oldestOverdueDays).toBe(12);
  });

  it('carries last payment and last activity through unchanged', () => {
    const lastPayment = { paidAt: '2026-10-01', amountMinor: 500, currency: 'EUR' as const };
    expect(row({ lastPayment, lastActivityAt: '2026-10-05' })).toMatchObject({
      lastPayment,
      lastActivityAt: '2026-10-05',
    });
  });
});

describe('owedRank', () => {
  it('converts every rated currency to ILS and adds them, for ordering only', () => {
    expect(
      owedRank(
        [
          { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
          { currency: 'ILS', owedMinor: 500, overdueMinor: 0 },
          { currency: 'EUR', owedMinor: 100, overdueMinor: 0 },
        ],
        rates
      )
    ).toEqual([1000 * 3 + 500 + 100 * 4, 0, 0, 0]);
  });

  it('keeps a currency with no rate out of the total, in its own slot after it', () => {
    expect(
      owedRank(
        [
          { currency: 'USD', owedMinor: 1000, overdueMinor: 0 },
          { currency: 'ILS', owedMinor: 500, overdueMinor: 0 },
        ],
        { EUR: 4 }
      )
    ).toEqual([500, 1000, 0, 0]);
  });

  it('is all zeros for a settled client', () => {
    expect(owedRank([], rates)).toEqual([0, 0, 0, 0]);
  });
});

describe('compareClientRows', () => {
  const gamma = row({ id: 'g', name: 'Gamma', owed: [{ currency: 'ILS', owedMinor: 1_200_000, overdueMinor: 400_000 }], oldestOverdueDays: 31 });
  const acme = row({
    id: 'a',
    name: 'Acme',
    owed: [
      { currency: 'USD', owedMinor: 130_000, overdueMinor: 100_000 },
      { currency: 'ILS', owedMinor: 420_000, overdueMinor: 0 },
    ],
    oldestOverdueDays: 3,
    lastPayment: { paidAt: '2026-10-05', amountMinor: 20_000, currency: 'USD' },
    lastActivityAt: '2026-10-09',
  });
  const beta = row({
    id: 'b',
    name: 'Beta',
    owed: [{ currency: 'USD', owedMinor: 90_000, overdueMinor: 0 }],
    lastPayment: { paidAt: '2026-09-01T22:00:00.000Z', amountMinor: 10_000, currency: 'USD' },
    lastActivityAt: '2026-10-10',
  });
  const delta = row({ id: 'd', name: 'Delta', lastActivityAt: '2026-08-01' });
  const all = [delta, beta, acme, gamma];

  it('orders owed now descending by today\'s rate, with settled clients last', () => {
    // Gamma ₪12,000 > Acme $1,300×3 + ₪4,200 = ₪8,100 > Beta $900×3 = ₪2,700 > Delta settled
    expect(order(all, 'owed', 'desc')).toEqual(['Gamma', 'Acme', 'Beta', 'Delta']);
  });

  it('reverses for ascending', () => {
    expect(order(all, 'owed', 'asc')).toEqual(['Delta', 'Beta', 'Acme', 'Gamma']);
  });

  it('ranks an amount with no rate after every amount that has one', () => {
    const noUsdRate = { EUR: 4 };
    const usdOnly = row({ id: 'u', name: 'Usd only', owed: [{ currency: 'USD', owedMinor: 500_000, overdueMinor: 0 }] }, noUsdRate);
    const ilsSmall = row({ id: 'i', name: 'Ils small', owed: [{ currency: 'ILS', owedMinor: 100, overdueMinor: 0 }] }, noUsdRate);
    const settled = row({ id: 's', name: 'Settled' }, noUsdRate);

    expect(order([settled, usdOnly, ilsSmall], 'owed', 'desc')).toEqual(['Ils small', 'Usd only', 'Settled']);
  });

  it('orders overdue by how late the oldest item is, never by amount; none-overdue last', () => {
    expect(order(all, 'overdue', 'desc')).toEqual(['Gamma', 'Acme', 'Beta', 'Delta']);
  });

  it('orders last payment newest first, with never-paid clients last', () => {
    expect(order(all, 'lastPayment', 'desc')).toEqual(['Acme', 'Beta', 'Delta', 'Gamma']);
  });

  it('orders last activity newest first', () => {
    expect(order(all, 'activity', 'desc')).toEqual(['Beta', 'Acme', 'Delta', 'Gamma']);
  });

  it('orders by name', () => {
    expect(order(all, 'name', 'asc')).toEqual(['Acme', 'Beta', 'Delta', 'Gamma']);
    expect(order(all, 'name', 'desc')).toEqual(['Gamma', 'Delta', 'Beta', 'Acme']);
  });

  it('breaks ties by name A–Z, then id, in either direction', () => {
    const z = row({ id: 'z2', name: 'Zed' });
    const a2 = row({ id: 'a2', name: 'Abe' });
    const a1 = row({ id: 'a1', name: 'Abe' });

    expect(order([z, a2, a1], 'owed', 'desc').join()).toBe('Abe,Abe,Zed');
    expect([z, a2, a1].sort(compareClientRows('owed', 'desc')).map((r) => r.id)).toEqual(['a1', 'a2', 'z2']);
    expect([z, a2, a1].sort(compareClientRows('owed', 'asc')).map((r) => r.id)).toEqual(['a1', 'a2', 'z2']);
  });
});

/**
 * MUT-83 (ADR-049): the debts the strip counts that belong to no listed
 * client get up to two muted rows, always after the clients.
 */
describe('a row\'s businesses (MUT-89)', () => {
  it('carries the businesses the index tagged it with', () => {
    expect(row({ profileIds: ['studio', 'teaching'] }).profileIds).toEqual(['studio', 'teaching']);
    expect(row().profileIds).toEqual([]);
  });
});

describe('toOwedBucketRows', () => {
  const none: OwedBucket = { owed: [], count: 0 };
  const owing: OwedBucket = {
    owed: [
      { currency: 'USD', owedMinor: 500, overdueMinor: 0 },
      { currency: 'ILS', owedMinor: 900, overdueMinor: 300 },
    ],
    count: 2,
  };

  it('shows nothing when neither bucket owes anything', () => {
    expect(toOwedBucketRows({ noClient: none, archivedClients: none })).toEqual([]);
  });

  it('shows only the non-zero buckets, No client first', () => {
    expect(toOwedBucketRows({ noClient: none, archivedClients: owing }).map((b) => b.kind)).toEqual(['archivedClients']);
    expect(toOwedBucketRows({ noClient: owing, archivedClients: owing }).map((b) => b.kind)).toEqual([
      'noClient',
      'archivedClients',
    ]);
  });

  it('carries the count and splits overdue per currency like a client row', () => {
    const [bucket] = toOwedBucketRows({ noClient: owing, archivedClients: none });

    expect(bucket).toEqual({
      kind: 'noClient',
      owed: owing.owed,
      overdue: [{ currency: 'ILS', amountMinor: 300 }],
      count: 2,
    });
  });
});

describe('orderClientIndex', () => {
  const clients = [
    row({ id: 'a', name: 'Abe', owed: [{ currency: 'ILS', owedMinor: 100, overdueMinor: 0 }], lastActivityAt: '2026-10-01' }),
    row({ id: 'z', name: 'Zed', owed: [{ currency: 'ILS', owedMinor: 900, overdueMinor: 900 }], oldestOverdueDays: 9 }),
    row({ id: 'm', name: 'Mia', lastPayment: { paidAt: '2026-10-02', amountMinor: 1, currency: 'USD' } }),
  ];
  const buckets = toOwedBucketRows({
    // Bigger than any client, overdue and recent: none of that may lift them
    noClient: { owed: [{ currency: 'USD', owedMinor: 10_000_000, overdueMinor: 10_000_000 }], count: 1 },
    archivedClients: { owed: [{ currency: 'ILS', owedMinor: 1, overdueMinor: 0 }], count: 1 },
  });

  it.each(CLIENT_SORT_FIELDS.flatMap((field) => (['asc', 'desc'] as const).map((dir) => [field, dir] as const)))(
    'puts No client, then Archived clients, after every client when sorted by %s %s (AC2)',
    (field, dir) => {
      const items = orderClientIndex(clients, buckets, field, dir);

      expect(items.slice(0, 3).map((i) => i.type)).toEqual(['client', 'client', 'client']);
      expect(items.slice(3).map((i) => (i.type === 'bucket' ? i.row.kind : i.row.id))).toEqual([
        'noClient',
        'archivedClients',
      ]);
      expect(items.slice(0, 3).map((i) => (i.type === 'client' ? i.row.name : ''))).toEqual(
        order(clients, field, dir)
      );
    }
  );
});

describe('toBusinessBucketRows: All businesses (MUT-89, O4)', () => {
  const none: OwedBucket = { owed: [], count: 0 };
  const owing = (amount: number, count: number): OwedBucket => ({
    owed: [{ currency: 'ILS', owedMinor: amount, overdueMinor: 0 }],
    count,
  });

  it('gives one row per business that owes, No client rows first, businesses in the given order', () => {
    const rows = toBusinessBucketRows([
      { profileId: 'studio', noClient: owing(500, 2), archivedClients: owing(100, 1) },
      { profileId: 'teaching', noClient: owing(300, 1), archivedClients: none },
    ]);

    expect(rows.map((r) => [r.kind, r.profileId, r.count])).toEqual([
      ['noClient', 'studio', 2],
      ['noClient', 'teaching', 1],
      ['archivedClients', 'studio', 1],
    ]);
  });

  it('shows nothing when no business owes outside its clients', () => {
    expect(toBusinessBucketRows([{ profileId: 'studio', noClient: none, archivedClients: none }])).toEqual([]);
  });
});
