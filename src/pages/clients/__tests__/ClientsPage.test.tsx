/**
 * @vitest-environment jsdom
 *
 * MUT-7: the clients index answers "who owes me, and who is late". Owed now
 * and overdue per currency (never summed across currencies), default order
 * owed-now descending by today's rate (ADR-035), last payment with a "never"
 * state, settled clients labelled, click-to-sort headers, row → profile.
 *
 * MUT-83 (ADR-049): the strip equals Home's Owed now. Debts of no listed
 * client get up to two muted rows after the clients, "No client" and
 * "Archived clients", each opening /income filtered to those entries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientsPage } from '../ClientsPage';
import * as useQueries from '../../../hooks/useQueries';
import { formatDate } from '../../../lib/utils';
import { combineOwed } from '../../../db/aggregations';
import { owedEntriesSearch } from '../../../lib/incomeSearch';
import type { ClientSummary, OwedBucket } from '../../../types';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search)}` : `${to}/${params?.clientId || ''}`}>{children}</a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'clients.title': 'Clients',
    'clients.searchPlaceholder': 'Search clients...',
    'clients.empty': 'No clients found',
    'clients.emptySearch': 'No matching clients',
    'clients.emptyHint': 'Add your first client',
    'clients.addClient': 'Add Client',
    'clients.emptyFiltered': 'No clients match your search',
    'clients.emptyFilteredCount': '{count} clients in total.',
    'clients.clearSearch': 'Clear search',
    'clients.crossProfileTxCount': '{count} entries',
    'clients.columns.client': 'Client',
    'clients.columns.owedNow': 'Owed now',
    'clients.columns.overdue': 'Overdue',
    'clients.columns.lastPayment': 'Last payment',
    'clients.columns.lastActivity': 'Last activity',
    'clients.summary.clientsCount': '{count} clients',
    'clients.summary.clientsCountOne': '1 client',
    'clients.index.settled': 'Settled',
    'clients.index.neverPaid': 'Never paid',
    'clients.index.oldestOverdue': 'oldest {days}d',
    'clients.index.owedOrderHint': "Ordered by today's exchange rate",
    'clients.profile.owedNow': 'Owed now',
    'clients.profile.nothingOwed': 'Nothing owed',
    'clients.profile.overdueAmount': '{amount} overdue',
    'clients.profile.nothingOverdue': 'Nothing overdue',
  };
  const t = (key: string, vars?: Record<string, string | number>) =>
    (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
  return { useT: () => t, useLanguage: () => ({ language: 'en' }), useDirection: () => 'ltr', getLocale: () => 'en-US' };
});

vi.mock('../../../lib/i18n/plural', () => {
  const plurals: Record<string, Record<'one' | 'other', string>> = {
    'clients.index.bucket.noClient': { one: 'No client · 1 entry', other: 'No client · {count} entries' },
    'clients.index.bucket.archivedClients': { one: 'Archived clients · 1', other: 'Archived clients · {count}' },
  };
  return {
    useTp: () => (key: string, count: number) =>
      (plurals[key]?.[count === 1 ? 'one' : 'other'] ?? key).replace('{count}', String(count)),
  };
});

const mockOpenClientDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openClientDrawer: mockOpenClientDrawer }),
}));

// Today's rates: $1 = ₪3, €1 = ₪4
const fxRates: Record<string, number | null> = { USD: 3, EUR: 4 };
vi.mock('../../../hooks/useFxRate', () => ({
  useFxRate: (base: string) => ({ rate: fxRates[base] ?? null, source: 'live' }),
}));

const summary = (overrides: Partial<ClientSummary>): ClientSummary => ({
  id: 'c',
  name: 'Client',
  activeProjectCount: 0,
  paidIncomeMinor: 0,
  unpaidIncomeMinor: 0,
  owed: [],
  ...overrides,
});

// Gamma ₪12,000 > Acme $1,300 + ₪4,200 (= ₪8,100) > Beta $900 (= ₪2,700) > Delta settled
const gamma = summary({
  id: 'gamma',
  name: 'Gamma',
  owed: [{ currency: 'ILS', owedMinor: 1_200_000, overdueMinor: 400_000 }],
  oldestOverdueDays: 31,
  lastActivityAt: '2026-09-01',
});
const acme = summary({
  id: 'acme',
  name: 'Acme',
  owed: [
    { currency: 'USD', owedMinor: 130_000, overdueMinor: 100_000 },
    { currency: 'ILS', owedMinor: 420_000, overdueMinor: 0 },
  ],
  oldestOverdueDays: 3,
  lastPayment: { paidAt: '2026-10-05', amountMinor: 20_000, currency: 'USD' },
  lastPaymentAt: '2026-10-05',
  lastActivityAt: '2026-10-09',
});
const beta = summary({
  id: 'beta',
  name: 'Beta',
  owed: [{ currency: 'USD', owedMinor: 90_000, overdueMinor: 0 }],
  lastPayment: { paidAt: '2026-09-01', amountMinor: 10_000, currency: 'USD' },
  lastPaymentAt: '2026-09-01',
  lastActivityAt: '2026-10-10',
});
const delta = summary({
  id: 'delta',
  name: 'Delta',
  lastPayment: { paidAt: '2026-08-15', amountMinor: 50_000, currency: 'ILS' },
  lastPaymentAt: '2026-08-15',
  lastActivityAt: '2026-08-15',
});

const NOTHING: OwedBucket = { owed: [], count: 0 };

/**
 * The index read: client rows plus the two muted rows. As in the repository,
 * a search narrows the client rows only; the total always covers everything.
 */
function mockSummaries(
  rows: ClientSummary[],
  isLoading = false,
  { noClient = NOTHING, archivedClients = NOTHING }: { noClient?: OwedBucket; archivedClients?: OwedBucket } = {}
) {
  const total = combineOwed([...rows.map((r) => r.owed), noClient.owed, archivedClients.owed]);
  vi.spyOn(useQueries, 'useClientOwedIndex').mockImplementation(
    (_profileId?: string, search?: string) =>
      ({
        data: {
          clients: rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
          total,
          noClient,
          archivedClients,
        },
        isLoading,
      }) as unknown as ReturnType<typeof useQueries.useClientOwedIndex>
  );
}

// No client: ₪500 (₪200 overdue) over 2 entries. Archived clients: $100 from 1 client.
const noClientDebt: OwedBucket = { owed: [{ currency: 'ILS', owedMinor: 50_000, overdueMinor: 20_000 }], count: 2 };
const archivedDebt: OwedBucket = { owed: [{ currency: 'USD', owedMinor: 10_000, overdueMinor: 0 }], count: 1 };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientsPage />
    </QueryClientProvider>
  );
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const names = () => bodyRows().map((r) => within(r).getByRole('link').textContent);
const rowFor = (name: string) => screen.getByRole('link', { name }).closest('tr')!;
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/clients');
    fxRates.USD = 3;
    fxRates.EUR = 4;
    mockSummaries([delta, beta, acme, gamma]);
    vi.spyOn(useQueries, 'useClients').mockReturnValue({
      data: [delta, beta, acme, gamma].map((c) => ({ id: c.id, name: c.name, profileId: 'p1' })),
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useClients>);
    vi.spyOn(useQueries, 'useBusinessProfiles').mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useBusinessProfiles>);
  });

  describe('columns', () => {
    it('shows Client, Owed now, Overdue, Last payment and Last activity, nothing else', () => {
      renderPage();
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, ''));
      expect(headers).toEqual(['Client', 'Owed now', 'Overdue', 'Last payment', 'Last activity']);
    });

    it('shows owed now per currency on separate lines, never one combined figure', () => {
      renderPage();
      const owedCell = within(rowFor('Acme')).getByTestId('client-owed');
      expect(within(owedCell).getAllByTestId('client-amount').map((e) => e.textContent)).toEqual(['$1,300', '₪4,200']);
    });

    it('shows overdue per currency with the age of the oldest overdue item', () => {
      renderPage();
      const overdueCell = within(rowFor('Gamma')).getByTestId('client-overdue');
      expect(overdueCell).toHaveTextContent('₪4,000');
      expect(overdueCell).toHaveTextContent('oldest 31d');

      // Acme owes ILS but only its USD is late
      const acmeOverdue = within(rowFor('Acme')).getByTestId('client-overdue');
      expect(within(acmeOverdue).getAllByTestId('client-amount').map((e) => e.textContent)).toEqual(['$1,000']);
    });

    it('labels a client who owes nothing as settled, with a dash for overdue rather than blank cells', () => {
      renderPage();
      expect(within(rowFor('Delta')).getByTestId('client-owed')).toHaveTextContent('Settled');
      expect(within(rowFor('Delta')).getByTestId('client-overdue')).toHaveTextContent('—');
    });

    it('shows last payment as date and amount, and "Never paid" when there is none', () => {
      renderPage();
      const paid = within(rowFor('Acme')).getByTestId('client-last-payment');
      expect(paid).toHaveTextContent(formatDate('2026-10-05', 'en-US'));
      expect(paid).toHaveTextContent('$200');
      expect(within(rowFor('Gamma')).getByTestId('client-last-payment')).toHaveTextContent('Never paid');
    });

    it('explains how owed now is ordered on its header', () => {
      renderPage();
      expect(within(header('Owed now')).getByRole('button')).toHaveAttribute('title', "Ordered by today's exchange rate");
    });
  });

  describe('order', () => {
    it('defaults to owed now, descending by today\'s rate, settled clients last', () => {
      renderPage();
      expect(names()).toEqual(['Gamma', 'Acme', 'Beta', 'Delta']);
      expect(header('Owed now')).toHaveAttribute('aria-sort', 'descending');
    });

    it('follows the rate: with a dollar worth ₪10, Acme owes more than Gamma', () => {
      fxRates.USD = 10;
      renderPage();
      // Acme $1,300 × 10 + ₪4,200 = ₪17,200 > Gamma ₪12,000
      expect(names()).toEqual(['Acme', 'Gamma', 'Beta', 'Delta']);
    });

    it('toggles direction when the active header is clicked again', () => {
      renderPage();
      fireEvent.click(within(header('Owed now')).getByRole('button'));
      expect(names()).toEqual(['Delta', 'Beta', 'Acme', 'Gamma']);
      expect(header('Owed now')).toHaveAttribute('aria-sort', 'ascending');
    });

    it('sorts overdue by how late, newest payment first, latest activity first, and names A–Z', () => {
      renderPage();

      fireEvent.click(within(header('Overdue')).getByRole('button'));
      expect(names()).toEqual(['Gamma', 'Acme', 'Beta', 'Delta']);

      fireEvent.click(within(header('Last payment')).getByRole('button'));
      expect(names()).toEqual(['Acme', 'Beta', 'Delta', 'Gamma']);

      fireEvent.click(within(header('Last activity')).getByRole('button'));
      expect(names()).toEqual(['Beta', 'Acme', 'Gamma', 'Delta']);

      fireEvent.click(within(header('Client')).getByRole('button'));
      expect(names()).toEqual(['Acme', 'Beta', 'Delta', 'Gamma']);
      expect(header('Client')).toHaveAttribute('aria-sort', 'ascending');
    });

    it('keeps the sort in the URL', () => {
      renderPage();
      fireEvent.click(within(header('Last payment')).getByRole('button'));
      expect(window.location.search).toContain('sort=lastPayment');
    });

    it('orders ties by name so the list never jumps', () => {
      mockSummaries([summary({ id: 'z', name: 'Zed' }), summary({ id: 'a', name: 'Abe' }), summary({ id: 'm', name: 'Mia' })]);
      renderPage();
      expect(names()).toEqual(['Abe', 'Mia', 'Zed']);
    });
  });

  describe('summary strip', () => {
    it('shows the client count and owed now for everyone listed, per currency', () => {
      renderPage();
      expect(screen.getByText('4 clients')).toBeInTheDocument();
      const strip = screen.getByRole('region', { name: 'Owed now' });
      // USD 1,300 + 900; ILS 12,000 + 4,200
      expect(within(strip).getAllByTestId('owed-now-amount').map((e) => e.textContent)).toEqual(['$2,200', '₪16,200']);
    });
  });

  describe('navigation', () => {
    it('opens the client profile when a row is clicked', () => {
      renderPage();
      fireEvent.click(rowFor('Beta'));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/clients/$clientId', params: { clientId: 'beta' } });
    });

    it('keeps the client name a link', () => {
      renderPage();
      expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/clients/$clientId/beta');
    });
  });

  // Archived clients are not listed: their debts sit in the Archived clients
  // row. Which clients are listed, and what each row counts, is pinned in
  // src/db/__tests__/clientOwedIndex.test.ts. The page adds no filter of its own.

  describe('empty and loading states', () => {
    it('shows the add-client empty state when there are no clients', () => {
      mockSummaries([]);
      vi.spyOn(useQueries, 'useClients').mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
        typeof useQueries.useClients
      >);
      renderPage();

      expect(screen.getByText('No clients found')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Add Client' }));
      expect(mockOpenClientDrawer).toHaveBeenCalledWith({ mode: 'create' });
    });

    it('says the search matched nothing, with the total and a translated Clear search', async () => {
      mockSummaries([]);
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search clients...'), { target: { value: 'zzz' } });

      // SearchInput debounces by 200ms
      expect(await screen.findByText('No clients match your search')).toBeInTheDocument();
      expect(screen.getByText('4 clients in total.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
    });

    it('shows a spinner while loading', () => {
      mockSummaries([], true);
      const { container } = renderPage();
      expect(container.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('No client and Archived clients rows (MUT-83)', () => {
    const bucketRow = (label: RegExp) => screen.getByRole('link', { name: label }).closest('tr')!;

    it('shows neither row when nothing is owed outside the listed clients', () => {
      renderPage();
      expect(screen.queryByRole('link', { name: /No client/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Archived clients/ })).not.toBeInTheDocument();
    });

    it('adds a muted row for each non-zero bucket, after every client', () => {
      mockSummaries([delta, beta, acme, gamma], false, { noClient: noClientDebt, archivedClients: archivedDebt });
      renderPage();

      expect(names()).toEqual(['Gamma', 'Acme', 'Beta', 'Delta', 'No client · 2 entries', 'Archived clients · 1']);
      expect(bucketRow(/No client/)).toHaveClass('client-index-bucket-row');
      expect(bucketRow(/Archived clients/)).toHaveClass('client-index-bucket-row');
    });

    it('shows only the bucket that owes something', () => {
      mockSummaries([acme], false, { archivedClients: archivedDebt });
      renderPage();

      expect(names()).toEqual(['Acme', 'Archived clients · 1']);
    });

    it('shows each bucket\'s owed now and overdue per currency, like a client row', () => {
      mockSummaries([acme], false, { noClient: noClientDebt });
      renderPage();

      const row = bucketRow(/No client/);
      expect(within(within(row).getByTestId('client-owed')).getAllByTestId('client-amount').map((e) => e.textContent)).toEqual([
        '₪500',
      ]);
      expect(within(row).getByTestId('client-overdue')).toHaveTextContent('₪200');
    });

    it('keeps them last whatever the sort', () => {
      mockSummaries([delta, beta, acme, gamma], false, { noClient: noClientDebt, archivedClients: archivedDebt });
      renderPage();

      fireEvent.click(within(header('Client')).getByRole('button'));
      expect(names().slice(-2)).toEqual(['No client · 2 entries', 'Archived clients · 1']);
      fireEvent.click(within(header('Client')).getByRole('button'));
      expect(names().slice(-2)).toEqual(['No client · 2 entries', 'Archived clients · 1']);
    });

    it('sums them into the strip, so it equals Home\'s Owed now', () => {
      mockSummaries([delta, beta, acme, gamma], false, { noClient: noClientDebt, archivedClients: archivedDebt });
      renderPage();

      const strip = screen.getByRole('region', { name: 'Owed now' });
      // USD 1,300 + 900 + archived 100; ILS 12,000 + 4,200 + no client 500
      expect(within(strip).getAllByTestId('owed-now-amount').map((e) => e.textContent)).toEqual(['$2,300', '₪16,700']);
    });

    it('opens /income filtered to those entries: unpaid, all time', () => {
      mockSummaries([acme], false, { noClient: noClientDebt, archivedClients: archivedDebt });
      renderPage();

      fireEvent.click(bucketRow(/No client/));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/income', search: owedEntriesSearch('none') });

      fireEvent.click(bucketRow(/Archived clients/));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/income', search: owedEntriesSearch('archived') });
    });

    it('keeps each label a link to the same filtered list', () => {
      mockSummaries([acme], false, { noClient: noClientDebt });
      renderPage();

      const href = screen.getByRole('link', { name: /No client/ }).getAttribute('href')!;
      expect(href).toMatch(/^\/income\?/);
      expect(new URLSearchParams(href.split('?')[1]).get('client')).toBe('none');
    });

    it('hides them during a search; the strip then sums the matching clients', async () => {
      mockSummaries([delta, beta, acme, gamma], false, { noClient: noClientDebt, archivedClients: archivedDebt });
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search clients...'), { target: { value: 'acm' } });

      // SearchInput debounces by 200ms
      expect(await screen.findByText('1 client')).toBeInTheDocument();
      expect(names()).toEqual(['Acme']);
      const strip = screen.getByRole('region', { name: 'Owed now' });
      expect(within(strip).getAllByTestId('owed-now-amount').map((e) => e.textContent)).toEqual(['$1,300', '₪4,200']);
    });

    it('shows the strip and the row instead of the empty state when only unassigned income is owed', () => {
      mockSummaries([], false, { noClient: noClientDebt });
      renderPage();

      expect(screen.queryByText('No clients found')).not.toBeInTheDocument();
      expect(names()).toEqual(['No client · 2 entries']);
      const strip = screen.getByRole('region', { name: 'Owed now' });
      expect(within(strip).getAllByTestId('owed-now-amount').map((e) => e.textContent)).toEqual(['₪500']);
    });
  });

  describe('unassigned clients', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not open a modal on its own; the app-wide banner handles them', () => {
      vi.spyOn(useQueries, 'useClients').mockReturnValue({
        data: [{ id: 'client-orphan', name: 'Unassigned client', createdAt: '', updatedAt: '' }],
        isLoading: false,
      } as unknown as ReturnType<typeof useQueries.useClients>);

      renderPage();

      expect(screen.getByRole('link', { name: 'Acme' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
