import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, localBackend } from '../../api/client';
import { setMode } from '../../session/mode';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * AC4 (MUT-286): signed out, the portal makes no `/v1` request. Driven through
 * the portal's own typed client (`api`), exactly as the views call it, with
 * the real lazy local backend behind it (the `@mut/local-backend` alias) and
 * `fetch` replaced by a spy that fails the test if anything reaches it.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

describe('signed out: no network (AC4)', () => {
  const fetchSpy = vi.fn((input: RequestInfo | URL) => Promise.reject(new TypeError(`network used: ${String(input)}`)));

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
    setMode('local');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs a whole session — who am I, record income, read every figure — without one request', async () => {
    const me = await api.me();
    const profileId = me.profiles[0]!.id;

    await api.createIncome(profileId, { kind: 'received', amount: '300.00', currency: 'ILS', occurredOn: '2026-10-01' }, 'no-network-1');
    const payments = await api.payments(profileId);
    const summary = await api.organizationSummary(profileId);
    const customers = await api.customers(profileId);
    const receivables = await api.receivables(profileId);

    expect(payments.items.map((p) => p.amount)).toEqual(['300.00']);
    expect(summary).toBeDefined();
    expect(customers.items).toEqual([]);
    expect(receivables.items).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adds a client, records money owed for them and part of it paid, all on this device (MUT-286)', async () => {
    const me = await api.me();
    const profileId = me.profiles[0]!.id;

    const client = await api.createCustomer(profileId, { name: 'Ramallah Bakery' }, 'no-network-client-1');
    const owed = await api.createIncome(profileId, { kind: 'owed', amount: '900.00', currency: 'ILS', occurredOn: '2026-10-01', customerId: client.id, title: 'Menu design' }, 'no-network-owed-1');
    await api.settleReceivable(profileId, owed.id, { amount: '400.00' }, 'no-network-settle-1');
    const receivable = await api.receivable(profileId, owed.id);

    expect(receivable.status).toBe('PARTIALLY_PAID');
    expect(receivable.outstanding).toBe('500.00');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adds a client, then a matter for them, then money owed on that matter, all on this device (MUT-318)', async () => {
    const me = await api.me();
    const profileId = me.profiles[0]!.id;

    const client = await api.createCustomer(profileId, { name: 'Ramallah Bakery' }, 'no-network-client-2');
    const matter = await api.createProject(profileId, { customerId: client.id, name: 'Menu design', currency: 'ILS' }, 'no-network-matter-1');
    const owed = await api.createIncome(profileId, { kind: 'owed', amount: '900.00', currency: 'ILS', occurredOn: '2026-10-01', projectId: matter.id, title: 'Menu design' }, 'no-network-owed-2');
    const matters = await api.projects(profileId, { customerId: client.id });
    const receivable = await api.receivable(profileId, owed.id);

    expect(matters.items.map((p) => p.name)).toEqual(['Menu design']);
    expect(receivable.customerId).toBe(client.id);
    expect(receivable.projectId).toBe(matter.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records, edits and deletes an expense with a receipt, and lists documents, all on this device (MUT-287 AC1-AC3)', async () => {
    const profileId = (await api.me()).profiles[0]!.id;

    const expense = await api.createExpense(profileId, { occurredOn: '2026-10-01', amount: '120.00', currency: 'ILS', title: 'Printer ink' }, 'no-network-expense-1');
    const edited = await api.updateExpense(profileId, expense.id, { amount: '125.00' }, String(expense.version));
    const { receipt, upload } = await api.startReceipt(profileId, expense.id, { filename: 'Ink.pdf', mimeType: 'application/pdf', sizeBytes: 8 });
    await (await localBackend()).putBlob(upload.url, new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    const ready = await api.completeReceipt(profileId, expense.id, receipt.id);
    const download = await api.receiptDownload(profileId, expense.id, receipt.id);
    const documents = await api.attachments(profileId);
    const categories = await api.expenseCategories(profileId);
    await api.deleteExpense(profileId, expense.id);

    expect(edited.amount).toBe('125.00');
    expect(ready.status).toBe('READY');
    expect(download.filename).toBe('Ink.pdf');
    expect(documents.items).toEqual([]);
    expect(categories.items.length).toBeGreaterThan(0);
    expect((await api.expenses(profileId)).items.map((e) => e.id)).not.toContain(expense.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs a trip group and a conversion end to end on this device (MUT-287 AC1)', async () => {
    const profileId = (await api.me()).profiles[0]!.id;

    const expense = await api.createExpense(profileId, { occurredOn: '2026-10-02', amount: '40.00', currency: 'USD', title: 'Taxi' }, 'no-network-expense-2');
    const group = await api.createExpenseGroup(profileId, { name: 'Amman trip', startOn: '2026-10-01', endOn: '2026-10-05' }, 'no-network-group-1');
    const summary = await api.expenseGroupSummary(profileId, group.id);
    await api.setExpenseGroupMark(profileId, group.id, expense.id, 'excluded');
    const afterMark = await api.expenseGroupSummary(profileId, group.id);
    await api.setExpenseGroupMark(profileId, group.id, expense.id, null);
    await api.deleteExpenseGroup(profileId, group.id);
    const conversion = await api.createConversion(profileId, { occurredOn: '2026-10-03', amount: '100.00', currency: 'USD', toAmount: '365.00', toCurrency: 'ILS' }, 'no-network-conversion-1');
    const updated = await api.updateConversion(profileId, conversion.id, { toAmount: '366.00' }, String(conversion.version));
    await api.deleteConversion(profileId, conversion.id);

    expect(JSON.stringify(summary)).toContain('40.00');
    expect(JSON.stringify(afterMark)).not.toContain('40.00');
    expect(updated.toAmount).toBe('366.00');
    expect((await api.expenseGroups(profileId)).items.map((g) => g.id)).not.toContain(group.id);
    expect((await api.conversions(profileId)).items.map((c) => c.id)).not.toContain(conversion.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends exactly one request for reference rates, to the public snapshot, with no credentials (D3, the one named exception)', async () => {
    // Relative to today: the server's cache refuses a snapshot older than MAX_RATE_AGE_DAYS, so a fixed date goes stale.
    const fetchedAt = new Date();
    const rateDate = new Date(fetchedAt.getTime() - ONE_DAY_MS).toISOString().slice(0, 10);
    fetchSpy.mockImplementationOnce(
      async () => new Response(JSON.stringify({ rateDate, perEur: { USD: 1.1208, ILS: 3.4769 }, fetchedAt: fetchedAt.toISOString(), source: 'live' }), { status: 200 }) as never,
    );

    const ils = await api.fxRates('ILS');
    await api.fxRates('USD');

    expect(ils.rateDate).toBe(rateDate);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/public/fx-rates');
    expect(init.credentials).toBe('omit');
  });
});
