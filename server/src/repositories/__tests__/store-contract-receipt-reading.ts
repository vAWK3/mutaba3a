import { describe, expect, it } from 'vitest';
import type { CreateExpenseReceiptInput, LedgerStore, Organization, ReceiptSuggestion } from '../ports.js';

/** MUT-441 storage contract: the server's reading state — set with READY, claimed under a lease, ended once, swept, and the grant backlog. */
export function describeLedgerStoreReceiptReadingContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 28, 9, 0, 0) + ms);
  const LEASE = 90_000;
  const org = (store: LedgerStore): Promise<Organization> =>
    store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store);
    const b = await org(store);
    const person = async () =>
      (await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) })).user;
    const user = await person();
    const upload = (over: Partial<CreateExpenseReceiptInput> = {}): CreateExpenseReceiptInput => ({
      organizationId: a.id,
      expenseId: null,
      filename: 'scan.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      receivedOn: '2026-10-28',
      uploadedByUserId: user.id,
      requestId: null,
      ...over,
    });
    const started = async (over: Partial<CreateExpenseReceiptInput> = {}) => {
      const r = await store.expenseReceipts.create(upload(over), at(0));
      return (await store.expenseReceipts.setKey(r.organizationId, r.id, `org/${r.organizationId}/expense-receipts/${r.id}`))!;
    };
    /** A library receipt completed with the server asked to read it. */
    const pending = async (over: Partial<CreateExpenseReceiptInput> = {}, ms = 1) => {
      const r = await started(over);
      return (await store.expenseReceipts.complete(r.organizationId, r.id, at(ms), 'PENDING'))!;
    };
    return { a, b, user, person, started, pending };
  }

  const read: ReceiptSuggestion = { readerVersion: 'server-ocr-test-1', date: { value: '2026-10-28', source: 'ocr', confidence: 0.9 }, totalMinor: { value: '1540', source: 'ocr', confidence: 0.8 } };

  describe(`${name} LedgerStore receipt reading contract (MUT-441)`, () => {
    it('complete sets the reading state in the same update as READY, and only on that flip', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.pending({}, 5);
      // Absent reads as 0 and null (a memory record carries only what was set).
      expect(r).toMatchObject({ status: 'READY', readStatus: 'PENDING', readRequestedAt: at(5) });
      expect([r.readAttempts ?? 0, r.readLeaseUntil ?? null]).toEqual([0, null]);
      const again = await store.expenseReceipts.complete(w.a.id, r.id, at(9), 'SKIPPED');
      expect(again).toMatchObject({ readStatus: 'PENDING', readRequestedAt: at(5) });
      const plain = await w.started();
      expect((await store.expenseReceipts.complete(w.a.id, plain.id, at(5)))?.readStatus ?? 'NONE').toBe('NONE');
      const skipped = await w.started();
      const skippedNow = await store.expenseReceipts.complete(w.a.id, skipped.id, at(5), 'SKIPPED');
      expect([skippedNow?.readStatus, skippedNow?.readRequestedAt ?? null]).toEqual(['SKIPPED', null]);
    });

    it('claimRead takes a free lease once: busy while it lives, claimable again once it lapses, none when not PENDING', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.pending();
      const first = await store.expenseReceipts.claimRead(r.id, at(10), LEASE);
      expect(first).toMatchObject({ kind: 'claimed', record: { id: r.id, readAttempts: 1, readLeaseUntil: at(10 + LEASE), version: r.version } });
      expect(await store.expenseReceipts.claimRead(r.id, at(20), LEASE)).toEqual({ kind: 'busy' });
      const lapsed = await store.expenseReceipts.claimRead(r.id, at(11 + LEASE), LEASE);
      expect(lapsed).toMatchObject({ kind: 'claimed', record: { readAttempts: 2 } });
      const plain = await w.started();
      await store.expenseReceipts.complete(w.a.id, plain.id, at(1));
      expect(await store.expenseReceipts.claimRead(plain.id, at(10), LEASE)).toEqual({ kind: 'none' });
      expect(await store.expenseReceipts.claimRead('00000000-0000-4000-8000-0000000000ff', at(10), LEASE)).toEqual({ kind: 'none' });
    });

    it('two claims at the same instant: exactly one wins', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.pending();
      const results = await Promise.all([1, 2, 3, 4].map(() => store.expenseReceipts.claimRead(r.id, at(10), LEASE)));
      expect(results.filter((c) => c.kind === 'claimed')).toHaveLength(1);
      expect((await store.expenseReceipts.getById(w.a.id, r.id))?.readAttempts).toBe(1);
    });

    it('releaseRead frees the lease of a PENDING receipt', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.pending();
      await store.expenseReceipts.claimRead(r.id, at(10), LEASE);
      await store.expenseReceipts.releaseRead(r.id);
      expect(await store.expenseReceipts.claimRead(r.id, at(11), LEASE)).toMatchObject({ kind: 'claimed', record: { readAttempts: 2 } });
    });

    it('finishRead DONE writes the suggestion at the expected version only, bumps the version, frees the lease', async () => {
      const store = await makeStore();
      const w = await world(store);
      const r = await w.pending();
      await store.expenseReceipts.claimRead(r.id, at(10), LEASE);
      // The person edits under the read: the version moves.
      const theirs: ReceiptSuggestion = { readerVersion: 'phone-1', totalMinor: { value: '9', source: 'ocr', confidence: 0.9 } };
      const edited = await store.expenseReceipts.setSuggested(w.a.id, r.id, r.version, theirs);
      expect(edited.kind).toBe('updated');
      const stale = await store.expenseReceipts.finishRead(r.id, r.version, { status: 'DONE', suggested: read });
      expect(stale).toMatchObject({ kind: 'stale', record: { version: r.version + 1, suggested: theirs } });
      const saved = await store.expenseReceipts.finishRead(r.id, r.version + 1, { status: 'DONE', suggested: { ...read, totalMinor: theirs.totalMinor } });
      expect(saved).toMatchObject({ kind: 'saved', record: { readStatus: 'DONE', readLeaseUntil: null, version: r.version + 2, suggested: { totalMinor: theirs.totalMinor, date: read.date } } });
      expect(await store.expenseReceipts.finishRead(r.id, r.version + 2, { status: 'FAILED', failReason: 'timeout' })).toEqual({ kind: 'not_pending' });
    });

    it('finishRead FAILED keeps the reason and the version; DONE with nothing to write keeps the suggestion', async () => {
      const store = await makeStore();
      const w = await world(store);
      const failing = await w.pending();
      expect(await store.expenseReceipts.finishRead(failing.id, 999, { status: 'FAILED', failReason: 'unreadable' })).toMatchObject({ kind: 'saved', record: { readStatus: 'FAILED', readFailReason: 'unreadable', version: failing.version } });
      const empty = await w.pending();
      expect(await store.expenseReceipts.finishRead(empty.id, empty.version, { status: 'DONE' })).toMatchObject({ kind: 'saved', record: { readStatus: 'DONE', suggested: null, version: empty.version } });
    });

    it('F8: a deleted or FILED receipt becomes SKIPPED and is given no suggestion', async () => {
      const store = await makeStore();
      const w = await world(store);
      const deleted = await w.pending();
      await store.expenseReceipts.softDelete(w.a.id, deleted.id, at(3));
      expect(await store.expenseReceipts.finishRead(deleted.id, deleted.version, { status: 'DONE', suggested: read })).toEqual({ kind: 'skipped' });
      const e = await store.expenses.create({ organizationId: w.a.id, occurredOn: '2026-10-28', amountMinor: 100n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: w.user.id }, at(4));
      const filed = await w.pending();
      const result = await store.expenseReceipts.fileOntoExpense({ organizationId: w.a.id, receiptId: filed.id, expenseId: e.id, maxReceipts: 10 });
      expect(result.kind).toBe('filed');
      const before = (await store.expenseReceipts.getById(w.a.id, filed.id))!;
      expect(await store.expenseReceipts.finishRead(filed.id, before.version, { status: 'DONE', suggested: read })).toEqual({ kind: 'skipped' });
      expect(await store.expenseReceipts.getById(w.a.id, filed.id)).toMatchObject({ readStatus: 'SKIPPED', suggested: null, version: before.version });
    });

    it('listPendingForSweep: PENDING with a free or lapsed lease, oldest request first, any profile', async () => {
      const store = await makeStore();
      const w = await world(store);
      const older = await w.pending({}, 1);
      const held = await w.pending({}, 2);
      const lapsed = await w.pending({ organizationId: w.b.id }, 3);
      await store.expenseReceipts.claimRead(held.id, at(100), LEASE);
      await store.expenseReceipts.claimRead(lapsed.id, at(100), LEASE);
      const done = await w.pending({}, 4);
      await store.expenseReceipts.finishRead(done.id, done.version, { status: 'FAILED', failReason: 'unreadable' });
      const ids = (await store.expenseReceipts.listPendingForSweep(at(200 + LEASE), 100)).map((r) => r.id);
      expect(ids.filter((id) => [older.id, held.id, lapsed.id, done.id].includes(id))).toEqual([older.id, held.id, lapsed.id]);
      const live = (await store.expenseReceipts.listPendingForSweep(at(150), 100)).map((r) => r.id);
      expect(live).toContain(older.id);
      expect(live).not.toContain(held.id);
    });

    it('markBacklogPending: the uploader\'s To-review READY receipts never asked and missing a field, once', async () => {
      const store = await makeStore();
      const w = await world(store);
      const someoneElse = await w.person();
      const waiting = await w.started();
      await store.expenseReceipts.complete(w.a.id, waiting.id, at(1));
      const otherProfile = await w.started({ organizationId: w.b.id });
      await store.expenseReceipts.complete(w.b.id, otherProfile.id, at(1));
      const unfinished = await w.started();
      const notMine = await w.started({ uploadedByUserId: someoneElse.id });
      await store.expenseReceipts.complete(w.a.id, notMine.id, at(1));
      const already = await w.pending();
      const f = (value: string) => ({ value, source: 'ocr' as const, confidence: 0.9 });
      const complete = await w.started({ suggested: { readerVersion: 'p', date: f('2026-10-28'), totalMinor: f('1'), currency: f('ILS'), vatMinor: f('1'), vatRateBasisPoints: { value: 1, source: 'ocr', confidence: 0.9 }, vendorName: f('x'), registrationNo: f('520022732'), phone: f('1'), email: f('a@b.co') } });
      await store.expenseReceipts.complete(w.a.id, complete.id, at(1));

      const onA = await store.expenseReceipts.markBacklogPending({ userId: w.user.id, organizationId: w.a.id }, at(50));
      expect(onA).toEqual([waiting.id]);
      const all = await store.expenseReceipts.markBacklogPending({ userId: w.user.id }, at(60));
      expect(all).toEqual([otherProfile.id]);
      expect(await store.expenseReceipts.markBacklogPending({ userId: w.user.id }, at(70))).toEqual([]);
      expect(await store.expenseReceipts.getById(w.a.id, waiting.id)).toMatchObject({ readStatus: 'PENDING', readRequestedAt: at(50) });
      for (const id of [unfinished.id, notMine.id, complete.id]) expect((await store.expenseReceipts.getById(w.a.id, id))?.readStatus ?? 'NONE').toBe('NONE');
      expect((await store.expenseReceipts.getById(w.a.id, already.id))?.readRequestedAt).toEqual(at(1));
    });

    it('vendors.findByRegistration finds the profile\'s vendor by its registration key, never another profile\'s', async () => {
      const store = await makeStore();
      const w = await world(store);
      const v = await store.vendors.resolve({ organizationId: w.a.id, name: 'Shufersal', registrationNo: '520022732' }, at(1));
      expect((await store.vendors.findByRegistration(w.a.id, '52-002273-2'))?.id).toBe(v!.id);
      expect(await store.vendors.findByRegistration(w.b.id, '520022732')).toBeNull();
      expect(await store.vendors.findByRegistration(w.a.id, '12')).toBeNull();
    });
  });
}
