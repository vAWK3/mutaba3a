/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncomePage } from '../IncomePage';
import type { TransactionDisplay } from '../../../types';

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'nav.income': 'Income',
      'income.summary.received': 'Received',
      'income.summary.unpaid': 'Unpaid',
      'income.status.all': 'All',
      'income.status.unpaid': 'Unpaid',
      'income.status.received': 'Received',
      'income.status.overdue': 'Overdue',
      'income.empty': 'No income transactions',
      'income.emptyHint': 'Add your first income transaction',
      'income.addIncome': 'Add Income',
      'transactions.searchPlaceholder': 'Search transactions...',
      'transactions.emptySearch': 'No matching transactions',
      'transactions.columns.date': 'Date',
      'transactions.columns.client': 'Client',
      'transactions.columns.project': 'Project',
      'transactions.columns.status': 'Status',
      'transactions.columns.amount': 'Amount',
      'common.loading': 'Loading...',
      'common.noClient': 'No Client',
      'common.markPaid': 'Mark as Paid',
      'common.duplicate': 'Duplicate',
      'transactions.status.paid': 'Paid',
      'transactions.status.unpaid': 'Unpaid',
      'transactions.status.partial': 'Partial ({{percent}}%)',
      'transactions.partialPayment.received': 'Received',
      'transactions.partialPayment.recordPayment': 'Record Payment',
      'transactions.partialPayment.remaining': 'Remaining',
    };
    let result = translations[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{{${k}}}`, String(v));
      });
    }
    return result;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenTransactionDrawer = vi.fn();
const mockOpenPartialPaymentDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openTransactionDrawer: mockOpenTransactionDrawer,
    openPartialPaymentDrawer: mockOpenPartialPaymentDrawer,
  }),
}));

// Mock media query
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsCompactTable: () => false,
}));

// Mock profile aware hooks
vi.mock('../../../hooks/useActiveProfile', () => ({
  useProfileFilter: () => 'profile-1',
  useActiveProfile: () => ({
    activeProfileId: null,
    setActiveProfile: vi.fn(),
    profilesLoading: false,
  }),
}));

vi.mock('../../../hooks/useProfileAwareAction', () => ({
  useProfileAwareAction: () => ({
    executeAction: vi.fn(),
  }),
}));

// Mock overview totals
const mockTotals = {
  USD: {
    paidIncomeMinor: 500000,
    unpaidIncomeMinor: 400000,
    expensesMinor: 0,
    netMinor: 500000,
  },
  ILS: {
    paidIncomeMinor: 0,
    unpaidIncomeMinor: 0,
    expensesMinor: 0,
    netMinor: 0,
  },
};

const mockUseOverviewTotalsByCurrency = vi.fn(() => ({
  data: mockTotals,
  isLoading: false,
}));

vi.mock('../../../hooks/useQueries', () => ({
  useOverviewTotalsByCurrency: (...args: unknown[]) => mockUseOverviewTotalsByCurrency(...args),
  useBusinessProfiles: () => ({ data: [], isLoading: false }),
  useDefaultBusinessProfile: () => ({ data: null, isLoading: false }),
}));

// Mock income queries
const mockMarkPaidMutation = vi.fn();
vi.mock('../../../hooks/useIncomeQueries', async () => {
  const actual = await vi.importActual('../../../hooks/useIncomeQueries');
  return {
    ...actual,
    useMarkIncomePaid: () => ({
      mutateAsync: mockMarkPaidMutation,
      isPending: false,
    }),
  };
});

// Mock income transactions data
const mockIncomeTransactions: TransactionDisplay[] = [
  {
    id: 'tx-1',
    kind: 'income',
    status: 'paid',
    occurredAt: '2026-03-15',
    amountMinor: 500000, // $5000
    currency: 'USD',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    projectId: 'project-1',
    projectName: 'Website Redesign',
    notes: 'First payment',
    dueDate: undefined,
    paidAt: '2026-03-15',
    receivedAmountMinor: 500000,
    paymentStatus: 'paid',
    remainingAmountMinor: 0,
    createdAt: '2026-03-15T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
  },
  {
    id: 'tx-2',
    kind: 'income',
    status: 'unpaid',
    occurredAt: '2026-03-10',
    amountMinor: 250000, // $2500
    currency: 'USD',
    clientId: 'client-2',
    clientName: 'Beta Inc',
    projectId: 'project-2',
    projectName: 'Mobile App',
    notes: 'Payment pending',
    dueDate: '2026-03-20',
    paidAt: undefined,
    receivedAmountMinor: 0,
    paymentStatus: 'unpaid',
    remainingAmountMinor: 250000,
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-10T00:00:00Z',
  },
  {
    id: 'tx-3',
    kind: 'income',
    status: 'unpaid',
    occurredAt: '2026-02-15',
    amountMinor: 150000, // $1500
    currency: 'USD',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    projectId: undefined,
    projectName: undefined,
    notes: 'Overdue invoice',
    dueDate: '2026-03-01', // Overdue
    paidAt: undefined,
    receivedAmountMinor: 0,
    paymentStatus: 'unpaid',
    remainingAmountMinor: 150000,
    createdAt: '2026-02-15T00:00:00Z',
    updatedAt: '2026-02-15T00:00:00Z',
    daysOverdue: 13,
  },
  {
    id: 'tx-4',
    kind: 'income',
    status: 'unpaid',
    occurredAt: '2026-03-05',
    amountMinor: 300000, // $3000
    currency: 'USD',
    clientId: 'client-3',
    clientName: 'Gamma LLC',
    projectId: 'project-3',
    projectName: 'API Integration',
    notes: 'Partial payment received',
    dueDate: '2026-03-25',
    paidAt: undefined,
    receivedAmountMinor: 100000, // $1000 received
    paymentStatus: 'partial',
    remainingAmountMinor: 200000, // $2000 remaining
    createdAt: '2026-03-05T00:00:00Z',
    updatedAt: '2026-03-12T00:00:00Z',
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

/**
 * The fixtures above are dated relative to this instant -- tx-3 is 13 days
 * past its 2026-03-01 due date, which is what `daysOverdue: 13` encodes.
 *
 * Pinning the clock is required, not cosmetic: the overdue tab count is
 * computed from "today", so without a fixed clock this suite silently rots as
 * the calendar advances. It did: every unpaid fixture fell into the past and
 * the count became 3 instead of 1 (MUT-17, MUT-21).
 */
const FIXED_NOW = new Date(2026, 2, 14, 12, 0, 0); // 2026-03-14 12:00 local

describe('IncomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // shouldAdvanceTime keeps Testing Library's waitFor from deadlocking.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Page rendering', () => {
    it('should pass active profile to totals and income queries', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      const useIncomeSpy = vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(useIncomeSpy).toHaveBeenCalled();
        expect(mockUseOverviewTotalsByCurrency).toHaveBeenCalled();
      });

      expect(useIncomeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: 'profile-1' })
      );
      expect(mockUseOverviewTotalsByCurrency).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'profile-1'
      );
    });

    it('should render page title in top bar', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Income')).toBeInTheDocument();
      });
    });

    it('should render summary strip with received and unpaid labels', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const receivedElements = screen.getAllByText('Received');
        const unpaidElements = screen.getAllByText('Unpaid');
        // Should find at least one of each (in summary strip and tabs)
        expect(receivedElements.length).toBeGreaterThan(0);
        expect(unpaidElements.length).toBeGreaterThan(0);
      });
    });

    it('should render status tabs', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /All/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Unpaid/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Received/ })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Overdue/ })).toBeInTheDocument();
      });
    });

    it('should show correct counts in status tabs', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        // All: 4, Unpaid: 3, Received: 1, Overdue: 1.
        // Only tx-3 (due 2026-03-01) is past the pinned 2026-03-14 clock;
        // tx-2 (03-20) and tx-4 (03-25) are still in the future.
        const allTab = screen.getByRole('tab', { name: /All/ });
        const unpaidTab = screen.getByRole('tab', { name: /Unpaid/ });
        const receivedTab = screen.getByRole('tab', { name: /Received/ });
        const overdueTab = screen.getByRole('tab', { name: /Overdue/ });

        expect(allTab.textContent).toContain('4');
        expect(unpaidTab.textContent).toContain('3');
        expect(receivedTab.textContent).toContain('1');
        expect(overdueTab.textContent).toContain('1');
      });
    });

    // MUT-17: the badge used to compare a date-only string against the current
    // instant, so an invoice due TODAY was counted overdue while the repository's
    // 'overdue' filter excluded it -- badge said 1, the list it opened showed 0.
    it('should not count income due today as overdue', async () => {
      const dueToday: TransactionDisplay = {
        ...mockIncomeTransactions[1],
        id: 'tx-due-today',
        status: 'unpaid',
        dueDate: '2026-03-14', // the pinned "today"
      };

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [dueToday],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const overdueTab = screen.getByRole('tab', { name: /Overdue/ });
        expect(overdueTab.textContent).toContain('0');
      });
    });

    it('should count income due yesterday as overdue', async () => {
      const dueYesterday: TransactionDisplay = {
        ...mockIncomeTransactions[1],
        id: 'tx-due-yesterday',
        status: 'unpaid',
        dueDate: '2026-03-13',
      };

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [dueYesterday],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const overdueTab = screen.getByRole('tab', { name: /Overdue/ });
        expect(overdueTab.textContent).toContain('1');
      });
    });

    it('should render search input', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search transactions...')).toBeInTheDocument();
      });
    });
  });

  describe('Transaction list', () => {
    it('should display income transactions in table', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const acmeElements = screen.getAllByText('Acme Corp');
        expect(acmeElements.length).toBeGreaterThan(0); // Acme Corp appears twice in mock data
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
        expect(screen.getByText('Mobile App')).toBeInTheDocument();
      });
    });

    it('should show table column headers', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Date')).toBeInTheDocument();
        expect(screen.getByText('Client')).toBeInTheDocument();
        expect(screen.getByText('Project')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
        expect(screen.getByText('Amount')).toBeInTheDocument();
      });
    });

    it('should show loading state', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: true,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });
    });

    it('should show empty state when no transactions', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('No income transactions')).toBeInTheDocument();
        expect(screen.getByText('Add your first income transaction')).toBeInTheDocument();
      });
    });
  });

  describe('User interactions', () => {
    it('should open transaction drawer when row is clicked', async () => {
      const user = userEvent.setup();
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const row = screen.getByText('Website Redesign').closest('tr');
      if (row) {
        await user.click(row);
      }

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        transactionId: 'tx-1',
      });
    });

    it('should filter by search term', async () => {
      const user = userEvent.setup();
      const mockUseIncome = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);

      renderWithProviders(<IncomePage />);

      const searchInput = screen.getByPlaceholderText('Search transactions...');
      await user.type(searchInput, 'Acme');

      await waitFor(() => {
        const calls = mockUseIncome.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].search).toBe('Acme');
      });
    });

    it('should switch to unpaid tab', async () => {
      const user = userEvent.setup();
      const mockUseIncome = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Unpaid/ })).toBeInTheDocument();
      });

      const unpaidTab = screen.getByRole('tab', { name: /Unpaid/ });
      await user.click(unpaidTab);

      await waitFor(() => {
        const calls = mockUseIncome.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].status).toBe('unpaid');
      });
    });

    it('should switch to received tab', async () => {
      const user = userEvent.setup();
      const mockUseIncome = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Received/ })).toBeInTheDocument();
      });

      const receivedTab = screen.getByRole('tab', { name: /Received/ });
      await user.click(receivedTab);

      await waitFor(() => {
        const calls = mockUseIncome.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].status).toBe('paid');
      });
    });

    it('should switch to overdue tab', async () => {
      const user = userEvent.setup();
      const mockUseIncome = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Overdue/ })).toBeInTheDocument();
      });

      const overdueTab = screen.getByRole('tab', { name: /Overdue/ });
      await user.click(overdueTab);

      await waitFor(() => {
        const calls = mockUseIncome.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].status).toBe('overdue');
      });
    });

    it('should open add income drawer from empty state', async () => {
      const user = userEvent.setup();
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Add Income')).toBeInTheDocument();
      });

      const addButton = screen.getByText('Add Income');
      await user.click(addButton);

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'create',
        defaultStatus: 'earned',
      });
    });
  });

  describe('Empty search state', () => {
    it('should show different empty message when search has no results', async () => {
      const user = userEvent.setup();
      const mockUseIncome = vi.fn();

      // First render - no search, no data
      mockUseIncome.mockReturnValue({
        data: [],
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);

      renderWithProviders(<IncomePage />);

      const searchInput = screen.getByPlaceholderText('Search transactions...');
      await user.type(searchInput, 'NonexistentClient');

      await waitFor(() => {
        expect(screen.getByText('No matching transactions')).toBeInTheDocument();
      });
    });
  });

  describe('Partial Payments', () => {
    it('should display PaymentStatusBadge for transactions with payment status', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        // Should show "Paid" badge
        expect(screen.getByText('Paid')).toBeInTheDocument();
        // Should show "Partial" badge with percentage
        expect(screen.getByText(/Partial \(33%\)/)).toBeInTheDocument();
      });
    });

    it('should display received amount for partial payments', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        // Should show "Received: $1,000.00" for partial payment transaction
        const receivedElements = screen.getAllByText((content, element) => {
          return element?.textContent?.includes('Received') && element.textContent.includes('$') || false;
        });
        expect(receivedElements.length).toBeGreaterThan(0);
      });
    });

    // MUT-6: "Record payment" is a primary row button, not a kebab entry.
    it('should show a "Record Payment" button on an unpaid row', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [mockIncomeTransactions[1]], // Beta Inc - unpaid
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
      });

      const betaRow = screen.getByText('Beta Inc').closest('tr');
      const button = betaRow?.querySelector('button.btn-secondary');
      expect(button).toBeInTheDocument();
      // The remaining balance is visible at the point of action: $2,500.00
      expect(button).toHaveTextContent('Record Payment');
      expect(button).toHaveTextContent('2,500');
    });

    it('should open the partial payment drawer in one click from the row', async () => {
      const user = userEvent.setup();
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [mockIncomeTransactions[1]], // Beta Inc - unpaid
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /record payment/i }));

      expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({ transactionId: 'tx-2' });
      // The row's own click handler must not also fire and open the edit drawer.
      expect(mockOpenTransactionDrawer).not.toHaveBeenCalled();
    });

    it('should show the button on a partially paid row, with the remaining balance', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [mockIncomeTransactions[3]], // Gamma LLC - partial, $2000 remaining
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Gamma LLC')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /record payment/i })).toHaveTextContent('2,000');
    });

    it('should not show the button for fully paid transactions', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [mockIncomeTransactions[0]], // Acme Corp - paid
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /record payment/i })).not.toBeInTheDocument();
    });

    it('should show the button on exactly the rows the kebab gate used to show it on', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Beta Inc')).toBeInTheDocument();
      });

      // tx-2, tx-3 unpaid and tx-4 partial -- but not tx-1, which is paid.
      expect(screen.getAllByRole('button', { name: /record payment/i })).toHaveLength(3);
      const paidRow = screen.getByText('Website Redesign').closest('tr');
      expect(paidRow?.querySelector('button.btn-secondary')).toBeNull();
    });

    it('should show correct payment status for partial payment', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [mockIncomeTransactions[3]], // Gamma LLC - partial payment
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        // Should show "Partial (33%)" - $1000 out of $3000
        expect(screen.getByText(/Partial \(33%\)/)).toBeInTheDocument();
        expect(screen.getByText('Gamma LLC')).toBeInTheDocument();
      });
    });
  });

  describe('Row interactions', () => {
    it('should open transaction drawer when row is clicked', async () => {
      const user = userEvent.setup();
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const row = screen.getByText('Website Redesign').closest('tr');
      await user.click(row!);

      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        transactionId: 'tx-1',
      });
    });

    it('should handle duplicate action', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      // Verify duplicate action is available through row actions
      const row = screen.getByText('Website Redesign').closest('tr');
      expect(row).toBeInTheDocument();
    });
  });

  describe('Date range control', () => {
    it('should update filters when date range changes', async () => {
      const mockQuery = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockQuery);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const dateInputs = screen.getAllByRole('textbox');
        expect(dateInputs.length).toBeGreaterThan(0);
      });

      // Verify that income query is called
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe('Additional status filters', () => {
    it('should filter by overdue status', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockQuery);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        expect(screen.getByText('Overdue')).toBeInTheDocument();
      });

      const overdueTab = screen.getByText('Overdue');
      await user.click(overdueTab);

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toHaveProperty('status', 'overdue');
      });
    });

    it('should show all transactions when All status selected', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockQuery);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const allTabs = screen.getAllByText('All');
        expect(allTabs.length).toBeGreaterThan(0);
      });

      const allTabs = screen.getAllByText('All');
      await user.click(allTabs[0]);

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].status).toBeUndefined();
      });
    });
  });

  describe('Search functionality', () => {
    it('should update search filter when typing', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockQuery);

      renderWithProviders(<IncomePage />);

      const searchInput = await screen.findByPlaceholderText('Search transactions...');
      await user.type(searchInput, 'Website');

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toHaveProperty('search', 'Website');
      });
    });

    it('should clear search when input is cleared', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      });

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockQuery);

      renderWithProviders(<IncomePage />);

      const searchInput = await screen.findByPlaceholderText('Search transactions...');
      await user.type(searchInput, 'test');
      await user.clear(searchInput);

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0].search).toBeUndefined();
      });
    });
  });
});
