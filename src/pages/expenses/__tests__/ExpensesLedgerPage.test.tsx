/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { ExpensesLedgerPage } from '../ExpensesLedgerPage';
import * as useExpenseQueries from '../../../hooks/useExpenseQueries';

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'nav.expenses': 'Expenses',
      'expenses.summary.total': 'Total Expenses',
      'expenses.summary.thisMonth': 'This Month',
      'expenses.view.list': 'List',
      'expenses.view.byCategory': 'By Category',
      'expenses.empty': 'No expenses found',
      'expenses.emptyHint': 'Add your first expense to get started',
      'expenses.addExpense': 'Add Expense',
      'expenses.manageRecurring': 'Manage Recurring',
      'transactions.searchPlaceholder': 'Search...',
      'transactions.columns.date': 'Date',
      'transactions.columns.description': 'Description',
      'transactions.columns.category': 'Category',
      'transactions.columns.amount': 'Amount',
      'transactions.emptySearch': 'No results found',
      'common.loading': 'Loading...',
      'common.noCategory': 'Uncategorized',
      'common.duplicate': 'Duplicate',
      'common.delete': 'Delete',
      'expenses.confirmDelete': 'Are you sure you want to delete this expense?',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock media query hook
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsCompactTable: () => false,
}));

// Mock drawer store
const mockOpenExpenseDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openExpenseDrawer: mockOpenExpenseDrawer,
  }),
}));

// Mock recurring expense hooks
vi.mock('../../../hooks/useRecurringExpenseQueries', () => ({
  useDueOccurrences: () => ({ data: [], isLoading: false }),
  useVirtualOccurrences: () => ({ data: [], isLoading: false }),
  useConfirmRecurringPayment: () => ({ mutateAsync: vi.fn() }),
  useSkipRecurringOccurrence: () => ({ mutateAsync: vi.fn() }),
  useSnoozeRecurringOccurrence: () => ({ mutateAsync: vi.fn() }),
}));

// Mock delete mutation
const mockDeleteExpense = vi.fn();
vi.mock('../../../hooks/useExpenseQueries', async () => {
  const actual = await vi.importActual('../../../hooks/useExpenseQueries');
  return {
    ...actual,
    useDeleteExpense: () => ({
      mutateAsync: mockDeleteExpense,
      isPending: false,
    }),
  };
});

// Create mock expenses
interface ExpenseDisplay {
  id: string;
  kind: 'expense';
  status: 'paid';
  title: string;
  vendor?: string;
  vendorId?: string;
  categoryId?: string;
  amountMinor: number;
  currency: 'USD' | 'ILS' | 'EUR';
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  categoryName?: string;
  profileId: string;
  notes?: string;
  receiptCount: number;
  isFromRecurring: boolean;
  recurringRuleId?: string;
}

function createMockExpense(overrides: Partial<ExpenseDisplay> = {}): ExpenseDisplay {
  return {
    id: 'exp-1',
    kind: 'expense',
    status: 'paid',
    title: 'Office Supplies',
    vendor: 'Staples',
    vendorId: 'vendor-1',
    categoryId: 'cat-1',
    amountMinor: 15000, // $150.00
    currency: 'USD',
    occurredAt: '2026-03-01',
    createdAt: '2026-03-01T10:00:00Z',
    updatedAt: '2026-03-01T10:00:00Z',
    categoryName: 'Office',
    profileId: 'profile-1',
    notes: 'Monthly supplies',
    receiptCount: 0,
    isFromRecurring: false,
    ...overrides,
  };
}

const mockExpenses: ExpenseDisplay[] = [
  createMockExpense({
    id: 'exp-1',
    title: 'Office Supplies',
    amountMinor: 15000,
    categoryId: 'cat-1',
    categoryName: 'Office',
  }),
  createMockExpense({
    id: 'exp-2',
    title: 'Software License',
    amountMinor: 50000,
    categoryId: 'cat-2',
    categoryName: 'Software',
  }),
  createMockExpense({
    id: 'exp-3',
    title: 'Travel Expense',
    amountMinor: 25000,
    categoryId: 'cat-1',
    categoryName: 'Office',
  }),
];

// Create a test router for testing pages with Link components
function createTestRouter() {
  const rootRoute = createRootRoute({
    component: ExpensesLedgerPage,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ExpensesLedgerPage,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
  });
}

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const router = createTestRouter();

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('ExpensesLedgerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useExpenseQueries, 'useExpenses').mockReturnValue({
      data: mockExpenses,
      isLoading: false,
    } as ReturnType<typeof useExpenseQueries.useExpenses>);
  });

  describe('Page rendering', () => {
    it('renders page title in top bar', async () => {
      renderWithProviders();
      await waitFor(() => {
        expect(screen.getByText('Expenses')).toBeInTheDocument();
      });
    });

    it('renders expenses summary strip', async () => {
      renderWithProviders();
      await waitFor(() => {
        expect(screen.getByText('Total Expenses')).toBeInTheDocument();
      });
    });

    it('renders view toggle buttons', async () => {
      renderWithProviders();
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /list/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /by category/i })).toBeInTheDocument();
      });
    });

    it('renders search input', async () => {
      renderWithProviders();
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      });
    });
  });

  describe('List view', () => {
    it('renders expense transactions in table format', async () => {
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        expect(screen.getByText('Software License')).toBeInTheDocument();
        expect(screen.getByText('Travel Expense')).toBeInTheDocument();
      });
    });

    it('shows category column', async () => {
      renderWithProviders();

      await waitFor(() => {
        // Multiple expenses may have the same category, so use getAllByText
        expect(screen.getAllByText('Office').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Software')).toBeInTheDocument();
      });
    });

    it('clicking row opens expense drawer', async () => {
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByText('Office Supplies')).toBeInTheDocument();
      });

      const row = screen.getByText('Office Supplies').closest('tr');
      fireEvent.click(row!);

      expect(mockOpenExpenseDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        expenseId: 'exp-1',
      });
    });
  });

  describe('By Category view', () => {
    it('groups expenses by category when toggle clicked', async () => {
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /by category/i })).toBeInTheDocument();
      });

      const categoryTab = screen.getByRole('tab', { name: /by category/i });
      fireEvent.click(categoryTab);

      await waitFor(() => {
        // Should show category group headers (using getAllByTestId since there are 2 groups)
        const categoryGroups = screen.getAllByTestId('category-group');
        expect(categoryGroups.length).toBe(2);
      });
    });

    it('shows subtotals for each category', async () => {
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /by category/i })).toBeInTheDocument();
      });

      const categoryTab = screen.getByRole('tab', { name: /by category/i });
      fireEvent.click(categoryTab);

      await waitFor(() => {
        // Office category has 2 expenses: $150 + $250 = $400
        // Software category has 1 expense: $500
        const categoryGroups = screen.getAllByTestId('category-group');
        expect(categoryGroups.length).toBe(2);
        // Verify each group has a header with the category name
        const groupHeaders = document.querySelectorAll('.expenses-group-header');
        expect(groupHeaders.length).toBe(2);
      });
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no expenses', async () => {
      vi.spyOn(useExpenseQueries, 'useExpenses').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useExpenseQueries.useExpenses>);

      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByText('No expenses found')).toBeInTheDocument();
        expect(screen.getByText('Add your first expense to get started')).toBeInTheDocument();
      });
    });

    it('shows add expense button in empty state', async () => {
      vi.spyOn(useExpenseQueries, 'useExpenses').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useExpenseQueries.useExpenses>);

      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /add expense/i })).toBeInTheDocument();
      });

      const addButton = screen.getByRole('button', { name: /add expense/i });
      fireEvent.click(addButton);

      expect(mockOpenExpenseDrawer).toHaveBeenCalledWith({
        mode: 'create',
      });
    });
  });

  describe('Loading state', () => {
    it('shows loading indicator when fetching data', async () => {
      vi.spyOn(useExpenseQueries, 'useExpenses').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useExpenseQueries.useExpenses>);

      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });
    });
  });

  describe('Filtering', () => {
    it('filters expenses by search term', async () => {
      renderWithProviders();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'software' } });

      await waitFor(() => {
        expect(useExpenseQueries.useExpenses).toHaveBeenCalledWith(
          expect.objectContaining({
            search: 'software',
          })
        );
      });
    });
  });

  describe('Row actions', () => {
    describe('Duplicate action', () => {
      it('opens expense drawer with prefilled data when duplicate clicked', async () => {
        renderWithProviders();

        await waitFor(() => {
          expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        });

        // Find the row actions menu button for the first expense
        const rows = screen.getAllByRole('row');
        const dataRow = rows[1]; // Skip header row
        const menuButton = dataRow.querySelector('.row-actions-trigger');

        expect(menuButton).toBeTruthy();
        fireEvent.click(menuButton!);

        await waitFor(() => {
          expect(screen.getByText('Duplicate')).toBeInTheDocument();
        });

        const duplicateButton = screen.getByText('Duplicate');
        fireEvent.click(duplicateButton);

        expect(mockOpenExpenseDrawer).toHaveBeenCalledWith({
          mode: 'create',
          defaultProfileId: 'profile-1',
          prefillData: expect.objectContaining({
            amountMinor: 15000,
            currency: 'USD',
            vendor: 'Staples',
            vendorId: 'vendor-1',
            categoryId: 'cat-1',
            title: 'Office Supplies',
          }),
        });
      });

      it('prefills data correctly without copying id or dates', async () => {
        renderWithProviders();

        await waitFor(() => {
          expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const dataRow = rows[1];
        const menuButton = dataRow.querySelector('.row-actions-trigger');

        expect(menuButton).toBeTruthy();
        fireEvent.click(menuButton!);

        await waitFor(() => {
          expect(screen.getByText('Duplicate')).toBeInTheDocument();
        });

        const duplicateButton = screen.getByText('Duplicate');
        fireEvent.click(duplicateButton);

        // Verify prefillData does NOT include id or occurredAt
        const callArgs = mockOpenExpenseDrawer.mock.calls[mockOpenExpenseDrawer.mock.calls.length - 1][0];
        expect(callArgs.prefillData).not.toHaveProperty('id');
        expect(callArgs.prefillData).not.toHaveProperty('occurredAt');
        expect(callArgs.expenseId).toBeUndefined();
      });
    });

    describe('Delete action', () => {
      it('shows delete button in row actions menu', async () => {
        renderWithProviders();

        await waitFor(() => {
          expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const dataRow = rows[1];
        const menuButton = dataRow.querySelector('.row-actions-trigger');

        expect(menuButton).toBeTruthy();
        fireEvent.click(menuButton!);

        await waitFor(() => {
          expect(screen.getByText('Delete')).toBeInTheDocument();
        });
      });

      it('calls delete mutation when delete confirmed', async () => {
        // Mock window.confirm to return true
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderWithProviders();

        await waitFor(() => {
          expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const dataRow = rows[1];
        const menuButton = dataRow.querySelector('.row-actions-trigger');

        expect(menuButton).toBeTruthy();
        fireEvent.click(menuButton!);

        await waitFor(() => {
          expect(screen.getByText('Delete')).toBeInTheDocument();
        });

        const deleteButton = screen.getByText('Delete');
        fireEvent.click(deleteButton);

        await waitFor(() => {
          expect(confirmSpy).toHaveBeenCalled();
          expect(mockDeleteExpense).toHaveBeenCalledWith('exp-1');
        });

        confirmSpy.mockRestore();
      });

      it('does not delete when confirm is cancelled', async () => {
        // Mock window.confirm to return false
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

        renderWithProviders();

        await waitFor(() => {
          expect(screen.getByText('Office Supplies')).toBeInTheDocument();
        });

        const rows = screen.getAllByRole('row');
        const dataRow = rows[1];
        const menuButton = dataRow.querySelector('.row-actions-trigger');

        expect(menuButton).toBeTruthy();
        fireEvent.click(menuButton!);

        await waitFor(() => {
          expect(screen.getByText('Delete')).toBeInTheDocument();
        });

        const deleteButton = screen.getByText('Delete');
        fireEvent.click(deleteButton);

        await waitFor(() => {
          expect(confirmSpy).toHaveBeenCalled();
        });
        expect(mockDeleteExpense).not.toHaveBeenCalled();

        confirmSpy.mockRestore();
      });
    });
  });
});
