/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectsPage } from '../ProjectsPage';
import * as useQueries from '../../../hooks/useQueries';

// Mock router
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, params }: { children: React.ReactNode; to: string; params?: Record<string, string> }) => (
    <a href={`${to}/${params?.projectId || ''}`}>{children}</a>
  ),
}));

// Mock i18n
vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    const translations: Record<string, string> = {
      'projects.title': 'Projects',
      'projects.searchPlaceholder': 'Search projects...',
      'projects.empty': 'No projects found',
      'projects.emptySearch': 'No matching projects',
      'projects.emptyHint': 'Add your first project',
      'projects.addProject': 'Add Project',
      'projects.columns.project': 'Project',
      'projects.columns.client': 'Client',
      'projects.columns.field': 'Field',
      'projects.columns.received': 'Received',
      'projects.columns.unpaid': 'Unpaid',
      'projects.columns.expenses': 'Expenses',
      'projects.columns.net': 'Net',
      'projects.columns.lastActivity': 'Last Activity',
      'projects.summary.projectsCount': `${params?.count || 0} projects`,
      'projects.summary.projectsCountOne': '1 project',
      'projects.summary.totalReceived': 'Total Received',
      'projects.summary.totalUnpaid': 'Total Unpaid',
      'projects.summary.totalExpenses': 'Total Expenses',
      'projects.summary.totalNet': 'Total Net',
    };
    return translations[key] || key;
  },
  useLanguage: () => ({ language: 'en' }),
  useDirection: () => 'ltr',
  getLocale: () => 'en-US',
}));

// Mock drawer store
const mockOpenProjectDrawer = vi.fn();
vi.mock('../../../lib/stores', () => ({
  useDrawerStore: () => ({
    openProjectDrawer: mockOpenProjectDrawer,
  }),
}));

// Mock projects data
const mockProjects = [
  {
    id: 'project-1',
    name: 'Website Redesign',
    clientId: 'client-1',
    clientName: 'Acme Corp',
    field: 'Web Development',
    paidIncomeMinor: 500000, // $5000
    unpaidIncomeMinor: 150000, // $1500
    expensesMinor: 100000, // $1000
    netMinor: 550000, // $5500
    paidIncomeMinorUSD: 500000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 150000,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    expensesMinorUSD: 100000,
    expensesMinorILS: 0,
    expensesMinorEUR: 0,
    lastActivityAt: '2026-03-10',
  },
  {
    id: 'project-2',
    name: 'Mobile App',
    clientId: 'client-2',
    clientName: 'Beta Inc',
    field: 'Mobile Development',
    paidIncomeMinor: 200000, // $2000
    unpaidIncomeMinor: 0,
    expensesMinor: 250000, // $2500 - negative net project
    netMinor: -50000, // -$500
    paidIncomeMinorUSD: 200000,
    paidIncomeMinorILS: 0,
    paidIncomeMinorEUR: 0,
    unpaidIncomeMinorUSD: 0,
    unpaidIncomeMinorILS: 0,
    unpaidIncomeMinorEUR: 0,
    expensesMinorUSD: 250000,
    expensesMinorILS: 0,
    expensesMinorEUR: 0,
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

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
      data: mockProjects,
      isLoading: false,
    } as ReturnType<typeof useQueries.useProjectSummaries>);
  });

  describe('Page rendering', () => {
    it('renders page title', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });

    it('renders search input', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
    });

    it('renders project list', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Website Redesign')).toBeInTheDocument();
      expect(screen.getByText('Mobile App')).toBeInTheDocument();
    });
  });

  describe('Column display', () => {
    it('shows project name column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Project')).toBeInTheDocument();
    });

    it('shows client column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Client')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    it('shows field column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Field')).toBeInTheDocument();
      expect(screen.getByText('Web Development')).toBeInTheDocument();
    });

    it('shows received column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Received')).toBeInTheDocument();
    });

    it('shows unpaid column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Unpaid')).toBeInTheDocument();
    });

    it('shows expenses column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Expenses')).toBeInTheDocument();
    });

    it('shows net column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Net')).toBeInTheDocument();
    });

    it('shows last activity column', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Last Activity')).toBeInTheDocument();
    });
  });

  describe('Net calculation display', () => {
    it('shows positive net values with positive styling', () => {
      renderWithProviders(<ProjectsPage />);
      // After sorting by name A-Z, "Website Redesign" (positive net) comes second
      const rows = document.querySelectorAll('tbody tr');
      const websiteRow = rows[1]; // "Website Redesign" after alphabetical sort
      const netCell = websiteRow?.querySelector('.net-cell.positive');
      expect(netCell).toBeInTheDocument();
    });

    it('shows negative net values with negative styling', () => {
      renderWithProviders(<ProjectsPage />);
      // After sorting by name A-Z, "Mobile App" (negative net) comes first
      const rows = document.querySelectorAll('tbody tr');
      const mobileRow = rows[0]; // "Mobile App" after alphabetical sort
      const netCell = mobileRow?.querySelector('.net-cell.negative');
      expect(netCell).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows empty state when no projects', () => {
      vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useProjectSummaries>);

      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('No projects found')).toBeInTheDocument();
    });

    it('shows add project button in empty state', () => {
      vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useProjectSummaries>);

      renderWithProviders(<ProjectsPage />);
      const addButton = screen.getByRole('button', { name: /add project/i });
      fireEvent.click(addButton);

      expect(mockOpenProjectDrawer).toHaveBeenCalledWith({ mode: 'create' });
    });
  });

  describe('Loading state', () => {
    it('shows loading indicator when fetching', () => {
      vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof useQueries.useProjectSummaries>);

      renderWithProviders(<ProjectsPage />);
      expect(document.querySelector('.spinner')).toBeInTheDocument();
    });
  });

  describe('Project navigation', () => {
    it('renders project names as links', () => {
      renderWithProviders(<ProjectsPage />);
      const link = screen.getByText('Website Redesign');
      expect(link.tagName).toBe('A');
    });
  });

  describe('Summary strip', () => {
    it('shows total projects count', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('2 projects')).toBeInTheDocument();
    });

    it('shows total received amount', () => {
      renderWithProviders(<ProjectsPage />);
      const summaryStrip = document.querySelector('.projects-summary-strip');
      expect(summaryStrip).toBeInTheDocument();
      expect(screen.getByText('Total Received')).toBeInTheDocument();
    });

    it('shows total unpaid amount', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Total Unpaid')).toBeInTheDocument();
    });

    it('shows total expenses amount', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    });

    it('shows total net amount', () => {
      renderWithProviders(<ProjectsPage />);
      expect(screen.getByText('Total Net')).toBeInTheDocument();
    });

    it('does not show summary strip when no projects', () => {
      vi.spyOn(useQueries, 'useProjectSummaries').mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof useQueries.useProjectSummaries>);

      renderWithProviders(<ProjectsPage />);
      const summaryStrip = document.querySelector('.projects-summary-strip');
      expect(summaryStrip).not.toBeInTheDocument();
    });
  });
});
