/**
 * @vitest-environment jsdom
 *
 * MUT-84 (ADR-050): on a wide window a client opens beside the Clients list,
 * like Mail; ↑/↓ walk the clients and the profile follows; the URL stays
 * /clients/:id. A narrow window keeps the full-page profile.
 *
 * Rendered on a real memory router with the app's route shape (a /clients
 * layout with an index and a $clientId child), so the URL, history entries
 * and remounts are the router's own. The profile is a stub that counts its
 * mounts; ClientDetailPage's content is covered in its own test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
} from '@tanstack/react-router';
import { ClientsLayout } from '../ClientsLayout';
import { parseClientsSearch } from '../../../components/clients/clientsSearch';
import { clientProfileRemountDeps } from '../../../components/clients/clientsSplitView';
import { BREAKPOINTS } from '../../../lib/breakpoints';
import * as useQueries from '../../../hooks/useQueries';
import { combineOwed } from '../../../db/aggregations';
import type { ClientSummary, OwedBucket } from '../../../types';

// The page's direction, switched per test for the Arabic cases
const i18n = vi.hoisted(() => ({ direction: 'ltr' as 'ltr' | 'rtl' }));

vi.mock('../../../lib/i18n', () => {
  const translations: Record<string, string> = {
    'common.loading': 'Loading...',
    'common.edit': 'Edit',
    'nav.clients': 'Clients',
    'clients.title': 'Clients',
    'clients.notFound': 'Client not found',
    'clients.searchPlaceholder': 'Search clients...',
    'clients.columns.client': 'Client',
    'clients.columns.owedNow': 'Owed now',
    'clients.columns.overdue': 'Overdue',
    'clients.columns.lastPayment': 'Last payment',
    'clients.columns.lastActivity': 'Last activity',
    'clients.summary.clientsCount': '{count} clients',
    'clients.index.settled': 'Settled',
    'clients.index.neverPaid': 'Never paid',
    'clients.profile.owedNow': 'Owed now',
    'clients.profile.nothingOwed': 'Nothing owed',
    'clients.split.profile': 'Client profile',
    'clients.split.showing': 'Showing {name}',
  };
  const t = (key: string, vars?: Record<string, string | number>) =>
    (translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
  return {
    useT: () => t,
    useLanguage: () => ({ language: 'en' }),
    useDirection: () => i18n.direction,
    getLocale: () => 'en-US',
  };
});

vi.mock('../../../lib/i18n/plural', () => ({
  useTp: () => (key: string, count: number) =>
    key === 'clients.index.bucket.noClient' ? `No client · ${count} entries` : `${key} ${count}`,
}));

// The top bar's own behaviour (FX readout, Add menu) is covered elsewhere;
// here it shows what the layout tells it.
vi.mock('../../../components/layout', () => ({
  TopBar: ({
    title,
    breadcrumbs,
    rightSlot,
  }: {
    title: string;
    breadcrumbs?: { label: string; href?: string }[];
    rightSlot?: React.ReactNode;
  }) => (
    <header data-testid="topbar">
      {breadcrumbs && <p data-testid="breadcrumbs">{breadcrumbs.map((b) => b.label).join(' / ')}</p>}
      <h1>{title}</h1>
      {rightSlot}
    </header>
  ),
}));

const mockOpenClientDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({ openClientDrawer: mockOpenClientDrawer }),
}));

vi.mock('../../../hooks/useFxRate', () => ({
  useFxRate: (base: string) => ({ rate: base === 'USD' ? 3 : 4, source: 'live' }),
}));

// ---------------------------------------------------------------------------
// Window width: matchMedia answers for the width set here, and a resize
// notifies every subscriber, as a browser does.
// ---------------------------------------------------------------------------
const WIDE = 1440;
const NARROW = 800;
const media = vi.hoisted(() => ({ width: 1440, listeners: new Set<(event: { matches: boolean }) => void>() }));

function installMatchMedia() {
  window.matchMedia = vi.fn((query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return media.width >= min;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => media.listeners.add(listener),
      removeEventListener: (_: string, listener: (event: { matches: boolean }) => void) => media.listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  }) as unknown as typeof window.matchMedia;
}

function resizeTo(width: number) {
  media.width = width;
  act(() => media.listeners.forEach((listener) => listener({ matches: width >= BREAKPOINTS.clientsSplit })));
}

// ---------------------------------------------------------------------------
// Data: Gamma ₪12,000 > Acme $1,300 > Beta $900 > Delta settled (owed now,
// descending, at $1 = ₪3), then the "No client" muted row.
// ---------------------------------------------------------------------------
const summary = (id: string, name: string, owed: ClientSummary['owed'] = []): ClientSummary => ({
  id,
  name,
  activeProjectCount: 0,
  paidIncomeMinor: 0,
  unpaidIncomeMinor: 0,
  owed,
});
const clients = [
  summary('delta', 'Delta'),
  summary('beta', 'Beta', [{ currency: 'USD', owedMinor: 90_000, overdueMinor: 0 }]),
  summary('acme', 'Acme', [{ currency: 'USD', owedMinor: 130_000, overdueMinor: 0 }]),
  summary('gamma', 'Gamma', [{ currency: 'ILS', owedMinor: 1_200_000, overdueMinor: 0 }]),
];
const NAMES: Record<string, string> = Object.fromEntries(clients.map((c) => [c.id, c.name]));
const noClient: OwedBucket = { owed: [{ currency: 'ILS', owedMinor: 50_000, overdueMinor: 0 }], count: 2 };
const NOTHING: OwedBucket = { owed: [], count: 0 };

function mockData() {
  vi.spyOn(useQueries, 'useClientOwedIndex').mockImplementation(
    (_profileId?: string, search?: string) =>
      ({
        data: {
          clients: clients.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase())),
          total: combineOwed([...clients.map((c) => c.owed), noClient.owed]),
          noClient,
          archivedClients: NOTHING,
        },
        isLoading: false,
      }) as unknown as ReturnType<typeof useQueries.useClientOwedIndex>
  );
  vi.spyOn(useQueries, 'useClients').mockReturnValue({
    data: clients.map((c) => ({ id: c.id, name: c.name, profileId: 'p1' })),
    isLoading: false,
  } as unknown as ReturnType<typeof useQueries.useClients>);
  vi.spyOn(useQueries, 'useBusinessProfiles').mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useQueries.useBusinessProfiles>);
  vi.spyOn(useQueries, 'useClient').mockImplementation(
    (id: string) =>
      ({
        data: id ? (NAMES[id] ? { id, name: NAMES[id] } : null) : undefined,
        isLoading: false,
      }) as unknown as ReturnType<typeof useQueries.useClient>
  );
}

// ---------------------------------------------------------------------------
// The profile stub: counts its mounts and holds a field whose value would be
// lost by a remount.
// ---------------------------------------------------------------------------
const profile = vi.hoisted(() => ({ mounts: 0 }));

function ProfileStub() {
  const { clientId } = useParams({ strict: false }) as { clientId?: string };
  useEffect(() => {
    profile.mounts += 1;
  }, []);
  return (
    <div className="page-content">
      <h2>Profile of {clientId}</h2>
      <input aria-label="Work search" />
      <button type="button">Record payment</button>
    </div>
  );
}

function renderAt(url: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const clientsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/clients',
    validateSearch: parseClientsSearch,
    component: ClientsLayout,
  });
  const indexRoute = createRoute({ getParentRoute: () => clientsRoute, path: '/', component: () => null });
  const detailRoute = createRoute({
    getParentRoute: () => clientsRoute,
    path: '$clientId',
    remountDeps: clientProfileRemountDeps,
    component: ProfileStub,
  });
  const incomeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/income', component: () => <p>Income</p> });
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([clientsRoute.addChildren([indexRoute, detailRoute]), incomeRoute]),
    history,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  return { router, history };
}

const layoutRoot = () => document.querySelector<HTMLElement>('[data-layout]')!;
const listPane = () => document.querySelector<HTMLElement>('.clients-split-list')!;
const profilePane = () => screen.queryByRole('region', { name: 'Client profile' });
const rowLink = (name: string) => screen.getByRole('link', { name });
const press = (target: Element, key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(target, { key, ...init });
const path = (router: ReturnType<typeof renderAt>['router']) => router.state.location.pathname;

describe('ClientsLayout (MUT-84)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    media.width = WIDE;
    media.listeners.clear();
    installMatchMedia();
    i18n.direction = 'ltr';
    profile.mounts = 0;
    mockData();
  });

  describe('a narrow window keeps today\'s pages', () => {
    beforeEach(() => {
      media.width = NARROW;
    });

    it('shows the list alone on /clients', async () => {
      renderAt('/clients');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(layoutRoot()).toHaveAttribute('data-layout', 'list');
      expect(profilePane()).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Clients');
    });

    it('shows the profile alone on /clients/:id, named in the top bar under a Clients breadcrumb', async () => {
      renderAt('/clients/acme');

      expect(await screen.findByRole('heading', { name: 'Profile of acme' })).toBeVisible();
      expect(layoutRoot()).toHaveAttribute('data-layout', 'profile');
      expect(listPane()).toHaveAttribute('hidden');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme');
      expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('Clients / Acme');
    });

    it('leaves ↑/↓ to the browser: nothing opens and focus stays', async () => {
      const { router } = renderAt('/clients');
      await screen.findByRole('table');
      rowLink('Gamma').focus();

      expect(press(rowLink('Gamma'), 'ArrowDown')).toBe(true);

      expect(rowLink('Gamma')).toHaveFocus();
      expect(path(router)).toBe('/clients');
    });
  });

  describe('a wide window opens the client beside the list', () => {
    it('shows the full list with nothing beside it on /clients', async () => {
      renderAt('/clients');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(layoutRoot()).toHaveAttribute('data-layout', 'list');
      expect(profilePane()).not.toBeInTheDocument();
    });

    it('shows the list and the profile together, the open client marked in the list', async () => {
      renderAt('/clients/acme');

      expect(await screen.findByRole('heading', { name: 'Profile of acme' })).toBeVisible();
      expect(layoutRoot()).toHaveAttribute('data-layout', 'split');
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(profilePane()).toBeInTheDocument();

      expect(rowLink('Acme')).toHaveAttribute('aria-current', 'page');
      expect(rowLink('Acme').closest('tr')).toHaveClass('client-index-row-open');
      expect(rowLink('Beta')).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme');
    });

    it('offers Edit for the open client in the top bar', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      fireEvent.click(within(screen.getByTestId('topbar')).getByRole('button', { name: 'Edit' }));
      expect(mockOpenClientDrawer).toHaveBeenCalledWith({ mode: 'edit', clientId: 'acme' });
    });

    it('says when the linked client does not exist, and keeps the list beside it', async () => {
      renderAt('/clients/zed');
      await screen.findByRole('heading', { name: 'Profile of zed' });

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Client not found');
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
  });

  describe('resizing across the breakpoint', () => {
    it('switches between beside and full page without remounting the profile', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });
      fireEvent.change(screen.getByLabelText('Work search'), { target: { value: 'logo' } });
      expect(profile.mounts).toBe(1);

      resizeTo(NARROW);
      expect(layoutRoot()).toHaveAttribute('data-layout', 'profile');
      expect(listPane()).toHaveAttribute('hidden');

      resizeTo(WIDE);
      expect(layoutRoot()).toHaveAttribute('data-layout', 'split');
      expect(listPane()).not.toHaveAttribute('hidden');

      expect(profile.mounts).toBe(1);
      expect(screen.getByLabelText('Work search')).toHaveValue('logo');
    });
  });

  describe('walking the list with ↑/↓', () => {
    it('opens the next and previous client, with focus and the URL following', async () => {
      const { router } = renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });
      rowLink('Acme').focus();

      expect(press(rowLink('Acme'), 'ArrowDown')).toBe(false);
      expect(rowLink('Beta')).toHaveFocus();
      await waitFor(() => expect(path(router)).toBe('/clients/beta'));
      expect(await screen.findByRole('heading', { name: 'Profile of beta' })).toBeVisible();
      expect(rowLink('Beta')).toHaveAttribute('aria-current', 'page');

      press(rowLink('Beta'), 'ArrowUp');
      press(rowLink('Acme'), 'ArrowUp');
      expect(rowLink('Gamma')).toHaveFocus();
      await waitFor(() => expect(path(router)).toBe('/clients/gamma'));
    });

    it('skips the muted rows and stops at either end, without scrolling the page', async () => {
      const { router } = renderAt('/clients/delta');
      await screen.findByRole('heading', { name: 'Profile of delta' });
      expect(screen.getByRole('link', { name: /No client/ })).toBeInTheDocument();

      // Delta is the last client: the No client row after it is not a stop
      rowLink('Delta').focus();
      expect(press(rowLink('Delta'), 'ArrowDown')).toBe(false);
      expect(rowLink('Delta')).toHaveFocus();
      expect(path(router)).toBe('/clients/delta');

      await act(async () => router.navigate({ to: '/clients/$clientId', params: { clientId: 'gamma' } }));
      rowLink('Gamma').focus();
      expect(press(rowLink('Gamma'), 'ArrowUp')).toBe(false);
      expect(rowLink('Gamma')).toHaveFocus();
      expect(path(router)).toBe('/clients/gamma');
    });

    it('adds one history entry when it opens the first client, then replaces it while walking', async () => {
      const { router, history } = renderAt('/clients');
      await screen.findByRole('table');
      const entriesBefore = history.length;

      rowLink('Gamma').focus();
      press(rowLink('Gamma'), 'ArrowDown');
      await waitFor(() => expect(path(router)).toBe('/clients/acme'));
      expect(layoutRoot()).toHaveAttribute('data-layout', 'split');
      expect(history.length).toBe(entriesBefore + 1);

      press(rowLink('Acme'), 'ArrowDown');
      await waitFor(() => expect(path(router)).toBe('/clients/beta'));
      expect(history.length).toBe(entriesBefore + 1);

      // Back closes the profile instead of replaying the walk
      await act(async () => history.back());
      await waitFor(() => expect(path(router)).toBe('/clients'));
    });

    it('keeps the list, its search and its sort while switching clients', async () => {
      const { router } = renderAt('/clients/acme?q=a&sort=name');
      await screen.findByRole('heading', { name: 'Profile of acme' });
      const pane = listPane();
      const scroller = pane.querySelector('.page-content');

      rowLink('Acme').focus();
      press(rowLink('Acme'), 'ArrowDown');
      await waitFor(() => expect(path(router)).toBe('/clients/beta'));
      expect(router.state.location.search).toEqual({ q: 'a', sort: 'name' });

      // A click keeps them too, and adds a history entry as any link does
      fireEvent.click(rowLink('Gamma'));
      await waitFor(() => expect(path(router)).toBe('/clients/gamma'));
      expect(router.state.location.search).toEqual({ q: 'a', sort: 'name' });

      expect(listPane()).toBe(pane);
      expect(pane.querySelector('.page-content')).toBe(scroller);
      expect(screen.getByPlaceholderText('Search clients...')).toHaveValue('a');
    });

    it('gives each client a fresh profile', async () => {
      const { router } = renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });
      fireEvent.change(screen.getByLabelText('Work search'), { target: { value: 'logo' } });

      rowLink('Acme').focus();
      press(rowLink('Acme'), 'ArrowDown');
      await waitFor(() => expect(path(router)).toBe('/clients/beta'));
      await screen.findByRole('heading', { name: 'Profile of beta' });

      expect(profile.mounts).toBe(2);
      expect(screen.getByLabelText('Work search')).toHaveValue('');
    });

    it('moves from the search box to the open client with ↓', async () => {
      const { router } = renderAt('/clients/beta');
      await screen.findByRole('heading', { name: 'Profile of beta' });

      press(screen.getByPlaceholderText('Search clients...'), 'ArrowDown');

      expect(rowLink('Beta')).toHaveFocus();
      expect(path(router)).toBe('/clients/beta');
    });

    it('opens the first client from the search box when none is open', async () => {
      const { router } = renderAt('/clients');
      await screen.findByRole('table');

      press(screen.getByPlaceholderText('Search clients...'), 'ArrowDown');

      expect(rowLink('Gamma')).toHaveFocus();
      await waitFor(() => expect(path(router)).toBe('/clients/gamma'));
    });
  });

  describe('moving between the list and the profile', () => {
    it('moves focus into the profile with Enter on the open client, or →', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      rowLink('Acme').focus();
      expect(press(rowLink('Acme'), 'Enter')).toBe(false);
      expect(profilePane()).toHaveFocus();

      rowLink('Beta').focus();
      press(rowLink('Beta'), 'ArrowRight');
      expect(profilePane()).toHaveFocus();
    });

    it('leaves Enter on another client to its link', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      rowLink('Beta').focus();
      expect(press(rowLink('Beta'), 'Enter')).toBe(true);
      expect(rowLink('Beta')).toHaveFocus();
    });

    it('returns focus to the open client with Escape or ←', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      profilePane()!.focus();
      press(profilePane()!, 'Escape');
      expect(rowLink('Acme')).toHaveFocus();

      const button = screen.getByRole('button', { name: 'Record payment' });
      button.focus();
      press(button, 'ArrowLeft');
      expect(rowLink('Acme')).toHaveFocus();
    });

    it('follows the screen in Arabic: ← goes into the profile, → comes back', async () => {
      i18n.direction = 'rtl';
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      rowLink('Acme').focus();
      press(rowLink('Acme'), 'ArrowRight');
      expect(rowLink('Acme')).toHaveFocus();

      press(rowLink('Acme'), 'ArrowLeft');
      expect(profilePane()).toHaveFocus();

      press(profilePane()!, 'ArrowRight');
      expect(rowLink('Acme')).toHaveFocus();
    });

    it('leaves keys typed in a field of the profile alone, and never takes Alt+← (Back)', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      const field = screen.getByLabelText('Work search');
      field.focus();
      expect(press(field, 'ArrowLeft')).toBe(true);
      expect(press(field, 'Escape')).toBe(true);
      expect(field).toHaveFocus();

      const button = screen.getByRole('button', { name: 'Record payment' });
      button.focus();
      expect(press(button, 'ArrowLeft', { altKey: true })).toBe(true);
      expect(button).toHaveFocus();
    });
  });

  describe('announcing the open client', () => {
    it('names the client a walk opened', async () => {
      const { router } = renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      rowLink('Acme').focus();
      press(rowLink('Acme'), 'ArrowDown');
      await waitFor(() => expect(path(router)).toBe('/clients/beta'));

      expect(screen.getByRole('status')).toHaveTextContent('Showing Beta');
    });

    it('says nothing when the page opens on a client', async () => {
      renderAt('/clients/acme');
      await screen.findByRole('heading', { name: 'Profile of acme' });

      expect(screen.getByRole('status')).toHaveTextContent('');
    });
  });
});
