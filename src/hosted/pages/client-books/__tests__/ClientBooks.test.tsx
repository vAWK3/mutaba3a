import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantClient, AccountantClientWithStats, Entry } from '../../../api/client';
import { ORG_A, emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { stripeNavigation } from '../../../data/billingQueries';

const { trackPortal, countPublicPage } = vi.hoisted(() => ({ trackPortal: vi.fn(async () => {}), countPublicPage: vi.fn() }));
vi.mock('../../../analytics/portalAnalytics', async (original) => ({ ...(await original<typeof import('../../../analytics/portalAnalytics')>()), trackPortal, countPublicPage }));

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
const meRow = (row: AccountantClientWithStats): AccountantClient => {
  const copy: Partial<AccountantClientWithStats> = { ...row };
  delete copy.entriesThisMonth;
  delete copy.lastActivityAt;
  return copy as AccountantClient;
};

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
  trackPortal.mockClear();
  countPublicPage.mockClear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const ticket = (type: 'report' | 'receipts', receiptBytes = 4 * 1024 * 1024) => ({ type, ticket: `${type}-ticket`, expiresAt: '2099-01-01T00:00:00.000Z', filename: `f.${type === 'report' ? 'xlsx' : 'zip'}`, estimate: { expenses: 9, income: 3, receipts: 11, receiptBytes } });

function captureForms() {
  const sent: Record<string, string>[] = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    sent.push(Object.fromEntries(new FormData(this) as unknown as Iterable<[string, string]>));
  });
  return sent;
}

describe('downloads (MUT-314)', () => {
  it('the client book’s Download mints both files for the period with one asOf, shows their size and posts the ticket', async () => {
    const sent = captureForms();
    const { user, api } = portal(`/client-books/${STUDIO}?preset=custom&from=2026-07&to=2026-09`, {
      'GET /v1/period-downloads/ticket': (request) => ok(ticket(request.url.searchParams.get('type') as 'report' | 'receipts')),
    });
    await screen.findByRole('table', { name: 'Entries' });
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('12 entries')).toBeInTheDocument();
    expect(screen.getByText('11 receipts · about 4 MB')).toBeInTheDocument();
    const mints = api.calls.filter((c) => c.url.pathname === '/v1/period-downloads/ticket');
    expect(mints.map((m) => [m.url.searchParams.get('type'), m.url.searchParams.get('from'), m.url.searchParams.get('to')])).toEqual([
      ['report', '2026-07', '2026-09'],
      ['receipts', '2026-07', '2026-09'],
    ]);
    expect(new Set(mints.map((m) => m.url.searchParams.get('asOf'))).size).toBe(1);
    expect(mints[0]!.headers.get('X-Mutaba3a-Profile')).toBe(STUDIO);
    await user.click(screen.getByRole('button', { name: 'Excel report' }));
    expect(sent).toEqual([{ ticket: 'report-ticket' }]);
  });

  it('over the zip cap, Receipts is off with a hint', async () => {
    const { user } = portal(`/client-books/${STUDIO}`, {
      'GET /v1/period-downloads/ticket': (request) =>
        request.url.searchParams.get('type') === 'receipts' ? fail(422, 'VALIDATION_FAILED', { reason: 'PERIOD_TOO_LARGE' }) : ok(ticket('report')),
    });
    await screen.findByRole('table', { name: 'Entries' });
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('Too large for one download. Pick a shorter period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receipts (zip)' })).toBeDisabled();
  });

  it('a row’s Download {last month} is last month’s Excel report only', async () => {
    const sent = captureForms();
    const { user, api } = portal('/client-books', { 'GET /v1/period-downloads/ticket': () => ok(ticket('report')) });
    await user.click(await screen.findByRole('button', { name: /^Download the Excel report for .*, Studio$/ }));
    await waitFor(() => expect(sent).toEqual([{ ticket: 'report-ticket' }]));
    const mint = api.calls.find((c) => c.url.pathname === '/v1/period-downloads/ticket')!;
    expect(mint.url.searchParams.get('type')).toBe('report');
    expect(mint.url.searchParams.get('from')).toBe(mint.url.searchParams.get('to'));
  });
});

describe('the Accountant plan on the desk (MUT-565, gated on its fields)', () => {
  const withPlan = (over: Record<string, unknown> = {}) => ({ count: 4, freeLimit: 3, cap: 3, readable: 3, plan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false }, ...over });

  it('shows "readable of freeLimit", fades a needsPlan row and offers the plan with the catalog’s price', async () => {
    const locked = client({ profileId: '12121212-1212-4121-8121-121212121212', name: 'Sweets', ownerName: 'Omar Nassar', needsPlan: true } as never);
    const api = stubApi({
      'GET /v1/me': () => ok({ ...me([profile({ owned: true })]), clients: [client(), locked].map(meRow), clientBooks: withPlan() }),
      ...emptyProfileRoutes(),
      'GET /v1/clients': () => ok({ items: [{ ...client(), needsPlan: false }, locked] }),
      'GET /v1/billing': () => ok({ configured: true, countries: { consumer: ['IL'], consumerEverywhere: false, customTaxId: [] }, accountantPlan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, interval: null, currency: null, catalog: { ILS: { month: 9900 }, USD: { month: 2900 } } } }),
      'POST /v1/billing/checkout-session': () => ok({ url: 'https://checkout.stripe.com/c/pay/x' }),
    });
    const { user } = renderPortal('/client-books');
    expect(await screen.findByText('3 of 3 free client books')).toBeInTheDocument();
    const row = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('Sweets'))!;
    expect(row).toHaveClass('hp-row-needs-plan');
    expect(within(row).getByText('Needs the Accountant plan')).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Subscribe to the Accountant plan to read Sweets' }));
    expect(await screen.findByText(/₪99\.00.*\$29\.00 a month/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Country'), 'IL');
    const assign = vi.spyOn(stripeNavigation, 'assign').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Subscribe' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/x'));
    expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toEqual({ interval: 'month', buyer: 'person', plan: 'accountant', country: 'IL', returnPath: '/client-books' });
    // MUT-565 (contract 2.8.0): one offer view on the desk, then the Checkout with its plan; the consented tracker only
    expect(trackPortal.mock.calls.filter(([event]) => event === 'accountant_plan_offer_shown')).toEqual([['accountant_plan_offer_shown', { place: 'client_books' }]]);
    expect(trackPortal).toHaveBeenCalledWith('billing_checkout_started', { plan: 'accountant', interval: 'month', currency: 'ILS' });
    expect(countPublicPage).not.toHaveBeenCalled();
  });

  it('a locked client’s own page (the 402 panel) counts one offer view at client_books', async () => {
    const locked = client({ profileId: '12121212-1212-4121-8121-121212121212', name: 'Sweets', ownerName: 'Omar Nassar', needsPlan: true } as never);
    stubApi({
      'GET /v1/me': () => ok({ ...me([profile({ owned: true })]), clients: [client(), locked].map(meRow), clientBooks: withPlan() }),
      ...emptyProfileRoutes(),
      'GET /v1/clients': () => ok({ items: [{ ...client(), needsPlan: false }, locked] }),
      'GET /v1/billing': () => ok({ configured: true, countries: { consumer: ['IL'], consumerEverywhere: false, customTaxId: [] }, accountantPlan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, interval: null, currency: null, catalog: { ILS: { month: 9900 }, USD: { month: 2900 } } } }),
    });
    renderPortal('/client-books/12121212-1212-4121-8121-121212121212');
    expect(await screen.findByRole('heading', { name: 'Sweets needs the Accountant plan' })).toBeInTheDocument();
    await screen.findByText(/a month/);
    expect(trackPortal.mock.calls.filter(([event]) => event === 'accountant_plan_offer_shown')).toEqual([['accountant_plan_offer_shown', { place: 'client_books' }]]);
  });

  it('without MUT-565’s fields nothing of the plan shows', async () => {
    portal('/client-books');
    await screen.findByRole('table', { name: 'Client books' });
    expect(screen.queryByText(/free client books/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Subscribe/ })).toBeNull();
  });
});

describe('the Accountant plan offer (review fixes 2 and 4)', () => {
  const locked = () => client({ profileId: '12121212-1212-4121-8121-121212121212', name: 'Sweets', ownerName: 'Omar Nassar', needsPlan: true } as never);
  const COUNTRIES = { consumer: ['IL'], consumerEverywhere: false, customTaxId: [] };
  const PLAN = { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, interval: null, currency: null, catalog: { ILS: { month: 9900 }, USD: { month: 2900 } } };
  function open(billing: Handler, checkout: Handler = () => ok({ url: 'https://checkout.stripe.com/c/pay/x' })) {
    const api = stubApi({
      'GET /v1/me': () => ok({ ...me([profile({ owned: true })]), clients: [client(), locked()].map(meRow), clientBooks: { count: 4, freeLimit: 3, cap: 3, readable: 3, plan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false } } }),
      ...emptyProfileRoutes(),
      'GET /v1/clients': () => ok({ items: [client(), locked()] }),
      'GET /v1/billing': billing,
      'POST /v1/billing/checkout-session': checkout,
    });
    return { api, ...renderPortal('/client-books') };
  }
  async function toOffer(user: ReturnType<typeof renderPortal>['user']) {
    await user.click(await screen.findByRole('button', { name: 'Subscribe to the Accountant plan to read Sweets' }));
  }
  const subscribe = () => screen.getByRole('button', { name: 'Subscribe' });

  it('Subscribe stays off until a price shows; a failed price read offers Try again', async () => {
    let fail500 = true;
    const { user } = open(() => (fail500 ? fail(500, 'INTERNAL') : ok({ configured: true, countries: COUNTRIES, accountantPlan: PLAN })));
    await toOffer(user);
    expect(await screen.findByText("Couldn't load the price.")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Country'), 'IL');
    expect(subscribe()).toBeDisabled();
    fail500 = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/₪99\.00 a month/)).toBeInTheDocument();
    expect(subscribe()).toBeEnabled();
  });

  it('asks who is buying as the Subscribe step does, and sends the business', async () => {
    vi.spyOn(stripeNavigation, 'assign').mockImplementation(() => {});
    const { user, api } = open(() => ok({ configured: true, countries: COUNTRIES, accountantPlan: PLAN }));
    await toOffer(user);
    await screen.findByText(/a month/);
    await user.selectOptions(screen.getByLabelText('Country'), 'DE');
    // A person in a country we can't sell to individuals: the Subscribe step's own words, and no Subscribe
    expect(screen.getByText(/We can't sell to individuals in/)).toBeInTheDocument();
    expect(subscribe()).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /For a business/ }));
    await user.click(subscribe());
    await waitFor(() => expect(api.calls.find((c) => c.url.pathname === '/v1/billing/checkout-session')?.body).toMatchObject({ buyer: 'business', country: 'DE', plan: 'accountant' }));
  });

  it('a COUNTRY_NEEDS_BUSINESS refusal says the same as the Subscribe step', async () => {
    const { user } = open(
      () => ok({ configured: true, countries: { ...COUNTRIES, consumer: ['IL', 'DE'] }, accountantPlan: PLAN }),
      () => fail(422, 'VALIDATION_FAILED', { reason: 'COUNTRY_NEEDS_BUSINESS' }),
    );
    await toOffer(user);
    await screen.findByText(/a month/);
    await user.selectOptions(screen.getByLabelText('Country'), 'DE');
    await user.click(subscribe());
    expect(await screen.findByText(/We can't sell to individuals in/)).toBeInTheDocument();
  });
});

describe('downloads keep their asOf honest (review fix 5)', () => {
  it('a 422 AS_OF mints once more with a new asOf; a panel open past 20 hours takes a new one on the press', async () => {
    let asOfRefused = true;
    const { user, api } = portal(`/client-books/${STUDIO}`, {
      'GET /v1/period-downloads/ticket': (request) => {
        if (asOfRefused && request.url.searchParams.get('type') === 'receipts') {
          asOfRefused = false;
          return fail(422, 'VALIDATION_FAILED', { reason: 'AS_OF' });
        }
        return ok(ticket(request.url.searchParams.get('type') as 'report' | 'receipts'));
      },
    });
    captureForms();
    await screen.findByRole('table', { name: 'Entries' });
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('11 receipts · about 4 MB')).toBeInTheDocument();
    const asOfs = () => api.calls.filter((c) => c.url.pathname === '/v1/period-downloads/ticket').map((c) => c.url.searchParams.get('asOf'));
    expect(asOfs()).toHaveLength(3);
    expect(asOfs()[2]).not.toBeNull();
    const later = Date.now() + 21 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await user.click(screen.getByRole('button', { name: 'Excel report' }));
    await waitFor(() => expect(asOfs()).toHaveLength(4));
    expect(asOfs()[3]).not.toBe(asOfs()[0]);
  });
});

