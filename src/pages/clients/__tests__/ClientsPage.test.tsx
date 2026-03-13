/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientsPage } from '../ClientsPage';
import * as useQueries from '../../../hooks/useQueries';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={`${to}/${params?.clientId || ''}`}>{children}</a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'clients.title': 'Clients',
      'clients.searchPlaceholder': 'Search clients...',
      'clients.empty': 'No clients found',
      'clients.emptySearch': 'No matching clients',
      'clients.emptyHint': 'Add your first client',
      'clients.addClient': 'Add Client',
      'clients.columns.client': 'Client',
      'clients.columns.activeProjects': 'Active Projects',
      'clients.columns.received': 'Received',
      'clients.columns.unpaid': 'Unpaid',
      'clients.columns.lastPayment': 'Last Payment',
      'clients.columns.lastActivity': 'Last Activity',
      'clients.summary.clientsCount': `${params?.count || 0} clients`,
      'clients.summary.clientsCountOne': '1 client',
      'clients.summary.totalReceived': 'Total Received',
      'clients.summary.totalUnpaid': 'Total Unpaid',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenClientDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openClientDrawer: mockOpenClientDrawer,
  }),
}));

// Mock clients data
const mockClients = [
  {
    id: 'client-1',
    name: 'Acme Corp',
    activeProjectCount: 3,
    paidIncomeMinor: 500000, // $5000
    unpaidIncomeMinor: 150000, // $1500
    paidIncomeMinorUSD: 500000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 150000,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    lastPaymentAt: '2026-03-01',
    lastActivityAt: '2026-03-10',
  },
  {
    id: 'client-2',
    name: 'Beta Inc',
    activeProjectCount: 1,
    paidIncomeMinor: 200000, // $2000
    unpaidIncomeMinor: 0,
    paidIncomeMinorUSD: 200000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 0,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    lastPaymentAt: '2026-02-15',
    lastActivityAt: '2026-02-20',
  },
];

function renderWithProviders(component: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {component}
    </QueryClientProvider>
  );
}

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
      data: mockClients,
      isLoading: false,
    } as ReturnType<typeof useQueries.useClientSummaries>);
  });

  describe('Page rendering', () => {
    it('renders page title', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Clients')).toBeInTheDocument();
    });

    it('renders search input', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByPlaceholderText('Search clients...')).toBeInTheDocument();
    });

    it('renders client list', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    });
  });

  describe('Column display', () => {
    it('shows client name column', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Client')).toBeInTheDocument();
    });

    it('shows active projects column', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Active Projects')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument(); // Acme Corp projects
    });

    it('shows received column with amounts', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Received')).toBeInTheDocument();
    });

    it('shows unpaid column', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
    });

    it('shows last activity column', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('Last Activity')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no clients', () => {
      vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useClientSummaries>);

      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('No clients found')).toBeInTheDocument();
    });

    it('shows add client button in empty state', () => {
      vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useClientSummaries>);

      renderWithProviders(<ClientsPage />);
      const addButton = screen.getByRole('button', { name: /add client/i });
      fireEvent.click(addButton);

      expect(mockOpenClientDrawer).toHaveBeenCalledWith({ mode: 'create' });
    });
  });

  describe('Loading state', () => {
    it('shows loading indicator when fetching', () => {
      vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useQueries.useClientSummaries>);

      renderWithProviders(<ClientsPage />);
      expect(document.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Client navigation', () => {
    it('renders client names as links', () => {
      renderWithProviders(<ClientsPage />);
      const link = screen.getByText('Acme Corp');
      expect(link.tagName).toBe('A');
    });
  });

  describe('Summary strip', () => {
    it('shows total clients count', () => {
      renderWithProviders(<ClientsPage />);
      expect(screen.getByText('2 clients')).toBeInTheDocument();
    });

    it('shows total received amount', () => {
      renderWithProviders(<ClientsPage />);
      // $5000 + $2000 = $7000 total received
      const summaryStrip = document.querySelector('.clients-summary-strip');
      expect(summaryStrip).toBeInTheDocument();
      expect(screen.getByText('Total Received')).toBeInTheDocument();
    });

    it('shows total unpaid amount', () => {
      renderWithProviders(<ClientsPage />);
      // $1500 total unpaid
      expect(screen.getByText('Total Unpaid')).toBeInTheDocument();
    });

    it('does not show summary strip when no clients', () => {
      vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useClientSummaries>);

      renderWithProviders(<ClientsPage />);
      const summaryStrip = document.querySelector('.clients-summary-strip');
      expect(summaryStrip).not.toBeInTheDocument();
    });
  });
});
