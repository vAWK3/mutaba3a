import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../database';
import { expenseRepo, recurringRuleRepo, recurringOccurrenceRepo, receiptRepo, vendorRepo } from '../expenseRepository';
import type { Expense, RecurringRule, RecurringOccurrence, Receipt, Vendor } from '../../types';

/**
 * MUT-24 §C: the expense-side repository paths expenseRepo.test.ts leaves
 * out — every ledger filter, search field, sort and page, the receipt count
 * and recurring flag on each row, soft-delete of a missing expense, the
 * recurring rule and occurrence filters, receipt paging, and what deleting a
 * vendor does to the expenses and receipts that named it.
 */

const now = '2026-09-01T00:00:00.000Z';

const expense = (id: string, extra: Partial<Expense> = {}): Expense =>
  ({
    id, profileId: 'bp1', title: id, amountMinor: 1000, currency: 'USD', occurredAt: '2026-09-15',
    createdAt: now, updatedAt: now, ...extra,
  }) as Expense;

const rule = (id: string, extra: Partial<RecurringRule> = {}): RecurringRule =>
  ({
    id, profileId: 'bp1', title: id, amountMinor: 500, currency: 'USD', frequency: 'monthly', dayOfMonth: 1,
    startDate: '2026-01-01', isPaused: false, scope: 'general', createdAt: now, updatedAt: now, ...extra,
  }) as RecurringRule;

const occurrence = (id: string, extra: Partial<RecurringOccurrence> = {}): RecurringOccurrence =>
  ({ id, ruleId: 'r1', profileId: 'bp1', expectedDate: '2026-09-01', status: 'pending', createdAt: now, updatedAt: now, ...extra }) as RecurringOccurrence;

const receipt = (id: string, extra: Partial<Receipt> = {}): Receipt =>
  ({ id, profileId: 'bp1', monthKey: '2026-09', fileName: `${id}.pdf`, createdAt: now, updatedAt: now, ...extra }) as Receipt;

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

beforeEach(async () => {
  await Promise.all(
    [db.expenses, db.expenseCategories, db.receipts, db.recurringRules, db.recurringOccurrences, db.vendors].map((t) => t.clear())
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('expenseRepo.list filters', () => {
  beforeEach(async () => {
    await db.expenseCategories.add({ id: 'cat-tools', profileId: 'bp1', name: 'Tools', color: '#123' });
    await db.expenses.bulkAdd([
      expense('base', { categoryId: 'cat-tools', clientId: 'c1', projectId: 'p1', vendor: 'Hardware Hub' }),
      expense('other-client', { clientId: 'c2', notes: 'Paid by card' }),
      expense('other-project', { clientId: 'c1', projectId: 'p2' }),
      expense('shekel', { currency: 'ILS' }),
      expense('other-business', { profileId: 'bp2' }),
      expense('last-year', { occurredAt: '2025-09-15' }),
      expense('august', { occurredAt: '2026-08-15T10:00:00.000Z' }),
      expense('deleted', { deletedAt: now }),
    ]);
  });

  it.each([
    ['business', { profileId: 'bp2' }, ['other-business']],
    ['client', { clientId: 'c1' }, ['base', 'other-project']],
    ['project', { projectId: 'p1' }, ['base']],
    ['category', { categoryId: 'cat-tools' }, ['base']],
    ['year', { year: 2025 }, ['last-year']],
    ['month', { profileId: 'bp1', year: 2026, month: 8 }, ['august']],
    ['date range, by calendar date of a timestamp', { dateFrom: '2026-08-15', dateTo: '2026-08-15' }, ['august']],
  ] as const)('by %s', async (_label, filters, expected) => {
    expect(ids(await expenseRepo.list(filters)).sort()).toEqual([...expected].sort());
  });

  it.each([
    ['vendor', 'hardware', ['base']],
    ['notes', 'CARD', ['other-client']],
    ['category name', 'tools', ['base']],
    ['title', 'shek', ['shekel']],
  ] as const)('searches the %s, ignoring case', async (_label, search, expected) => {
    expect(ids(await expenseRepo.list({ search }))).toEqual(expected);
  });

  it('keeps deleted expenses only when asked', async () => {
    expect(ids(await expenseRepo.list())).not.toContain('deleted');
    expect(ids(await expenseRepo.list({ includeDeleted: true }))).toContain('deleted');
  });
});

describe('expenseRepo.list rows, sort and paging', () => {
  it('names the category, counts linked receipts and flags recurring expenses', async () => {
    await db.expenseCategories.add({ id: 'cat', profileId: 'bp1', name: 'Rent', color: '#f00' });
    await db.expenses.bulkAdd([expense('rent', { categoryId: 'cat', recurringRuleId: 'r1' }), expense('one-off', { categoryId: 'gone' })]);
    await db.receipts.bulkAdd([receipt('a', { expenseId: 'rent' }), receipt('b', { expenseId: 'rent' }), receipt('loose')]);

    const rows = Object.fromEntries((await expenseRepo.list()).map((r) => [r.id, r]));

    expect(rows.rent).toMatchObject({ categoryName: 'Rent', categoryColor: '#f00', receiptCount: 2, isFromRecurring: true });
    expect(rows['one-off']).toMatchObject({ categoryName: undefined, receiptCount: 0, isFromRecurring: false });
  });

  it('sorts by a text or number field in either direction, and pages the result', async () => {
    await db.expenses.bulkAdd([
      expense('b', { amountMinor: 300, occurredAt: '2026-09-02' }),
      expense('a', { amountMinor: 100, occurredAt: '2026-09-03' }),
      expense('c', { amountMinor: 200, occurredAt: '2026-09-01' }),
    ]);

    expect(ids(await expenseRepo.list())).toEqual(['a', 'b', 'c']);
    expect(ids(await expenseRepo.list({ sort: { by: 'occurredAt', dir: 'asc' } }))).toEqual(['c', 'b', 'a']);
    expect(ids(await expenseRepo.list({ sort: { by: 'amountMinor', dir: 'asc' } }))).toEqual(['a', 'c', 'b']);
    expect(ids(await expenseRepo.list({ sort: { by: 'amountMinor', dir: 'desc' } }))).toEqual(['b', 'c', 'a']);
    expect(ids(await expenseRepo.list({ offset: 1, limit: 1 }))).toEqual(['b']);
  });

  it('leaves rows in stored order when the sort field is missing or mixed', async () => {
    await db.expenses.bulkAdd([expense('x', { vendor: 'Zed' }), expense('y')]);

    expect(ids(await expenseRepo.list({ sort: { by: 'vendor' as never, dir: 'asc' } }))).toEqual(['x', 'y']);
  });
});

describe('expenseRepo.softDelete', () => {
  it('refuses an expense that does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(expenseRepo.softDelete('missing')).rejects.toThrow('Expense not found: missing');
    expect(warn).toHaveBeenCalled();
  });
});

describe('recurringRuleRepo', () => {
  beforeEach(async () => {
    await db.recurringRules.bulkAdd([
      rule('active'),
      rule('paused', { isPaused: true }),
      rule('project', { scope: 'project' }),
      rule('elsewhere', { profileId: 'bp2' }),
      rule('deleted', { deletedAt: now }),
    ]);
  });

  it('filters by business, paused state and scope, never returning deleted rules', async () => {
    expect(ids(await recurringRuleRepo.list()).sort()).toEqual(['active', 'elsewhere', 'paused', 'project']);
    expect(ids(await recurringRuleRepo.list({ profileId: 'bp1', isPaused: true }))).toEqual(['paused']);
    expect(ids(await recurringRuleRepo.list({ scope: 'project' }))).toEqual(['project']);
    expect(ids(await recurringRuleRepo.listActive('bp1')).sort()).toEqual(['active', 'project']);
  });

  it('hides a deleted rule from get', async () => {
    expect(await recurringRuleRepo.get('deleted')).toBeUndefined();
    expect((await recurringRuleRepo.get('active'))?.id).toBe('active');
  });

  it('pauses, resumes, soft-deletes, updates and deletes', async () => {
    await recurringRuleRepo.pause('active');
    expect((await db.recurringRules.get('active'))?.isPaused).toBe(true);
    await recurringRuleRepo.resume('active');
    expect((await db.recurringRules.get('active'))?.isPaused).toBe(false);
    await recurringRuleRepo.update('active', { amountMinor: 900 });
    expect((await db.recurringRules.get('active'))?.amountMinor).toBe(900);
    await recurringRuleRepo.softDelete('active');
    expect(await recurringRuleRepo.get('active')).toBeUndefined();
    await recurringRuleRepo.delete('paused');
    expect(await db.recurringRules.get('paused')).toBeUndefined();
  });
});

describe('recurringOccurrenceRepo', () => {
  beforeEach(async () => {
    await db.recurringOccurrences.bulkAdd([
      occurrence('aug', { expectedDate: '2026-08-01', status: 'fulfilled' }),
      occurrence('sep', { expectedDate: '2026-09-01', status: 'skipped' }),
      occurrence('oct', { expectedDate: '2026-10-01' }),
      occurrence('other-rule', { ruleId: 'r2', expectedDate: '2026-09-01' }),
      occurrence('other-business', { ruleId: 'r3', profileId: 'bp2' }),
    ]);
  });

  it('filters by rule, one or several statuses and an expected-date range, within one business', async () => {
    expect(ids(await recurringOccurrenceRepo.list({ profileId: 'bp1', ruleId: 'r1' })).sort()).toEqual(['aug', 'oct', 'sep']);
    expect(ids(await recurringOccurrenceRepo.list({ profileId: 'bp1', status: 'pending' })).sort()).toEqual(['oct', 'other-rule']);
    expect(ids(await recurringOccurrenceRepo.list({ profileId: 'bp1', status: ['fulfilled', 'skipped'] })).sort()).toEqual(['aug', 'sep']);
    expect(ids(await recurringOccurrenceRepo.list({ profileId: 'bp1', ruleId: 'r1', dateFrom: '2026-08-15', dateTo: '2026-09-30' }))).toEqual(['sep']);
  });

  it('finds one by rule and date, and lists a rule’s history oldest first', async () => {
    expect((await recurringOccurrenceRepo.getByRuleAndDate('r1', '2026-09-01'))?.id).toBe('sep');
    expect(await recurringOccurrenceRepo.getByRuleAndDate('r1', '2026-12-01')).toBeUndefined();
    expect(ids(await recurringOccurrenceRepo.getHistoryForRule('r1'))).toEqual(['aug', 'sep', 'oct']);
  });

  it('updates and deletes', async () => {
    await recurringOccurrenceRepo.update('oct', { status: 'snoozed' as RecurringOccurrence['status'] });
    expect((await recurringOccurrenceRepo.get('oct'))?.status).toBe('snoozed');
    await recurringOccurrenceRepo.delete('oct');
    expect(await recurringOccurrenceRepo.get('oct')).toBeUndefined();
  });
});

describe('receiptRepo.list', () => {
  it('filters by expense and unlinked, newest first, and pages', async () => {
    await db.receipts.bulkAdd([
      receipt('old', { createdAt: '2026-09-01T00:00:00.000Z', expenseId: 'e1' }),
      receipt('mid', { createdAt: '2026-09-02T00:00:00.000Z' }),
      receipt('new', { createdAt: '2026-09-03T00:00:00.000Z' }),
    ]);

    expect(ids(await receiptRepo.list({ expenseId: 'e1' }))).toEqual(['old']);
    expect(ids(await receiptRepo.list({ unlinkedOnly: true }))).toEqual(['new', 'mid']);
    expect(ids(await receiptRepo.list({ offset: 1, limit: 1 }))).toEqual(['mid']);
    expect(await receiptRepo.count()).toBe(3);
    await receiptRepo.update('mid', { expenseId: 'e2' });
    expect((await receiptRepo.get('mid'))?.expenseId).toBe('e2');
    await receiptRepo.delete('mid');
    expect(await receiptRepo.count()).toBe(2);
  });
});

describe('vendorRepo', () => {
  const vendor = (id: string, canonicalName: string, aliases: string[] = []): Vendor =>
    ({ id, profileId: 'bp1', canonicalName, aliases, createdAt: now, updatedAt: now }) as Vendor;

  it('unlinks the expenses and receipts that named a vendor before deleting it', async () => {
    await db.vendors.add(vendor('v1', 'Office Depot'));
    await db.expenses.add(expense('e1', { vendorId: 'v1' }));
    await db.receipts.add(receipt('rc1', { vendorId: 'v1' }));

    await vendorRepo.delete('v1');

    expect(await vendorRepo.get('v1')).toBeUndefined();
    expect((await db.expenses.get('e1'))?.vendorId).toBeUndefined();
    expect((await db.receipts.get('rc1'))?.vendorId).toBeUndefined();
  });

  it('matches a near spelling of a name or alias, and nothing for blank input', async () => {
    await db.vendors.bulkAdd([vendor('v1', 'Amazon Web Services', ['AWS Billing']), vendor('v2', 'Starbucks')]);

    expect((await vendorRepo.findByAlias('bp1', 'Starbuck'))?.id).toBe('v2');
    expect((await vendorRepo.findByAlias('bp1', 'AWS Biling'))?.id).toBe('v1');
    expect(await vendorRepo.findByAlias('bp1', '')).toBeUndefined();
    expect(await vendorRepo.findByAlias('bp1', '   ')).toBeUndefined();
  });

  it('renames through update', async () => {
    await db.vendors.add(vendor('v1', 'Old'));
    await vendorRepo.update('v1', { canonicalName: 'New' });
    expect((await vendorRepo.get('v1'))?.canonicalName).toBe('New');
  });
});
