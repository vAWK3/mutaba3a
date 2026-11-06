import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantClient, AccountantClientWithStats, Entry } from '../../../api/client';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/** MUT-562: the Client books desk (layout C): the list, the empty state, a client's book, its receipts, an ended client. */

const STUDIO = '55555555-5555-4555-8555-555555555555';
const BAKERY = '66666666-6666-4666-8666-666666666666';
const EXPENSE_ID = '77777777-7777-4777-8777-777777777777';
const RECEIPT_ID = '88888888-8888-4888-8888-888888888888';

function client(over: Partial<AccountantClientWithStats> = {}): AccountantClientWithStats {
  return {
    profileId: STUDIO,
    name: 'Studio',
    ownerName: 'Rana Haddad',
    sharedSince: '2026-10-12T09:00:00.000Z',
    profileType: 'business',
    status: 'active',
    endedReason: null,
    endedAt: null,
    entriesThisMonth: 23,
    lastActivityAt: '2026-11-05T09:00:00.000Z',
    ...over,
  };
}
const ended = client({ profileId: BAKERY, name: 'Bakery', ownerName: 'Lina Sabbagh', status: 'ended', endedReason: 'revoked', endedAt: '2026-11-01T00:00:00.000Z', entriesThisMonth: null, lastActivityAt: null });
const meRow = ({ entriesThisMonth: _e, lastActivityAt: _l, ...row }: AccountantClientWithStats): AccountantClient => row;

const expenseEntry: Entry = {
  kind: 'expense',
  profileId: STUDIO,
  createdAt: '2026-11-04T09:00:00.000Z',
  createdByUserId: null,
  expense: { id: EXPENSE_ID, occurredOn: '2026-11-03', amount: '350.00', currency: 'ILS', title: 'Office rent', vendor: null, categoryId: null, receiptCount: 1 } as never,
};
const receivedEntry = {
  kind: 'received',
  profileId: STUDIO,
  createdAt: '2026-11-02T09:00:00.000Z',
  createdByUserId: null,
  origin: 'capture',
  settlesOwedId: null,
  replacesPaymentId: null,
  income: { id: '99999999-0000-4000-8000-000000000000', occurredOn: '2026-11-01', amount: '3200.00', currency: 'ILS', title: 'Brand identity' },
} as unknown as Entry;

function portal(path: string, routes: Record<string, Handler> = {}, clients = [client(), ended]) {
  const api = stubApi({
    'GET /v1/me': () => ok({ ...me([profile({ owned: true, isPersonalDefault: true, type: 'personal' })]), clients: clients.map(meRow) }),
    ...emptyProfileRoutes(),
    'GET /v1/billing': () => ok({ configured: false }),
    'GET /v1/clients': () => ok({ items: clients }),
    'GET /v1/profile-entries': () => ok({ items: [expenseEntry, receivedEntry], nextCursor: null }),
    'GET /v1/summaries/activity': () =>
      ok({ from: '2026-11-01', to: '2026-11-30', bucket: 'month', asOf: '2026-11-06', dataSince: null, earlierData: false, buckets: [], currencies: [{ currency: 'ILS', spent: '350.00', received: '3200.00', byCategory: [], byCustomer: [] }, { currency: 'USD', spent: '20.00', received: '0.00', byCategory: [], byCustomer: [] }], history: [], daysToPaid: { overall: null, byCustomer: [], samples: [] } }),
    'GET /v1/expense-categories': () => ok({ items: [] }),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => vi.unstubAllGlobals());

describe('the Client books corner', () => {
  it('shows beside Reports while any client is listed, and opens the desk', async () => {
    const { user, router } = portal(`/p/${ORG_A}`);
    await user.click(await screen.findByRole('link', { name: 'Client books' }));
    await waitFor(() => expect(locationOf(router)).toBe('/client-books'));
  });

  it('is not there for a person with no client book', async () => {
    portal(`/p/${ORG_A}`, {}, []);
    await screen.findByRole('navigation', { name: 'Sections' });
    expect(screen.queryByRole('link', { name: 'Client books' })).toBeNull();
  });
});

describe('the desk list (AC1)', () => {
  it('lists owner, profile, entries this month and last activity; an ended row is faded with Remove', async () => {
    portal('/client-books');
    const table = await screen.findByRole('table', { name: 'Client books' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Rana Haddad');
    expect(rows[1]).toHaveTextContent('Studio');
    expect(rows[1]).toHaveTextContent('23');
    expect(rows[2]).toHaveClass('hp-row-ended');
    expect(rows[2]).toHaveTextContent('No longer shared');
    expect(within(rows[2]).getByRole('button', { name: 'Remove Bakery from your client books' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Client books or my books' })).toBeInTheDocument();
  });

  it('Remove asks in place, then removes the ended client', async () => {
    const removed: string[] = [];
    let clients = [client(), ended];
    const { user } = portal('/client-books', {
      'GET /v1/clients': () => ok({ items: clients }),
      [`DELETE /v1/clients/${BAKERY}`]: () => {
        removed.push(BAKERY);
        clients = [client()];
        return new Response(null, { status: 204 });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Remove Bakery from your client books' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText('Bakery')).toBeNull());
    expect(removed).toEqual([BAKERY]);
  });

  it('searches owner or profile', async () => {
    const { user } = portal('/client-books');
    await screen.findByRole('table', { name: 'Client books' });
    await user.type(screen.getByPlaceholderText('Search owner or profile'), 'lina');
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Client books' })).getAllByRole('row')).toHaveLength(2));
    expect(within(screen.getByRole('table', { name: 'Client books' })).getByText('Bakery')).toBeInTheDocument();
  });

  it('with none, says how a client invites you (AW5)', async () => {
    portal('/client-books', {}, []);
    expect(await screen.findByRole('heading', { name: 'No client books yet' })).toBeInTheDocument();
    expect(screen.getByText(/invite you from MTB3A › their profile › Sharing/)).toBeInTheDocument();
  });
});

describe('a client book (AC2, AC3)', () => {
  it('shows the read-only line, totals per currency and the entries, with no write control anywhere', async () => {
    const { api } = portal(`/client-books/${STUDIO}?newExpense=1&newIncome=true`);
    expect(await screen.findByRole('heading', { name: 'Rana Haddad · Studio' })).toBeInTheDocument();
    expect(screen.getByText(/Read-only · since/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Entries' });
    expect(within(table).getByText('Office rent')).toBeInTheDocument();
    expect(within(table).getByText('Brand identity')).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: /Totals for/ });
    expect(within(totals).getAllByRole('term').filter((term) => term.textContent === 'Spent')).toHaveLength(2);
    // AC3: no add, edit or delete control, and the drawer keys do nothing
    expect(screen.queryByRole('button', { name: /add|new|edit|delete/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The feed asks for expenses and received payments of this month, under the client's profile
    const feed = api.calls.find((call) => call.url.pathname === '/v1/profile-entries')!;
    expect(feed.headers.get('X-Mutaba3a-Profile')).toBe(STUDIO);
    expect(feed.url.searchParams.getAll('kinds')).toEqual(['expense', 'received']);
    expect(feed.url.searchParams.get('limit')).toBe('100');
  });

  it('a preset and a type filter go to the URL and the feed', async () => {
    const { user, router, api } = portal(`/client-books/${STUDIO}`);
    await screen.findByRole('table', { name: 'Entries' });
    await user.click(screen.getByRole('radio', { name: 'This quarter' }));
    await waitFor(() => expect(locationOf(router)).toContain('preset=quarter'));
    await user.click(screen.getByRole('checkbox', { name: 'Expenses' }));
    await waitFor(() => expect(locationOf(router)).toContain('kind=income'));
    await waitFor(() => expect(api.calls.at(-1)?.url.searchParams.getAll('kinds')).toEqual(['received']));
  });

  it('opens a row’s receipt in the pane, previewed from an inline URL', async () => {
    const { user, api } = portal(`/client-books/${STUDIO}`, {
      [`GET /v1/expenses/${EXPENSE_ID}`]: () => ok({ ...expenseEntry.kind === 'expense' && expenseEntry.expense, receipts: [{ id: RECEIPT_ID, filename: 'rent.png', mimeType: 'image/png', status: 'READY' }] }),
      [`GET /v1/expenses/${EXPENSE_ID}/receipts/${RECEIPT_ID}/download`]: () => ok({ url: 'https://files.test/rent.png', expiresAt: '2099-01-01T00:00:00.000Z' }),
    });
    await user.click(await screen.findByRole('button', { name: 'Office rent' }));
    const pane = await screen.findByRole('dialog', { name: 'Receipt' });
    expect(await within(pane).findByRole('img', { name: /rent.png/ })).toHaveAttribute('src', 'https://files.test/rent.png');
    const preview = api.calls.find((call) => call.url.pathname.endsWith('/download'))!;
    expect(preview.url.searchParams.get('disposition')).toBe('inline');
    expect(within(pane).getByRole('button', { name: 'Download receipt' })).toBeInTheDocument();
  });

  it('a 404 mid-session says the owner stopped sharing, and the list is asked again', async () => {
    const { user, api } = portal(`/client-books/${STUDIO}`, { 'GET /v1/profile-entries': () => fail(404, 'PROFILE_NOT_FOUND') });
    expect(await screen.findByRole('heading', { name: 'No longer shared' })).toBeInTheDocument();
    expect(screen.getByText(/Rana Haddad stopped sharing Studio with you/)).toBeInTheDocument();
    await waitFor(() => expect(api.count('GET /v1/clients')).toBeGreaterThan(1));
    await user.click(screen.getByRole('link', { name: 'Back to Client books' }));
    expect(await screen.findByRole('table', { name: 'Client books' })).toBeInTheDocument();
  });

  it('an ended client opens on the same state', async () => {
    portal(`/client-books/${BAKERY}`);
    expect(await screen.findByRole('heading', { name: 'No longer shared' })).toBeInTheDocument();
  });
});
