/**
 * MUT-83 (ADR-049): Owed now on Home and on the Clients list always match.
 *
 * Home sums every unpaid entry recorded in the business
 * (summarizeOwedByCurrency over transactionRepo.list with Home's filters,
 * ADR-036 §5). The clients index splits those same entries into its rows, a
 * "No client" row and an "Archived clients" row, so its strip equals Home's
 * per currency and its rows add up to the strip. Each business's list counts
 * only that business's entries; a client from another business that has an
 * entry here is listed here too (the owner's decision A, 2026-10-12).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { clientSummaryRepo, transactionRepo } from '../repository';
import { combineOwed, summarizeOwedByCurrency } from '../aggregations';
import { todayLocalISO } from '../../lib/dates';
import type { Client, ClientOwedIndex, PaymentRecord, Transaction } from '../../types';

const P1 = 'business-design';
const P2 = 'business-consulting';
const STAMP = '2026-09-01T00:00:00.000Z';
const LONG_AGO = '2020-01-15';

const client = (id: string, profileId: string, overrides: Partial<Client> = {}): Client => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  profileId,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

const entry = (id: string, profileId: string, overrides: Partial<Transaction> = {}): Transaction => ({
  id,
  kind: 'income',
  status: 'unpaid',
  amountMinor: 1000,
  currency: 'USD',
  occurredAt: LONG_AGO,
  profileId,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...overrides,
});

const CLIENTS: Client[] = [
  client('acme', P1),
  client('beta', P1), // no entries anywhere: still listed in its own business
  client('shared', P2), // created in P2, owes in P1 (D3)
  client('mine', P1), // created in P1, owes only in P2 (D4)
  client('gone', P1, { archivedAt: STAMP }),
  client('gone2', P2, { archivedAt: STAMP }),
];

const ENTRIES: Transaction[] = [
  entry('acme-late', P1, { clientId: 'acme', amountMinor: 10000, dueDate: LONG_AGO }),
  entry('acme-paid', P1, { clientId: 'acme', currency: 'ILS', amountMinor: 5000, status: 'paid', paidAt: '2026-08-20' }),
  entry('acme-archived-entry', P1, { clientId: 'acme', amountMinor: 99900, archivedAt: STAMP }),
  entry('no-client', P1, { currency: 'ILS', amountMinor: 30000 }),
  entry('ghost', P1, { clientId: 'deleted-client', currency: 'EUR', amountMinor: 2000 }),
  entry('gone-open', P1, { clientId: 'gone', amountMinor: 4000 }),
  entry('gone2-open', P1, { clientId: 'gone2', amountMinor: 500, dueDate: LONG_AGO }),
  entry('shared-open', P1, { clientId: 'shared', currency: 'EUR', amountMinor: 7000 }),
  entry('deleted', P1, { amountMinor: 123400, deletedAt: STAMP }),
  entry('mine-open', P2, { clientId: 'mine', amountMinor: 6000 }),
  entry('mine-paid', P2, { clientId: 'mine', currency: 'ILS', amountMinor: 2500, status: 'paid', paidAt: '2026-07-01' }),
  entry('p2-no-client', P2, { currency: 'ILS', amountMinor: 1100 }),
];

/** Home's Owed now, exactly as OverviewPage reads it (useReceivables → transactionRepo.list). */
async function homeOwedNow(profileId: string) {
  const receivables = await transactionRepo.list({
    kind: 'income',
    status: 'unpaid',
    profileId,
    sort: { by: 'dueDate', dir: 'asc' },
  });
  return summarizeOwedByCurrency(receivables, todayLocalISO());
}

const sumOfRows = (index: ClientOwedIndex) =>
  combineOwed([...index.clients.map((c) => c.owed), index.noClient.owed, index.archivedClients.owed]);

const rowOf = (index: ClientOwedIndex, id: string) => index.clients.find((c) => c.id === id);

describe('clientSummaryRepo.listOwedIndex', () => {
  beforeEach(async () => {
    await Promise.all([db.clients.clear(), db.transactions.clear(), db.paymentRecords.clear(), db.projects.clear()]);
    await db.clients.bulkAdd(CLIENTS);
    await db.transactions.bulkAdd(ENTRIES);
  });

  afterEach(async () => {
    await Promise.all([db.clients.clear(), db.transactions.clear(), db.paymentRecords.clear(), db.projects.clear()]);
  });

  describe('parity with Home (AC1, AC3)', () => {
    it.each([P1, P2])('its total equals Home\'s Owed now for every currency in %s', async (profileId) => {
      const index = await clientSummaryRepo.listOwedIndex({ profileId });

      expect(index.total).toEqual(await homeOwedNow(profileId));
    });

    it('pins the figures: unassigned, archived-client and shared-client debts count; archived entries do not', async () => {
      const index = await clientSummaryRepo.listOwedIndex({ profileId: P1 });

      expect(index.total).toEqual([
        // acme 100 + gone 40 + gone2 5 (overdue: acme 100 + gone2 5)
        { currency: 'USD', owedMinor: 14500, overdueMinor: 10500 },
        { currency: 'ILS', owedMinor: 30000, overdueMinor: 0 },
        // ghost 20 + shared 70
        { currency: 'EUR', owedMinor: 9000, overdueMinor: 0 },
      ]);
    });

    it.each([P1, P2])('the client rows and the two muted rows add up to the total in %s (ADR-033 §2)', async (profileId) => {
      const index = await clientSummaryRepo.listOwedIndex({ profileId });

      expect(sumOfRows(index)).toEqual(index.total);
    });

    it('stays equal to Home after a client is archived: its debt moves to the Archived clients row', async () => {
      await db.clients.update('acme', { archivedAt: STAMP });
      const index = await clientSummaryRepo.listOwedIndex({ profileId: P1 });

      expect(index.total).toEqual(await homeOwedNow(P1));
      expect(rowOf(index, 'acme')).toBeUndefined();
      expect(index.archivedClients.count).toBe(3);
    });
  });

  describe('the muted rows', () => {
    it('No client holds entries with no client or a deleted client, and counts the entries', async () => {
      const { noClient } = await clientSummaryRepo.listOwedIndex({ profileId: P1 });

      expect(noClient).toEqual({
        owed: [
          { currency: 'ILS', owedMinor: 30000, overdueMinor: 0 },
          { currency: 'EUR', owedMinor: 2000, overdueMinor: 0 },
        ],
        count: 2,
      });
    });

    it('Archived clients holds this business\'s entries of archived clients from any business, and counts the clients', async () => {
      const { archivedClients } = await clientSummaryRepo.listOwedIndex({ profileId: P1 });

      expect(archivedClients).toEqual({
        owed: [{ currency: 'USD', owedMinor: 4500, overdueMinor: 500 }],
        count: 2,
      });
    });
  });

  describe('which clients are listed, and what their rows count', () => {
    it('lists the business\'s own live clients, even with no entries, plus other businesses\' clients with an entry here', async () => {
      const index = await clientSummaryRepo.listOwedIndex({ profileId: P1 });

      expect(index.clients.map((c) => c.id).sort()).toEqual(['acme', 'beta', 'mine', 'shared']);
    });

    it('counts a shared client\'s debt only in the business it was recorded in (D3)', async () => {
      const p1 = await clientSummaryRepo.listOwedIndex({ profileId: P1 });
      const p2 = await clientSummaryRepo.listOwedIndex({ profileId: P2 });

      expect(rowOf(p1, 'shared')!.owed).toEqual([{ currency: 'EUR', owedMinor: 7000, overdueMinor: 0 }]);
      // Created in P2, so listed there too, with nothing recorded there
      expect(rowOf(p2, 'shared')!.owed).toEqual([]);
    });

    it('does not carry another business\'s debt or payment into a client\'s own business (D4)', async () => {
      const p1 = await clientSummaryRepo.listOwedIndex({ profileId: P1 });
      const p2 = await clientSummaryRepo.listOwedIndex({ profileId: P2 });

      expect(rowOf(p1, 'mine')!.owed).toEqual([]);
      expect(rowOf(p1, 'mine')!.lastPayment).toBeUndefined();
      expect(rowOf(p1, 'mine')!.lastActivityAt).toBeUndefined();

      expect(rowOf(p2, 'mine')!.owed).toEqual([{ currency: 'USD', owedMinor: 6000, overdueMinor: 0 }]);
      expect(rowOf(p2, 'mine')!.lastPayment).toEqual({ paidAt: '2026-07-01', amountMinor: 2500, currency: 'ILS' });
    });

    it('keeps every column of a row to the business: overdue age, last payment and activity', async () => {
      const records: PaymentRecord[] = [
        { id: 'rec-p2', transactionId: 'mine-open', amountMinor: 1000, paidAt: '2026-09-30', createdAt: STAMP, updatedAt: STAMP },
      ];
      await db.paymentRecords.bulkAdd(records);
      const p1 = await clientSummaryRepo.listOwedIndex({ profileId: P1 });
      const acme = rowOf(p1, 'acme')!;

      expect(acme.oldestOverdueDays).toBeGreaterThan(0);
      expect(acme.lastPayment).toEqual({ paidAt: '2026-08-20', amountMinor: 5000, currency: 'ILS' });
      expect(acme.lastActivityAt).toBe(LONG_AGO);
      // A payment recorded against a P2 entry never shows on P1
      expect(rowOf(p1, 'mine')!.lastPayment).toBeUndefined();
    });
  });

  describe('search', () => {
    it('narrows the client rows by name and leaves the total and the muted rows alone', async () => {
      const all = await clientSummaryRepo.listOwedIndex({ profileId: P1 });
      const searched = await clientSummaryRepo.listOwedIndex({ profileId: P1, search: 'ACM' });

      expect(searched.clients.map((c) => c.id)).toEqual(['acme']);
      expect(searched.total).toEqual(all.total);
      expect(searched.noClient).toEqual(all.noClient);
      expect(searched.archivedClients).toEqual(all.archivedClients);
    });
  });
});

/** The muted rows open /income filtered to their entries (MUT-83). */
describe('transactionRepo.list clientScope', () => {
  beforeEach(async () => {
    await Promise.all([db.clients.clear(), db.transactions.clear()]);
    await db.clients.bulkAdd(CLIENTS);
    await db.transactions.bulkAdd(ENTRIES);
  });

  afterEach(async () => {
    await Promise.all([db.clients.clear(), db.transactions.clear()]);
  });

  const idsFor = async (clientScope: 'none' | 'archived') =>
    (await transactionRepo.list({ kind: 'income', status: 'unpaid', profileId: P1, clientScope }))
      .map((tx) => tx.id)
      .sort();

  it('none: entries with no client, or whose client row is gone', async () => {
    expect(await idsFor('none')).toEqual(['ghost', 'no-client']);
  });

  it('archived: entries of archived clients', async () => {
    expect(await idsFor('archived')).toEqual(['gone-open', 'gone2-open']);
  });

  it('lists exactly the entries behind each muted row\'s figure', async () => {
    const index = await clientSummaryRepo.listOwedIndex({ profileId: P1 });
    const today = todayLocalISO();
    const owedOf = async (clientScope: 'none' | 'archived') =>
      summarizeOwedByCurrency(await transactionRepo.list({ kind: 'income', status: 'unpaid', profileId: P1, clientScope }), today);

    expect(await owedOf('none')).toEqual(index.noClient.owed);
    expect(await owedOf('archived')).toEqual(index.archivedClients.owed);
  });
});
