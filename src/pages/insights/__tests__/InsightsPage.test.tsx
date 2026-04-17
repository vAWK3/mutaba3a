/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InsightsPage } from '../InsightsPage';
import * as useQueries from '../../../hooks/useQueries';

vi.mock('../../../hooks/useActiveProfile', () => ({
  useProfileFilter: () => 'profile-1',
  useActiveProfile: () => ({
    isAllProfiles: false,
    activeProfileId: 'profile-1',
    activeProfile: { id: 'profile-1', name: 'Test Business' },
    profiles: [{ id: 'profile-1', name: 'Test Business' }],
    showAllProfilesOption: false,
    setActiveProfile: vi.fn(),
    isLoading: false,
  }),
}));

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ tab: undefined }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'insights.title': 'Insights',
      'insights.tabs.summary': 'Summary',
      'insights.tabs.clients': 'Clients',
      'insights.tabs.projects': 'Projects',
      'insights.tabs.expenses': 'Expenses',
      'insights.tabs.unpaid': 'Unpaid',
      'common.loading': 'Loading...',
      'overview.kpi.paidIncome': 'Paid Income',
      'overview.kpi.unpaidReceivables': 'Unpaid Receivables',
      'overview.kpi.expenses': 'Expenses',
      'overview.kpi.net': 'Net (Paid - Expenses)',
      'reports.exportCsv': 'Export CSV',
      'reports.currencyMode.usd': 'USD',
      'reports.currencyMode.ils': 'ILS',
      'reports.currencyMode.both': 'Both',
      'clients.columns.client': 'Client',
      'clients.columns.paidIncome': 'Paid Income',
      'clients.columns.unpaid': 'Unpaid',
      'projects.columns.project': 'Project',
      'projects.columns.received': 'Received',
      'projects.columns.unpaid': 'Unpaid',
      'projects.columns.expenses': 'Expenses',
      'projects.columns.net': 'Net',
      'expenses.title': 'Expenses',
      'reports.sections.unpaidAging': 'Unpaid Receivables Aging',
      'insights.cashFlowTimeline.title': 'Cash Flow Timeline',
      'insights.cashFlowTimeline.hint': 'View daily inflows and outflows with a dedicated date picker',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock transactions data
const mockTransactions = [
  {
    id: 'tx-1',
    kind: 'income',
    status: 'paid',
    amountMinor: 500000,
    currency: 'USD',
    occurredAt: '2026-03-01',
    clientId: 'client-1',
    clientName: 'Acme Corp',
  },
  {
    id: 'tx-2',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 200000,
    currency: 'USD',
    occurredAt: '2026-03-05',
    dueDate: '2026-03-15',
    clientId: 'client-1',
    clientName: 'Acme Corp',
  },
  {
    id: 'tx-3',
    kind: 'expense',
    status: 'paid',
    amountMinor: 100000,
    currency: 'USD',
    occurredAt: '2026-03-02',
  },
];

const mockClientSummaries = [
  {
    id: 'client-1',
    name: 'Acme Corp',
    activeProjectCount: 2,
    paidIncomeMinorUSD: 500000,
    paidIncomeMinorILS: 0,
    unpaidIncomeMinorUSD: 200000,
    unpaidIncomeMinorILS: 0,
    expensesMinorUSD: 50000,
    expensesMinorILS: 0,
  },
];

const mockProjectSummaries = [
  {
    id: 'project-1',
    name: 'Website Redesign',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    paidIncomeMinorUSD: 300000,
    paidIncomeMinorILS: 0,
    unpaidIncomeMinorUSD: 100000,
    unpaidIncomeMinorILS: 0,
    expensesMinorUSD: 30000,
    expensesMinorILS: 0,
    netMinor: 370000,
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

describe('InsightsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
      data: mockTransactions,
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useTransactions>);
    vi.spyOn(useQueries, 'useClientSummaries').mockReturnValue({
      data: mockClientSummaries,
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useClientSummaries>);
    vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
      data: mockProjectSummaries,
      isLoading: false,
    } as unknown as ReturnType<typeof useQueries.useProjectSummaries>);
  });

  describe('Page structure', () => {
    it('passes active profile to data queries', () => {
      renderWithProviders(<InsightsPage />);

      expect(useQueries.useTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'profile-1' })
      );
      expect(useQueries.useProjectSummaries).toHaveBeenCalledWith('profile-1', undefined);
      expect(useQueries.useClientSummaries).toHaveBeenCalledWith('profile-1', undefined);
    });

    it('renders the page title', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    it('renders all preset tabs', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clients' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Projects' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expenses' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unpaid' })).toBeInTheDocument();
    });

    it('renders currency mode selector', () => {
      renderWithProviders(<InsightsPage />);
      // There are multiple comboboxes, find the currency one by its options
      const selects = screen.getAllByRole('combobox');
      const currencySelect = selects.find(s => s.querySelector('option[value="USD"]'));
      expect(currencySelect).toBeInTheDocument();
    });

    it('renders export CSV button', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeInTheDocument();
    });
  });

  describe('Tab switching', () => {
    it('shows Summary tab content by default', () => {
      renderWithProviders(<InsightsPage />);
      // Summary tab should show financial summary
      expect(screen.getByText('Paid Income')).toBeInTheDocument();
    });

    it('switches to Clients tab when clicked', async () => {
      renderWithProviders(<InsightsPage />);
      const clientsTab = screen.getByRole('button', { name: 'Clients' });
      fireEvent.click(clientsTab);

      await waitFor(() => {
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      });
    });

    it('switches to Projects tab when clicked', async () => {
      renderWithProviders(<InsightsPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });
    });

    it('switches to Expenses tab when clicked', async () => {
      renderWithProviders(<InsightsPage />);
      const expensesTab = screen.getByRole('button', { name: 'Expenses' });
      fireEvent.click(expensesTab);

      // Verify tab is now active
      await waitFor(() => {
        expect(expensesTab).toHaveClass('active');
      });
    });

    it('switches to Unpaid tab when clicked', async () => {
      renderWithProviders(<InsightsPage />);
      const unpaidTab = screen.getByRole('button', { name: 'Unpaid' });
      fireEvent.click(unpaidTab);

      await waitFor(() => {
        expect(unpaidTab).toHaveClass('active');
      });
    });
  });

  describe('Summary preset', () => {
    it('shows paid income total', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByText('Paid Income')).toBeInTheDocument();
    });

    it('shows unpaid total', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByText('Unpaid Receivables')).toBeInTheDocument();
    });

    it('shows expenses total in summary table', () => {
      renderWithProviders(<InsightsPage />);
      // The Expenses row in the summary table
      const table = document.querySelector('.data-table table');
      expect(table).toBeInTheDocument();
      const rows = table!.querySelectorAll('tbody tr');
      const expensesRow = Array.from(rows).find(row => row.textContent?.includes('Expenses'));
      expect(expensesRow).toBeInTheDocument();
    });

    it('shows net calculation', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByText('Net (Paid - Expenses)')).toBeInTheDocument();
    });
  });

  describe('Clients preset', () => {
    it('shows client name column', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Clients' }));

      await waitFor(() => {
        expect(screen.getByText('Client')).toBeInTheDocument();
      });
    });

    it('shows paid income column', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Clients' }));

      await waitFor(() => {
        const headers = document.querySelectorAll('th');
        const hasPaidIncome = Array.from(headers).some(h => h.textContent === 'Paid Income');
        expect(hasPaidIncome).toBe(true);
      });
    });

    it('shows unpaid column', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Clients' }));

      await waitFor(() => {
        const headers = document.querySelectorAll('th');
        const hasUnpaid = Array.from(headers).some(h => h.textContent === 'Unpaid');
        expect(hasUnpaid).toBe(true);
      });
    });

    it('displays client data', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Clients' }));

      await waitFor(() => {
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      });
    });
  });

  describe('Projects preset', () => {
    it('shows project data', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });
    });

    it('shows received column', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

      await waitFor(() => {
        expect(screen.getByText('Received')).toBeInTheDocument();
      });
    });

    it('shows net column', async () => {
      renderWithProviders(<InsightsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Projects' }));

      await waitFor(() => {
        expect(screen.getByText('Net')).toBeInTheDocument();
      });
    });
  });

  describe('Currency mode', () => {
    it('changes currency mode when selector changes', async () => {
      renderWithProviders(<InsightsPage />);
      // Find the currency select by its options
      const selects = screen.getAllByRole('combobox');
      const currencySelect = selects.find(s => s.querySelector('option[value="USD"]'));
      expect(currencySelect).toBeInTheDocument();

      fireEvent.change(currencySelect!, { target: { value: 'USD' } });

      await waitFor(() => {
        expect(currencySelect).toHaveValue('USD');
      });
    });
  });

  describe('Cash Flow Timeline link', () => {
    it('renders Cash Flow Timeline link on Summary tab', () => {
      renderWithProviders(<InsightsPage />);
      expect(screen.getByTestId('cash-flow-timeline')).toBeInTheDocument();
    });

    it('has a link to the cash flow page', () => {
      renderWithProviders(<InsightsPage />);
      const link = screen.getByRole('link', { name: /cash flow timeline/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/money-answers');
    });
  });
});
