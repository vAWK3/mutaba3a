import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import type { CreateExpenseReceiptInput, LedgerStore } from '../ports.js';

/**
 * MUT-503: moving a To-review receipt to another profile in Postgres — the row lock decides between a move and a
 * filing (or a second move), the approval is cleared as JSON null, and a read interrupted by a move gets its try back.
 */

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma receipt move (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await store.disconnect();
  });

  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 29, 10, 0, 0, ms));

  async function seed(s: LedgerStore) {
    const a = await s.organizations.create({ name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const b = await s.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await s.users.create({ email: `m-${unique()}@studio.ps`, displayName: 'Lina', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const ready = async () => {
      const input: CreateExpenseReceiptInput = { organizationId: a.id, expenseId: null, filename: 'scan.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, receivedOn: '2026-10-28', uploadedByUserId: user.id, requestId: null };
      const r = await s.expenseReceipts.create(input, at(1));
      await s.expenseReceipts.setKey(a.id, r.id, `org/${a.id}/expense-receipts/${r.id}`);
      return (await s.expenseReceipts.complete(a.id, r.id, at(2), 'PENDING'))!;
    };
    return { a, b, user, ready };
  }

  describe('Prisma receipt move (MUT-503)', () => {
    it('re-homes the row: same id and day, new profile and key, approval cleared, version bumped, reading kept', async () => {
      const { a, b, ready } = await seed(store);
      const r = await ready();
      const result = await store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: r.id, targetOrganizationId: b.id, storageKey: `org/${b.id}/expense-receipts/${r.id}-abc` });
      expect(result.kind).toBe('moved');
      if (result.kind !== 'moved') return;
      expect(result.previousStorageKey).toBe(r.storageKey);
      expect(result.receipt).toMatchObject({ id: r.id, organizationId: b.id, receivedOn: '2026-10-28', storageKey: `org/${b.id}/expense-receipts/${r.id}-abc`, approved: null, approvedAt: null, version: r.version + 1, readStatus: 'PENDING' });
      expect(await store.expenseReceipts.getById(a.id, r.id)).toBeNull();
      expect(await store.expenseReceipts.countByFilingStatus(b.id)).toEqual({ toReview: 1, filed: 0 });
    });

    it('two moves of one receipt at once: exactly one wins, the other finds it gone', async () => {
      const { a, b, ready } = await seed(store);
      const r = await ready();
      const results = await Promise.all(['one', 'two'].map((n) => store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: r.id, targetOrganizationId: b.id, storageKey: `org/${b.id}/expense-receipts/${r.id}-${n}` })));
      expect(results.map((x) => x.kind).sort()).toEqual(['moved', 'not_found']);
      const winner = results.find((x) => x.kind === 'moved')!;
      expect((await store.expenseReceipts.getById(b.id, r.id))!.storageKey).toBe(winner.kind === 'moved' ? winner.receipt.storageKey : '');
    });

    it('a move and an approval at once: exactly one wins', async () => {
      const { a, b, user, ready } = await seed(store);
      const r = await ready();
      const [moved, filed] = await Promise.all([
        store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: r.id, targetOrganizationId: b.id, storageKey: `org/${b.id}/expense-receipts/${r.id}-x` }),
        store.expenseReceipts.fileAsExpense(
          { organizationId: a.id, receiptId: r.id, userId: user.id, expense: { organizationId: a.id, occurredOn: '2026-10-28', amountMinor: 1_500n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: user.id }, approved: { occurredOn: '2026-10-28', amountMinor: '1500', currency: 'ILS', vendor: 'Cafe', categoryId: null } },
          at(5),
        ),
      ]);
      expect([moved.kind, filed.kind].filter((k) => k === 'moved' || k === 'filed')).toHaveLength(1);
    });

    it('refuses a filed receipt and an unfinished one', async () => {
      const { a, b, user, ready } = await seed(store);
      const filed = await ready();
      await store.expenseReceipts.fileAsExpense(
        { organizationId: a.id, receiptId: filed.id, userId: user.id, expense: { organizationId: a.id, occurredOn: '2026-10-28', amountMinor: 100n, currency: 'ILS', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: null, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null, createdByUserId: user.id }, approved: { occurredOn: '2026-10-28', amountMinor: '100', currency: 'ILS', vendor: null, categoryId: null } },
        at(5),
      );
      expect((await store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: filed.id, targetOrganizationId: b.id, storageKey: 'k' })).kind).toBe('already_filed');
      const pending = await store.expenseReceipts.create({ organizationId: a.id, expenseId: null, filename: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 1, receivedOn: '2026-10-28', uploadedByUserId: user.id, requestId: null }, at(6));
      expect((await store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: pending.id, targetOrganizationId: b.id, storageKey: 'k' })).kind).toBe('not_ready');
    });

    it('releaseMovedRead gives the lease and the try back only when the key moved on', async () => {
      const { a, b, ready } = await seed(store);
      const r = await ready();
      const claim = await store.expenseReceipts.claimRead(r.id, at(10), 90_000);
      expect(claim.kind).toBe('claimed');
      expect(await store.expenseReceipts.releaseMovedRead(r.id, r.storageKey)).toBe(false);
      await store.expenseReceipts.moveToProfile({ organizationId: a.id, receiptId: r.id, targetOrganizationId: b.id, storageKey: `org/${b.id}/expense-receipts/${r.id}-m` });
      expect(await store.expenseReceipts.releaseMovedRead(r.id, r.storageKey)).toBe(true);
      expect(await store.expenseReceipts.getById(b.id, r.id)).toMatchObject({ readStatus: 'PENDING', readAttempts: 0, readLeaseUntil: null });
    });
  });
}
