/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExpensesOverviewPage } from '../ExpensesOverviewPage';
import type { ProfileExpenseSummary } from '../../../types';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: any) => (
    <a href={to} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'nav.expenses': 'Expenses',
      'expenses.overview.title': 'Expenses Overview',
      'expenses.overview.totalExpenses': 'Total Expenses',
      'expenses.overview.monthlyBreakdown': 'Monthly Breakdown',
      'expenses.overview.byProfile': 'By Profile',
      'expenses.overview.noProfiles': 'No profile data available',
      'expenses.overview.profile': 'Profile',
      'expenses.overview.total': 'Total',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
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

// Mock expense data with monthly breakdown
const mockProfileSummaries: ProfileExpenseSummary[] = [
  {
    profileId: 'profile-1',
    profileName: 'Profile One',
    totalMinorUSD: 600000, // $6000
    totalMinorILS: 2000000, // ₪20000
    monthlyBreakdown: [
      { month: 1, totalMinorUSD: 50000, totalMinorILS: 0 },
      { month: 2, totalMinorUSD: 100000, totalMinorILS: 200000 },
      { month: 3, totalMinorUSD: 150000, totalMinorILS: 400000 },
      { month: 4, totalMinorUSD: 50000, totalMinorILS: 200000 },
      { month: 5, totalMinorUSD: 100000, totalMinorILS: 300000 },
      { month: 6, totalMinorUSD: 75000, totalMinorILS: 400000 },
      { month: 7, totalMinorUSD: 25000, totalMinorILS: 200000 },
      { month: 8, totalMinorUSD: 0, totalMinorILS: 100000 },
      { month: 9, totalMinorUSD: 25000, totalMinorILS: 100000 },
      { month: 10, totalMinorUSD: 15000, totalMinorILS: 50000 },
      { month: 11, totalMinorUSD: 5000, totalMinorILS: 25000 },
      { month: 12, totalMinorUSD: 5000, totalMinorILS: 25000 },
    ],
  },
  {
    profileId: 'profile-2',
    profileName: 'Profile Two',
    totalMinorUSD: 300000, // $3000
    totalMinorILS: 0,
    monthlyBreakdown: [
      { month: 1, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 2, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 3, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 4, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 5, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 6, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 7, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 8, totalMinorUSD: 0, totalMinorILS: 0 },
      { month: 9, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 10, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 11, totalMinorUSD: 25000, totalMinorILS: 0 },
      { month: 12, totalMinorUSD: 25000, totalMinorILS: 0 },
    ],
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

describe('ExpensesOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Page rendering', () => {
    it('should render page title', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const elements = screen.getAllByText('Expenses Overview');
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('should render breadcrumbs', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('Expenses')).toBeInTheDocument();
      });
    });

    it('should render year selector with current year', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        const select = screen.getByRole('combobox');
        expect(select).toHaveValue(currentYear.toString());
      });
    });

    it('should have 6 year options', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const select = screen.getByRole('combobox');
        const options = select.querySelectorAll('option');
        expect(options).toHaveLength(6);
      });
    });
  });

  describe('Loading state', () => {
    it('should show loading spinner when data is loading', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: true,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(document.querySelector('.spinner')).toBeInTheDocument();
      });
    });

    it('should hide content when loading', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: true,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.queryByText('Monthly Breakdown')).not.toBeInTheDocument();
      });
    });
  });

  describe('Grand total section', () => {
    it('should display grand total header', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      const currentYear = new Date().getFullYear();
      await waitFor(() => {
        expect(screen.getByText(`Total Expenses (${currentYear})`)).toBeInTheDocument();
      });
    });

    it('should display currency summary popup for grand total', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        // Should have the grand total component
        expect(document.querySelector('.overview-grand-total')).toBeInTheDocument();
      });
    });
  });

  describe('Monthly breakdown chart', () => {
    it('should display monthly breakdown header', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('Monthly Breakdown (USD)')).toBeInTheDocument();
      });
    });

    it('should render 12 month bars', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const bars = document.querySelectorAll('.chart-bar');
        expect(bars).toHaveLength(12);
      });
    });

    it('should display month labels', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const labels = document.querySelectorAll('.chart-bar-label');
        expect(labels).toHaveLength(12);
      });
    });

    it('should show dash for months with zero expenses', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        // Month 8 has 0 USD expenses (only ILS), should show "-"
        const values = document.querySelectorAll('.chart-bar-value');
        const hasEmptyMonth = Array.from(values).some(v => v.textContent === '-');
        expect(hasEmptyMonth).toBe(true);
      });
    });

    it('should calculate monthly totals correctly across profiles', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        // Month 1: Profile 1 has $500, Profile 2 has $250 = $750 total
        const elements = screen.getAllByText(/\$750/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Profile breakdown table', () => {
    it('should display profile breakdown header', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('By Profile')).toBeInTheDocument();
      });
    });

    it('should display table headers', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('Profile')).toBeInTheDocument();
        expect(screen.getAllByText('USD').length).toBeGreaterThan(0);
        expect(screen.getAllByText('ILS').length).toBeGreaterThan(0);
      });
    });

    it('should display all profiles', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('Profile One')).toBeInTheDocument();
        expect(screen.getByText('Profile Two')).toBeInTheDocument();
      });
    });

    it('should sort profiles by total amount descending', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const tbody = document.querySelector('tbody');
        const rows = tbody?.querySelectorAll('tr');
        expect(rows).toHaveLength(2);
        // Profile One should be first (higher total)
        expect(rows![0].textContent).toContain('Profile One');
        expect(rows![1].textContent).toContain('Profile Two');
      });
    });

    it('should display USD amounts for each profile', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText(/\$6,000/)).toBeInTheDocument();
        expect(screen.getByText(/\$3,000/)).toBeInTheDocument();
      });
    });

    it('should display ILS amounts for profiles with ILS data', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const elements = screen.getAllByText(/₪20,000/);
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('should show dash for zero ILS amounts', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const tbody = document.querySelector('tbody');
        const profileTwoRow = Array.from(tbody?.querySelectorAll('tr') || []).find(
          row => row.textContent?.includes('Profile Two')
        );
        expect(profileTwoRow?.textContent).toContain('-');
      });
    });

    it('should have clickable profile links', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const profileLink = screen.getByText('Profile One').closest('a');
        expect(profileLink).toHaveAttribute('href', '/expenses/profile/$profileId');
      });
    });

    it('should display footer totals row', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const tfoot = document.querySelector('tfoot');
        expect(tfoot).toBeInTheDocument();
        expect(tfoot?.textContent).toContain('Total');
      });
    });

    it('should calculate correct total USD in footer', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        // Total: $6000 + $3000 = $9000
        expect(screen.getByText(/\$9,000/)).toBeInTheDocument();
      });
    });

    it('should show empty state when no profiles', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('No profile data available')).toBeInTheDocument();
      });
    });
  });

  describe('User interactions', () => {
    it('should change year when selector is changed', async () => {
      const user = userEvent.setup();
      const mockQuery = vi.fn().mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      });

      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockImplementation(mockQuery);

      renderWithProviders(<ExpensesOverviewPage />);

      const currentYear = new Date().getFullYear();
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, (currentYear - 1).toString());

      await waitFor(() => {
        const calls = mockQuery.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(currentYear - 1);
      });
    });

    it('should update month labels when year changes', async () => {
      const user = userEvent.setup();
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: mockProfileSummaries,
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(document.querySelectorAll('.chart-bar-label')).toHaveLength(12);
      });

      const currentYear = new Date().getFullYear();
      const select = screen.getByRole('combobox');
      await user.selectOptions(select, (currentYear - 1).toString());

      await waitFor(() => {
        // Month labels should still be 12
        expect(document.querySelectorAll('.chart-bar-label')).toHaveLength(12);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle profiles with only ILS amounts', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [
          {
            profileId: 'profile-ils',
            profileName: 'ILS Only Profile',
            totalMinorUSD: 0,
            totalMinorILS: 500000,
            monthlyBreakdown: Array.from({ length: 12 }, (_, i) => ({
              month: i + 1,
              totalMinorUSD: 0,
              totalMinorILS: 50000,
            })),
          },
        ],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('ILS Only Profile')).toBeInTheDocument();
      });
    });

    it('should handle zero expenses correctly', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [
          {
            profileId: 'profile-zero',
            profileName: 'Zero Profile',
            totalMinorUSD: 0,
            totalMinorILS: 0,
            monthlyBreakdown: Array.from({ length: 12 }, (_, i) => ({
              month: i + 1,
              totalMinorUSD: 0,
              totalMinorILS: 0,
            })),
          },
        ],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        expect(screen.getByText('Zero Profile')).toBeInTheDocument();
      });
    });

    it('should handle single profile correctly', async () => {
      const useExpenseQueries = await import('../../../hooks/useExpenseQueries');
      vi.spyOn(useExpenseQueries, 'useAllProfilesExpenseTotals').mockReturnValue({
        data: [mockProfileSummaries[0]],
        isLoading: false,
      } as any);

      renderWithProviders(<ExpensesOverviewPage />);

      await waitFor(() => {
        const tbody = document.querySelector('tbody');
        const rows = tbody?.querySelectorAll('tr');
        expect(rows).toHaveLength(1);
      });
    });
  });
});
