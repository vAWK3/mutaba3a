/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IncomePage } from '../IncomePage';
import { getDateRangePreset } from '../../../lib/utils';
import type { IncomeSearch } from '../../../lib/incomeSearch';
import type { TransactionDisplay } from '../../../types';

// The URL filters (MUT-83): an in-memory stand-in for the router, so a tab
// click re-renders with the new filters as the real URL would. The URL itself
// (parse, replace) is covered by useIncomeFilters.test.tsx.
const urlFilters = vi.hoisted(() => ({
  initial: {} as Record<string, unknown>,
  writes: [] as Record<string, unknown>[],
}));
vi.mock('../../../hooks/useIncomeFilters', async () => {
  const { useState, useCallback } = await import('react');
  const { mergeIncomeSearch } = await import('../../../lib/incomeSearch');
  return {
    useIncomeFilters: () => {
      const [search, setState] = useState<IncomeSearch>(() => urlFilters.initial as IncomeSearch);
      const setSearch = useCallback((patch: Partial<IncomeSearch>) => {
        urlFilters.writes.push(patch);
        setState((prev) => mergeIncomeSearch(prev, patch));
      }, []);
      return { search, setSearch };
    },
  };
});

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
      'clients.profile.work.what': 'What',
      'common.loading': 'Loading...',
      'common.actions': 'Actions',
      'filters.period': 'Period',
      'common.noClient': 'No Client',
      'income.clientScope.none': 'No client',
      'income.clientScope.archived': 'Archived clients',
      'income.clientScope.clear': 'Clear filter: {name}',
      'common.markPaid': 'Mark as Paid',
      'common.duplicate': 'Duplicate',
      'transactions.partialPayment.editPayment': 'Edit Payment',
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
        result = result.replace(`{{${k}}}`, String(v)).replace(`{${k}}`, String(v));
      });
    }
    return result;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// SearchInput imports useT from core directly (MUT-43: the hosted bundle must
// never carry the app's full translation dictionary), so it isn't covered by
// the barrel mock above.
vi.mock('../../../lib/i18n/core', () => ({
  useT: () => (key: string) => key,
  useOptionalT: () => (key: string) => key,
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

// Mock media query: a wide table unless a test asks for the compact one
const media = vi.hoisted(() => ({ compact: false }));
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsCompactTable: () => media.compact,
}));

// Count row shaping, to prove the rows are memoized (MUT-62)
const rowShaping = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../incomeRows', async () => {
  const actual = await vi.importActual<typeof import('../incomeRows')>('../incomeRows');
  return {
    ...actual,
    toIncomeRow: (...args: Parameters<typeof actual.toIncomeRow>) => {
      rowShaping.calls += 1;
      return actual.toIncomeRow(...args);
    },
  };
});

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
    urlFilters.initial = {};
    urlFilters.writes = [];
    media.compact = false;
    rowShaping.calls = 0;
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

    it('should not count income due tomorrow as overdue (MUT-21)', async () => {
      const dueTomorrow: TransactionDisplay = {
        ...mockIncomeTransactions[1],
        id: 'tx-due-tomorrow',
        status: 'unpaid',
        dueDate: '2026-03-15',
      };

      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: [dueTomorrow],
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      await waitFor(() => {
        const overdueTab = screen.getByRole('tab', { name: /Overdue/ });
        expect(overdueTab.textContent).toContain('0');
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

    // TD-009: axe's empty-table-header and select-name fired on Income
    it('names the row-actions column and the period filter', async () => {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
        data: mockIncomeTransactions,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

      renderWithProviders(<IncomePage />);

      expect(await screen.findByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Period' })).toBeInTheDocument();
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

  describe('URL filters (MUT-83)', () => {
    const lastIncomeFilters = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls[mock.mock.calls.length - 1][0];

    async function renderWith(initial: IncomeSearch, data: TransactionDisplay[] = mockIncomeTransactions) {
      urlFilters.initial = initial as Record<string, unknown>;
      const mockUseIncome = vi.fn().mockReturnValue({ data, isLoading: false });
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);
      renderWithProviders(<IncomePage />);
      return mockUseIncome;
    }

    it('with no parameters behaves as before: this month, every status, every client', async () => {
      const mockUseIncome = await renderWith({});

      await waitFor(() => expect(mockUseIncome).toHaveBeenCalled());
      const filters = lastIncomeFilters(mockUseIncome);
      expect(filters).toMatchObject(getDateRangePreset('this-month'));
      expect(filters.status).toBeUndefined();
      expect(filters.clientScope).toBeUndefined();
      expect(screen.queryByRole('button', { name: /Clear filter/ })).not.toBeInTheDocument();
    });

    it('opens on the filters a link carries: a client scope, a status tab and a period', async () => {
      const mockUseIncome = await renderWith({ client: 'none', status: 'unpaid', ...getDateRangePreset('all') });

      await waitFor(() =>
        expect(lastIncomeFilters(mockUseIncome)).toMatchObject({
          clientScope: 'none',
          status: 'unpaid',
          ...getDateRangePreset('all'),
        })
      );
      expect(screen.getByRole('tab', { name: /Unpaid/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('names the client scope in a chip that clears it', async () => {
      const user = userEvent.setup();
      const mockUseIncome = await renderWith({ client: 'archived' });

      const chip = await screen.findByRole('button', { name: 'Clear filter: Archived clients' });
      expect(chip).toHaveTextContent('Archived clients');

      await user.click(chip);

      await waitFor(() => expect(lastIncomeFilters(mockUseIncome).clientScope).toBeUndefined());
      expect(urlFilters.writes).toContainEqual({ client: undefined });
    });

    it('writes a tab change to the URL, not to its own state', async () => {
      const user = userEvent.setup();
      await renderWith({ client: 'none' });

      await user.click(await screen.findByRole('tab', { name: /Overdue/ }));
      await user.click(screen.getByRole('tab', { name: /All/ }));

      expect(urlFilters.writes).toEqual([{ status: 'overdue' }, { status: undefined }]);
    });

    it('says nothing matched, rather than "no income yet", when a client scope finds nothing', async () => {
      await renderWith({ client: 'none' }, []);

      expect(await screen.findByText('No matching transactions')).toBeInTheDocument();
      expect(screen.queryByText('Add Income')).not.toBeInTheDocument();
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

    // MUT-169: fix a payment's date from the ledger, not just the client page
    describe('Edit Payment', () => {
      async function kebabItems(user: ReturnType<typeof userEvent.setup>, rowText: string) {
        const row = screen.getByText(rowText).closest('tr') as HTMLElement;
        await user.click(within(row).getByRole('button', { name: 'Actions' }));
        return screen.getAllByRole('menuitem').map((item) => item.textContent);
      }

      it.each([
        ['a fully paid row', 0, 'Website Redesign'],
        ['a part-paid row', 3, 'Gamma LLC'],
      ])('is offered on %s and opens the drawer to edit its payment', async (_label, index, rowText) => {
        const user = userEvent.setup();
        const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
        vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
          data: [mockIncomeTransactions[index]],
          isLoading: false,
        } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

        renderWithProviders(<IncomePage />);
        await waitFor(() => expect(screen.getByText(rowText)).toBeInTheDocument());

        expect(await kebabItems(user, rowText)).toContain('Edit Payment');
        await user.click(screen.getByRole('menuitem', { name: 'Edit Payment' }));

        expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({
          transactionId: mockIncomeTransactions[index].id,
          intent: 'editPayment',
        });
        expect(mockOpenTransactionDrawer).not.toHaveBeenCalled();
      });

      it('is not offered on a row with nothing received', async () => {
        const user = userEvent.setup();
        const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
        vi.spyOn(useIncomeQueries, 'useIncome').mockReturnValue({
          data: [mockIncomeTransactions[1]], // Beta Inc - unpaid
          isLoading: false,
        } as unknown as ReturnType<typeof useIncomeQueries.useIncome>);

        renderWithProviders(<IncomePage />);
        await waitFor(() => expect(screen.getByText('Beta Inc')).toBeInTheDocument());

        expect(await kebabItems(user, 'Beta Inc')).not.toContain('Edit Payment');
      });
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

  // MUT-62: the entry is the work record (MUT-5), so the ledger shows what was done
  describe('What column (MUT-62)', () => {
    const titled: TransactionDisplay[] = [
      { ...mockIncomeTransactions[0], title: 'Homepage copy and pricing table' },
      { ...mockIncomeTransactions[1], title: undefined }, // a legacy entry saved without a title
      { ...mockIncomeTransactions[2], title: '   ' }, // no project either
      { ...mockIncomeTransactions[3], title: 'هوية بصرية لمقهى' },
    ];

    async function renderEntries(data: TransactionDisplay[] = titled) {
      const useIncomeQueries = await import('../../../hooks/useIncomeQueries');
      const mockUseIncome = vi.fn().mockReturnValue({ data, isLoading: false });
      vi.spyOn(useIncomeQueries, 'useIncome').mockImplementation(mockUseIncome);
      renderWithProviders(<IncomePage />);
      await screen.findByText('Beta Inc');
      return mockUseIncome;
    }

    const rowOf = (text: string) => screen.getByText(text).closest('tr')!;
    const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

    it('heads the column "What", right after the date', async () => {
      await renderEntries();

      expect(headers()).toEqual(['Date', 'What', 'Client', 'Project', 'Status', 'Amount', 'Actions']);
    });

    it("shows each entry's title, an Arabic one included", async () => {
      await renderEntries();

      expect(within(rowOf('Website Redesign')).getAllByRole('cell')[1]).toHaveTextContent('Homepage copy and pricing table');
      expect(within(rowOf('Gamma LLC')).getAllByRole('cell')[1]).toHaveTextContent('هوية بصرية لمقهى');
    });

    it('shows a dash for an untitled entry and for a blank title', async () => {
      await renderEntries();

      expect(within(rowOf('Beta Inc')).getAllByRole('cell')[1]).toHaveTextContent(/^—$/);
      const blank = screen.getAllByText('Acme Corp')[1].closest('tr')!;
      expect(within(blank).getAllByRole('cell')[1]).toHaveTextContent(/^—$/);
      // Nothing to open from: the dash is plain text, not a button
      expect(within(within(blank).getAllByRole('cell')[1]).queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows the same dash for a missing project', async () => {
      await renderEntries();

      const noProject = screen.getAllByText('Acme Corp')[1].closest('tr')!;
      expect(within(noProject).getAllByRole('cell')[3]).toHaveTextContent(/^—$/);
    });

    it('makes the title a button that opens the entry once, by click or keyboard', async () => {
      const user = userEvent.setup();
      await renderEntries();

      await user.click(screen.getByRole('button', { name: 'Homepage copy and pricing table' }));
      expect(mockOpenTransactionDrawer).toHaveBeenCalledTimes(1);
      expect(mockOpenTransactionDrawer).toHaveBeenCalledWith({ mode: 'edit', transactionId: 'tx-1' });

      screen.getByRole('button', { name: 'هوية بصرية لمقهى' }).focus();
      await user.keyboard('{Enter}');
      expect(mockOpenTransactionDrawer).toHaveBeenLastCalledWith({ mode: 'edit', transactionId: 'tx-4' });
      expect(mockOpenTransactionDrawer).toHaveBeenCalledTimes(2);
    });

    it('keeps What and drops Project on a compact table, with headers and cells lined up', async () => {
      media.compact = true;
      await renderEntries();

      expect(headers()).toEqual(['Date', 'What', 'Client', 'Status', 'Amount', 'Actions']);
      for (const row of screen.getAllByRole('row').slice(1)) {
        expect(within(row).getAllByRole('cell')).toHaveLength(6);
      }
    });

    it('renders every row from the same column list as the header', async () => {
      await renderEntries();

      for (const row of screen.getAllByRole('row').slice(1)) {
        expect(within(row).getAllByRole('cell')).toHaveLength(headers().length);
      }
    });

    it('shapes the rows once per result, not on every render', async () => {
      const user = userEvent.setup();
      await renderEntries();
      expect(rowShaping.calls).toBe(titled.length);

      // A filter change re-renders the page; the (mocked) result is the same array
      await user.click(screen.getByRole('tab', { name: /Unpaid/ }));
      await waitFor(() => expect(urlFilters.writes).toContainEqual({ status: 'unpaid' }));

      expect(rowShaping.calls).toBe(titled.length);
    });
  });
});
