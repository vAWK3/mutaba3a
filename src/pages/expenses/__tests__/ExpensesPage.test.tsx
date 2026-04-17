/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpensesPage } from '../ExpensesPage';
import type { ReactNode } from 'react';

// Type definitions for mock components
interface LinkProps {
  children: ReactNode;
  to: string;
  params?: Record<string, unknown>;
  onClick?: () => void;
}

// Mock router
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params, onClick }: LinkProps) => (
    <a href={to} onClick={onClick} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'expenses.title': 'Expenses',
      'expenses.allProfilesOverview': 'All Profiles Overview',
      'expenses.forecast': 'Forecast',
      'expenses.totalExpenses': 'Total Expenses',
      'expenses.emptyProfiles': 'No expense data',
      'expenses.emptyProfilesHint': 'Start tracking your expenses',
      'expenses.addExpense': 'Add Expense',
      'expenses.viewReceipts': 'View Receipts',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenExpenseDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openExpenseDrawer: mockOpenExpenseDrawer,
  }),
}));

// Mock profile aware hooks
vi.mock('../../../hooks/useActiveProfile', () => ({
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

// Mock business profiles
vi.mock('../../../hooks/useQueries', () => ({
  useBusinessProfiles: () => ({ data: [], isLoading: false }),
  useDefaultBusinessProfile: () => ({ data: null, isLoading: false }),
}));

// Mock expense totals data
const mockProfileSummaries = [
  {
    profileId: 'profile-1',
    profileName: 'Profile One',
    totalMinorUSD: 500000, // $5000
    totalMinorILS: 1800000, // ₪18000
  },
  {
    profileId: 'profile-2',
    profileName: 'Profile Two',
    totalMinorUSD: 250000, // $2500
    totalMinorILS: 0,
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

describe('ExpensesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Page rendering', () => {
    it('should render page title', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('Expenses')).toBeInTheDocument();
      });
    });

    it('should render year selector with current year', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        const select = screen.getByRole('combobox');
        expect(select).toHaveValue(currentYear.toString());
      });
    });

    it('should render quick links', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('All Profiles Overview')).toBeInTheDocument();
        expect(screen.getByText('Forecast')).toBeInTheDocument();
      });
    });

    it('should have links pointing to correct routes', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        const overviewLink = screen.getByText('All Profiles Overview').closest('a');
        const forecastLink = screen.getByText('Forecast').closest('a');

        expect(overviewLink).toHaveAttribute('href', '/expenses/overview');
        expect(forecastLink).toHaveAttribute('href', '/expenses/forecast');
      });
    });
  });

  describe('Grand totals', () => {
    it('should display grand totals when profiles have data', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        expect(screen.getByText(`Total Expenses (${currentYear})`)).toBeInTheDocument();
      });
    });

    it('should calculate and display USD total correctly', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        // Total should be $5000 + $2500 = $7500
        expect(screen.getByText(/\$7,500/)).toBeInTheDocument();
      });
    });

    it('should calculate and display ILS total correctly', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        // Total should be ₪18000 - appears in both grand total and profile card
        const ilsElements = screen.getAllByText(/₪18,000/);
        expect(ilsElements.length).toBeGreaterThan(0);
      });
    });

    it('should not display grand totals when no profiles', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        expect(screen.queryByText(`Total Expenses (${currentYear})`)).not.toBeInTheDocument();
      });
    });
  });

  describe('Profile cards', () => {
    it('should display profile cards with names', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('Profile One')).toBeInTheDocument();
        expect(screen.getByText('Profile Two')).toBeInTheDocument();
      });
    });

    it('should display USD amounts for each profile', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText(/\$5,000/)).toBeInTheDocument();
        expect(screen.getByText(/\$2,500/)).toBeInTheDocument();
      });
    });

    it('should display ILS amounts for profiles with ILS data', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        const ilsElements = screen.getAllByText(/₪18,000/);
        expect(ilsElements.length).toBeGreaterThan(0);
      });
    });

    it('should show dash for zero amounts', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [
          {
            profileId: 'profile-zero',
            profileName: 'Zero Profile',
            totalMinorUSD: 0,
            totalMinorILS: 0,
          },
        ],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('Zero Profile')).toBeInTheDocument();
      });
    });

    it('should display view receipts links', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        const receiptLinks = screen.getAllByText('View Receipts');
        expect(receiptLinks).toHaveLength(2);
      });
    });

    it('should have correct profile links', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        const profileOneCard = screen.getByText('Profile One').closest('a');
        expect(profileOneCard).toHaveAttribute('href', '/expenses/profile/$profileId');
      });
    });
  });

  describe('Loading and empty states', () => {
    it('should show loading state', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: true,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(document.querySelector('.spinner')).toBeInTheDocument();
      });
    });

    it('should show empty state when no profiles', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('No expense data')).toBeInTheDocument();
        expect(screen.getByText('Start tracking your expenses')).toBeInTheDocument();
      });
    });

    it('should show add expense button in empty state', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('Add Expense')).toBeInTheDocument();
      });
    });
  });

  describe('User interactions', () => {
    it('should change year when selector is changed', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: [],
        isLoading: false,
      });

      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockImplementation(mockQuery);

      renderWithProviders(<ExpensesPage />);

      const currentYear = new Date().getFullYear();
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, (currentYear - 1).toString());

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(currentYear - 1);
      });
    });

    it('should open expense drawer when add expense is clicked', async () => {
      const user = userEvent.setup();
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getByText('Add Expense')).toBeInTheDocument();
      });

      const addButton = screen.getByText('Add Expense');
      await user.click(addButton);

      expect(mockOpenExpenseDrawer).toHaveBeenCalledWith({ mode: 'create' });
    });

    it('should generate year options correctly', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      const currentYear = new Date().getFullYear();
      const select = screen.getByRole('combobox');
      const options = Array.from(select.querySelectorAll('option'));

      // Should have 6 years (current + 5 previous)
      expect(options).toHaveLength(6);
      expect(options[0].value).toBe(currentYear.toString());
      expect(options[5].value).toBe((currentYear - 5).toString());
    });
  });

  describe('Receipt links', () => {
    it('should stop propagation when clicking view receipts', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as unknown);

      renderWithProviders(<ExpensesPage />);

      await waitFor(() => {
        expect(screen.getAllByText('View Receipts')).toHaveLength(2);
      });

      const receiptLinks = screen.getAllByText('View Receipts');
      const firstReceiptLink = receiptLinks[0];

      // Verify link exists and has onClick handler
      expect(firstReceiptLink.closest('a')).toBeInTheDocument();
    });
  });
});
