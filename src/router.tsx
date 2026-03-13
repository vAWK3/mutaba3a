/* eslint-disable react-refresh/only-export-components */
import React, { Suspense } from 'react';
import { createRouter, createRootRoute, createRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppShell } from './components/layout';

// Keep OverviewPage eager (it's the landing page)
import { OverviewPage } from './pages/overview/OverviewPage';

// Simple loading fallback
const PageLoader = () => (
  <div style={{ padding: '2rem', opacity: 0.5 }}>Loading...</div>
);

// Helper for lazy routes with named exports
function lazyPage(
  factory: () => Promise<Record<string, React.ComponentType<unknown>>>,
  exportName: string
) {
  const LazyComponent = React.lazy(() =>
    factory().then((mod) => ({ default: mod[exportName] }))
  );
  return () => (
    <Suspense fallback={<PageLoader />}>
      <LazyComponent />
    </Suspense>
  );
}

// Root route with AppShell layout
const rootRoute = createRootRoute({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

// Overview route
const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
});

// Income route (dedicated income tracking page)
const incomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/income',
  component: lazyPage(() => import('./pages/income'), 'IncomePage'),
});

// Insights route (consolidates reports and money-answers)
const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  component: lazyPage(() => import('./pages/insights'), 'InsightsPage'),
});

// Transactions route (legacy redirect to /income)
const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/income',
      search: search as Record<string, unknown>,
    });
  },
});

// Projects routes
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: lazyPage(() => import('./pages/projects/ProjectsPage'), 'ProjectsPage'),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$projectId',
  component: lazyPage(() => import('./pages/projects/ProjectDetailPage'), 'ProjectDetailPage'),
});

// Clients routes
const clientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients',
  component: lazyPage(() => import('./pages/clients/ClientsPage'), 'ClientsPage'),
});

const clientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clients/$clientId',
  component: lazyPage(() => import('./pages/clients/ClientDetailPage'), 'ClientDetailPage'),
});

// Reports route (legacy redirect to /insights)
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => {
    throw redirect({ to: '/insights' });
  },
});

// Documents routes
const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: lazyPage(() => import('./pages/documents'), 'DocumentsPage'),
});

const documentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/new',
  component: lazyPage(() => import('./pages/documents'), 'DocumentFormPage'),
});

const documentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId',
  component: lazyPage(() => import('./pages/documents'), 'DocumentDetailPage'),
});

const documentEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents/$documentId/edit',
  component: lazyPage(() => import('./pages/documents'), 'DocumentFormPage'),
});

// Settings route
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyPage(() => import('./pages/settings/SettingsPage'), 'SettingsPage'),
});

// Profile detail route (under settings)
const profileDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/profiles/$profileId',
  component: lazyPage(() => import('./pages/settings/ProfileDetailPage'), 'ProfileDetailPage'),
});

// Theme demo route (for visual testing)
const themeDemoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/theme-demo',
  component: lazyPage(() => import('./components/examples/ThemeDemo'), 'ThemeDemo'),
});

// ============================================================================
// Expense Routes
// ============================================================================

// Expenses search params
interface ExpensesSearch {
  year?: number;
  month?: number;
  currency?: 'USD' | 'ILS';
  categoryId?: string;
}

// Main expenses route - uses the new question-first ExpensesLedgerPage
const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses',
  component: lazyPage(() => import('./pages/expenses/ExpensesLedgerPage'), 'ExpensesLedgerPage'),
});

// Profile-based expenses route - legacy profile expense tracking
const expenseProfilesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profiles',
  component: lazyPage(() => import('./pages/expenses/ExpensesPage'), 'ExpensesPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

const profileExpensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId',
  component: lazyPage(() => import('./pages/expenses/ProfileExpensesPage'), 'ProfileExpensesPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
      month: typeof search.month === 'number' ? search.month : undefined,
      currency: search.currency === 'USD' || search.currency === 'ILS' ? search.currency : undefined,
      categoryId: typeof search.categoryId === 'string' ? search.categoryId : undefined,
    };
  },
});

const profileReceiptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/profile/$profileId/receipts',
  component: lazyPage(() => import('./pages/expenses/ReceiptsPage'), 'ReceiptsPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
      month: typeof search.month === 'number' ? search.month : undefined,
    };
  },
});

const expensesOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/overview',
  component: lazyPage(() => import('./pages/expenses/ExpensesOverviewPage'), 'ExpensesOverviewPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

const expensesForecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/forecast',
  component: lazyPage(() => import('./pages/expenses/ExpensesForecastPage'), 'ExpensesForecastPage'),
  validateSearch: (search: Record<string, unknown>): ExpensesSearch => {
    return {
      year: typeof search.year === 'number' ? search.year : undefined,
    };
  },
});

// ============================================================================
// Retainer Routes
// ============================================================================

// Retainers search params
interface RetainersSearch {
  status?: 'draft' | 'active' | 'paused' | 'ended';
  currency?: 'USD' | 'ILS';
  clientId?: string;
}

const retainersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/retainers',
  component: lazyPage(() => import('./pages/retainers/RetainersPage'), 'RetainersPage'),
  validateSearch: (search: Record<string, unknown>): RetainersSearch => {
    return {
      status: search.status === 'draft' || search.status === 'active' || search.status === 'paused' || search.status === 'ended'
        ? search.status
        : undefined,
      currency: search.currency === 'USD' || search.currency === 'ILS' ? search.currency : undefined,
      clientId: typeof search.clientId === 'string' ? search.clientId : undefined,
    };
  },
});

// ============================================================================
// Engagement Routes
// ============================================================================

// Engagement search params for new wizard
interface EngagementNewSearch {
  clientId?: string;
  type?: 'task' | 'retainer';
}

// Engagement list search params
interface EngagementsSearch {
  status?: 'draft' | 'final' | 'archived';
  type?: 'task' | 'retainer';
  clientId?: string;
}

const engagementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/engagements',
  component: lazyPage(() => import('./pages/engagements'), 'EngagementsPage'),
  validateSearch: (search: Record<string, unknown>): EngagementsSearch => {
    return {
      status: search.status === 'draft' || search.status === 'final' || search.status === 'archived'
        ? search.status
        : undefined,
      type: search.type === 'task' || search.type === 'retainer' ? search.type : undefined,
      clientId: typeof search.clientId === 'string' ? search.clientId : undefined,
    };
  },
});

const engagementNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/engagements/new',
  component: lazyPage(() => import('./pages/engagements'), 'EngagementWizardPage'),
  validateSearch: (search: Record<string, unknown>): EngagementNewSearch => {
    return {
      clientId: typeof search.clientId === 'string' ? search.clientId : undefined,
      type: search.type === 'task' || search.type === 'retainer' ? search.type : undefined,
    };
  },
});

const engagementEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/engagements/$engagementId/edit',
  component: lazyPage(() => import('./pages/engagements'), 'EngagementWizardPage'),
});

// ============================================================================
// Money Answers Route (Cash Flow Timeline)
// ============================================================================

interface MoneyAnswersSearch {
  mode?: 'month' | 'year';
  year?: number;
  month?: string;
  includeReceivables?: boolean;
  includeProjections?: boolean;
}

const moneyAnswersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/money-answers',
  component: lazyPage(() => import('./pages/money-answers'), 'MoneyAnswersPage'),
  validateSearch: (search: Record<string, unknown>): MoneyAnswersSearch => {
    return {
      mode: search.mode === 'month' || search.mode === 'year' ? search.mode : undefined,
      year: typeof search.year === 'number' ? search.year : undefined,
      month: typeof search.month === 'string' ? search.month : undefined,
      includeReceivables: typeof search.includeReceivables === 'boolean' ? search.includeReceivables : undefined,
      includeProjections: typeof search.includeProjections === 'boolean' ? search.includeProjections : undefined,
    };
  },
});

// Monthly close search params
interface MonthCloseSearch {
  month?: string;
}

const monthCloseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/expenses/close/profile/$profileId',
  component: lazyPage(() => import('./pages/expenses/MonthCloseChecklistPage'), 'MonthCloseChecklistPage'),
  validateSearch: (search: Record<string, unknown>): MonthCloseSearch => {
    return {
      month: typeof search.month === 'string' ? search.month : undefined,
    };
  },
});

// Create route tree
const routeTree = rootRoute.addChildren([
  overviewRoute,
  // New question-first routes
  incomeRoute,
  insightsRoute,
  // Legacy routes (kept for backwards compatibility)
  transactionsRoute,
  projectsRoute,
  projectDetailRoute,
  clientsRoute,
  clientDetailRoute,
  documentsRoute,
  documentNewRoute,
  documentDetailRoute,
  documentEditRoute,
  // Expense routes
  expensesRoute,
  expenseProfilesRoute,
  profileExpensesRoute,
  profileReceiptsRoute,
  expensesOverviewRoute,
  expensesForecastRoute,
  monthCloseRoute,
  // Retainer routes
  retainersRoute,
  // Engagement routes
  engagementsRoute,
  engagementNewRoute,
  engagementEditRoute,
  // Money Answers route
  moneyAnswersRoute,
  // Reports route
  reportsRoute,
  settingsRoute,
  profileDetailRoute,
  themeDemoRoute,
]);

// Create router with conditional basepath for web build
export const router = createRouter({
  routeTree,
  basepath: __BUILD_MODE__ === 'web' ? '/app' : undefined,
});

// Type declaration for router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
