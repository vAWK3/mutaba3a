import { beforeAll, describe, expect, it } from 'vitest';
import { accountantExpenseView } from '../auth/store-guard.js';
import { accountantHarness, businessOf, expenseOn, person, read, receiptOnExpense, shared, type AccountantHarness, type Loose, type Person } from './helpers/accountants.js';

/**
 * An accountant sees only the expenses with a receipt on them: one without a document is not a book entry they can
 * work from. The owner still sees everything. The rule lives in the accountant's store guard (accountantExpenseView),
 * so every route that reads expenses for them agrees: the list, one expense, the summaries, the profile feed, and
 * their client list's monthly count.
 */
let h: AccountantHarness;
let owner: Person;
let accountant: Person;
let profileId: string;
let ink: string;
let paper: string;
let summaryWithInkOnly: unknown;

beforeAll(async () => {
  h = accountantHarness();
  owner = await person(h, { displayName: 'Basel Sader' });
  profileId = await businessOf(h, owner, 'Sader Studio');
  ink = await expenseOn(h, owner, profileId, 'Printer ink');
  await receiptOnExpense(h, owner, profileId, ink);
  summaryWithInkOnly = await read(await h.app.request('/v1/summaries/expenses', { headers: owner.on(profileId) }));
  paper = await expenseOn(h, owner, profileId, 'Loose paper');
  accountant = await shared(h, owner, profileId);
});

const titles = async (p: Person) => (await read(await h.app.request('/v1/expenses', { headers: p.on(profileId) }))).items.map((e: Loose) => e.title).sort();

describe('accountant sees only expenses with a receipt', () => {
  it('the expense list: the owner sees both, the accountant only the receipted one', async () => {
    expect(await titles(owner)).toEqual(['Loose paper', 'Printer ink']);
    expect(await titles(accountant)).toEqual(['Printer ink']);
  });

  it('one expense: the receipted one reads, the other is 404 for the accountant and 200 for the owner', async () => {
    expect((await h.app.request(`/v1/expenses/${ink}`, { headers: accountant.on(profileId) })).status).toBe(200);
    expect((await h.app.request(`/v1/expenses/${paper}`, { headers: accountant.on(profileId) })).status).toBe(404);
    expect((await h.app.request(`/v1/expenses/${paper}`, { headers: owner.on(profileId) })).status).toBe(200);
  });

  it('the expenses summary counts what the accountant sees', async () => {
    const asAccountant = await read(await h.app.request('/v1/summaries/expenses', { headers: accountant.on(profileId) }));
    expect(asAccountant).toEqual(summaryWithInkOnly);
    const asOwner = await read(await h.app.request('/v1/summaries/expenses', { headers: owner.on(profileId) }));
    expect(asOwner).not.toEqual(summaryWithInkOnly);
  });

  it('the profile feed carries only the receipted expense', async () => {
    const feed = JSON.stringify(await read(await h.app.request('/v1/profile-entries', { headers: accountant.on(profileId) })));
    expect(feed).toContain('Printer ink');
    expect(feed).not.toContain('Loose paper');
  });

  it('the client list counts only receipted expenses this month', async () => {
    const { items } = await read(await h.app.request('/v1/clients', { headers: accountant.auth }));
    expect(items.find((i: Loose) => i.profileId === profileId)).toMatchObject({ entriesThisMonth: 1 });
  });

  it('a receipt added later makes the expense appear; deleting it hides the expense again', async () => {
    const receiptId = await receiptOnExpense(h, owner, profileId, paper);
    expect(await titles(accountant)).toEqual(['Loose paper', 'Printer ink']);
    await h.store.expenseReceipts.softDelete(profileId, receiptId, h.now());
    expect(await titles(accountant)).toEqual(['Printer ink']);
  });
});

describe('accountantExpenseView', () => {
  it('adds the receipt filter to every expense read and leaves other calls as they are', () => {
    expect(accountantExpenseView('expenses', 'list', ['org', { from: '2026-11-01' }, { limit: 1 }])).toEqual(['org', { from: '2026-11-01', withReceipt: true }, { limit: 1 }]);
    expect(accountantExpenseView('expenses', 'totalsByCurrency', ['org', {}])).toEqual(['org', { withReceipt: true }]);
    expect(accountantExpenseView('expenses', 'getById', ['org', 'id'])).toEqual(['org', 'id', { withReceipt: true }]);
    expect(accountantExpenseView('entries', 'list', [['org'], { limit: 5 }])).toEqual([['org'], { limit: 5, expensesWithReceipt: true }]);
    expect(accountantExpenseView('periodPack', 'estimate', ['org', { occurredBefore: '2026-12-01' }, 'asOf'])).toEqual(['org', { occurredBefore: '2026-12-01', expensesWithReceipt: true }, 'asOf']);
    expect(accountantExpenseView('payments', 'list', ['org', { status: 'POSTED' }])).toEqual(['org', { status: 'POSTED' }]);
  });
});
