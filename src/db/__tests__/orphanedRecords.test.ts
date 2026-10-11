import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../database';
import { runIntegrityCheck } from '../integrityCheck';
import { findOrphanedRecords, startingProfileId } from '../orphanedRecords';
import type { Client, Expense, Project, Transaction } from '../../types';

const STAMP = '2026-10-01T00:00:00.000Z';

function client(id: string, overrides: Partial<Client> = {}): Client {
  return { id, name: `Client ${id}`, createdAt: STAMP, updatedAt: STAMP, ...overrides };
}

function project(id: string, overrides: Partial<Project> = {}): Project {
  return { id, name: `Project ${id}`, createdAt: STAMP, updatedAt: STAMP, ...overrides };
}

function income(id: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    kind: 'income',
    status: 'unpaid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: '2026-10-01',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

/** Expense.profileId is required by the type; an orphan is exactly a row without it. */
function expense(id: string, overrides: Partial<Expense> = {}): Expense {
  return {
    id,
    amountMinor: 5000,
    currency: 'ILS',
    occurredAt: '2026-10-02',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  } as Expense;
}

async function clearTables() {
  await Promise.all([db.clients.clear(), db.projects.clear(), db.transactions.clear(), db.expenses.clear()]);
}

beforeEach(clearTables);
afterEach(clearTables);

describe('findOrphanedRecords', () => {
  it('returns empty lists and link maps for an empty database', async () => {
    expect(await findOrphanedRecords()).toEqual({
      clients: [],
      projects: [],
      transactions: [],
      expenses: [],
      clientProfileIds: {},
      projectProfileIds: {},
      clientNames: {},
    });
  });

  it('returns the unassigned record of every kind and skips assigned ones', async () => {
    await db.clients.bulkAdd([client('c-orphan'), client('c-ok', { profileId: 'p1' })]);
    await db.projects.bulkAdd([project('pr-orphan'), project('pr-ok', { profileId: 'p1' })]);
    await db.transactions.bulkAdd([income('tx-orphan'), income('tx-ok', { profileId: 'p1' })]);
    await db.expenses.bulkAdd([expense('ex-orphan'), expense('ex-ok', { profileId: 'p1' })]);

    const result = await findOrphanedRecords();

    expect(result.clients.map((c) => c.id)).toEqual(['c-orphan']);
    expect(result.projects.map((p) => p.id)).toEqual(['pr-orphan']);
    expect(result.transactions.map((t) => t.id)).toEqual(['tx-orphan']);
    expect(result.expenses.map((e) => e.id)).toEqual(['ex-orphan']);
  });

  it('skips archived clients and projects and soft-deleted income and expenses', async () => {
    await db.clients.add(client('c-archived', { archivedAt: STAMP }));
    await db.projects.add(project('pr-archived', { archivedAt: STAMP }));
    await db.transactions.add(income('tx-deleted', { deletedAt: STAMP }));
    await db.expenses.add(expense('ex-deleted', { deletedAt: STAMP }));

    const result = await findOrphanedRecords();

    expect(result.clients).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(result.transactions).toEqual([]);
    expect(result.expenses).toEqual([]);
  });

  it('maps every assigned client and project to its profile, and no unassigned one', async () => {
    await db.clients.bulkAdd([client('c-a', { profileId: 'p1' }), client('c-orphan')]);
    await db.projects.bulkAdd([project('pr-a', { profileId: 'p2' }), project('pr-orphan')]);

    const result = await findOrphanedRecords();

    expect(result.clientProfileIds).toEqual({ 'c-a': 'p1' });
    expect(result.projectProfileIds).toEqual({ 'pr-a': 'p2' });
  });

  it('names every client, assigned, unassigned or archived', async () => {
    await db.clients.bulkAdd([
      client('c-a', { name: 'Acme', profileId: 'p1' }),
      client('c-orphan', { name: 'Beta' }),
      client('c-archived', { name: 'Gamma', archivedAt: STAMP }),
    ]);

    expect((await findOrphanedRecords()).clientNames).toEqual({ 'c-a': 'Acme', 'c-orphan': 'Beta', 'c-archived': 'Gamma' });
  });

  it('lists exactly the records the integrity check counts', async () => {
    await db.clients.bulkAdd([client('c-orphan'), client('c-archived', { archivedAt: STAMP }), client('c-ok', { profileId: 'p1' })]);
    await db.projects.bulkAdd([project('pr-orphan', { clientId: 'c-ok' }), project('pr-archived', { archivedAt: STAMP })]);
    await db.transactions.bulkAdd([income('tx-orphan'), income('tx-deleted', { deletedAt: STAMP })]);
    await db.expenses.bulkAdd([expense('ex-orphan'), expense('ex-deleted', { deletedAt: STAMP })]);

    const [records, check] = await Promise.all([findOrphanedRecords(), runIntegrityCheck()]);

    const listed = [
      ...records.clients.map((r) => `clients:${r.id}`),
      ...records.projects.map((r) => `projects:${r.id}`),
      ...records.transactions.map((r) => `transactions:${r.id}`),
      ...records.expenses.map((r) => `expenses:${r.id}`),
    ].sort();
    const counted = check.orphanedRecords.map((r) => `${r.table}:${r.id}`).sort();
    expect(listed).toEqual(counted);
    expect(listed).toHaveLength(4);
  });
});

describe('startingProfileId', () => {
  const links = {
    clientProfileIds: { 'c-a': 'p-a', 'c-archived-profile': 'p-gone' },
    projectProfileIds: { 'pr-b': 'p-b' },
  };
  const selectable = new Set(['p-a', 'p-b']);

  it('gives a client no linked profile', () => {
    expect(startingProfileId('clients', client('c-x'), links, selectable)).toBeUndefined();
  });

  it("starts a project on its client's profile", () => {
    expect(startingProfileId('projects', project('pr-x', { clientId: 'c-a' }), links, selectable)).toBe('p-a');
  });

  it('gives a project with no client, or an unassigned client, no linked profile', () => {
    expect(startingProfileId('projects', project('pr-x'), links, selectable)).toBeUndefined();
    expect(startingProfileId('projects', project('pr-x', { clientId: 'c-orphan' }), links, selectable)).toBeUndefined();
  });

  it.each(['transactions', 'expenses'] as const)("starts %s on the client's profile before the project's", (table) => {
    const record = table === 'transactions'
      ? income('r', { clientId: 'c-a', projectId: 'pr-b' })
      : expense('r', { clientId: 'c-a', projectId: 'pr-b' });
    expect(startingProfileId(table, record, links, selectable)).toBe('p-a');
  });

  it.each(['transactions', 'expenses'] as const)("falls back to the project's profile for %s without an assigned client", (table) => {
    const record = table === 'transactions'
      ? income('r', { clientId: 'c-orphan', projectId: 'pr-b' })
      : expense('r', { projectId: 'pr-b' });
    expect(startingProfileId(table, record, links, selectable)).toBe('p-b');
  });

  it.each(['transactions', 'expenses'] as const)('gives %s with no links no linked profile', (table) => {
    const record = table === 'transactions' ? income('r') : expense('r');
    expect(startingProfileId(table, record, links, selectable)).toBeUndefined();
  });

  it('skips a linked profile that is not selectable and tries the next link', () => {
    const record = income('r', { clientId: 'c-archived-profile', projectId: 'pr-b' });
    expect(startingProfileId('transactions', record, links, selectable)).toBe('p-b');
    expect(startingProfileId('projects', project('pr-x', { clientId: 'c-archived-profile' }), links, selectable)).toBeUndefined();
  });
});
