import { describe, expect, it } from 'vitest';
import { checkCarriedTotals, prepareFromBackup } from '../index';
import { mapFreeAppBackup, type CarryOverPlan } from '../mapFreeAppBackup';
import { CarryOverAborted, idempotencyKeyOf, outcomeOf, replayCarryOver } from '../replay';
import { snapshotTotals, totalsByCurrency } from '../totals';
import { business, client, conversion, expense, freeAppBackup, income, payment, project } from './helpers/freeAppFixture';

/** MUT-291 §3.1 E2, §3.4 (T-U12, T-I2): the plan sent through a throwaway local app, and the totals gate. */

const NOW = () => new Date('2026-03-01T10:00:00.000Z');
const OPTIONS = { now: NOW, timezone: 'Asia/Jerusalem', locale: 'en' as const, labels: { noClient: 'No client', defaultBusiness: 'My business' } };

const TABLES = {
  businessProfiles: [business('b1', { isDefault: true }), business('b2', { defaultCurrency: 'USD' })],
  clients: [client('c1', 'b1', { email: 'not an email' }), client('c2', 'b2')],
  projects: [project('p1', 'b1', 'c1')],
  transactions: [
    income('t1', 'b1', { clientId: 'c1', projectId: 'p1', receivedAmountMinor: 4_000 }),
    income('t2', 'b1', { status: 'paid', paidAt: '2026-02-12' }),
    income('t3', 'b2', { clientId: 'c2', currency: 'JOD', amountMinor: 5_250, status: 'paid', paidAt: '2026-02-14' }),
    conversion('x1', 'b2'),
  ],
  paymentRecords: [payment('r1', 't1', 4_000, '2026-02-11'), payment('r3', 't3', 5_250, '2026-02-14')],
  expenses: [expense('e1', 'b1', { clientId: 'c1' }), expense('e2', 'b2', { currency: 'USD', amountMinor: 1_99 })],
  receipts: [{ id: 'rc1', profileId: 'b1', expenseId: 'e1', fileName: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: btoa('PDF') }],
};

describe('replayCarryOver', () => {
  it('recreates every record through the routes, with its receipt file', async () => {
    const backup = freeAppBackup(TABLES);
    const plan = mapFreeAppBackup(backup, OPTIONS);
    const result = await replayCarryOver(plan, OPTIONS);
    const { maps } = result.snapshot;

    expect([...maps.orgs.values()].filter((o) => !o.personalOwnerUserId).map((o) => o.name).sort()).toEqual(['Business b1', 'Business b2']);
    expect(maps.custs.size).toBe(2);
    expect([...maps.custs.values()].find((c) => c.name === 'Client c1')!.email).toBeNull(); // dropped, and counted
    expect(maps.projs.size).toBe(1);
    expect(maps.recs.size).toBe(2); // t1 (part-paid, client) and t3 (paid, client): Owed
    expect([...maps.pays.values()].filter((p) => p.status === 'POSTED')).toHaveLength(3); // r1, t2 as Received, r3
    expect(maps.exps.size).toBe(2);
    expect(maps.convs.size).toBe(1);
    expect(result.files).toEqual([expect.objectContaining({ type: 'application/pdf' })]);
    expect(new TextDecoder().decode(result.files[0]!.bytes)).toBe('PDF');
    expect(result.report.notCarried).toEqual([]);
    expect(result.report.changed).toEqual(expect.arrayContaining([{ code: 'client-email-dropped', count: 1 }]));
    expect(checkCarriedTotals(backup, plan, result)).toEqual([]);
  });

  it('lists a receipt whose file won\'t decode, and carries everything else', async () => {
    const backup = freeAppBackup({
      businessProfiles: [business('b1')],
      expenses: [expense('e1', 'b1')],
      receipts: [
        { id: 'bad', profileId: 'b1', expenseId: 'e1', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: '%%%not base64%%%' },
        // The backup's size is wrong; the decoded bytes are what's uploaded and checked.
        { id: 'good', profileId: 'b1', expenseId: 'e1', fileName: 'b.pdf', mimeType: 'application/pdf', sizeBytes: 999, data: btoa('PDF') },
      ],
    });
    const result = await replayCarryOver(mapFreeAppBackup(backup, OPTIONS), OPTIONS);
    expect(result.report.notCarried).toEqual([{ code: 'receipt-file-unreadable', count: 1 }]);
    expect(result.snapshot.maps.exps.size).toBe(1);
    expect(result.files).toHaveLength(1);
    expect([...result.snapshot.maps.expReceipts.values()].map((r) => r.status)).toEqual(['READY']);
  });

  it('a receipt the rules refuse leaves no half-uploaded row behind', async () => {
    const backup = freeAppBackup({
      businessProfiles: [business('b1')],
      expenses: [expense('e1', 'b1')],
      receipts: [{ id: 'txt', profileId: 'b1', expenseId: 'e1', fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: 3, data: btoa('TXT') }],
    });
    const result = await replayCarryOver(mapFreeAppBackup(backup, OPTIONS), OPTIONS);
    expect(result.report.notCarried).toEqual([expect.objectContaining({ code: 'refused', count: 1 })]);
    expect([...result.snapshot.maps.expReceipts.values()].filter((r) => !r.deletedAt)).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('lists a record a route refuses, with the reason, and whatever needed it (T-U12)', async () => {
    const backup = freeAppBackup({ businessProfiles: [business('b1')], clients: [client('c1', 'b1')], transactions: [income('old', 'b1', { clientId: 'c1', occurredAt: '2001-01-01' })], paymentRecords: [payment('r1', 'old', 100, '2001-01-02')] });
    const result = await replayCarryOver(mapFreeAppBackup(backup, OPTIONS), OPTIONS);
    expect(result.report.notCarried).toEqual([
      { code: 'refused', count: 1, reason: 'DATE_INVALID' },
      { code: 'parent-not-carried', count: 1 },
    ]);
    expect(result.snapshot.maps.recs.size).toBe(0);
  });

  it('keeps a record whose optional link was refused, and counts the dropped link', async () => {
    const plan: CarryOverPlan = {
      ops: [
        { op: 'profile', ref: 'p', source: { table: 'businessProfiles', id: 'b' }, name: 'B', defaultCurrency: 'ILS' },
        { op: 'customer', ref: 'c', source: { table: 'clients', id: 'c' }, profile: 'p', name: 'C' },
        { op: 'project', ref: 'j', source: { table: 'projects', id: 'j' }, profile: 'p', customer: 'c', name: 'x'.repeat(201), currency: 'ILS' },
        { op: 'owed', ref: 'o', source: { table: 'transactions', id: 't' }, profile: 'p', customer: 'c', project: 'j', amountMinor: 100, currency: 'ILS', occurredOn: '2026-02-01' },
      ],
      report: { changed: [], notCarried: [], jodEntries: 0 },
    };
    const result = await replayCarryOver(plan, OPTIONS);
    expect(result.snapshot.maps.recs.size).toBe(1);
    expect([...result.snapshot.maps.recs.values()][0]!.projectId).toBeNull();
    expect(result.report.changed).toEqual([{ code: 'link-dropped', count: 1 }]);
  });

  // MUT-464: the profile is seeded in the person's language; a backup category that is the same seeded entry in the
  // other language is that category, not a refused duplicate (its expense would lose the category).
  it('files a backup category under the seeded one when it is the same entry in the other language', async () => {
    const plan: CarryOverPlan = {
      ops: [
        { op: 'profile', ref: 'p', source: { table: 'businessProfiles', id: 'b' }, name: 'B', defaultCurrency: 'ILS' },
        { op: 'category', ref: 'k', source: { table: 'expenseCategories', id: 'k' }, profile: 'p', name: 'إيجار المكتب' },
        { op: 'category', ref: 'q', source: { table: 'expenseCategories', id: 'q' }, profile: 'p', name: 'قهوة' },
        { op: 'expense', ref: 'e', source: { table: 'expenses', id: 'e' }, profile: 'p', amountMinor: 100, currency: 'ILS', occurredOn: '2026-02-01', category: 'k' },
      ],
      report: { changed: [], notCarried: [], jodEntries: 0 },
    };
    const result = await replayCarryOver(plan, OPTIONS);
    const cats = [...result.snapshot.maps.expCats.values()];
    const rent = cats.filter((c) => c.name === 'Office Rent' || c.name === 'إيجار المكتب');
    expect(rent).toHaveLength(1);
    expect(cats.some((c) => c.name === 'قهوة')).toBe(true);
    expect([...result.snapshot.maps.exps.values()][0]!.categoryId).toBe(rent[0]!.id);
    expect(result.report.notCarried).toEqual([]);
    expect(result.report.changed).toEqual([]);
  });

  it('gives the browser its page back while it works, and reports progress (R5)', async () => {
    const backup = freeAppBackup({ businessProfiles: [business('b1')], expenses: Array.from({ length: 450 }, (_, i) => expense(`e${i}`, 'b1')) });
    const progress: Array<[number, number]> = [];
    let yields = 0;
    let ms = 0;
    // Each read of the clock is 10 ms later: a slice fits a few ops, then the page gets its turn.
    await replayCarryOver(mapFreeAppBackup(backup, OPTIONS), { ...OPTIONS, onProgress: (done, total) => progress.push([done, total]), yieldToBrowser: async () => void yields++, clock: () => (ms += 10) });
    expect(yields).toBeGreaterThan(50);
    expect(progress.at(-1)).toEqual([451, 451]);
    expect(progress.every(([done], i) => i === 0 || done >= progress[i - 1]![0])).toBe(true);
  });

  it('holds the page for no slice at all when the work is quick', async () => {
    const backup = freeAppBackup({ businessProfiles: [business('b1')], expenses: [expense('e1', 'b1')] });
    let yields = 0;
    await replayCarryOver(mapFreeAppBackup(backup, OPTIONS), { ...OPTIONS, yieldToBrowser: async () => void yields++, clock: () => 0 });
    expect(yields).toBe(0);
  });
});

describe('idempotencyKeyOf', () => {
  it.each(['p', 'category:profile:b1|rent', 'x'.repeat(300)])('makes a key the API accepts from %s', (ref) => {
    expect(idempotencyKeyOf(ref)).toMatch(/^[A-Za-z0-9_\-:.]{8,128}$/);
  });
});

describe('outcomeOf', () => {
  it('a 4xx is the record\'s answer; its reason is the API\'s', () => {
    expect(outcomeOf(422, { error: { code: 'VALIDATION_FAILED', details: { reason: 'DATE_INVALID' } } })).toEqual({ kind: 'refused', reason: 'DATE_INVALID' });
    expect(outcomeOf(409, { error: { code: 'CONFLICT' } })).toEqual({ kind: 'refused', reason: 'CONFLICT' });
    expect(outcomeOf(201, { id: 'x' })).toEqual({ kind: 'created' });
  });

  it('a 5xx stops the whole carry-over (T-U12)', () => {
    expect(() => outcomeOf(500, { error: { code: 'INTERNAL' } })).toThrow(CarryOverAborted);
  });
});

describe('the totals gate (T-I2, E4)', () => {
  it('fails when the records don\'t add up to the free app\'s own rows', async () => {
    const backup = freeAppBackup(TABLES);
    const plan = mapFreeAppBackup(backup, OPTIONS);
    const result = await replayCarryOver(plan, OPTIONS);
    const settle = [...result.snapshot.maps.pays.values()].find((p) => p.amountMinor === 4_000n)!;
    result.snapshot.maps.pays.delete(settle.id); // a settle that went missing

    expect(checkCarriedTotals(backup, plan, result)).toEqual([expect.objectContaining({ currency: 'ILS', field: 'paid', expected: 14_000n, actual: 10_000n })]);
  });

  it('prepareFromBackup gives the summary its counts and per-currency totals', async () => {
    const prepared = await prepareFromBackup(freeAppBackup(TABLES), OPTIONS);
    expect(prepared.counts).toEqual({ businesses: 2, clients: 2, projects: 1, income: 2, payments: 3, expenses: 2, receipts: 1, conversions: 1 });
    expect(prepared.totals).toEqual({
      ILS: { paid: '140.00', outstanding: '60.00', expenses: '25.00', convertedOut: '0.00', convertedIn: '365.00' },
      JOD: { paid: '5.250', outstanding: '0.000', expenses: '0.000', convertedOut: '0.000', convertedIn: '0.000' },
      USD: { paid: '0.00', outstanding: '0.00', expenses: '1.99', convertedOut: '100.00', convertedIn: '0.00' },
    });
    expect(prepared.report.jodEntries).toBe(1);
  });

  it('totalsByCurrency adds profiles together', async () => {
    const result = await replayCarryOver(mapFreeAppBackup(freeAppBackup(TABLES), OPTIONS), OPTIONS);
    expect(Object.keys(totalsByCurrency(snapshotTotals(result.snapshot.maps)))).toEqual(['ILS', 'JOD', 'USD']);
  });
});
