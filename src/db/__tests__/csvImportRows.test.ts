import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database';
import { importCsvRows, type CsvImportRow } from '../csvImport';

/**
 * MUT-24 §C: the whole-file import (Settings → Import) beyond its income
 * payment records (csvImport.test.ts): clients and projects are created once
 * and matched by name, later rows link to them by name, incomplete rows are
 * skipped, conversions use each currency's own minor unit and never mix one
 * currency with itself, and the count is money rows only.
 */

const PROFILE = 'bp1';
const run = (rows: CsvImportRow[]) => importCsvRows(rows, { selectedProfileId: PROFILE, language: 'en' });
const now = '2026-09-01T00:00:00.000Z';

beforeEach(async () => {
  await Promise.all(
    [db.clients, db.projects, db.transactions, db.paymentRecords, db.expenses, db.expenseCategories, db.businessProfiles].map((t) => t.clear())
  );
});

describe('clients and projects', () => {
  it('creates new ones in the chosen business, skipping nameless rows', async () => {
    await run([
      { type: 'client', name: 'Acme', email: 'a@acme.test', phone: '', notes: 'vip' },
      { type: 'client', name: '' },
      { type: 'project', name: 'Site', client: 'Acme', field: 'web' },
      { type: 'project', name: '' },
    ]);

    const [client] = await db.clients.toArray();
    expect(client).toMatchObject({ name: 'Acme', email: 'a@acme.test', notes: 'vip', profileId: PROFILE });
    expect(client.phone).toBeUndefined();
    expect(await db.projects.toArray()).toEqual([
      expect.objectContaining({ name: 'Site', clientId: client.id, field: 'web', profileId: PROFILE }),
    ]);
  });

  it('reuses a client or project that already has the name, and links to it', async () => {
    await db.clients.add({ id: 'old-client', name: 'Acme', profileId: 'other', createdAt: now, updatedAt: now });
    await db.projects.add({ id: 'old-project', name: 'Site', profileId: 'other', createdAt: now, updatedAt: now });

    await run([
      { type: 'client', name: 'Acme' },
      { type: 'project', name: 'Site', client: 'Acme' },
      { type: 'income', amount: '10', currency: 'USD', date: '2026-09-02', client: 'Acme', project: 'Site' },
    ]);

    expect(await db.clients.count()).toBe(1);
    expect(await db.projects.count()).toBe(1);
    expect((await db.transactions.toArray())[0]).toMatchObject({ clientId: 'old-client', projectId: 'old-project' });
  });

  it('leaves a project unlinked when its client is not in the file', async () => {
    await run([{ type: 'project', name: 'Solo', client: 'Nobody' }]);

    expect((await db.projects.toArray())[0].clientId).toBeUndefined();
  });
});

describe('income rows', () => {
  it('imports an unpaid row with its due date and notes, defaulting the title', async () => {
    const result = await run([{ type: 'income', amount: '12.34', currency: 'ILS', date: '2026-09-03', dueDate: '2026-10-03', notes: 'net 30' }]);

    expect(result.transactions).toBe(1);
    expect((await db.transactions.toArray())[0]).toMatchObject({
      kind: 'income', status: 'unpaid', title: 'Income', amountMinor: 1234, currency: 'ILS',
      occurredAt: '2026-09-03', dueDate: '2026-10-03', notes: 'net 30', profileId: PROFILE,
    });
    expect(await db.paymentRecords.count()).toBe(0);
  });

  it('skips a row missing its amount, currency or date', async () => {
    const result = await run([
      { type: 'income', currency: 'USD', date: '2026-09-03' },
      { type: 'income', amount: '1', date: '2026-09-03' },
      { type: 'income', amount: '1', currency: 'USD' },
    ]);

    expect(result.transactions).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
});

describe('conversion rows', () => {
  it('stores both legs in their own minor units, outside any business', async () => {
    const result = await run([{ type: 'conversion', amount: '100', currency: 'USD', toAmount: '70.125', toCurrency: 'JOD', date: '2026-09-04', notes: 'bank' }]);

    expect(result.transactions).toBe(1);
    const [conversion] = await db.transactions.toArray();
    expect(conversion).toMatchObject({
      kind: 'conversion', status: 'paid', amountMinor: 10000, currency: 'USD',
      toAmountMinor: 70125, toCurrency: 'JOD', occurredAt: '2026-09-04', notes: 'bank',
    });
    expect(conversion.profileId).toBeUndefined();
  });

  it('skips an incomplete row and one that converts a currency into itself', async () => {
    const result = await run([
      { type: 'conversion', amount: '1', currency: 'USD', toAmount: '1', toCurrency: 'USD', date: '2026-09-04' },
      { type: 'conversion', amount: '1', currency: 'USD', toCurrency: 'ILS', date: '2026-09-04' },
      { type: 'conversion', amount: '1', currency: 'USD', toAmount: '3', toCurrency: 'ILS' },
    ]);

    expect(result.transactions).toBe(0);
  });
});

describe('the count', () => {
  it('counts income, expense and conversion rows, never clients, projects or skipped rows', async () => {
    const result = await run([
      { type: 'client', name: 'Acme' },
      { type: 'project', name: 'Site' },
      { type: 'income', amount: '5', currency: 'USD', date: '2026-09-05', status: 'paid' },
      { type: 'expense', amount: '2', currency: 'USD', date: '2026-09-05', category: 'Tools' },
      { type: 'expense', currency: 'USD', date: '2026-09-05' },
      { type: 'conversion', amount: '1', currency: 'USD', toAmount: '3.5', toCurrency: 'ILS', date: '2026-09-05' },
      { type: 'unknown', name: 'ignored' },
    ]);

    expect(result.transactions).toBe(3);
    expect(await db.expenses.count()).toBe(1);
  });
});
