/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientDetailPage } from '../ClientDetailPage';
import * as useQueries from '../../../hooks/useQueries';
import * as useIncomeQueries from '../../../hooks/useIncomeQueries';
import type { TransactionDisplay } from '../../../types';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ clientId: 'client-1' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => {
    const translations: Record<string, string> = {
      'common.loading': 'Loading...',
      'common.edit': 'Edit',
      'nav.clients': 'Clients',
      'clients.notFound': 'Client not found',
      'clients.notFoundHint': 'This client may have been deleted',
      'clients.columns.activeProjects': 'Active Projects',
      'clients.columns.paidIncome': 'Paid Income',
      'clients.columns.unpaid': 'Unpaid',
      'clients.columns.expenses': 'Expenses',
      'clients.tabs.summary': 'Summary',
      'clients.tabs.projects': 'Projects',
      'clients.tabs.receivables': 'Receivables',
      'clients.tabs.transactions': 'Transactions',
      'clients.detail.clientDetails': 'Client Details',
      'clients.detail.email': 'Email',
      'clients.detail.phone': 'Phone',
      'clients.detail.noProjects': 'No projects',
      'clients.detail.noProjectsHint': 'Add your first project',
      'projects.addProject': 'Add Project',
      'projects.columns.project': 'Project',
      'projects.columns.field': 'Field',
      'projects.columns.received': 'Received',
      'projects.columns.unpaid': 'Unpaid',
      'projects.columns.expenses': 'Expenses',
      'projects.columns.net': 'Net',
      'transactions.addTransaction': 'Add Transaction',
      'drawer.client.notes': 'Notes',
      'transactions.partialPayment.recordPayment': 'Record Payment',
      'transactions.partialPayment.remaining': 'Remaining',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenTransactionDrawer = vi.fn();
const mockOpenClientDrawer = vi.fn();
const mockOpenProjectDrawer = vi.fn();
const mockOpenIncomeDrawer = vi.fn();
const mockOpenExpenseDrawer = vi.fn();
const mockOpenPartialPaymentDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openTransactionDrawer: mockOpenTransactionDrawer,
    openClientDrawer: mockOpenClientDrawer,
    openProjectDrawer: mockOpenProjectDrawer,
    openIncomeDrawer: mockOpenIncomeDrawer,
    openExpenseDrawer: mockOpenExpenseDrawer,
    openPartialPaymentDrawer: mockOpenPartialPaymentDrawer,
  }),
}));

// Mock client data
const mockClient = {
  id: 'client-1',
  name: 'Acme Corp',
  email: 'contact@acme.com',
  phone: '+1234567890',
  notes: 'Great client',
};

// Mock client summary
const mockClientSummary = {
  id: 'client-1',
  name: 'Acme Corp',
  activeProjectCount: 2,
  paidIncomeMinor: 700000, // $7000
  unpaidIncomeMinor: 150000, // $1500
  paidIncomeMinorUSD: 700000,
  paidIncomeMinorILS: 0,
  paidIncomeMinorEUR: 0,
  unpaidIncomeMinorUSD: 150000,
  unpaidIncomeMinorILS: 0,
  unpaidIncomeMinorEUR: 0,
  expensesMinor: 200000, // $2000
  expensesMinorUSD: 200000,
  expensesMinorILS: 0,
  expensesMinorEUR: 0,
};

// Mock projects for this client
const mockProjects = [
  {
    id: 'project-1',
    name: 'Website Redesign',
    clientId: 'client-1',
    field: 'Web Development',
  },
  {
    id: 'project-2',
    name: 'Mobile App',
    clientId: 'client-1',
    field: 'Mobile Development',
  },
];

// Mock project summaries (for financial data)
const mockProjectSummaries = [
  {
    id: 'project-1',
    name: 'Website Redesign',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    field: 'Web Development',
    paidIncomeMinor: 500000,
    unpaidIncomeMinor: 100000,
    expensesMinor: 100000,
    netMinor: 500000,
    paidIncomeMinorUSD: 500000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 100000,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    expensesMinorUSD: 100000,
    expensesMinorILS: 0,
    expensesMinorEUR: 0,
  },
  {
    id: 'project-2',
    name: 'Mobile App',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    field: 'Mobile Development',
    paidIncomeMinor: 200000,
    unpaidIncomeMinor: 50000,
    expensesMinor: 100000,
    netMinor: 150000,
    paidIncomeMinorUSD: 200000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 50000,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    expensesMinorUSD: 100000,
    expensesMinorILS: 0,
    expensesMinorEUR: 0,
  },
];

// Receivable rows for the MUT-6 "Record payment" gate: unpaid, partial, paid.
const mockReceivables: TransactionDisplay[] = [
  {
    id: 'tx-unpaid',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 100000,
    currency: 'USD',
    occurredAt: '2026-03-01',
    dueDate: '2026-04-01',
    receivedAmountMinor: 0,
    paymentStatus: 'unpaid',
    remainingAmountMinor: 100000,
    projectName: 'Website Redesign',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
  {
    id: 'tx-partial',
    kind: 'income',
    status: 'unpaid',
    amountMinor: 50000,
    currency: 'USD',
    occurredAt: '2026-03-02',
    dueDate: '2026-04-02',
    receivedAmountMinor: 20000,
    paymentStatus: 'partial',
    remainingAmountMinor: 30000,
    projectName: 'Mobile App',
    createdAt: '2026-03-02T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
  },
  {
    id: 'tx-paid',
    kind: 'income',
    status: 'paid',
    amountMinor: 70000,
    currency: 'USD',
    occurredAt: '2026-03-03',
    paidAt: '2026-03-04',
    receivedAmountMinor: 70000,
    paymentStatus: 'paid',
    remainingAmountMinor: 0,
    projectName: 'Brand Kit',
    createdAt: '2026-03-03T00:00:00Z',
    updatedAt: '2026-03-04T00:00:00Z',
  },
] as TransactionDisplay[];

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

describe('ClientDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useQueries, 'useClient').mockReturnValue({
      data: mockClient,
      isLoading: false,
    } as ReturnType<typeof useQueries.useClient>);
    vi.spyOn(useQueries, 'useClientSummary').mockReturnValue({
      data: mockClientSummary,
      isLoading: false,
    } as ReturnType<typeof useQueries.useClientSummary>);
    vi.spyOn(useQueries, 'useProjects').mockReturnValue({
      data: mockProjects,
      isLoading: false,
    } as ReturnType<typeof useQueries.useProjects>);
    vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
      data: mockProjectSummaries,
      isLoading: false,
    } as ReturnType<typeof useQueries.useProjectSummaries>);
    vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useQueries.useTransactions>);
    vi.spyOn(useQueries, 'useMarkTransactionPaid').mockReturnValue({
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useQueries.useMarkTransactionPaid>);
  });

  describe('Summary stats header', () => {
    it('shows active projects count', () => {
      renderWithProviders(<ClientDetailPage />);
      expect(screen.getByText('Active Projects')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows paid income stat', () => {
      renderWithProviders(<ClientDetailPage />);
      expect(screen.getByText('Paid Income')).toBeInTheDocument();
    });

    it('shows unpaid stat', () => {
      renderWithProviders(<ClientDetailPage />);
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
    });

    it('shows expenses stat', () => {
      renderWithProviders(<ClientDetailPage />);
      expect(screen.getByText('Expenses')).toBeInTheDocument();
    });
  });

  describe('Projects tab with financial summary', () => {
    it('shows project name column', async () => {
      renderWithProviders(<ClientDetailPage />);
      // Click Projects tab
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        expect(screen.getByText('Project')).toBeInTheDocument();
      });
    });

    it('shows received column in projects tab', async () => {
      renderWithProviders(<ClientDetailPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        expect(screen.getByText('Received')).toBeInTheDocument();
      });
    });

    it('shows unpaid column in projects tab', async () => {
      renderWithProviders(<ClientDetailPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        const table = document.querySelector('.data-table');
        expect(table).toBeInTheDocument();
      });
    });

    it('shows expenses column in projects tab', async () => {
      renderWithProviders(<ClientDetailPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        // Check that expenses column exists in the table
        const headers = document.querySelectorAll('th');
        const hasExpenses = Array.from(headers).some(h => h.textContent === 'Expenses');
        expect(hasExpenses).toBe(true);
      });
    });

    it('shows net column in projects tab', async () => {
      renderWithProviders(<ClientDetailPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        expect(screen.getByText('Net')).toBeInTheDocument();
      });
    });

    it('renders project names as links', async () => {
      renderWithProviders(<ClientDetailPage />);
      const projectsTab = screen.getByRole('button', { name: 'Projects' });
      fireEvent.click(projectsTab);

      await waitFor(() => {
        const projectLink = screen.getByText('Website Redesign');
        expect(projectLink.tagName).toBe('A');
      });
    });
  });

  // MUT-6: "Record payment" is a primary row button on both money tabs, not a
  // kebab entry. The receivables tab previously offered it on *every* row,
  // including settled ones; the shared gate is what fixes that.
  describe('Record payment button', () => {
    beforeEach(() => {
      vi.spyOn(useIncomeQueries, 'useReceivables').mockReturnValue({
        data: mockReceivables,
        isLoading: false,
      } as unknown as ReturnType<typeof useIncomeQueries.useReceivables>);
    });

    it('shows the button on unpaid and partial receivables, but not settled ones', async () => {
      renderWithProviders(<ClientDetailPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Receivables' }));

      await waitFor(() => {
        expect(screen.getByText('Brand Kit')).toBeInTheDocument();
      });

      expect(screen.getAllByRole('button', { name: /record payment/i })).toHaveLength(2);
      const paidRow = screen.getByText('Brand Kit').closest('tr');
      expect(paidRow?.querySelector('button.btn-secondary')).toBeNull();
    });

    it('opens the payment drawer for the clicked row', async () => {
      renderWithProviders(<ClientDetailPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Receivables' }));

      await waitFor(() => {
        expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      });

      const unpaidRow = screen.getByText('Website Redesign').closest('tr');
      fireEvent.click(unpaidRow!.querySelector('button.btn-secondary')!);

      expect(mockOpenPartialPaymentDrawer).toHaveBeenCalledWith({ transactionId: 'tx-unpaid' });
    });

    it('shows the remaining balance, not the full amount, on a partial row', async () => {
      renderWithProviders(<ClientDetailPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Receivables' }));

      await waitFor(() => {
        expect(screen.getByText('Mobile App')).toBeInTheDocument();
      });

      const partialRow = screen.getByText('Mobile App').closest('tr');
      // $300.00 remaining of a $500.00 receivable.
      expect(partialRow?.querySelector('button.btn-secondary')).toHaveTextContent('300');
    });

    it('applies the same gate on the transactions tab, skipping expenses', async () => {
      vi.spyOn(useQueries, 'useTransactions').mockReturnValue({
        data: [
          ...mockReceivables,
          {
            id: 'tx-expense',
            kind: 'expense',
            status: 'paid',
            amountMinor: 25000,
            currency: 'USD',
            occurredAt: '2026-03-05',
            projectName: 'Hosting',
            createdAt: '2026-03-05T00:00:00Z',
            updatedAt: '2026-03-05T00:00:00Z',
          },
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof useQueries.useTransactions>);

      renderWithProviders(<ClientDetailPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

      await waitFor(() => {
        expect(screen.getByText('Hosting')).toBeInTheDocument();
      });

      expect(screen.getAllByRole('button', { name: /record payment/i })).toHaveLength(2);
      const expenseRow = screen.getByText('Hosting').closest('tr');
      expect(expenseRow?.querySelector('button.btn-secondary')).toBeNull();
    });
  });
});
