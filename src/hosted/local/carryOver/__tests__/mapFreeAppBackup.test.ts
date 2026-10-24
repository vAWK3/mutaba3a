import { describe, expect, it } from 'vitest';
import { FREE_APP_BACKUP_MAX_VERSION, FreeAppBackupRefused, parseFreeAppBackup } from '../freeAppBackup';
import { dependenciesOf, localDate, mapFreeAppBackup, MAX_CARRIED_BUSINESSES, type CarryOp, type CarryOverPlan } from '../mapFreeAppBackup';
import { business, client, conversion, expense, freeAppBackup, income, payment, project } from './helpers/freeAppFixture';

/** MUT-291 §3.3 and §7 (T-U1..T-U11): the free app's backup, as the requests that recreate it in local mode. */

const OPTIONS = { timezone: 'Asia/Jerusalem', labels: { noClient: 'No client', defaultBusiness: 'My business' } };
const map = (tables: Record<string, unknown[]>) => mapFreeAppBackup(freeAppBackup(tables), OPTIONS);
const opsOf = <K extends CarryOp['op']>(plan: CarryOverPlan, kind: K) => plan.ops.filter((op): op is Extract<CarryOp, { op: K }> => op.op === kind);
const changed = (plan: CarryOverPlan, code: string) => plan.report.changed.find((l) => l.code === code)?.count ?? 0;
const notCarried = (plan: CarryOverPlan, code: string) => plan.report.notCarried.find((l) => l.code === code)?.count ?? 0;

describe('parseFreeAppBackup (T-U1)', () => {
  it('reads a v24 backup and keeps every table it maps', () => {
    const backup = parseFreeAppBackup(JSON.stringify({ version: 24, timestamp: 'x', tables: { businessProfiles: [business('b1')], clients: [client('c1', 'b1')] } }));
    expect(backup.tables.businessProfiles).toHaveLength(1);
    expect(backup.tables.clients).toHaveLength(1);
    expect(backup.tables.expenses).toEqual([]);
  });

  it('refuses a backup from a newer free app', () => {
    expect(() => parseFreeAppBackup(JSON.stringify({ version: FREE_APP_BACKUP_MAX_VERSION + 1, tables: {} }))).toThrow(expect.objectContaining({ reason: 'too-new' }));
  });

  it.each([
    ['not JSON', 'nope{'],
    ['JSON that is not a backup', JSON.stringify({ kind: 'mtb3a.records', maps: {} })],
    ['a backup with no tables', JSON.stringify({ version: 24 })],
    ['a non-integer version', JSON.stringify({ version: 2.5, tables: {} })],
  ])('refuses %s, and only ever with FreeAppBackupRefused', (_label, text) => {
    expect(() => parseFreeAppBackup(text)).toThrow(FreeAppBackupRefused);
  });

  it('counts a malformed row instead of refusing the whole backup', () => {
    const backup = parseFreeAppBackup(JSON.stringify({ version: 24, tables: { clients: [client('c1', 'b1'), { id: 'c2' }] } }));
    expect(backup.tables.clients).toHaveLength(1);
    expect(backup.malformed).toEqual({ clients: 1 });
    expect(notCarried(mapFreeAppBackup(backup, OPTIONS), 'malformed')).toBe(1);
  });
});

describe('profiles (T-U2, T-U3; D2)', () => {
  it('makes each business a Business profile with its name and currency, the default first', () => {
    const plan = map({ businessProfiles: [business('b2', { createdAt: '2026-01-01' }), business('b1', { isDefault: true, defaultCurrency: 'USD' })] });
    expect(opsOf(plan, 'profile').map((p) => [p.ref, p.name, p.defaultCurrency])).toEqual([
      ['profile:b1', 'Business b1', 'USD'],
      ['profile:b2', 'Business b2', 'ILS'],
    ]);
  });

  it(`carries at most ${MAX_CARRIED_BUSINESSES}; the rest and their records are listed`, () => {
    const businesses = Array.from({ length: 7 }, (_, i) => business(`b${i}`, { createdAt: `2026-01-0${i + 1}` }));
    const plan = map({ businessProfiles: businesses, clients: [client('c6', 'b6')], transactions: [income('t6', 'b6')] });
    expect(opsOf(plan, 'profile')).toHaveLength(5);
    expect(notCarried(plan, 'business-over-cap')).toBe(2);
    expect(notCarried(plan, 'record-of-business-over-cap')).toBe(2);
    expect(opsOf(plan, 'customer')).toEqual([]);
  });

  it('carries an archived business after the active ones and says so', () => {
    const plan = map({ businessProfiles: [business('old', { archivedAt: '2026-01-01', createdAt: '2025-01-01' }), business('b1')] });
    expect(opsOf(plan, 'profile').map((p) => p.ref)).toEqual(['profile:b1', 'profile:old']);
    expect(changed(plan, 'business-archived-carried')).toBe(1);
  });

  it('puts rows with no business into the default one, counted', () => {
    const plan = map({ businessProfiles: [business('b1', { isDefault: true })], transactions: [income('t1', undefined), conversion('x1', undefined)] });
    expect(opsOf(plan, 'owed')[0]!.profile).toBe('profile:b1');
    expect(opsOf(plan, 'conversion')[0]!.profile).toBe('profile:b1');
    expect(changed(plan, 'unscoped-assigned')).toBe(2);
  });

  it('makes one business for records from before businesses existed', () => {
    const plan = map({ clients: [client('c1', undefined as unknown as string)] });
    expect(opsOf(plan, 'profile')).toEqual([expect.objectContaining({ ref: 'profile:default', name: 'My business' })]);
    expect(plan.ops[0]!.op).toBe('profile');
    expect(changed(plan, 'business-created')).toBe(1);
  });
});

describe('No client and project currency (T-U4, T-U5; D4)', () => {
  it('puts an Owed with no client under one "No client" client per profile', () => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1'), income('t2', 'b1')] });
    const placeholders = opsOf(plan, 'customer').filter((c) => c.name === 'No client');
    expect(placeholders).toHaveLength(1);
    expect(opsOf(plan, 'owed').map((o) => o.customer)).toEqual([placeholders[0]!.ref, placeholders[0]!.ref]);
    expect(changed(plan, 'owed-no-client')).toBe(2);
  });

  it('gives a project the currency most of its entries use, and drops the project from the others', () => {
    const plan = map({
      businessProfiles: [business('b1')],
      clients: [client('c1', 'b1')],
      projects: [project('p1', 'b1', 'c1')],
      transactions: [income('t1', 'b1', { clientId: 'c1', projectId: 'p1', currency: 'USD' }), income('t2', 'b1', { clientId: 'c1', projectId: 'p1', currency: 'USD' }), income('t3', 'b1', { clientId: 'c1', projectId: 'p1', currency: 'ILS' })],
    });
    expect(opsOf(plan, 'project')[0]!.currency).toBe('USD');
    const ils = opsOf(plan, 'owed').find((o) => o.currency === 'ILS')!;
    expect(ils.project).toBeUndefined();
    expect(ils.customer).toBe('customer:c1');
    expect(changed(plan, 'project-currency-dropped')).toBe(1);
  });

  it('gives a project with no client the "No client" client', () => {
    const plan = map({ businessProfiles: [business('b1')], projects: [project('p1', 'b1', undefined)] });
    expect(opsOf(plan, 'project')[0]!.customer).toBe('customer:no-client:profile:b1');
    expect(changed(plan, 'project-no-client')).toBe(1);
  });
});

describe('payments (T-U6)', () => {
  it('turns a part-paid entry into an Owed and one settle per payment record', () => {
    const plan = map({
      businessProfiles: [business('b1')],
      clients: [client('c1', 'b1')],
      transactions: [income('t1', 'b1', { clientId: 'c1', receivedAmountMinor: 4_000 })],
      paymentRecords: [payment('r2', 't1', 1_000, '2026-02-20'), payment('r1', 't1', 3_000, '2026-02-15'), payment('gone', 't1', 9, '2026-02-16', { deletedAt: 'x' })],
    });
    expect(opsOf(plan, 'owed')).toEqual([expect.objectContaining({ customer: 'customer:c1', amountMinor: 10_000 })]);
    expect(opsOf(plan, 'settle').map((s) => [s.amountMinor, s.paidAt])).toEqual([
      [3_000, '2026-02-15'],
      [1_000, '2026-02-20'],
    ]);
  });

  it('settles the paid amount no payment record covers on the entry\'s paid date', () => {
    const plan = map({ businessProfiles: [business('b1')], clients: [client('c1', 'b1')], transactions: [income('t1', 'b1', { clientId: 'c1', status: 'paid', paidAt: '2026-02-11T10:00:00.000Z' })], paymentRecords: [payment('r1', 't1', 6_000, '2026-02-11')] });
    expect(opsOf(plan, 'settle').map((s) => [s.source.table, s.amountMinor])).toEqual([
      ['paymentRecords', 6_000],
      ['uncovered', 4_000],
    ]);
  });

  it('makes paid income with no client Received money, one per payment', () => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1', { status: 'paid', notes: 'cash' })], paymentRecords: [payment('r1', 't1', 7_000, '2026-02-11'), payment('r2', 't1', 3_000, '2026-02-12')] });
    expect(opsOf(plan, 'owed')).toEqual([]);
    expect(opsOf(plan, 'received').map((r) => [r.amountMinor, r.occurredOn, r.notes])).toEqual([
      [7_000, '2026-02-11', 'cash'],
      [3_000, '2026-02-12', undefined],
    ]);
  });

  it('lists what an Owed and a settle have no place for', () => {
    const plan = map({ businessProfiles: [business('b1')], clients: [client('c1', 'b1')], transactions: [income('t1', 'b1', { clientId: 'c1', notes: 'n', categoryId: 'cat', needsReview: true })], paymentRecords: [payment('r1', 't1', 1, '2026-02-11', { notes: 'n' })] });
    expect(changed(plan, 'owed-notes-dropped')).toBe(1);
    expect(changed(plan, 'payment-notes-dropped')).toBe(1);
    expect(changed(plan, 'income-category-dropped')).toBe(1);
    expect(changed(plan, 'review-flag-dropped')).toBe(1);
  });
});

describe('dates (T-U7)', () => {
  it.each([
    ['Asia/Jerusalem', '2026-02-10T22:30:00.000Z', '2026-02-11'],
    ['America/New_York', '2026-02-11T03:30:00.000Z', '2026-02-10'],
    ['Asia/Jerusalem', '2026-02-10', '2026-02-10'],
  ])('in %s, %s is the day %s', (timezone, value, day) => {
    expect(localDate(value, timezone)).toBe(day);
  });

  it('moves a due date before the entry\'s date, and a payment dated before it, to that date', () => {
    const plan = map({ businessProfiles: [business('b1')], clients: [client('c1', 'b1')], transactions: [income('t1', 'b1', { clientId: 'c1', dueDate: '2026-02-01' })], paymentRecords: [payment('r1', 't1', 100, '2026-02-01')] });
    expect(opsOf(plan, 'owed')[0]!.dueDate).toBe('2026-02-10');
    expect(opsOf(plan, 'settle')[0]!.paidAt).toBe('2026-02-10');
    expect(changed(plan, 'due-date-moved')).toBe(1);
    expect(changed(plan, 'paid-before-entry-moved')).toBe(1);
  });
});

describe('what has no home (T-U8)', () => {
  it('lists each kind once with its count, and drops nothing silently', () => {
    const plan = map({
      businessProfiles: [business('b1')],
      transactions: [income('t1', 'b1', { archivedAt: 'x' }), income('t2', 'b1', { currency: 'GBP' }), conversion('x1', 'b1', { toCurrency: 'USD' }), conversion('x2', 'b1', { toCurrency: undefined })],
      vendors: [{ id: 'v1', profileId: 'b1', canonicalName: 'Shop' }],
      receipts: [{ id: 'rc1', profileId: 'b1', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: 'AAA' }],
      recurringRules: [{}, {}],
      recurringOccurrences: [{}],
      documents: [{}],
      engagements: [{}],
      monthCloseStatuses: [{}],
    });
    expect(Object.fromEntries(plan.report.notCarried.map((l) => [l.code, l.count]))).toEqual({
      'archived-entry': 1,
      currency: 1,
      'conversion-same-currency': 1,
      'conversion-incomplete': 1,
      'receipt-unattached': 1,
      vendors: 1,
      'recurring-rules': 2,
      'recurring-occurrences': 1,
      documents: 1,
      engagements: 1,
      'month-close': 1,
    });
  });

  it('never carries a deleted row and never lists one', () => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1', { deletedAt: 'x' })], expenses: [expense('e1', 'b1', { deletedAt: 'x' })] });
    expect(plan.ops.filter((op) => op.op !== 'profile')).toEqual([]);
    expect(plan.report.notCarried).toEqual([]);
  });
});

describe('JOD (T-U9, TD-112)', () => {
  it('counts JOD income and expenses for the warning, not JOD conversions', () => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1', { currency: 'JOD' }), conversion('x1', 'b1', { currency: 'JOD', toCurrency: 'USD' })], expenses: [expense('e1', 'b1', { currency: 'JOD' })] });
    expect(plan.report.jodEntries).toBe(2);
  });
});

describe('amounts (T-U10)', () => {
  it('keeps the minor units it read, for replay.ts to write in each currency\'s digits', () => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1', { currency: 'JOD', amountMinor: 5_250 })] });
    expect(opsOf(plan, 'owed')[0]).toMatchObject({ amountMinor: 5_250, currency: 'JOD' });
  });

  it.each([0, -5])('lists an amount of %s instead of sending it', (amountMinor) => {
    const plan = map({ businessProfiles: [business('b1')], transactions: [income('t1', 'b1', { amountMinor })], expenses: [expense('e1', 'b1', { amountMinor })] });
    expect(notCarried(plan, 'amount')).toBe(2);
  });
});

describe('order and refs (T-U11)', () => {
  const plan = map({
    businessProfiles: [business('b1')],
    clients: [client('c1', 'b1', { archivedAt: 'x' })],
    projects: [project('p1', 'b1', 'c1', { archivedAt: 'x' })],
    transactions: [income('t1', 'b1', { clientId: 'c1', projectId: 'p1' })],
    paymentRecords: [payment('r1', 't1', 100, '2026-02-11')],
    expenses: [expense('e1', 'b1', { clientId: 'c1', categoryId: 'k1' })],
    expenseCategories: [{ id: 'k1', profileId: 'b1', name: 'Rent', color: '#aabbcc' }],
    receipts: [{ id: 'rc1', profileId: 'b1', expenseId: 'e1', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 3, data: 'AAA' }],
  });

  it('every op comes after the ops it depends on', () => {
    const seen = new Set<string>();
    for (const op of plan.ops) {
      for (const dep of dependenciesOf(op)) expect(seen.has(dep), `${op.ref} needs ${dep}`).toBe(true);
      seen.add(op.ref);
    }
  });

  it('archives the project before its client, both last', () => {
    expect(plan.ops.slice(-2).map((op) => op.op)).toEqual(['archive-project', 'archive-customer']);
  });

  it('refs are unique', () => {
    const refs = plan.ops.map((op) => op.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('one category per profile and name, with its colour', () => {
    expect(opsOf(plan, 'category')).toEqual([expect.objectContaining({ name: 'Rent', color: '#aabbcc' })]);
    expect(opsOf(plan, 'expense')[0]!.category).toBe(opsOf(plan, 'category')[0]!.ref);
  });

  it('a receipt goes with its expense', () => {
    expect(opsOf(plan, 'receipt')[0]!.expense).toBe(opsOf(plan, 'expense')[0]!.ref);
  });
});
