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
 *
 * MUT-84 (ADR-050): the list is the Clients layout's list pane. Its search and
 * sort are one URL model (stood in for here; the URL itself is covered by
 * useClientsSearch.test.tsx), every client link keeps them, and the client
 * open beside the list is marked. The split view itself is ClientsLayout.test.
 *
 * MUT-89 (ADR-051): with "All businesses" on, the list reads every business,
 * tags each row with its businesses, and splits the muted rows per business.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientsPage } from '../ClientsPage';
import { LoaderI18n } from '../../../test/loaderI18n';
import { LOADER_DELAY_MS } from '../../../components/brand/BrandLoader';
import * as useQueries from '../../../hooks/useQueries';
import { combineOwed } from '../../../db/aggregations';
import { owedEntriesSearch } from '../../../lib/incomeSearch';
import { useProfileStore, useOwedScreenStore } from '../../../lib/profileStore';
import * as crossProfileStats from '../../../db/crossProfileStats';
import type { ClientsSearch } from '../../../components/clients/clientsSearch';
import type { BusinessProfile, ClientSummary, OwedBucket, OwedBusinessBuckets } from '../../../types';
import { SLOW_UNDER_COVERAGE } from '../../../test/timeouts';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    'aria-current': ariaCurrent,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string> | true;
    'aria-current'?: 'page';
  }) => (
    <a
      href={typeof search === 'object' ? `${to}?${new URLSearchParams(search)}` : `${to}/${params?.clientId || ''}`}
      aria-current={ariaCurrent}
    >
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

// The list's search and sort (MUT-84): an in-memory stand-in for the URL, so a
// header click or a search re-renders the list as the real URL would.
const urlSearch = vi.hoisted(() => ({
  initial: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
}));
vi.mock('../../../components/clients/useClientsSearch', async () => {
  const { useState, useCallback } = await import('react');
  const { mergeClientsSearch } = await import('../../../components/clients/clientsSearch');
  return {
    useClientsSearch: () => {
      const [search, setState] = useState<ClientsSearch>(() => urlSearch.initial as ClientsSearch);
      const setSearch = useCallback((patch: Parameters<typeof mergeClientsSearch>[1]) => {
        urlSearch.writes.push(patch);
        setState((prev) => mergeClientsSearch(prev, patch));
      }, []);
      return { search, setSearch };
    },
  };
});

vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'clients.title': 'Clients',
    'clients.searchPlaceholder': 'Search clients...',
    'clients.empty': 'No clients found',
    'clients.emptySearch': 'No matching clients',
    'clients.emptyHint': 'Add your first client',
    'clients.addClient': 'Add Client',
    'clients.emptyFiltered': 'No clients match your search',
    'clients.clearSearch': 'Clear search',
    'clients.columns.client': 'Client',
    'clients.columns.owedNow': 'Owed now',
    'clients.columns.overdue': 'Overdue',
    'clients.columns.lastPayment': 'Last payment',
    'clients.columns.lastActivity': 'Last activity',
    'clients.index.settled': 'Settled',
    'clients.index.neverPaid': 'Never paid',
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
    'clients.emptyFilteredCount': { one: '{count} client in total.', other: '{count} clients in total.' },
    'clients.crossProfileTxCount': { one: '{count} entry', other: '{count} entries' },
    'clients.summary.clientsCount': { one: '{count} client', other: '{count} clients' },
    'clients.index.oldestOverdue': { one: 'oldest {count}d', other: 'oldest {count}d' },
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
  {
    noClient = NOTHING,
    archivedClients = NOTHING,
    byProfile,
  }: { noClient?: OwedBucket; archivedClients?: OwedBucket; byProfile?: OwedBusinessBuckets[] } = {}
) {
  const total = combineOwed([...rows.map((r) => r.owed), noClient.owed, archivedClients.owed]);
  vi.spyOn(useQueries, 'useClientOwedIndex').mockImplementation(
    (_profileId?: unknown, search?: string) =>
      ({
        data: {
          clients: rows.filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
          total,
          noClient,
          archivedClients,
          byProfile,
        },
        isLoading,
        isPending: isLoading,
      }) as unknown as ReturnType<typeof useQueries.useClientOwedIndex>
  );
}

// No client: ₪500 (₪200 overdue) over 2 entries. Archived clients: $100 from 1 client.
const noClientDebt: OwedBucket = { owed: [{ currency: 'ILS', owedMinor: 50_000, overdueMinor: 20_000 }], count: 2 };
const archivedDebt: OwedBucket = { owed: [{ currency: 'USD', owedMinor: 10_000, overdueMinor: 0 }], count: 1 };

function renderPage(props: React.ComponentProps<typeof ClientsPage> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoaderI18n>
        <ClientsPage {...props} />
      </LoaderI18n>
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
    urlSearch.initial = {};
    urlSearch.writes = [];
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
    vi.spyOn(useQueries, 'useDefaultBusinessProfile').mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useDefaultBusinessProfile>);
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

    it('MUT-109: each amount is a plain <bdi>, so an Arabic amount resolves from its own leading RLM', () => {
      renderPage();
      for (const amount of within(rowFor('Acme')).getAllByTestId('client-amount')) {
        expect(amount.tagName).toBe('BDI');
        expect(amount).not.toHaveAttribute('dir');
      }
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
      // The payment's own day in every timezone (MUT-169: formatPaymentDate)
      expect(paid).toHaveTextContent('Oct 5, 2026');
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

    it('sorts overdue by how late, newest payment first, latest activity first, and names A–Z', SLOW_UNDER_COVERAGE, () => {
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
      expect(urlSearch.writes).toEqual([{ sort: 'lastPayment', dir: 'desc' }]);
    });

    it('opens in the sort the URL names', () => {
      urlSearch.initial = { sort: 'name', dir: 'asc' };
      renderPage();
      expect(names()).toEqual(['Acme', 'Beta', 'Delta', 'Gamma']);
      expect(header('Client')).toHaveAttribute('aria-sort', 'ascending');
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
    it('opens the client profile when a row is clicked, keeping the list\'s search and sort', () => {
      renderPage();
      fireEvent.click(rowFor('Beta'));
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/clients/$clientId', params: { clientId: 'beta' }, search: true });
    });

    it('keeps the client name a link', () => {
      renderPage();
      expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/clients/$clientId/beta');
    });

    it('writes the search into the URL', async () => {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('Search clients...'), { target: { value: 'acm' } });

      // SearchInput debounces by 200ms
      expect(await screen.findByText('1 client')).toBeInTheDocument();
      expect(urlSearch.writes).toEqual([{ q: 'acm' }]);
    });

    it('opens with the search the URL names', () => {
      urlSearch.initial = { q: 'acm' };
      renderPage();
      expect(screen.getByPlaceholderText('Search clients...')).toHaveValue('acm');
      expect(names()).toEqual(['Acme']);
    });
  });

  describe('the client open beside the list (MUT-84)', () => {
    it('marks its row and makes its link the current page', () => {
      renderPage({ openClientId: 'acme' });
      expect(rowFor('Acme')).toHaveClass('client-index-row-open');
      expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: 'Beta' })).not.toHaveAttribute('aria-current');
    });

    it('marks nothing when no client is open', () => {
      renderPage();
      expect(document.querySelector('.client-index-row-open')).toBeNull();
      expect(document.querySelector('[aria-current]')).toBeNull();
    });

    it('tags each client row with its id, and no muted row', () => {
      mockSummaries([acme, beta], false, { noClient: noClientDebt });
      renderPage();
      expect(rowFor('Acme')).toHaveAttribute('data-client-id', 'acme');
      expect(rowFor('Beta')).toHaveAttribute('data-client-id', 'beta');
      expect(screen.getByRole('link', { name: /No client/ }).closest('tr')).not.toHaveAttribute('data-client-id');
    });

    it('leaves ↑/↓ alone when the window is too narrow to walk', () => {
      renderPage();
      const link = screen.getByRole('link', { name: 'Gamma' });
      link.focus();
      expect(fireEvent.keyDown(link, { key: 'ArrowDown' })).toBe(true);
      expect(link).toHaveFocus();
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

    // MUT-206: the bloom loader, named after its 400 ms delay. Real timers (eng review Q1).
    it('shows the bloom loader while loading', async () => {
      mockSummaries([], true);
      renderPage();
      const loader = await screen.findByRole('status');
      await waitFor(() => expect(loader).toHaveTextContent(/loading/i));
    });

    // MUT-206 DR8: a loader only when there is nothing to show yet. A refetch keeps the rows.
    it('keeps the rows through a background refetch, with no loader', async () => {
      renderPage();
      expect(names()).toHaveLength(4);

      vi.spyOn(useQueries, 'useClientOwedIndex').mockImplementation(
        () =>
          ({
            data: { clients: [delta, beta, acme, gamma], total: combineOwed([delta, beta, acme, gamma].map((r) => r.owed)), noClient: NOTHING, archivedClients: NOTHING },
            isLoading: false,
            isPending: false,
            isFetching: true,
          }) as unknown as ReturnType<typeof useQueries.useClientOwedIndex>,
      );
      // The query refetches in the background (an invalidation): data stays, isFetching is on. Re-render the page.
      fireEvent.click(within(header('Owed now')).getByRole('button'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, LOADER_DELAY_MS + 100));
      });

      expect(names()).toHaveLength(4);
      expect(document.querySelector('.brand-loader')).toBeNull();
      expect(screen.queryAllByRole('status').filter((node) => /loading/i.test(node.textContent ?? ''))).toEqual([]);
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

  describe('All businesses (MUT-89)', () => {
    const STAMP = '2026-01-01T00:00:00Z';
    const studio: BusinessProfile = { id: 'p1', name: 'Studio', isDefault: true, createdAt: STAMP, updatedAt: STAMP };
    const teaching: BusinessProfile = { id: 'p2', name: 'Teaching', createdAt: STAMP, updatedAt: STAMP };
    const studioNoClient: OwedBucket = { owed: [{ currency: 'ILS', owedMinor: 30_000, overdueMinor: 0 }], count: 2 };
    const teachingNoClient: OwedBucket = { owed: [{ currency: 'ILS', owedMinor: 20_000, overdueMinor: 0 }], count: 1 };
    const bucketLink = (label: RegExp) => screen.getByRole('link', { name: label });

    beforeEach(() => {
      vi.spyOn(useQueries, 'useBusinessProfiles').mockReturnValue({
        data: [studio, teaching],
        isLoading: false,
      } as unknown as ReturnType<typeof useQueries.useBusinessProfiles>);
      vi.spyOn(useQueries, 'useDefaultBusinessProfile').mockReturnValue({
        data: studio,
        isLoading: false,
      } as unknown as ReturnType<typeof useQueries.useDefaultBusinessProfile>);
      vi.spyOn(crossProfileStats, 'getCrossProfileClientStats').mockResolvedValue(
        new Map([['acme', [{ profileId: 'p2', profileName: 'Teaching', txCount: 3, totalMinor: 100 }]]])
      );
      useProfileStore.setState({ activeProfileId: 'p1', allBusinesses: true });
      useOwedScreenStore.setState({ onOwedScreen: true });
      mockSummaries(
        [{ ...acme, profileIds: ['p1', 'p2'] }, { ...beta, profileIds: ['p2'] }, { ...gamma, profileIds: ['p1'] }],
        false,
        {
          noClient: combineBuckets(studioNoClient, teachingNoClient),
          byProfile: [
            { profileId: 'p1', noClient: studioNoClient, archivedClients: NOTHING },
            { profileId: 'p2', noClient: teachingNoClient, archivedClients: NOTHING },
          ],
        }
      );
    });

    afterEach(() => {
      useProfileStore.setState({ activeProfileId: '', allBusinesses: false });
      useOwedScreenStore.setState({ onOwedScreen: false });
    });

    function combineBuckets(...buckets: OwedBucket[]): OwedBucket {
      return { owed: combineOwed(buckets.map((b) => b.owed)), count: buckets.reduce((n, b) => n + b.count, 0) };
    }

    it('reads every business in the switcher (AC2)', () => {
      renderPage();
      expect(vi.mocked(useQueries.useClientOwedIndex).mock.calls[0][0]).toEqual(['p1', 'p2']);
    });

    it('tags a shared client with each of its businesses, and the others with theirs (AC2)', () => {
      renderPage();
      expect(within(rowFor('Acme')).getByText('Studio')).toBeInTheDocument();
      expect(within(rowFor('Acme')).getByText('Teaching')).toBeInTheDocument();
      expect(within(rowFor('Beta')).getByText('Teaching')).toBeInTheDocument();
      expect(within(rowFor('Beta')).queryByText('Studio')).toBeNull();
    });

    it('shows the business tags instead of the "entries in other businesses" badges', async () => {
      const { container } = renderPage();
      // Give an enabled query the turn it would need to run
      await act(async () => {});
      expect(crossProfileStats.getCrossProfileClientStats).not.toHaveBeenCalled();
      expect(container.querySelector('.cross-profile-badge')).toBeNull();
    });

    it('gives each business its own No client row, tagged, after the clients (O4)', () => {
      renderPage();
      expect(bucketLink(/No client · 2 entries.*Studio/)).toBeInTheDocument();
      expect(bucketLink(/No client · 1 entry.*Teaching/)).toBeInTheDocument();
      expect(names().slice(-2).map((n) => n?.startsWith('No client'))).toEqual([true, true]);
    });

    it('opens Income in that row\'s business and keeps All businesses on (O4)', () => {
      renderPage();
      fireEvent.click(bucketLink(/Teaching/).closest('tr')!);

      expect(useProfileStore.getState()).toMatchObject({ activeProfileId: 'p2', allBusinesses: true });
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/income', search: owedEntriesSearch('none') });
    });

    it('sets the business before following a muted row\'s link too', () => {
      renderPage();
      fireEvent.click(bucketLink(/Teaching/));
      expect(useProfileStore.getState().activeProfileId).toBe('p2');
    });

    it('keeps the cross-profile badges in one business', async () => {
      useProfileStore.setState({ allBusinesses: false });
      renderPage();
      expect(await screen.findByText('3 entries')).toBeInTheDocument();
      expect(screen.queryByText('Studio', { selector: '.profile-badge-name' })).toBeNull();
    });
  });
});
