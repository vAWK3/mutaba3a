import { describe, expect, it } from 'vitest';
import { ForeignKeyViolation } from '../memory.js';
import type { CreateExpenseInput, CreateInboxEntryInput, InboxEntryRecord, LedgerStore, Organization, UserRecord } from '../ports.js';

/**
 * MUT-66 storage contract: the unsorted inbox and the two filing transactions.
 *
 * What this file owns is the transaction boundary — that filing creates the
 * real record and removes the entry together, and that neither happens alone.
 * What the created expense/payment/receivable itself must look like is MUT-42's
 * and MUT-65's contract, already tested in their own files; re-asserting it
 * here would be duplication, not coverage.
 */
export function describeLedgerStoreInboxContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 12, 10, 0, 0, ms));

  async function person(store: LedgerStore, label: string): Promise<{ user: UserRecord; organization: Organization }> {
    const organization = await store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await store.users.create({ email: `${label.toLowerCase()}-${unique()}@firm.ps`, displayName: label, passwordHash: 'x', locale: 'en', organizationId: organization.id, at: at(0) });
    return { user, organization };
  }

  async function world(store: LedgerStore) {
    const owner = await person(store, 'Nour');
    const stranger = await person(store, 'Rami');
    const customer = await store.customers.create({ organizationId: owner.organization.id, name: 'Haddad', email: null, phone: null, notes: null }, at(0));
    const entry = (over: Partial<CreateInboxEntryInput> = {}): CreateInboxEntryInput => ({
      userId: owner.user.id,
      kind: 'EXPENSE',
      amountMinor: 12_345n,
      currency: 'ILS',
      occurredOn: '2026-10-05',
      note: 'Taxi from court',
      captureSource: 'siri',
      ...over,
    });
    const expense = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
      organizationId: owner.organization.id,
      occurredOn: '2026-10-05',
      amountMinor: 12_345n,
      currency: 'ILS',
      title: null,
      vendor: null,
      categoryId: null,
      customerId: null,
      projectId: null,
      notes: 'Taxi from court',
      createdByUserId: owner.user.id,
      ...over,
    });
    return { owner, stranger, customer, entry, expense };
  }

  const countExpenses = async (store: LedgerStore, organizationId: string): Promise<number> =>
    (await store.expenses.list(organizationId, {}, { limit: 500, cursor: null })).items.length;

  describe(`${name} LedgerStore inbox contract (MUT-66)`, () => {
    it('creates and reads back every field, with captureSource absent round-tripping as null', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.inboxEntries.create(w.entry({ kind: 'INCOME', amountMinor: 9_007_199_254_740_993n }), at(1));
      expect(created).toMatchObject({
        userId: w.owner.user.id,
        kind: 'INCOME',
        amountMinor: 9_007_199_254_740_993n,
        currency: 'ILS',
        occurredOn: '2026-10-05',
        note: 'Taxi from court',
        captureSource: 'siri',
        version: 1,
        createdAt: at(1),
        updatedAt: at(1),
      });
      expect(await store.inboxEntries.getById(w.owner.user.id, created.id)).toEqual(created);

      const bare = await store.inboxEntries.create(w.entry({ note: null, captureSource: null }), at(2));
      expect(bare.note).toBeNull();
      expect(bare.captureSource).toBeNull();
    });

    it('refuses an entry for a user who does not exist', async () => {
      const store = await makeStore();
      const w = await world(store);
      await expect(store.inboxEntries.create(w.entry({ userId: '00000000-0000-4000-8000-000000000000' }), at(1))).rejects.toThrow(ForeignKeyViolation);
    });

    it('never shows one person’s entries to another, through getById or any page', async () => {
      const store = await makeStore();
      const w = await world(store);
      const mine = await store.inboxEntries.create(w.entry(), at(1));
      await store.inboxEntries.create(w.entry({ userId: w.stranger.user.id }), at(2));

      expect(await store.inboxEntries.getById(w.stranger.user.id, mine.id)).toBeNull();
      const theirs = await store.inboxEntries.list(w.stranger.user.id, { limit: 50, cursor: null });
      expect(theirs.items.map((e) => e.id)).not.toContain(mine.id);
      expect(await store.inboxEntries.countByUser(w.owner.user.id)).toBe(1);
      expect(await store.inboxEntries.countByUser(w.stranger.user.id)).toBe(1);
    });

    it('pages newest first with no gaps or repeats, including entries captured in the same millisecond', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created: InboxEntryRecord[] = [];
      for (let i = 0; i < 4; i += 1) created.push(await store.inboxEntries.create(w.entry({ note: `a${i}` }), at(1)));
      for (let i = 0; i < 3; i += 1) created.push(await store.inboxEntries.create(w.entry({ note: `b${i}` }), at(2)));
      await store.inboxEntries.create(w.entry({ userId: w.stranger.user.id }), at(2));

      const walked: string[] = [];
      let cursor = null;
      do {
        const page = await store.inboxEntries.list(w.owner.user.id, { limit: 2, cursor });
        walked.push(...page.items.map((e) => e.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(new Set(walked).size).toBe(walked.length);
      expect(new Set(walked)).toEqual(new Set(created.map((e) => e.id)));
      // The at(2) batch is newer, so it comes first in whatever (createdAt, id) order the store settles on.
      expect(walked.slice(0, 3).every((id) => created.slice(4).some((e) => e.id === id))).toBe(true);
    });

    it('updates a patchable field, bumps the version, and refuses a stale one with no side effects', async () => {
      const store = await makeStore();
      const w = await world(store);
      const created = await store.inboxEntries.create(w.entry(), at(1));

      const updated = await store.inboxEntries.update(w.owner.user.id, created.id, 1, { amountMinor: 999n, note: null }, at(2));
      expect(updated).toMatchObject({ kind: 'updated', record: { amountMinor: 999n, note: null, version: 2, updatedAt: at(2) } });

      const stale = await store.inboxEntries.update(w.owner.user.id, created.id, 1, { amountMinor: 1n }, at(3));
      expect(stale.kind).toBe('stale');
      expect((await store.inboxEntries.getById(w.owner.user.id, created.id))?.amountMinor).toBe(999n);
    });

    it('answers not_found alike for an unknown id, another person’s, and a deleted one', async () => {
      const store = await makeStore();
      const w = await world(store);
      const mine = await store.inboxEntries.create(w.entry(), at(1));
      const theirs = await store.inboxEntries.create(w.entry({ userId: w.stranger.user.id }), at(1));

      expect((await store.inboxEntries.update(w.owner.user.id, '00000000-0000-4000-8000-000000000000', 1, { note: 'x' }, at(2))).kind).toBe('not_found');
      expect((await store.inboxEntries.update(w.owner.user.id, theirs.id, 1, { note: 'x' }, at(2))).kind).toBe('not_found');
      expect(await store.inboxEntries.delete(w.owner.user.id, mine.id)).toBe(true);
      expect((await store.inboxEntries.update(w.owner.user.id, mine.id, 1, { note: 'x' }, at(2))).kind).toBe('not_found');
    });

    it('hard-deletes, and answers false alike for an unknown id, another person’s, and one already deleted', async () => {
      const store = await makeStore();
      const w = await world(store);
      const mine = await store.inboxEntries.create(w.entry(), at(1));
      const theirs = await store.inboxEntries.create(w.entry({ userId: w.stranger.user.id }), at(1));

      expect(await store.inboxEntries.delete(w.owner.user.id, mine.id)).toBe(true);
      expect(await store.inboxEntries.getById(w.owner.user.id, mine.id)).toBeNull();
      expect(await store.inboxEntries.delete(w.owner.user.id, mine.id)).toBe(false);
      expect(await store.inboxEntries.delete(w.owner.user.id, theirs.id)).toBe(false);
      expect(await store.inboxEntries.delete(w.owner.user.id, '00000000-0000-4000-8000-000000000000')).toBe(false);
      // The other person's entry was never touched by any of the above.
      expect(await store.inboxEntries.getById(w.stranger.user.id, theirs.id)).not.toBeNull();
    });

    it('counts per person: zero, then up on capture, down on delete and on a successful filing', async () => {
      const store = await makeStore();
      const w = await world(store);
      expect(await store.inboxEntries.countByUser(w.owner.user.id)).toBe(0);

      const kept = await store.inboxEntries.create(w.entry(), at(1));
      const dropped = await store.inboxEntries.create(w.entry(), at(1));
      const filed = await store.inboxEntries.create(w.entry(), at(1));
      expect(await store.inboxEntries.countByUser(w.owner.user.id)).toBe(3);

      await store.inboxEntries.delete(w.owner.user.id, dropped.id);
      await store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: filed.id, kind: 'EXPENSE', expense: w.expense() }, at(2));
      expect(await store.inboxEntries.countByUser(w.owner.user.id)).toBe(1);
      expect((await store.inboxEntries.list(w.owner.user.id, { limit: 10, cursor: null })).items.map((e) => e.id)).toEqual([kept.id]);
    });

    /** AC 6, proven rather than assumed: the inbox outlives every membership the person had. */
    it('survives the removal of the person’s last membership', async () => {
      const store = await makeStore();
      const w = await world(store);
      await store.inboxEntries.create(w.entry(), at(1));

      await store.memberships.revoke(w.owner.user.id, w.owner.organization.id);
      expect(await store.memberships.listByUser(w.owner.user.id)).toEqual([]);
      expect(await store.inboxEntries.countByUser(w.owner.user.id)).toBe(1);
      expect((await store.inboxEntries.list(w.owner.user.id, { limit: 10, cursor: null })).items).toHaveLength(1);
    });

    it('files as an expense: the expense exists and the entry is gone, from the one call', async () => {
      const store = await makeStore();
      const w = await world(store);
      const captured = await store.inboxEntries.create(w.entry(), at(1));

      const filed = await store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: captured.id, kind: 'EXPENSE', expense: w.expense({ notes: captured.note }) }, at(2));
      expect(filed.kind).toBe('filed');
      if (filed.kind !== 'filed') throw new Error('unreachable');
      expect(filed.expense).toMatchObject({ organizationId: w.owner.organization.id, amountMinor: 12_345n, currency: 'ILS', occurredOn: '2026-10-05', notes: 'Taxi from court' });
      expect(await store.expenses.getById(w.owner.organization.id, filed.expense.id)).not.toBeNull();
      expect(await store.inboxEntries.getById(w.owner.user.id, captured.id)).toBeNull();
    });

    it('files as income, both shapes, and removes the entry each time', async () => {
      const store = await makeStore();
      const w = await world(store);
      const forReceived = await store.inboxEntries.create(w.entry({ kind: 'INCOME' }), at(1));
      const forOwed = await store.inboxEntries.create(w.entry({ kind: 'INCOME' }), at(1));

      const received = await store.inboxEntries.fileAsIncome(
        {
          userId: w.owner.user.id,
          inboxEntryId: forReceived.id,
          kind: 'INCOME',
          write: {
            kind: 'received',
            payment: {
              organizationId: w.owner.organization.id,
              customerId: null,
              projectId: null,
              currency: 'ILS',
              amountMinor: 12_345n,
              receivedOn: '2026-10-05',
              method: 'CASH',
              reference: null,
              notes: 'Taxi from court',
              replacesPaymentId: null,
              requestId: null,
              createdByUserId: w.owner.user.id,
              allocations: [],
            },
          },
        },
        at(2),
      );
      expect(received.kind).toBe('filed');
      if (received.kind !== 'filed' || received.result.kind !== 'received') throw new Error('unreachable');
      expect(received.result.payment.amountMinor).toBe(12_345n);
      expect(await store.inboxEntries.getById(w.owner.user.id, forReceived.id)).toBeNull();

      const owed = await store.inboxEntries.fileAsIncome(
        {
          userId: w.owner.user.id,
          inboxEntryId: forOwed.id,
          kind: 'INCOME',
          write: {
            kind: 'owed',
            receivable: {
              organizationId: w.owner.organization.id,
              customerId: w.customer.id,
              projectId: null,
              currency: 'ILS',
              netMinor: 12_345n,
              vatMinor: 0n,
              grossMinor: 12_345n,
              vatTreatment: 'OUT_OF_SCOPE',
              vatRateBasisPoints: 0,
              title: null,
              dueDate: '2026-11-15',
              postingDate: '2026-10-05',
              postedAt: at(2),
              createdByUserId: w.owner.user.id,
              requestId: null,
            },
          },
        },
        at(2),
      );
      expect(owed.kind).toBe('filed');
      if (owed.kind !== 'filed' || owed.result.kind !== 'owed') throw new Error('unreachable');
      expect(owed.result.receivable.origin).toBe('ADJUSTMENT');
      expect(await store.inboxEntries.getById(w.owner.user.id, forOwed.id)).toBeNull();
    });

    it('files nothing at all for an unknown, foreign, wrong-kind or already-filed entry', async () => {
      const store = await makeStore();
      const w = await world(store);
      const theirs = await store.inboxEntries.create(w.entry({ userId: w.stranger.user.id }), at(1));
      const income = await store.inboxEntries.create(w.entry({ kind: 'INCOME' }), at(1));
      const spent = await store.inboxEntries.create(w.entry(), at(1));
      await store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: spent.id, kind: 'EXPENSE', expense: w.expense() }, at(2));
      const before = await countExpenses(store, w.owner.organization.id);

      for (const inboxEntryId of ['00000000-0000-4000-8000-000000000000', theirs.id, income.id, spent.id]) {
        const result = await store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId, kind: 'EXPENSE', expense: w.expense() }, at(3));
        expect(result, inboxEntryId).toEqual({ kind: 'not_found' });
      }
      // The return value alone could be a lie; the ledger is what proves nothing was written.
      expect(await countExpenses(store, w.owner.organization.id)).toBe(before);
      expect(await store.inboxEntries.getById(w.stranger.user.id, theirs.id)).not.toBeNull();
      expect(await store.inboxEntries.getById(w.owner.user.id, income.id)).not.toBeNull();
    });

    it('files an entry exactly once when two filings race it', async () => {
      const store = await makeStore();
      const w = await world(store);
      const captured = await store.inboxEntries.create(w.entry(), at(1));

      const results = await Promise.all([
        store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: captured.id, kind: 'EXPENSE', expense: w.expense() }, at(2)),
        store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: captured.id, kind: 'EXPENSE', expense: w.expense() }, at(2)),
      ]);

      expect(results.filter((r) => r.kind === 'filed')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'not_found')).toHaveLength(1);
      expect(await countExpenses(store, w.owner.organization.id)).toBe(1);
      expect(await store.inboxEntries.getById(w.owner.user.id, captured.id)).toBeNull();
    });

    /** The literal "on failure it stays untouched" half of the ticket, at the layer where the transaction actually lives. */
    it('leaves the entry exactly as it was when the financial write fails mid-transaction', async () => {
      const store = await makeStore();
      const w = await world(store);
      const captured = await store.inboxEntries.create(w.entry(), at(1));
      const before = await countExpenses(store, w.owner.organization.id);

      // Fault injection: an organization that does not exist makes the expense insert fail on its
      // foreign key, after the entry has already been claimed. A route can never send this — the
      // profile is resolved by middleware — which is the point: it isolates the rollback itself.
      await expect(
        store.inboxEntries.fileAsExpense({ userId: w.owner.user.id, inboxEntryId: captured.id, kind: 'EXPENSE', expense: w.expense({ organizationId: '00000000-0000-4000-8000-000000000000' }) }, at(2)),
      ).rejects.toThrow(ForeignKeyViolation);

      expect(await store.inboxEntries.getById(w.owner.user.id, captured.id)).toEqual(captured);
      expect(await countExpenses(store, w.owner.organization.id)).toBe(before);
    });

    it('rolls the entry back when an income filing fails mid-transaction', async () => {
      const store = await makeStore();
      const w = await world(store);
      const captured = await store.inboxEntries.create(w.entry({ kind: 'INCOME' }), at(1));

      await expect(
        store.inboxEntries.fileAsIncome(
          {
            userId: w.owner.user.id,
            inboxEntryId: captured.id,
            kind: 'INCOME',
            write: {
              kind: 'owed',
              receivable: {
                organizationId: w.owner.organization.id,
                // No such client in this profile: createAdjustmentTx throws before the receivable row exists.
                customerId: '00000000-0000-4000-8000-000000000000',
                projectId: null,
                currency: 'ILS',
                netMinor: 12_345n,
                vatMinor: 0n,
                grossMinor: 12_345n,
                vatTreatment: 'OUT_OF_SCOPE',
                vatRateBasisPoints: 0,
                title: null,
                dueDate: '2026-11-15',
                postingDate: '2026-10-05',
                postedAt: at(2),
                createdByUserId: w.owner.user.id,
                requestId: null,
              },
            },
          },
          at(2),
        ),
      ).rejects.toThrow();

      expect(await store.inboxEntries.getById(w.owner.user.id, captured.id)).toEqual(captured);
    });
  });
}
