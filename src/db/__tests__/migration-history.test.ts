import { describe, it, expect, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { MiniCrmDatabase, MIGRATED_PAYMENT_NOTE } from '../database';
import { createDatabaseAt, schemaAt, uniqueDbName } from '../../test/legacyDexie';

/**
 * MUT-24 §C: every historical `upgrade()` in database.ts, run from the shape
 * the version before it left on disk. v20–v24 have their own files; this one
 * covers v8, v10, v11, v13, v14, v15, v17 and v18, plus the "log, never
 * throw" fallbacks of v23 and v24. Each case opens the current database over
 * the legacy one, so it also proves every later upgrade keeps the result.
 */

const now = '2026-01-10T09:00:00.000Z';
const opened: Dexie[] = [];

async function upgradeFrom(version: number, rows: Record<string, object[]>): Promise<MiniCrmDatabase> {
  const name = uniqueDbName(`mutaba3a-history-v${version}`);
  await createDatabaseAt(name, version, rows);
  const current = new MiniCrmDatabase(name);
  opened.push(current);
  await current.open();
  return current;
}

afterEach(async () => {
  for (const d of opened.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
  vi.restoreAllMocks();
});

const profile = (id: string, isDefault: boolean) => ({ id, name: id, isDefault, createdAt: now });
const income = (id: string, extra: object) => ({
  id, kind: 'income', status: 'unpaid', amountMinor: 10000, currency: 'USD',
  occurredAt: '2026-01-05', createdAt: now, updatedAt: now, ...extra,
});

describe('schemaAt', () => {
  it('rebuilds a past schema from the version history, without tables dropped later', () => {
    expect(Object.keys(schemaAt(1)).sort()).toEqual(['categories', 'clients', 'fxRates', 'projects', 'settings', 'transactions']);
    expect(schemaAt(20)).toHaveProperty('opLog');
    expect(schemaAt(21)).not.toHaveProperty('opLog');
    expect(schemaAt(24)).not.toHaveProperty('plans');
    expect(schemaAt(18).paymentRecords).toBe('id, transactionId, paidAt, deletedAt');
  });
});

describe('v8 — documents get an export count', () => {
  it('sets exportCount to 0 when missing and keeps one already set', async () => {
    const db = await upgradeFrom(7, {
      documents: [
        { id: 'd1', number: 'INV-1', type: 'invoice', status: 'issued', businessProfileId: 'bp1' },
        { id: 'd2', number: 'INV-2', type: 'invoice', status: 'issued', businessProfileId: 'bp1', exportCount: 3 },
      ],
    });

    const docs = await db.documents.orderBy('id').toArray();
    expect(docs.map((d) => d.exportCount)).toEqual([0, 3]);
  });
});

describe('v10 — engagements are assigned to a profile', () => {
  const engagements = [
    { id: 'e1', type: 'design', status: 'draft' },
    { id: 'e2', type: 'design', status: 'draft', profileId: 'mine' },
  ];

  it('gives unassigned engagements the default profile and keeps assigned ones', async () => {
    const db = await upgradeFrom(9, {
      businessProfiles: [profile('other', false), profile('main', true)],
      engagements,
    });

    const rows = await db.engagements.orderBy('id').toArray();
    expect(rows.map((e) => e.profileId)).toEqual(['main', 'mine']);
  });

  it('falls back to the first profile when none is marked default', async () => {
    const db = await upgradeFrom(9, { businessProfiles: [profile('first', false)], engagements });

    expect((await db.engagements.get('e1'))?.profileId).toBe('first');
  });

  it('leaves engagements alone when there is no profile at all', async () => {
    const db = await upgradeFrom(9, { engagements });

    expect((await db.engagements.get('e1'))?.profileId).toBeUndefined();
  });
});

describe('v11 — documents get a PDF version', () => {
  it('marks exported documents version 1, never-exported 0, and keeps a set version', async () => {
    const db = await upgradeFrom(10, {
      documents: [
        { id: 'd1', number: 'INV-1', type: 'invoice', status: 'issued', pdfSavedPath: '/tmp/inv-1.pdf' },
        { id: 'd2', number: 'INV-2', type: 'invoice', status: 'issued' },
        { id: 'd3', number: 'INV-3', type: 'invoice', status: 'issued', pdfVersion: 4 },
      ],
    });

    const docs = await db.documents.orderBy('id').toArray();
    expect(docs.map((d) => d.pdfVersion)).toEqual([1, 0, 4]);
  });
});

describe('v13 — clients, projects and transactions join a profile', () => {
  const core = {
    clients: [{ id: 'c1', name: 'Acme', createdAt: now, updatedAt: now }, { id: 'c2', name: 'Kept', profileId: 'mine', createdAt: now, updatedAt: now }],
    projects: [{ id: 'p1', name: 'Site', clientId: 'c1', createdAt: now, updatedAt: now }],
    transactions: [income('t1', {})],
  };

  it('assigns every unassigned record to the default profile', async () => {
    const db = await upgradeFrom(12, { businessProfiles: [profile('other', false), profile('main', true)], ...core });

    expect((await db.clients.orderBy('id').toArray()).map((c) => c.profileId)).toEqual(['main', 'mine']);
    expect((await db.projects.get('p1'))?.profileId).toBe('main');
    expect((await db.transactions.get('t1'))?.profileId).toBe('main');
  });

  it('uses the first profile when none is default', async () => {
    const db = await upgradeFrom(12, { businessProfiles: [profile('first', false)], ...core });

    expect((await db.transactions.get('t1'))?.profileId).toBe('first');
    expect((await db.transactions.get('t1'))?.needsReview).toBeUndefined();
  });
});

describe('v14 — income gets a received amount', () => {
  it('sets paid income to its full amount, unpaid income to 0, and leaves expenses alone', async () => {
    const db = await upgradeFrom(13, {
      businessProfiles: [profile('bp1', true)],
      transactions: [
        income('paid', { status: 'paid', paidAt: '2026-01-06', profileId: 'bp1' }),
        income('unpaid', { profileId: 'bp1' }),
        { ...income('exp', { profileId: 'bp1' }), kind: 'expense', status: 'paid' },
      ],
    });

    const received = Object.fromEntries((await db.transactions.toArray()).map((t) => [t.id, t.receivedAmountMinor]));
    expect(received).toEqual({ paid: 10000, unpaid: 0, exp: undefined });
  });
});

describe('v15 — recurring rules get schedule defaults', () => {
  // Local-noon timestamps keep getDate()/getMonth() stable in every test timezone.
  const rule = (id: string, extra: object) => ({ id, profileId: 'bp1', frequency: 'monthly', isPaused: false, createdAt: now, ...extra });

  it('infers the day from the start date (capped at 28), else day 1, and keeps set fields', async () => {
    const db = await upgradeFrom(14, {
      recurringRules: [
        rule('mid', { startDate: '2026-03-15T12:00:00' }),
        rule('late', { startDate: '2026-03-31T12:00:00' }),
        rule('none', {}),
        rule('set', { startDate: '2026-03-15T12:00:00', dayOfMonth: 9, scope: 'client', reminderDaysBefore: 3 }),
        rule('yearly', { frequency: 'yearly', startDate: '2026-07-04T12:00:00' }),
        rule('yearly-set', { frequency: 'yearly', startDate: '2026-07-04T12:00:00', monthOfYear: 2 }),
        rule('yearly-undated', { frequency: 'yearly' }),
      ],
    });

    const byId = Object.fromEntries((await db.recurringRules.toArray()).map((r) => [r.id, r]));
    expect(byId.mid).toMatchObject({ dayOfMonth: 15, scope: 'general', reminderDaysBefore: 0 });
    expect(byId.mid.monthOfYear).toBeUndefined();
    expect(byId.late.dayOfMonth).toBe(28);
    expect(byId.none.dayOfMonth).toBe(1);
    expect(byId.set).toMatchObject({ dayOfMonth: 9, scope: 'client', reminderDaysBefore: 3 });
    expect(byId.yearly).toMatchObject({ dayOfMonth: 4, monthOfYear: 7 });
    expect(byId['yearly-set'].monthOfYear).toBe(2);
    expect(byId['yearly-undated']).toMatchObject({ dayOfMonth: 1 });
    expect(byId['yearly-undated'].monthOfYear).toBeUndefined();
  });
});

describe('v17 — every core record must belong to a profile', () => {
  const orphans = {
    transactions: [income('t1', {}), income('t-deleted', { deletedAt: now }), income('t-kept', { profileId: 'mine' })],
    expenses: [
      { id: 'e1', amountMinor: 500, currency: 'USD', occurredAt: '2026-01-02', createdAt: now },
      { id: 'e-deleted', amountMinor: 500, currency: 'USD', occurredAt: '2026-01-02', createdAt: now, deletedAt: now },
    ],
    projects: [{ id: 'p1', name: 'Site', createdAt: now, updatedAt: now }],
    clients: [{ id: 'c1', name: 'Acme', createdAt: now, updatedAt: now }],
  };

  it('backfills the default profile and flags nothing for review', async () => {
    const db = await upgradeFrom(16, { businessProfiles: [profile('main', true)], ...orphans });

    const t1 = await db.transactions.get('t1');
    expect(t1).toMatchObject({ profileId: 'main' });
    expect(t1?.needsReview).toBeUndefined();
    expect((await db.expenses.get('e1'))?.profileId).toBe('main');
    expect((await db.projects.get('p1'))?.profileId).toBe('main');
    expect((await db.clients.get('c1'))?.profileId).toBe('main');
    expect(await db.businessProfiles.count()).toBe(1);
  });

  it('creates a default "Migrated" profile when none is default and flags its transactions', async () => {
    const db = await upgradeFrom(16, { businessProfiles: [profile('side', false)], ...orphans });

    const migrated = (await db.businessProfiles.toArray()).find((p) => p.name === 'Migrated');
    expect(migrated).toMatchObject({ isDefault: true });
    expect(await db.transactions.get('t1')).toMatchObject({ profileId: migrated?.id, needsReview: true });
    expect((await db.expenses.get('e1'))?.profileId).toBe(migrated?.id);
    expect((await db.clients.get('c1'))?.profileId).toBe(migrated?.id);
  });

  it('skips soft-deleted transactions and expenses and keeps assigned records', async () => {
    const db = await upgradeFrom(16, { businessProfiles: [profile('main', true)], ...orphans });

    expect((await db.transactions.get('t-deleted'))?.profileId).toBeUndefined();
    expect((await db.expenses.get('e-deleted'))?.profileId).toBeUndefined();
    expect((await db.transactions.get('t-kept'))?.profileId).toBe('mine');
  });
});

describe('v18 — payment records from accumulated totals', () => {
  const rows = (transactions: object[]) => ({ businessProfiles: [profile('bp1', true)], transactions });
  const recordsFor = async (db: MiniCrmDatabase, id: string) => db.paymentRecords.where('transactionId').equals(id).toArray();

  it('records a part-paid amount on its paid date', async () => {
    const db = await upgradeFrom(17, rows([income('part', { profileId: 'bp1', receivedAmountMinor: 4000, paidAt: '2026-01-07' })]));

    const [record, ...rest] = await recordsFor(db, 'part');
    expect(rest).toHaveLength(0);
    expect(record).toMatchObject({ amountMinor: 4000, paidAt: '2026-01-07', notes: MIGRATED_PAYMENT_NOTE });
  });

  it('records a pre-v14 paid transaction in full and backfills its received amount', async () => {
    const db = await upgradeFrom(17, rows([income('old', { profileId: 'bp1', status: 'paid', paidAt: '2026-01-08' })]));

    expect(await recordsFor(db, 'old')).toEqual([expect.objectContaining({ amountMinor: 10000, paidAt: '2026-01-08' })]);
    expect((await db.transactions.get('old'))?.receivedAmountMinor).toBe(10000);
  });

  it('dates the record from updatedAt, then createdAt, when paidAt is missing', async () => {
    const db = await upgradeFrom(17, rows([
      income('by-updated', { profileId: 'bp1', receivedAmountMinor: 100, updatedAt: '2026-01-09T00:00:00.000Z' }),
      income('by-created', { profileId: 'bp1', status: 'paid', updatedAt: undefined, createdAt: '2026-01-03T00:00:00.000Z' }),
    ]));

    expect((await recordsFor(db, 'by-updated'))[0].paidAt).toBe('2026-01-09T00:00:00.000Z');
    expect((await recordsFor(db, 'by-created'))[0].paidAt).toBe('2026-01-03T00:00:00.000Z');
  });

  it('writes nothing for unpaid, deleted or expense rows', async () => {
    const db = await upgradeFrom(17, rows([
      income('unpaid', { profileId: 'bp1' }),
      income('gone', { profileId: 'bp1', status: 'paid', deletedAt: now }),
      { ...income('exp', { profileId: 'bp1', status: 'paid' }), kind: 'expense' },
    ]));

    expect(await db.paymentRecords.count()).toBe(0);
  });
});

describe('late upgrades log instead of throwing', () => {
  it('v23 keeps the database openable when the backfill fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('no ids');
    });

    const db = await upgradeFrom(22, {
      businessProfiles: [profile('bp1', true)],
      transactions: [income('paid', { profileId: 'bp1', status: 'paid', receivedAmountMinor: 10000 })],
    });

    expect(db.verno).toBe(24);
    expect(await db.paymentRecords.count()).toBe(0);
    expect(errors).toHaveBeenCalledWith('[db] v23: could not backfill payment records:', expect.any(Error));
  });

  it('v24 keeps the database openable when the settings clean-up fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const db = await upgradeFrom(23, { settings: [{ id: 'default', featureNotice: 'not-a-list' }] });

    expect(db.verno).toBe(24);
    expect(errors).toHaveBeenCalledWith(
      '[db] v24: could not clean up planning and retainer references:',
      expect.anything()
    );
  });

  it('v24 leaves a settings row with no switches or notices as it was', async () => {
    const db = await upgradeFrom(23, { settings: [{ id: 'default', defaultCurrency: 'USD' }] });

    expect(await db.settings.get('default')).toEqual({ id: 'default', defaultCurrency: 'USD' });
  });
});
