/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectDetailPage } from '../ProjectDetailPage';
import type { Project, ProjectSummary, TransactionDisplay } from '../../../types';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ projectId: 'project-1' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'common.loading': 'Loading...',
      'common.edit': 'Edit',
      'common.markPaid': 'Mark as Paid',
      'common.duplicate': 'Duplicate',
      'nav.projects': 'Projects',
      'projects.notFound': 'Project not found',
      'projects.notFoundHint': 'This project may have been deleted',
      'projects.columns.paid': 'Paid',
      'projects.columns.unpaid': 'Unpaid',
      'projects.columns.expenses': 'Expenses',
      'projects.columns.net': 'Net',
      'projects.columns.client': 'Client',
      'projects.columns.field': 'Field',
      'projects.tabs.summary': 'Summary',
      'projects.tabs.transactions': 'Transactions',
      'projects.detail.projectDetails': 'Project Details',
      'projects.detail.noTransactions': 'No transactions yet',
      'projects.detail.noTransactionsHint': 'Add your first transaction',
      'drawer.project.notes': 'Notes',
      'transactions.addTransaction': 'Add Transaction',
      'transactions.columns.date': 'Date',
      'transactions.columns.type': 'Type',
      'transactions.columns.category': 'Category',
      'transactions.columns.amount': 'Amount',
      'transactions.columns.status': 'Status',
      'transactions.type.income': 'Income',
      'transactions.type.expense': 'Expense',
      'transactions.type.receivable': 'Receivable',
      'transactions.status.paid': 'Paid',
      'transactions.status.overdue': `${params?.days || 0} days overdue`,
      'transactions.status.dueToday': 'Due today',
      'transactions.status.dueIn': `Due in ${params?.days || 0} days`,
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenIncomeDrawer = vi.fn();
const mockOpenExpenseDrawer = vi.fn();
const mockOpenProjectDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openIncomeDrawer: mockOpenIncomeDrawer,
    openExpenseDrawer: mockOpenExpenseDrawer,
    openProjectDrawer: mockOpenProjectDrawer,
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
vi.mock('../../../hooks/useQueries', async () => {
  const actual = await vi.importActual('../../../hooks/useQueries');
  return {
    ...actual,
    useBusinessProfiles: () => ({ data: [], isLoading: false }),
    useDefaultBusinessProfile: () => ({ data: null, isLoading: false }),
  };
});

// Mock income queries
const mockMarkPaidMutation = vi.fn();
vi.mock('../../../hooks/useIncomeQueries', async () => {
  const actual = await vi.importActual('../../../hooks/useIncomeQueries');
  return {
    ...actual,
    useMarkIncomePaid: () => ({
      mutate: mockMarkPaidMutation,
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

// Mock data
const mockProject: Project = {
  id: 'project-1',
  name: 'Website Redesign',
  clientId: 'client-1',
  field: 'Web Development',
  notes: 'Client wants modern design',
  profileId: 'profile-1',
  createdAt: '2026-01-01',
  updatedAt: '2026-03-01',
};

const mockSummary: ProjectSummary = {
  projectId: 'project-1',
  projectName: 'Website Redesign',
  clientId: 'client-1',
  clientName: 'Acme Corp',
  paidIncomeMinor: 500000,
  unpaidIncomeMinor: 250000,
  expensesMinor: 100000,
  netMinor: 400000,
  paidIncomeMinorUSD: 500000,
  paidIncomeMinorILS: 0,
  paidIncomeMinorEUR: 0,
  unpaidIncomeMinorUSD: 250000,
  unpaidIncomeMinorILS: 0,
  unpaidIncomeMinorEUR: 0,
  expensesMinorUSD: 100000,
  expensesMinorILS: 0,
  expensesMinorEUR: 0,
  lastActivityAt: '2026-03-10',
};

const mockTransactions: TransactionDisplay[] = [
  {
    id: 'tx-1',
    kind: 'income',
    status: 'paid',
    occurredAt: '2026-03-15',
    amountMinor: 500000,
    currency: 'USD',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    projectId: 'project-1',
    projectName: 'Website Redesign',
    notes: 'Payment received',
    paidAt: '2026-03-15',
  },
  {
    id: 'tx-2',
    kind: 'income',
    status: 'unpaid',
    occurredAt: '2026-03-10',
    amountMinor: 250000,
    currency: 'USD',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    projectId: 'project-1',
    projectName: 'Website Redesign',
    notes: 'Pending payment',
    dueDate: '2026-03-20',
  },
  {
    id: 'tx-3',
    kind: 'expense',
    status: 'paid',
    occurredAt: '2026-03-05',
    amountMinor: 100000,
    currency: 'USD',
    categoryId: 'cat-1',
    categoryName: 'Hosting',
    projectId: 'project-1',
    projectName: 'Website Redesign',
    notes: 'Server costs',
    paidAt: '2026-03-05',
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

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading and error states', () => {
    it('should show loading state', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: undefined,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Loading...')).toBeInTheDocument();
      });
    });

    it('should show not found state when project does not exist', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: undefined,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: undefined,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        const notFoundElements = screen.getAllByText('Project not found');
        expect(notFoundElements.length).toBeGreaterThan(0);
        expect(screen.getByText('This project may have been deleted')).toBeInTheDocument();
      });
    });
  });

  describe('Page rendering', () => {
    it('should render project name in title', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        const titleElements = screen.getAllByText('Website Redesign');
        expect(titleElements.length).toBeGreaterThan(0);
      });
    });

    it('should render breadcrumbs', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Projects')).toBeInTheDocument();
      });
    });

    it('should render edit button', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
    });

    it('should render summary stats', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Paid')).toBeInTheDocument();
        expect(screen.getByText('Unpaid')).toBeInTheDocument();
        expect(screen.getByText('Expenses')).toBeInTheDocument();
        expect(screen.getByText('Net')).toBeInTheDocument();
      });
    });

    it('should render tabs', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Summary')).toBeInTheDocument();
        expect(screen.getByText('Transactions')).toBeInTheDocument();
      });
    });
  });

  describe('Summary tab', () => {
    it('should show project details', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Project Details')).toBeInTheDocument();
        expect(screen.getByText('Acme Corp')).toBeInTheDocument();
        expect(screen.getByText('Web Development')).toBeInTheDocument();
      });
    });

    it('should show project notes when available', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Client wants modern design')).toBeInTheDocument();
      });
    });

    it('should show add transaction button', async () => {
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        const addButtons = screen.getAllByText('Add Transaction');
        expect(addButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Transactions tab', () => {
    it('should switch to transactions tab', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: mockTransactions,
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Transactions')).toBeInTheDocument();
      });

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        expect(screen.getByText('Date')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
      });
    });

    it('should display transactions in table', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: mockTransactions,
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        expect(screen.getByText('Hosting')).toBeInTheDocument();
      });
    });

    it('should show empty state when no transactions', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        expect(screen.getByText('No transactions yet')).toBeInTheDocument();
        expect(screen.getByText('Add your first transaction')).toBeInTheDocument();
      });
    });

    it('should show table column headers', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: mockTransactions,
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        expect(screen.getByText('Date')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
        expect(screen.getByText('Category')).toBeInTheDocument();
        expect(screen.getByText('Amount')).toBeInTheDocument();
        expect(screen.getByText('Status')).toBeInTheDocument();
      });
    });
  });

  describe('User interactions', () => {
    it('should open edit drawer when edit button is clicked', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });

      const editButton = screen.getByText('Edit');
      await user.click(editButton);

      expect(mockOpenProjectDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        projectId: 'project-1',
      });
    });

    it('should open income drawer when add transaction is clicked from summary tab', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [],
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      await waitFor(() => {
        expect(screen.getByText('Add Transaction')).toBeInTheDocument();
      });

      const addButton = screen.getByText('Add Transaction');
      await user.click(addButton);

      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({
        mode: 'create',
        defaultProjectId: 'project-1',
        defaultClientId: 'client-1',
        defaultStatus: 'earned',
      });
    });

    it('should open income drawer when clicking income transaction row', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: mockTransactions,
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        const paidElements = screen.getAllByText('Paid');
        expect(paidElements.length).toBeGreaterThan(0);
      });

      // Find the paid status badge (it has class 'status-badge paid') and click its row
      const paidElements = screen.getAllByText('Paid');
      const statusBadge = paidElements.find(el => el.className.includes('status-badge'));
      const row = statusBadge?.closest('tr');
      if (row) {
        await user.click(row);
      }

      expect(mockOpenIncomeDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        transactionId: 'tx-1',
      });
    });

    it('should open expense drawer when clicking expense transaction row', async () => {
      const user = userEvent.setup();
      const useQueries = await import('../../../hooks/useQueries');
      vi.spyOn(useQueries, 'useProject').mockReturnValue({
        data: mockProject,
        isLoading: false,
      } as any);
      vi.spyOn(useQueries, 'useProjectSummary').mockReturnValue({
        data: mockSummary,
      } as any);
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: mockTransactions,
      } as any);

      renderWithProviders(<ProjectDetailPage />);

      const transactionsTab = screen.getByText('Transactions');
      await user.click(transactionsTab);

      await waitFor(() => {
        expect(screen.getByText('Hosting')).toBeInTheDocument();
      });

      const row = screen.getByText('Hosting').closest('tr');
      if (row) {
        await user.click(row);
      }

      expect(mockOpenExpenseDrawer).toHaveBeenCalledWith({
        mode: 'edit',
        expenseId: 'tx-3',
      });
    });
  });
});
